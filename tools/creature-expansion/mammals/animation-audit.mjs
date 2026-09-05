import * as THREE from 'three';
import {buildSpecies, SPECIES} from '../mammals.mjs';

// Source-only audit. This does not export assets or replace browser acceptance.
// Sample every authored key and the midpoint of every interval, including the
// final pose of one-shots. The default threshold rejects penetration over 25 mm.
const REQUIRED = ['Idle', 'Walk', 'Run', 'Attack', 'Death', 'Hit', 'HitLeft', 'HitRight'];
const LOOPS = new Set(['Idle', 'Walk', 'Run']);
const DEFAULT_MAX_PENETRATION = 0.025;
const rounded = value => Number(value.toFixed(6));

function inspectClip(object, clip) {
  const errors = [];
  const sampleTimes = new Set([0, clip.duration]);
  const names = new Set();
  let maxLoopEndpointDelta = 0;
  let rootHorizontalDelta = 0;
  let rootPositionFound = false;
  if (!Number.isFinite(clip.duration) || clip.duration <= 0) errors.push('duration must be finite and positive');
  if (!clip.tracks.length) errors.push('clip has no tracks');
  for (const track of clip.tracks) {
    if (names.has(track.name)) errors.push(`duplicate track ${track.name}`);
    names.add(track.name);
    let target = null;
    let property = null;
    try {
      const parsed = THREE.PropertyBinding.parseTrackName(track.name);
      target = THREE.PropertyBinding.findNode(object, parsed.nodeName);
      property = parsed.propertyName;
      if (!target || !(property in target)) errors.push(`${track.name}: target or property does not exist`);
      if (parsed.objectName || parsed.objectIndex !== undefined || parsed.propertyIndex !== undefined) {
        errors.push(`${track.name}: audit expects direct node property tracks`);
      }
    } catch (error) {
      errors.push(`${track.name}: invalid binding, ${error.message}`);
    }
    const size = track.getValueSize();
    if (!track.times.length || !Number.isInteger(size) || size <= 0) {
      errors.push(`${track.name}: invalid key/value array sizes`);
      continue;
    }
    if (target?.[property]?.isVector3 && size !== 3) errors.push(`${track.name}: vector track must have three values per key`);
    if (target?.[property]?.isQuaternion && size !== 4) errors.push(`${track.name}: quaternion track must have four values per key`);
    let finite = true;
    for (let i = 0; i < track.times.length; i++) {
      const time = track.times[i];
      if (!Number.isFinite(time)) {
        errors.push(`${track.name}: non-finite key time at ${i}`);
        finite = false;
        break;
      }
      if (i && time <= track.times[i - 1]) errors.push(`${track.name}: key times are not strictly increasing at ${i}`);
      if (time < -1e-6 || time > clip.duration + 1e-6) errors.push(`${track.name}: key time outside clip at ${i}`);
      sampleTimes.add(THREE.MathUtils.clamp(time, 0, clip.duration));
    }
    for (let i = 0; i < track.values.length; i++) {
      if (!Number.isFinite(track.values[i])) {
        errors.push(`${track.name}: non-finite value at ${i}`);
        finite = false;
        break;
      }
    }
    if (!finite) continue;
    if (Math.abs(track.times[0]) > 1e-6 || Math.abs(track.times.at(-1) - clip.duration) > 1e-6) {
      errors.push(`${track.name}: keys do not cover both clip endpoints`);
    }
    if (LOOPS.has(clip.name)) {
      let delta = 0;
      for (let component = 0; component < size; component++) {
        delta = Math.max(delta, Math.abs(track.values[component] - track.values[track.values.length - size + component]));
      }
      maxLoopEndpointDelta = Math.max(maxLoopEndpointDelta, delta);
      // Deliberately exact. The authoring function copies the first pose into
      // the final key, so a tolerance would hide a regression in that contract.
      if (delta !== 0) errors.push(`${track.name}: loop endpoints differ by ${delta}`);
      if (target?.name === 'Root' && property === 'position' && size === 3) {
        rootPositionFound = true;
        for (let i = 0; i < track.values.length; i += 3) {
          rootHorizontalDelta = Math.max(rootHorizontalDelta,
            Math.abs(track.values[i] - track.values[0]),
            Math.abs(track.values[i + 2] - track.values[2]));
        }
      }
    }
  }
  if (LOOPS.has(clip.name)) {
    if (!rootPositionFound) errors.push('missing Root.position track');
    if (rootHorizontalDelta !== 0) errors.push(`Root translates horizontally by ${rootHorizontalDelta} m`);
  }
  const keys = [...sampleTimes].filter(Number.isFinite).sort((a, b) => a - b);
  for (let i = 1; i < keys.length; i++) sampleTimes.add((keys[i - 1] + keys[i]) / 2);
  return {errors, times: [...sampleTimes].filter(Number.isFinite).sort((a, b) => a - b), maxLoopEndpointDelta, rootHorizontalDelta};
}

