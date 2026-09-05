/**
 * FBX -> GLB conversion, run inside headless Chromium by tools/build-animals.ts.
 *
 * Lives in the browser because three's FBXLoader and GLTFExporter both need DOM APIs Node has no
 * answer for: the loader resolves textures through TextureLoader, and the exporter encodes images
 * through a canvas. Playwright is already a dependency for playtests, so this costs nothing new.
 *
 * Three facts about this source pack drive the whole file, all measured with `probeFbx`:
 *  - The models are authored in CENTIMETRES. A deer measures 187 units tall, so everything is
 *    scaled by 0.01 into the metres-Y-up convention the rest of game/public/assets already uses.
 *  - Every animation ships as its own FBX whose single clip is always called "Take 001". The clip
 *    name has to come from the filename or all six clips on a rig collide.
 *  - Rig and animation files share exact bone names (`Deer_MAINSHJnt`, ...), so clips retarget by
 *    name with no bone remapping. The animation files carry FEWER bones than the rig, which is
 *    fine: a track set that addresses a subset of the skeleton still fits it.
 */
import * as THREE from "three";
import { FBXLoader } from "/node_modules/three/examples/jsm/loaders/FBXLoader.js";
import { GLTFExporter } from "/node_modules/three/examples/jsm/exporters/GLTFExporter.js";

const fbxLoader = new FBXLoader();
const texLoader = new THREE.TextureLoader();
const textureCache = new Map();

/** Source units are centimetres; game/public/assets is metres. */
const CM_TO_M = 0.01;

/**
 * Frame rate the pack was authored at, needed to turn Unity's frame ranges into seconds.
 *
 * Confirmed rather than assumed: the frog take runs 0..627 frames and FBXLoader reports it as
 * 20.90 s, and 627 / 20.90 = 30.0.
 */
const SOURCE_FPS = 30;

// CONTACT_GAIT_HELPERS_START
// Self-contained Three.js helpers. The Node calibration tool evaluates this exact block,
// so imported source metadata and shipped-GLB metadata use the same contact calculation.
function legacyContactProfile(root, assetId = "") {
  const has = name => Boolean(root.getObjectByName(name));
  const groups = [];
  const paired = names => names.filter(has).map(name => [name]);
  if (has("Chicken_l_Toe_01_03SHJnt")) {
    for (const side of ["l", "r"]) groups.push(["01", "02", "03"].map(toe => `Chicken_${side}_Toe_${toe}_03SHJnt`).filter(has));
  } else if (has("CATRigLArmPalm")) {
    groups.push(...paired(["CATRigLArmPalm", "CATRigRArmPalm", "CATRigLLegDigit11", "CATRigRLegDigit11"]));
  } else if (has("toes_01l") && has("toes_01r")) {
    groups.push(["toes_01l"], ["toes_01r"]);
  } else if (has("Scorpion_l_FrontLeg_ToeSHJnt")) {
    groups.push(...paired(["l", "r"].flatMap(side => ["FrontLeg", "MidFrontLeg", "MidBackLeg", "BackLeg"].map(leg => `Scorpion_${side}_${leg}_ToeSHJnt`))));
  } else {
    for (const prefix of ["Cow", "Goat", "WildRabbit", "Deer", "Wolf", "Bear", "WildBoar", "Ibex"]) {
      if (!has(`${prefix}_l_FrontLeg_BallSHJnt`)) continue;
      // Distal unweighted toe helpers can curl beneath the actual sole during rollover.
      // These reviewed ball anchors were cross-checked against the skinned foot surface.
      groups.push(...paired(["l", "r"].flatMap(side => ["FrontLeg", "HindLeg"].map(leg => `${prefix}_${side}_${leg}_BallSHJnt`))));
      break;
    }
  }
  if (!groups.length && /(?:^|_)hog(?:_|$)/i.test(assetId)) groups.push(...paired(["Bone027", "Bone027(mirrored)", "Bone033", "Bone033(mirrored)"]));
  if (!groups.length && /(?:^|_)rat(?:_|$)/i.test(assetId)) groups.push(...paired(["Bone029", "Bone029(mirrored)", "Bone034", "Bone034(mirrored)"]));
  if (!groups.length && /(?:^|_)frog(?:_|$)/i.test(assetId)) groups.push(...paired(["Bone017", "Bone017(mirrored)", "Bone013(mirrored)", "Bone013(mirrored)(mirrored)"]));
  return { groups, axis: "z", direction: 1, heightM: /frog/i.test(assetId) ? .003 : /scorpion/i.test(assetId) ? .003 : .01 };
}

function measureProxyContactGait(root, clip, options = {}) {
  if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0) return { speedMps: null, reason: "missing-clip", feet: [] };
  const profile = { ...legacyContactProfile(root, options.assetId), ...options };
  const groups = profile.groups.filter(group => group.length);
  if (!groups.length) return { speedMps: null, reason: "no-reviewed-ground-contact-points", feet: [] };
  const count = profile.samples ?? 1920, axis = profile.axis ?? "z", direction = profile.direction ?? 1;
  if (!Number.isInteger(count) || count < 120 || count > 7680 || !["x", "z"].includes(axis)
    || ![1, -1].includes(direction) || !Number.isFinite(profile.heightM) || profile.heightM <= 0) throw new Error("Invalid contact sampling profile");
  const median = values => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
  const percentile = (values, fraction) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]; };
  const saved = [];
  root.traverse(node => saved.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(),
    matrix: node.matrix.clone(), matrixWorld: node.matrixWorld.clone(), matrixWorldNeedsUpdate: node.matrixWorldNeedsUpdate,
    bindMatrix: node.isSkinnedMesh ? node.bindMatrix.clone() : null, bindMatrixInverse: node.isSkinnedMesh ? node.bindMatrixInverse.clone() : null,
    morphTargetInfluences: node.morphTargetInfluences?.slice() }));
  const nodes = [...new Set(groups.flat())].map(name => {
    const node = root.getObjectByName(name);
    if (!node) throw new Error(`Missing reviewed contact node ${name}`);
    return { node, positions: [] };
  });
  const mixer = new THREE.AnimationMixer(root), action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
  const dt = clip.duration / count, position = new THREE.Vector3();
  try {
    for (let index = 0; index <= count; index++) {
      mixer.setTime(index * dt); root.updateMatrixWorld(true);
      for (const row of nodes) {
        row.node.getWorldPosition(position);
        if (![position.x, position.y, position.z].every(Number.isFinite)) throw new Error(`Non-finite contact ${row.node.name}`);
        row.positions.push({ x: position.x, y: position.y, z: position.z });
      }
    }
  } finally {
    mixer.stopAllAction(); mixer.uncacheRoot(root);
    for (const pose of saved) {
      const node = pose.node;
      node.position.copy(pose.position); node.quaternion.copy(pose.quaternion); node.scale.copy(pose.scale);
      node.matrix.copy(pose.matrix); node.matrixWorld.copy(pose.matrixWorld); node.matrixWorldNeedsUpdate = pose.matrixWorldNeedsUpdate;
      if (pose.bindMatrix) { node.bindMatrix.copy(pose.bindMatrix); node.bindMatrixInverse.copy(pose.bindMatrixInverse); }
      if (pose.morphTargetInfluences) for (let index = 0; index < pose.morphTargetInfluences.length; index++) node.morphTargetInfluences[index] = pose.morphTargetInfluences[index];
    }
  }
  const contacts = nodes.map(({ node, positions }) => {
    const minY = Math.min(...positions.map(p => p.y)), maxY = Math.max(...positions.map(p => p.y));
    const speeds = [], lateral = [], phases = [];
    for (let index = 1; index <= count; index++) {
      const a = positions[index - 1], b = positions[index];
      if (Math.max(a.y, b.y) > minY + profile.heightM) continue;
      const speed = -direction * (b[axis] - a[axis]) / dt;
      if (speed <= 1e-5) continue;
      speeds.push(speed); lateral.push(Math.abs(b[axis === "z" ? "x" : "z"] - a[axis === "z" ? "x" : "z"]) / dt); phases.push((index - .5) / count);
    }
    return { bone: node.name, minY, maxY, samples: speeds.length, medianMps: median(speeds), p10Mps: percentile(speeds, .1), p90Mps: percentile(speeds, .9), lateralMedianMps: median(lateral), phases, speeds };
  });
  // One vote per physical foot: three toes must not outweigh another animal's one hoof.
  const feet = groups.map(names => {
    const rows = contacts.filter(row => names.includes(row.bone));
    const speeds = rows.flatMap(row => row.speeds);
    return { bones: names, samples: speeds.length, medianMps: median(speeds), p10Mps: percentile(speeds, .1), p90Mps: percentile(speeds, .9) };
  });
  const accepted = feet.filter(foot => foot.samples >= 8 && foot.medianMps > 0);
  const speedMps = accepted.length === feet.length ? median(accepted.map(foot => foot.medianMps)) : null;
  return { speedMps, reason: speedMps === null ? "insufficient-contact-samples" : null,
    method: "bone-proxy-backward-contact-velocity", duration: clip.duration, sampleCount: count, axis, direction, heightM: profile.heightM,
    feet, contacts: contacts.map(({ speeds, ...row }) => row) };
}

function legacyPhysicalContactProfile(root, assetId = "") {
  const known = { animal_chicken: "Chicken", animal_chicken_speckled: "Chicken", animal_cattle: "Cow", animal_aurochs: "Cow", animal_goat: "Goat", animal_rabbit: "WildRabbit", animal_rabbit_dark: "WildRabbit", animal_deer: "Deer", animal_coyote: "Wolf", animal_bear: "Bear", animal_boar: "WildBoar", animal_ibex: "Ibex", animal_hog: "hog", animal_rat: "rat" };
  let type = known[assetId];
  if (!type) {
    if (root.getObjectByName("Chicken_l_Toe_01_03SHJnt")) type = "Chicken";
    else type = ["Cow", "Goat", "WildRabbit", "Deer", "Wolf", "Bear", "WildBoar", "Ibex"].find(prefix => root.getObjectByName(`${prefix}_l_FrontLeg_BallSHJnt`));
  }
  if (!type) return null;
  const names = new Map();
  const expectedFeet = type === "Chicken" ? ["l", "r"] : ["l_FrontLeg", "l_HindLeg", "r_FrontLeg", "r_HindLeg"];
  if (type === "hog" || type === "rat") {
    expectedFeet.splice(0, expectedFeet.length, "negativeX_front", "negativeX_hind", "positiveX_front", "positiveX_hind");
    const front = type === "hog" ? [25, 26, 27] : [27, 28, 29], hind = type === "hog" ? [31, 32, 33] : [32, 33, 34];
    for (const suffix of ["", "(mirrored)"]) for (const [end, chain] of [["front", front], ["hind", hind]]) {
      for (const number of chain) names.set(`Bone${String(number).padStart(3, "0")}${suffix}`.replace(/[^\w]/g, ""), `${suffix ? "positiveX" : "negativeX"}_${end}`);
    }
  }
  return { type, expectedFeet, names, soleBandM: type === "hog" ? .008 : type === "rat" ? .002 : .005 };
}