function meshCache(mesh) {
  const position = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.getAttribute('skinIndex');
  const weight = mesh.geometry.getAttribute('skinWeight');
  if (!position || !index || !weight || index.count !== position.count || weight.count !== position.count) {
    throw new Error(`${mesh.name}: missing or mismatched skin attributes`);
  }
  const vertices = new Float64Array(position.count * 3);
  const joints = new Uint32Array(position.count * 4);
  const weights = new Float64Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    vertices.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3);
    let sum = 0;
    for (let component = 0; component < 4; component++) {
      const joint = index.getComponent(i, component);
      const influence = weight.getComponent(i, component);
      if (!Number.isInteger(joint) || joint < 0 || joint >= mesh.skeleton.bones.length || !Number.isFinite(influence) || influence < 0) {
        throw new Error(`${mesh.name}: invalid skin influence at vertex ${i}`);
      }
      joints[i * 4 + component] = joint;
      weights[i * 4 + component] = influence;
      sum += influence;
    }
    if (Math.abs(sum - 1) > 1e-4) throw new Error(`${mesh.name}: skin weights sum to ${sum} at vertex ${i}`);
  }
  if (!vertices.every(Number.isFinite)) throw new Error(`${mesh.name}: non-finite source vertex`);
  return {mesh, vertices, joints, weights, rows: new Float64Array(mesh.skeleton.bones.length * 4)};
}

function sampleGround(object, caches, maxPenetration) {
  object.updateMatrixWorld(true);
  for (const skeleton of new Set(caches.map(cache => cache.mesh.skeleton))) skeleton.update();
  let lowest = Infinity;
  let lowestMesh = null;
  let lowestVertex = -1;
  let belowThreshold = 0;
  const outer = new THREE.Matrix4();
  const bone = new THREE.Matrix4();
  for (const cache of caches) {
    const {mesh, vertices, joints, weights, rows} = cache;
    outer.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
    // Precompute only the world Y row of each skin transform. This visits every
    // vertex without allocating vectors for four influences at every sample.
    for (let i = 0; i < mesh.skeleton.bones.length; i++) {
      bone.fromArray(mesh.skeleton.boneMatrices, i * 16).premultiply(outer).multiply(mesh.bindMatrix);
      const e = bone.elements;
      rows.set([e[1], e[5], e[9], e[13]], i * 4);
    }
    for (let i = 0; i < vertices.length / 3; i++) {
      const x = vertices[i * 3], y = vertices[i * 3 + 1], z = vertices[i * 3 + 2];
      let worldY = 0;
      for (let component = 0; component < 4; component++) {
        const slot = i * 4 + component, influence = weights[slot];
        if (!influence) continue;
        const row = joints[slot] * 4;
        worldY += influence * (rows[row] * x + rows[row + 1] * y + rows[row + 2] * z + rows[row + 3]);
      }
      if (!Number.isFinite(worldY)) throw new Error(`${mesh.name}: non-finite posed vertex ${i}`);
      if (worldY < lowest) {lowest = worldY; lowestMesh = mesh.name; lowestVertex = i;}
      if (worldY < -maxPenetration) belowThreshold++;
    }
  }
  return {lowest, mesh: lowestMesh, vertex: lowestVertex, belowThreshold};
}