function measurePhysicalContactGait(root, clip, options, profile) {
  const count = options.samples ?? 1920, axis = options.axis ?? "z", direction = options.direction ?? 1;
  const requestedHeightM = options.heightM ?? .01, heightM = Math.min(.01, requestedHeightM);
  if (!Number.isInteger(count) || count < 120 || count > 7680 || !["x", "z"].includes(axis)
    || ![1, -1].includes(direction) || !Number.isFinite(requestedHeightM) || heightM <= 0) throw new Error("Invalid contact sampling profile");
  const median = values => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
  const percentile = (values, fraction) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]; };
  const base = { method: "physical-sole-backward-contact-velocity", duration: clip.duration, sampleCount: count, axis, direction, heightM,
    physicalContact: true, metadataAloneProvesPlanting: false };
  const saved = [];
  root.traverse(node => saved.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(),
    matrix: node.matrix.clone(), matrixWorld: node.matrixWorld.clone(), matrixWorldNeedsUpdate: node.matrixWorldNeedsUpdate,
    bindMatrix: node.isSkinnedMesh ? node.bindMatrix.clone() : null, bindMatrixInverse: node.isSkinnedMesh ? node.bindMatrixInverse.clone() : null,
    morphTargetInfluences: node.morphTargetInfluences?.slice() }));
  let mixer;
  try {
    root.updateMatrixWorld(true);
    const candidates = new Map(), point = new THREE.Vector3();
    root.traverse(mesh => {
      if (!mesh.isSkinnedMesh) return;
      const positions = mesh.geometry.getAttribute("position"), joints = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
      if (!positions || !joints || !weights) return;
      for (let index = 0; index < positions.count; index++) {
        const groupWeights = new Map(), groupBones = new Map();
        for (let influence = 0; influence < weights.itemSize; influence++) {
          const bone = mesh.skeleton.bones[joints.getComponent(index, influence)];
          if (!bone) throw new Error("Invalid skin joint while measuring physical contact");
          const name = bone.name;
          const match = profile.type === "Chicken" ? /^Chicken_([lr])_(?:Toe|Leg_Ankle)/.exec(name) : /_(l|r)_(FrontLeg|HindLeg)_(?:Ankle|Ball|Toe)/.exec(name);
          const unnamed = profile.names.get(name.replace(/[^\w]/g, ""));
          if (!match && !unnamed) continue;
          const foot = unnamed ?? (profile.type === "Chicken" ? match[1] : `${match[1]}_${match[2]}`);
          const weight = weights.getComponent(index, influence);
          groupWeights.set(foot, (groupWeights.get(foot) ?? 0) + weight);
          if (weight > 0) { const names = groupBones.get(foot) ?? new Set(); names.add(name); groupBones.set(foot, names); }
        }
        const best = [...groupWeights.entries()].sort((a, b) => b[1] - a[1])[0];
        if (!best || best[1] < .5) continue;
        mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
        if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error("Non-finite physical rest sole");
        const group = candidates.get(best[0]) ?? [];
        group.push({ mesh, index, rest: point.toArray(), positions: [], bones: [...groupBones.get(best[0])] });
        candidates.set(best[0], group);
      }
    });
    const groups = [...candidates].map(([foot, vertices]) => {
      const floorY = Math.min(...vertices.map(vertex => vertex.rest[1]));
      const low = vertices.filter(vertex => vertex.rest[1] <= floorY + profile.soleBandM);
      const cells = new Map();
      for (const vertex of low) {
        const key = `${Math.round(vertex.rest[0] / .004)}:${Math.round(vertex.rest[2] / .004)}`;
        if (!cells.has(key) || cells.get(key).rest[1] > vertex.rest[1]) cells.set(key, vertex);
      }
      return { foot, floorY, vertices: [...cells.values()] };
    });
    const missingFeet = profile.expectedFeet.filter(foot => !groups.some(group => group.foot === foot && group.vertices.length));
    if (missingFeet.length || groups.length !== profile.expectedFeet.length) return { ...base, speedMps: null, reason: "missing-reviewed-physical-foot-group", missingFeet, feet: [], cadenceQualityFlags: ["missingPhysicalContact"], inconsistentSourceContacts: true };
    mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
    for (let index = 0; index <= count; index++) {
      mixer.setTime(index * clip.duration / count); root.updateMatrixWorld(true);
      for (const group of groups) for (const vertex of group.vertices) {
        vertex.mesh.getVertexPosition(vertex.index, point).applyMatrix4(vertex.mesh.matrixWorld);
        if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error("Non-finite animated physical sole");
        vertex.positions.push(point.toArray());
      }
    }
    const dt = clip.duration / count, forwardIndex = axis === "z" ? 2 : 0;
    const feet = groups.map(group => {
      const phaseSpeeds = Array.from({ length: count }, () => []), vertical = [];
      let minY = Infinity, maxY = -Infinity, belowFloorSamples = 0;
      for (const vertex of group.vertices) {
        for (let index = 1; index < vertex.positions.length; index++) {
          const a = vertex.positions[index - 1], b = vertex.positions[index];
          minY = Math.min(minY, a[1], b[1]); maxY = Math.max(maxY, a[1], b[1]);
          const backward = -direction * (b[forwardIndex] - a[forwardIndex]) / dt, vy = Math.abs((b[1] - a[1]) / dt);
          if (b[1] < group.floorY - .010) belowFloorSamples++;
          if (backward <= 1e-6 || vy > .1 * backward + .01 || Math.abs(a[1] - group.floorY) > heightM || Math.abs(b[1] - group.floorY) > heightM) continue;
          phaseSpeeds[index - 1].push(backward); vertical.push(vy);
        }
      }
      const speeds = phaseSpeeds.flatMap(values => values.length ? [median(values)] : []);
      const p10Mps = percentile(speeds, .1), p90Mps = percentile(speeds, .9);
      return { foot: group.foot, bones: [...new Set(group.vertices.flatMap(vertex => vertex.bones))].sort(), samples: speeds.length,
        medianMps: median(speeds), p10Mps, p90Mps, selectedSoleVertices: group.vertices.length, restFloorY: group.floorY, minY, maxY,
        belowRestFloor10mmVertexSamples: belowFloorSamples, totalVertexSamples: group.vertices.length * count,
        verticalMedianMps: median(vertical), sparseContact: speeds.length < count * .1,
        stanceVelocityVaries: p10Mps === null || p90Mps === null || p90Mps / Math.max(p10Mps, 1e-6) > 1.25 };
    });
    const accepted = feet.filter(foot => foot.samples >= 8 && foot.medianMps > 0);
    const speedMps = accepted.length === feet.length ? median(accepted.map(foot => foot.medianMps)) : null;
    const rates = accepted.map(foot => foot.medianMps);
    const maxToMinFootMedianRatio = rates.length ? Math.max(...rates) / Math.min(...rates) : null;
    const physicalFootMediansDisagree = accepted.length !== feet.length || maxToMinFootMedianRatio > 1.1;
    const cadenceQualityFlags = [...(physicalFootMediansDisagree ? ["physicalFootMediansDisagree"] : []), ...(feet.some(foot => foot.stanceVelocityVaries) ? ["velocityVariesWithinStance"] : []), ...(feet.some(foot => foot.sparseContact) ? ["sparsePhysicalContact"] : [])];
    return { ...base, speedMps, reason: speedMps === null ? "insufficient-physical-contact-samples" : null, feet,
      maxToMinFootMedianRatio, physicalFootMediansDisagree, cadenceQualityFlags, inconsistentSourceContacts: cadenceQualityFlags.length > 0,
      contactMask: "Per-foot rest sole plane +/-10mm maximum; positive backward speed; abs(vertical)<=0.1*backward+0.01m/s",
      aggregation: "Median contact vertex velocity per physical foot phase, median across phases, equal median vote per foot" };
  } finally {
    if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(root); }
    for (const pose of saved) {
      const node = pose.node;
      node.position.copy(pose.position); node.quaternion.copy(pose.quaternion); node.scale.copy(pose.scale);
      node.matrix.copy(pose.matrix); node.matrixWorld.copy(pose.matrixWorld); node.matrixWorldNeedsUpdate = pose.matrixWorldNeedsUpdate;
      if (pose.bindMatrix) { node.bindMatrix.copy(pose.bindMatrix); node.bindMatrixInverse.copy(pose.bindMatrixInverse); }
      if (pose.morphTargetInfluences) for (let index = 0; index < pose.morphTargetInfluences.length; index++) node.morphTargetInfluences[index] = pose.morphTargetInfluences[index];
    }
  }
}

function measureContactGait(root, clip, options = {}) {
  if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0) return { speedMps: null, reason: "missing-clip", feet: [] };
  // Explicit groups preserve synthetic tests and reviewed exotic/boss proxy profiles.
  if (options.groups !== undefined) return measureProxyContactGait(root, clip, options);
  const physical = legacyPhysicalContactProfile(root, options.assetId);
  if (physical) return measurePhysicalContactGait(root, clip, options, physical);
  return measureProxyContactGait(root, clip, options);
}
// CONTACT_GAIT_HELPERS_END

function boxOf(object) {
  const box = new THREE.Box3();
  object.updateWorldMatrix(true, true);
  object.traverse((node) => {
    if (!node.isMesh && !node.isSkinnedMesh) return;
    if (!node.geometry) return;
    node.geometry.computeBoundingBox();
    box.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
  });
  return box;
}

function trackTargets(clip) {
  const names = new Set();
  for (const track of clip.tracks) names.add(track.name.split(".")[0]);
  return [...names];
}

/** Clips that play on LoopRepeat, and therefore have to join back to their own first frame. */
const LOOPING_CLIPS = new Set(["Idle", "Walk", "Run"]);

/** Angle between two quaternions, in degrees, sign-insensitive. */
function quatAngle(v, i, j) {
  const dot = Math.abs(v[i] * v[j] + v[i + 1] * v[j + 1] + v[i + 2] * v[j + 2] + v[i + 3] * v[j + 3]);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

/**
 * Makes a looping clip end on the pose it starts on, so the repeat is invisible.
 *
 * A cycle authored in Unity closes because the artist made the last frame return to the first. The
 * ranges we cut with do not always preserve that: an `_exp` take packs several motions end to end
 * and its recorded walk range stops at the last DISTINCT frame, not at the repeat of the first. The
 * mixer then plays the closing pose and jumps straight to the opening one in a single display
 * frame. Measured on the shipped rigs: the deer walk crosses 5 degrees in that one frame against a
 * 1 degree per frame cycle, and the frog 12 against 2. That reads as the legs snapping mid-stride,
 * once per cycle, which is exactly the report.
 *
 * The repair is to append the FIRST keyframe of every track back onto the end. The wrap then joins
 * a pose to itself and is exact by construction, and the seam becomes ordinary interpolated motion
 * instead of a teleport.
 *
 * How much time that seam gets is measured, not guessed. The gap is divided by the clip's own
 * median per-frame motion to say how many frames' worth of movement it represents, and it is given
 * that many frames to cross so the limb keeps the speed it had. Capped at four frames because
 * beyond that the clip was never a cycle and stretching the seam only hides it, and skipped
 * entirely under 1.5 frames, where the cycle already closes to within its own frame rate.
 *
 * Returns whether it changed anything, so the build log can say which clips needed it.
 */
function closeLoop(clip, fps) {
  // Two readings of the same seam, because either one alone misses cases.
  //
  // `seamFrames` is the gap in units of the clip's own frame rate, which is what decides how much
  // time the repair gets. It can only be taken from a track that actually moves; a bone drifting a
  // fraction of a degree per frame has no frame rate to divide by and would report a ratio in the
  // hundreds from rounding noise alone.
  //
  // `maxGap` is the raw angle, and it is the one that catches the deer. Its seam sits on a slow
  // bone whose per-frame motion is under that noise floor, so the ratio test skipped it - but
  // `resample` later thins exactly those near-constant tracks, the surviving frames get further
  // apart, and the 5 degree gap is left standing in the shipped file. Measured on the ratio alone
  // the deer walk reads 1.32 frames and looks fine; measured in the GLB it pops at 6x a frame.
  let seamFrames = 0;
  let maxGap = 0;
  for (const track of clip.tracks) {
    if (track.getValueSize() !== 4 || !/\.quaternion$/.test(track.name)) continue;
    const values = track.values;
    const count = Math.floor(values.length / 4);
    if (count < 3) continue;
    const gap = quatAngle(values, 0, (count - 1) * 4);
    if (gap < 0.05) continue;
    maxGap = Math.max(maxGap, gap);
    const steps = [];
    for (let i = 1; i < count; i += 1) steps.push(quatAngle(values, (i - 1) * 4, i * 4));
    steps.sort((a, b) => a - b);
    const median = steps[Math.floor(steps.length / 2)];
    if (median <= 0.5) continue;
    seamFrames = Math.max(seamFrames, gap / median);
  }

  // Two degrees is below what reads as a pop on any of these rigs and above the float noise a
  // closed cycle carries: the clips the pack really does close measure 0.0.
  if (seamFrames <= 1.5 && maxGap <= 2) return seamFrames;

  const frames = Math.min(4, Math.max(1, Math.round(seamFrames)));
  const end = clip.duration + frames / fps;
  for (const track of clip.tracks) {
    const size = track.getValueSize();
    if (track.times.length < 2) continue;
    const times = new Float32Array(track.times.length + 1);
    times.set(track.times);
    times[track.times.length] = end;
    const values = new Float32Array(track.values.length + size);
    values.set(track.values);
    for (let c = 0; c < size; c += 1) values[track.values.length + c] = track.values[c];
    track.times = times;
    track.values = values;
  }
  clip.resetDuration();
  return Math.max(seamFrames, 1);
}

async function loadTexture(url, { linear = false } = {}) {
  // Linear and sRGB reads of one file are different textures to the exporter, so they cache apart.
  const key = linear ? `linear:${url}` : url;
  let cached = textureCache.get(key);
  if (!cached) {
    cached = texLoader.loadAsync(url).then((texture) => {
      // Normal maps are vector data, not colour: run them through the sRGB transfer curve and
      // every surface acquires a subtle skew toward its own tangent.
      texture.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      // FBX uses the source atlas orientation. GLTFExporter bakes this flip into its image.
      // Forcing false assigned white belly/eye texels to bear legs and split the neck atlas.
      texture.flipY = true;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      return texture;
    });
    textureCache.set(key, cached);
  }
  return cached;
}

window.probeFbx = async (url) => {
  const group = await fbxLoader.loadAsync(url);
  const box = boxOf(group);
  const size = box.getSize(new THREE.Vector3());
  const meshes = [];
  let boneCount = 0;
  group.traverse((node) => {
    if (node.isBone) boneCount += 1;
    if (!node.isMesh && !node.isSkinnedMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    meshes.push({
      name: node.name,
      skinned: Boolean(node.isSkinnedMesh),
      verts: node.geometry.attributes.position.count,
      materials: materials.filter(Boolean).map((m) => m.name || "(unnamed)"),
    });
  });
  return {
    sizeCm: [size.x, size.y, size.z],
    sizeM: [size.x * CM_TO_M, size.y * CM_TO_M, size.z * CM_TO_M],
    minM: [box.min.x * CM_TO_M, box.min.y * CM_TO_M, box.min.z * CM_TO_M],
    meshes,
    boneCount,
    animations: group.animations.map((clip) => ({
      name: clip.name, duration: clip.duration, tracks: clip.tracks.length,
      targetCount: trackTargets(clip).length,
    })),
  };
};

/**
 * Build one animal GLB.
 *
 * spec: {
 *   rig: url, texture: url, textureOverrides?: { [meshNameSubstring]: url },
 *   emissive?: url, emissiveIntensity?: number,   // bosses only; animals ship base colour alone
 *   materialName?: string,   // minibosses only; see the tier-tint contract note below
 *   clips: [{ url, name, frames?, take? }],
 *   dropRigClips?: boolean   // the rig's own stub "Take 001" is 0.03 s of nothing
 * }
 *
 * `take` names the FBX AnimStack the clip comes from, for packs that ship EVERY motion as its own
 * named take inside one file (the miniboss rig carries eleven). Without it the entry keeps the
 * historical `animations[0]` behaviour, which is correct for the animal and boss packs where each
 * file holds exactly one take. A named take that is not in the file is a hard per-clip failure in
 * the report - never a silent fall-back to `animations[0]`, because the wrong take plays SOME
 * animation and the mistake only surfaces as "the monster idles through its own death".
 */
window.convertAnimal = async (spec) => {
  const root = await fbxLoader.loadAsync(spec.rig);

  // The pack's own materials point at .tga files that were never shipped beside the FBX and would
  // 404 anyway. Replace them outright with one lit material per mesh: base colour, plus an emissive
  // map where the source has one. No normal or ORM maps, like the rest of the asset library.
  const baseTexture = await loadTexture(spec.texture);
  const overrides = new Map();
  for (const [match, url] of Object.entries(spec.textureOverrides ?? {})) {
    overrides.set(match, await loadTexture(url));
  }
  // Optional, and no animal uses it. The elemental bosses do: their glow is authored as an emissive
  // map of seams and plates, and without it a boss is the same flat-lit hide as a goat.
  const emissiveTexture = spec.emissive ? await loadTexture(spec.emissive) : null;

  const meshNames = [];
  root.traverse((node) => {
    if (!node.isMesh && !node.isSkinnedMesh) return;
    meshNames.push(node.name);
    let texture = baseTexture;
    for (const [match, override] of overrides) {
      if (node.name.toLowerCase().includes(match.toLowerCase())) texture = override;
    }
    const material = new THREE.MeshStandardMaterial({
      map: texture, roughness: 0.86, metalness: 0,
      ...(emissiveTexture
        ? {
            emissiveMap: emissiveTexture,
            // White, so the map's own colour is what shows. Tinting here instead would multiply
            // twice: the maps are already recoloured per element when they are staged.
            emissive: new THREE.Color(0xffffff),
            emissiveIntensity: spec.emissiveIntensity ?? 1,
          }
        : {}),
      // Several of these textures carry a real alpha channel for fins, fur cards and wing
      // membranes. Alpha test rather than blend: sorted transparency on an instanced crowd of
      // animals is not worth the cost, and these masks are hard-edged anyway.
      alphaTest: spec.alphaTest ?? 0,
      side: spec.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    // `render/entityViews.ts` exempts materials matching /^(animal|boss)_/i from the tier tint,
    // so an id that starts with neither (miniboss_*) must override the name to keep its authored
    // texture. The override is the caller's contract with that regex, not a cosmetic choice.
    material.name = spec.materialName ?? `${spec.id}_mat`;
    if (Array.isArray(node.material)) node.material = node.material.map(() => material);
    else node.material = material;
    node.frustumCulled = false;
  });

  // The hierarchy root of the skeleton: the one bone whose parent is not itself a bone. Everything
  // that needs "the bone that carries the whole animal" resolves through this rather than a name.
  const allBones = [];
  root.traverse((node) => { if (node.isBone) allBones.push(node); });
  const rootBone = allBones.find((bone) => !bone.parent?.isBone) ?? allBones[0] ?? null;
  const rootBoneName = rootBone ? rootBone.name : null;

  // Nodes whose transform can actually reach a vertex: the bones every skin binds to, plus the
  // mesh nodes themselves, which some rigs animate directly instead of their skeleton.
  const deformingNodes = new Set();
  root.traverse((node) => {
    if (node.isSkinnedMesh) {
      deformingNodes.add(node.name);
      for (const bone of node.skeleton?.bones ?? []) deformingNodes.add(bone.name);
    } else if (node.isMesh) {
      deformingNodes.add(node.name);
    }
  });

  const clips = [];
  const clipReport = [];
  // Every NAMED node, not just bones. The fish rigs animate their mesh node directly rather than
  // only their skeleton, so a bones-only set reports a perfectly good clip as broken.
  const rigNodes = new Set();
  root.traverse((node) => { if (node.name) rigNodes.add(node.name); });

  for (const entry of spec.clips) {
    const source = await fbxLoader.loadAsync(entry.url);
    // A named take selects its AnimStack exactly; anything else keeps the historical "first take"
    // read. Missing takes are reported and NOT substituted - see the spec comment above.
    let clip = entry.take
      ? source.animations.find((candidate) => candidate.name === entry.take)
      : source.animations[0];
    if (!clip) {
      const available = source.animations.map((candidate) => candidate.name).join(", ") || "(none)";
      clipReport.push({
        name: entry.name, ok: false,
        reason: entry.take ? `take "${entry.take}" not in file; has: ${available}` : "no clip in file",
      });
      continue;
    }

    // Cut the clip down to the frame range Unity recorded for it.
    //
    // Half the pack's animation files are not single clips. The `_exp` rigs each ship one long take
    // covering every motion, and the motions are sub-ranges of it, so taking `animations[0]` whole
    // gave the frog, hog, rat and crab four IDENTICAL clips - the same 20.9 s take for idle, walk,
    // attack and death, which is why they never appeared to change animation. The ranges come from
    // the `.meta` sidecars via `stage-clip-ranges.py`; `entry.frames` may narrow them further,
    // which is how a 230-frame feeding cycle becomes a peck. See catalog.mjs.
    const frames = entry.frames;
    if (frames) {
      const [first, last] = frames;
      // Unity's frame numbers are 1-BASED for the single-motion files, and the file holds exactly
      // one cycle. `Ibex_Run` is 14 keys, frames 0 to 13, and frame 13 returns to frame 0's pose -
      // a closed loop - while Unity records the range as 1..14. Subclipping to 1..13 therefore
      // dropped frame 0 and every repeat jumped from the closing pose back to frame 1 instead,
      // measured at 51 degrees against a 7 degree frame. That is the jittery walk.
      //
      // So a range that spans the whole take is left alone: the take already IS the clip. Only the
      // `_exp` rigs, which pack many motions into one long take, get cut, and their ranges are
      // genuine 0-based offsets into it.
      const totalFrames = Math.round(clip.duration * SOURCE_FPS);
      const wholeTake = first <= 1 && last >= totalFrames;
      if (!wholeTake && last > first) {
        // Searching a window around the recorded end for a better cycle match was tried and
        // removed: judged on the single widest-travel track it picks frames that match there and
        // nowhere else, which left the hog wrapping 55 degrees where it had been clean.
        clip = THREE.AnimationUtils.subclip(clip, entry.name, first, last, SOURCE_FPS);
      }
    }
    clip.name = entry.name;
    // Prove the clip addresses this rig before it ships. A silently non-fitting clip is the exact
    // failure that makes an enemy stand in bind pose through a whole fight.
    const targets = trackTargets(clip);
    const missing = targets.filter((t) => !rigNodes.has(t));
    // Navigation owns horizontal root travel. Preserve vertical compression and airtime: deleting
    // the whole position track removes the frog's hop height and drives its feet underground.
    //
    // Matched by BONE IDENTITY, not by name. This was a `MAINSHJnt|ROOTSHJnt|_root|Hips` regex,
    // which covers the named rigs and misses every `_exp` one, whose root is called `Bone001` or
    // `Bone002`. The frog's hop carries 134.7 units of root travel - 1.35 m - and none of it was
    // being stripped, so the frog physically leapt across the ground on every step and every swing.
    if (spec.stripRootMotion !== false && rootBoneName) {
      clip.tracks = clip.tracks.map((track) => {
        if (!/\.position$/.test(track.name) || track.name.split(".")[0] !== rootBoneName) return track;
        const inPlace = track.clone();
        for (let i = 0; i < inPlace.values.length; i += 3) {
          inPlace.values[i] = rootBone.position.x;
          inPlace.values[i + 2] = rootBone.position.z;
        }
        return inPlace;
      });
    }
    // Drop channels that cannot move a single vertex.
    //
    // These rigs ship IK helper objects - `IK_Chain007` and friends - which are neither skin joints
    // nor meshes. Their tracks are the LARGEST in several clips (the frog's carries 138 units of
    // hop) and they deform nothing, so they are pure weight in the buffer and pure work for the
    // mixer. They also make any "is this clip translating the animal" check meaningless until they
    // are gone, which is how a stripped frog still measured as leaping 1.38 m.
    if (deformingNodes.size > 0) {
      clip.tracks = clip.tracks.filter((track) => deformingNodes.has(track.name.split(".")[0]));
    }

    // Last, so it closes the clip that actually ships: after the range cut, after the root-motion
    // strip and after the IK channels are dropped.
    const seam = LOOPING_CLIPS.has(entry.name) ? closeLoop(clip, SOURCE_FPS) : 0;
    const sealed = seam >= 1;

    clips.push(clip);
    clipReport.push({
      name: entry.name, ok: missing.length === 0, duration: clip.duration, sealed, seam,
      tracks: clip.tracks.length, missing: missing.slice(0, 4), targetCount: targets.length,
    });
  }

  // Centimetres -> metres.
  //
  // Deliberately a node scale rather than a bake. Baking it into the geometry and the skeleton was
  // tried and reverted: these rigs park their own scales in different places (the bear's mesh node
  // carries 72.242, the deer's carries 1), so one uniform factor applied to vertices, bone
  // translations and inverse binds is right for some rigs and wrong for others - measured, it left
  // frogs at 3.24 m and bears at 0.20 m. three's skinning shader applies the node's world matrix
  // after the skin, so this is correct for every rig, and the consumer that ignored it
  // (`render/entityViews.ts` pose bake) was fixed instead.
  root.scale.setScalar(CM_TO_M * (spec.extraScale ?? 1));
  root.updateMatrixWorld(true);
  root.userData.fbxTextureOrientation = "source-correct";

  // What ground speed each locomotion cycle looks like it is travelling at, so the runtime can play
  // it at the rate that keeps the feet planted. Measured from the feet because these cycles are
  // authored in place: every rig but the frog has zero root travel, so the stride is not in the
  // root track.
  //
  // BOTH gaits are measured. A walk and a run are different animations with different strides, and
  // the runtime picks between them by whether the creature is pottering or pursuing, so it needs a
  // speed for each. Measuring only the walk and reusing it for the run was not a simplification —
  // it is what let a gallop be played as a walk for the whole roster.
  const gaitMeasurements = Object.fromEntries(["Walk", "Run"].map(name => [name,
    measureContactGait(root, clips.find(clip => clip.name === name), { assetId: spec.id }),
  ]));
  const impliedWalkMps = gaitMeasurements.Walk.speedMps ?? 0;
  const impliedRunMps = gaitMeasurements.Run.speedMps ?? 0;

  const box = boxOf(root);
  const size = box.getSize(new THREE.Vector3());

  const glb = await new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      root,
      (result) => resolve(result),
      (error) => reject(error),
      { binary: true, animations: clips, embedImages: true, onlyVisible: false },
    );
  });

  const bytes = new Uint8Array(glb);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return {
    base64: btoa(binary),
    bytes: bytes.length,
    size: [size.x, size.y, size.z],
    base: [box.min.x, box.min.y, box.min.z],
    meshNames,
    clips: clipReport,
    impliedWalkMps,
    impliedRunMps,
    gaitMeasurements,
  };
};

/** Read backward contact velocity; excursion divided by a whole cycle is not a planted speed. */
window.probeStride = async (rigUrl, clipUrl, frames, name, take) => {
  const rig = await fbxLoader.loadAsync(rigUrl);
  const source = await fbxLoader.loadAsync(clipUrl);
  // Same take rule as convertAnimal: a named take resolves exactly or the probe fails out loud.
  let clip = take
    ? source.animations.find((candidate) => candidate.name === take)
    : source.animations[0];
  if (!clip) {
    throw new Error(
      `take "${take}" not in ${clipUrl}; has: ${source.animations.map((c) => c.name).join(", ") || "(none)"}`,
    );
  }
  if (frames && frames[1] > frames[0]) {
    const total = Math.round(clip.duration * SOURCE_FPS);
    if (!(frames[0] <= 1 && frames[1] >= total)) {
      clip = THREE.AnimationUtils.subclip(clip, name || "probe", frames[0], frames[1], SOURCE_FPS);
    }
  }
  rig.scale.setScalar(CM_TO_M);
  rig.updateMatrixWorld(true);
  const result = measureContactGait(rig, clip, { assetId: name ?? "" });
  return { ...result, duration: clip.duration, impliedMps: result.speedMps ?? 0,
    strideM: (result.speedMps ?? 0) * clip.duration, strideDefinition: "equivalent-native-cycle-travel" };

};

/**
 * Build one STATIC prop GLB - no skeleton, no clips. Used for the miniboss weapon drops.
 *
 * The same loader/exporter stack as convertAnimal rather than a second pipeline, because the two
 * failure classes it already solved - textures that need explicit colour spaces, and sources whose
 * units are centimetres - are exactly the ones a new stack would rediscover.
 *
 * spec: {
 *   id, mesh: url, materialName,
 *   baseColor: url, normal?: url,
 *   emissive?: url, emissiveColor?: [r,g,b], emissiveIntensity?: number,
 *   roughness?: number, metalness?: number,
 *   extraScale?: number,   // on top of CM_TO_M, measured per source like RHINO_EXTRA_SCALE
 *   recenterXZ?: boolean,  // for meshes parked away from their file's origin (a lineup artefact)
 * }
 *
 * Unlike the creatures, a weapon keeps its authored normal map: the imported `rpg_weapon_*` GLBs
 * ship theirs, and an equipped item is inspected close-up where baked shading detail earns its
 * bytes. Metallic/AO maps are still dropped - glTF wants them packed into one ORM image and the
 * repacking is not worth it for stylized props whose albedo already paints the metal.
 */
window.convertStatic = async (spec) => {
  const root = await fbxLoader.loadAsync(spec.mesh);

  const baseTexture = await loadTexture(spec.baseColor);
  const normalTexture = spec.normal ? await loadTexture(spec.normal, { linear: true }) : null;
  const emissiveTexture = spec.emissive ? await loadTexture(spec.emissive) : null;

  const meshNames = [];
  root.traverse((node) => {
    if (!node.isMesh && !node.isSkinnedMesh) return;
    meshNames.push(node.name);
    const material = new THREE.MeshStandardMaterial({
      map: baseTexture,
      roughness: spec.roughness ?? 0.8,
      metalness: spec.metalness ?? 0,
      ...(normalTexture ? { normalMap: normalTexture } : {}),
      ...(emissiveTexture
        ? {
            emissiveMap: emissiveTexture,
            // The authored Unity _EmissionColor, split into a unit colour and an intensity so the
            // over-1 part survives as KHR_materials_emissive_strength (same trap the bosses hit).
            emissive: new THREE.Color(...(spec.emissiveColor ?? [1, 1, 1])),
            emissiveIntensity: spec.emissiveIntensity ?? 1,
          }
        : {}),
    });
    material.name = spec.materialName;
    if (Array.isArray(node.material)) node.material = node.material.map(() => material);
    else node.material = material;
  });

  root.scale.setScalar(CM_TO_M * (spec.extraScale ?? 1));
  root.updateMatrixWorld(true);

  // Some source files park the mesh metres away from the origin on X/Z - a lineup position from
  // the artist's master scene, not a grip convention. Recentring the horizontal axes keeps the
  // authored Y pivot (which IS the grip) and discards the lineup.
  if (spec.recenterXZ) {
    const before = boxOf(root);
    root.position.x -= (before.min.x + before.max.x) / 2;
    root.position.z -= (before.min.z + before.max.z) / 2;
    root.updateMatrixWorld(true);
  }

  const box = boxOf(root);
  const size = box.getSize(new THREE.Vector3());

  const glb = await new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      root,
      (result) => resolve(result),
      (error) => reject(error),
      { binary: true, animations: [], embedImages: true, onlyVisible: false },
    );
  });

  const bytes = new Uint8Array(glb);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return {
    base64: btoa(binary),
    bytes: bytes.length,
    size: [size.x, size.y, size.z],
    base: [box.min.x, box.min.y, box.min.z],
    meshNames,
  };
};