async function auditSpecies(id, maxPenetration) {
  const {object, clips} = await buildSpecies(id);
  const errors = [], reports = [];
  const meshes = [];
  object.traverse(node => {if (node.isSkinnedMesh) meshes.push(node);});
  if (!meshes.length) throw new Error('species has no skinned meshes');
  const caches = meshes.map(meshCache);
  for (const name of REQUIRED) {
    const count = clips.filter(clip => clip.name === name).length;
    if (count !== 1) errors.push(`expected one ${name} clip, found ${count}`);
  }
  const mixer = new THREE.AnimationMixer(object);
  for (const clip of clips) {
    const check = inspectClip(object, clip);
    const report = {clip: clip.name, seconds: rounded(clip.duration), tracks: clip.tracks.length,
      loopEndpointDelta: LOOPS.has(clip.name) ? check.maxLoopEndpointDelta : null,
      rootHorizontalDelta: LOOPS.has(clip.name) ? check.rootHorizontalDelta : null,
      samples: 0, errors: check.errors};
    if (!check.errors.length) {
      mixer.stopAllAction();
      const action = mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      let worst = {lowest: Infinity};
      let peakBelowThreshold = 0;
      try {
        for (const time of check.times) {
          mixer.setTime(time);
          const sample = sampleGround(object, caches, maxPenetration);
          if (sample.lowest < worst.lowest) worst = {...sample, time};
          peakBelowThreshold = Math.max(peakBelowThreshold, sample.belowThreshold);
          report.samples++;
        }
        report.minimumY = rounded(worst.lowest);
        report.maximumPenetration = rounded(Math.max(0, -worst.lowest));
        report.worstPose = {time: rounded(worst.time), mesh: worst.mesh, vertex: worst.vertex};
        report.peakVerticesBelowThreshold = peakBelowThreshold;
        if (worst.lowest < -maxPenetration) report.errors.push(`ground penetration ${rounded(-worst.lowest)} m exceeds ${maxPenetration} m`);
      } catch (error) {
        report.errors.push(error.message);
      }
      action.stop();
    }
    reports.push(report);
    errors.push(...report.errors.map(error => `${clip.name}: ${error}`));
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(object);
  return {id, ok: errors.length === 0, maxPenetration, groundPlaneY: 0,
    sampling: 'all track key times and interval midpoints; all skinned vertices', clips: reports, errors};
}

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node tools/creature-expansion/mammals/animation-audit.mjs [species ...] [--max-penetration=0.025]');
  console.log('Defaults to all mammals. Emits one JSON record per species and a summary. Fails on contract errors or excessive ground penetration.');
} else {
  const toleranceArg = args.find(arg => arg.startsWith('--max-penetration='));
  const maxPenetration = toleranceArg ? Number(toleranceArg.split('=')[1]) : DEFAULT_MAX_PENETRATION;
  const requested = args.filter(arg => !arg.startsWith('--'));
  const ids = requested.length ? requested : SPECIES;
  const unknown = args.filter(arg => arg.startsWith('--') && arg !== toleranceArg);
  if (!Number.isFinite(maxPenetration) || maxPenetration <= 0 || unknown.length || ids.some(id => !SPECIES.includes(id))) {
    console.error('Invalid species or options. Use --help for usage.');
    process.exitCode = 2;
  } else {
    let failed = 0;
    for (const id of ids) {
      try {
        const report = await auditSpecies(id, maxPenetration);
        console.log(JSON.stringify(report));
        if (!report.ok) failed++;
      } catch (error) {
        failed++;
        console.log(JSON.stringify({id, ok: false, errors: [error.message]}));
      }
    }
    console.log(JSON.stringify({summary: {species: ids.length, passed: ids.length - failed, failed, maxPenetration}}));
    if (failed) process.exitCode = 1;
  }
}
