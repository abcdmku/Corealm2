// Source geometry audit only. Root-owned browser acceptance remains separate.
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SOURCE = new URL('../crawlers.mjs', import.meta.url);
const OUTPUT = new URL('../../../test-results/creature-expansion/crawlers/beetle-joint-audit.json', import.meta.url);
const CLIPS = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'HitLeft', 'HitRight', 'Death'];
const LOOPS = new Set(['Idle', 'Walk', 'Run']);
const PHASES = 49;
const LOOP_TOLERANCE = 1e-5;
const GROUND_TOLERANCE = 0.002;
const DIRECTIONS = [[0.823, 0.317, 0.473], [-0.391, 0.861, 0.327], [0.137, -0.417, 0.899]]
  .map(values => new THREE.Vector3(...values).normalize());
const rounded = value => Number(value.toFixed(9));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const point = new THREE.Vector3();
const hit = new THREE.Vector3();
const nearest = new THREE.Vector3();
const ray = new THREE.Ray();

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function rigidVertex(mesh, index, boneIndex) {
  const { skinIndex, skinWeight } = mesh.geometry.attributes;
  return skinIndex.getX(index) === boneIndex && skinWeight.getX(index) === 1
    && skinWeight.getY(index) === 0 && skinWeight.getZ(index) === 0 && skinWeight.getW(index) === 0;
}

function worldVertex(mesh, index, target) {
  target.fromBufferAttribute(mesh.geometry.attributes.position, index);
  mesh.applyBoneTransform(index, target);
  return target.applyMatrix4(mesh.matrixWorld);
}

function buildTree(faces) {
  const box = new THREE.Box3();
  for (const face of faces) box.union(face.box);
  if (faces.length <= 8) return { box, faces };
  const size = box.getSize(new THREE.Vector3());
  const axis = size.x > size.y && size.x > size.z ? 'x' : size.y > size.z ? 'y' : 'z';
  faces.sort((a, b) => a.center[axis] - b.center[axis]);
  const middle = Math.floor(faces.length / 2);
  return { box, left: buildTree(faces.slice(0, middle)), right: buildTree(faces.slice(middle)) };
}

function inspectPoint(tree, p) {
  const crossings = [];
  let rayTriangleTests = 0, distanceTriangleTests = 0;
  for (const direction of DIRECTIONS) {
    ray.set(p, direction);
    const distances = [], stack = [tree];
    while (stack.length) {
      const node = stack.pop();
      if (!ray.intersectsBox(node.box)) continue;
      if (!node.faces) { stack.push(node.left, node.right); continue; }
      for (const { triangle } of node.faces) {
        rayTriangleTests++;
        if (ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, hit)) distances.push(p.distanceTo(hit));
      }
    }
    distances.sort((a, b) => a - b);
    let count = 0, previous = -Infinity;
    for (const distance of distances) if (distance - previous > 1e-7) { count++; previous = distance; }
    crossings.push(count);
  }
  let distanceSquared = Infinity, closestFace = null;
  const stack = [tree];
  while (stack.length) {
    const node = stack.pop();
    if (node.box.distanceToPoint(p) ** 2 > distanceSquared) continue;
    if (!node.faces) {
      const leftDistance = node.left.box.distanceToPoint(p), rightDistance = node.right.box.distanceToPoint(p);
      if (leftDistance < rightDistance) stack.push(node.right, node.left);
      else stack.push(node.left, node.right);
      continue;
    }
    for (const face of node.faces) {
      if (face.box.distanceToPoint(p) ** 2 > distanceSquared) continue;
      distanceTriangleTests++;
      face.triangle.closestPointToPoint(p, nearest);
      const distance = p.distanceToSquared(nearest);
      if (distance < distanceSquared) { distanceSquared = distance; closestFace = face.sourceTriangle; }
    }
  }
  return { inside: crossings.every(count => count % 2 === 1), crossings,
    clearance: Math.sqrt(distanceSquared), closestFace, rayTriangleTests, distanceTriangleTests };
}

function extractLeg(shell, horn, h) {
  const k = h.children.find(bone => bone.name.endsWith('_tibia'));
  requireCondition(k, `${h.name}: missing tibia child`);
  const width = h.name.endsWith('_1_coxa') ? 0.065 : 0.069;
  const knee = k.getWorldPosition(new THREE.Vector3());
  const hIndex = shell.skeleton.bones.indexOf(h), kIndex = horn.skeleton.bones.indexOf(k);
  const lower = [];
  let maximumLowerRestRadius = 0;
  for (let index = 0; index < horn.geometry.attributes.position.count; index++) {
    if (!rigidVertex(horn, index, kIndex) || horn.geometry.attributes.uv.getY(index) !== 0) continue;
    const distance = point.fromBufferAttribute(horn.geometry.attributes.position, index).distanceTo(knee) / width;
    if (distance < 0.65) { lower.push(index); maximumLowerRestRadius = Math.max(maximumLowerRestRadius, distance); }
  }
  requireCondition(lower.length === 11, `${h.name}: lower ring has ${lower.length} vertices, expected 11`);

  // Indexed connectivity separates the single femur loft from its separate hip bead.
  const parents = new Map(), candidateFaces = [];
  const root = index => {
    if (!parents.has(index)) parents.set(index, index);
    let current = index;
    while (parents.get(current) !== current) current = parents.get(current);
    while (parents.get(index) !== index) { const next = parents.get(index); parents.set(index, current); index = next; }
    return current;
  };
  const indices = shell.geometry.index.array;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const ids = [indices[offset], indices[offset + 1], indices[offset + 2]];
    if (!ids.every(index => rigidVertex(shell, index, hIndex))) continue;
    const first = root(ids[0]);
    for (const index of ids.slice(1)) parents.set(root(index), first);
    candidateFaces.push({ ids, sourceTriangle: offset / 3 });
  }
  const components = new Map();
  for (const index of parents.keys()) {
    const key = root(index);
    if (!components.has(key)) components.set(key, []);
    components.get(key).push(index);
  }
  const component = [...components.values()].sort((a, b) => b.length - a.length)[0];
  requireCondition(component?.length === 702, `${h.name}: expected 702-vertex continuous femur, found ${component?.length}`);
  const included = new Set(component);
  const positions = new Map(component.map(index => [index,
    new THREE.Vector3().fromBufferAttribute(shell.geometry.attributes.position, index).sub(knee).divideScalar(width)]));
  const rear = component.filter(index => shell.geometry.attributes.uv.getY(index) === 0)
    .sort((a, b) => shell.geometry.attributes.uv.getX(a) - shell.geometry.attributes.uv.getX(b));
  const pole = component.filter(index => shell.geometry.attributes.uv.getY(index) === 1);
  requireCondition(rear.length === 18 && pole.length === 18, `${h.name}: unexpected femur end ring count`);
  requireCondition(pole.every(index => positions.get(index).distanceTo(positions.get(pole[0])) < 1e-6),
    `${h.name}: femur terminal pole is open`);

  const faces = [], edges = new Map(), welded = new Map();
  let skippedDegenerateTriangles = 0, signedVolume = 0;
  const weldId = p => {
    const key = p.toArray().map(value => value.toFixed(6)).join(',');
    if (!welded.has(key)) welded.set(key, welded.size);
    return welded.get(key);
  };
  const addFace = (a, b, c, sourceTriangle) => {
    const triangle = new THREE.Triangle(a, b, c);
    if (triangle.getArea() < 1e-10) { skippedDegenerateTriangles++; return; }
    const ids = [weldId(a), weldId(b), weldId(c)];
    requireCondition(new Set(ids).size === 3, `${h.name}: welding collapsed a nondegenerate face`);
    for (let i = 0; i < 3; i++) {
      const from = ids[i], to = ids[(i + 1) % 3], key = `${Math.min(from, to)},${Math.max(from, to)}`;
      if (!edges.has(key)) edges.set(key, { count: 0, orientation: 0 });
      const edge = edges.get(key); edge.count++; edge.orientation += from < to ? 1 : -1;
    }
    signedVolume += a.dot(b.clone().cross(c)) / 6;
    const box = new THREE.Box3().setFromPoints([a, b, c]);
    faces.push({ triangle, box, center: triangle.getMidpoint(new THREE.Vector3()), sourceTriangle });
  };
  for (const { ids, sourceTriangle } of candidateFaces)
    if (included.has(ids[0])) addFace(...ids.map(index => positions.get(index)), sourceTriangle);
  const actualFacets = faces.length;
  // This diagnostic cap is at the original hip opening, remote from the knee.
  const rearCenter = new THREE.Vector3();
  for (const index of rear.slice(0, -1)) rearCenter.add(positions.get(index));
  rearCenter.divideScalar(rear.length - 1);
  for (let i = 0; i < rear.length - 1; i++)
    addFace(rearCenter, positions.get(rear[i + 1]), positions.get(rear[i]), `hip-closure-${i}`);
  const badEdges = [...edges.values()].filter(edge => edge.count !== 2 || edge.orientation !== 0);
  requireCondition(actualFacets === 1275 && skippedDegenerateTriangles === 17,
    `${h.name}: unexpected femur facets ${actualFacets} or degenerate count ${skippedDegenerateTriangles}`);
  requireCondition(badEdges.length === 0, `${h.name}: femur volume has ${badEdges.length} unpaired or misoriented edges`);
  requireCondition(signedVolume > 0, `${h.name}: femur triangle winding is inward`);
  requireCondition(welded.size - edges.size + faces.length === 2, `${h.name}: femur volume is not a closed genus-zero mesh`);
  const tree = buildTree(faces);
  const kneeInterior = inspectPoint(tree, new THREE.Vector3());
  requireCondition(kneeInterior.inside, `${h.name}: knee center is outside femur`);
  requireCondition(maximumLowerRestRadius < kneeInterior.clearance,
    `${h.name}: lower ring does not fit the centered ball inside the actual femur`);
  const outside = tree.box.max.clone().addScalar(1);
  requireCondition(!inspectPoint(tree, outside).inside, `${h.name}: exterior control was classified inside`);
  return { name: h.name.replace('antler_beetle_', '').replace('_coxa', ''), h, k, width, lower, tree,
    actualFacets, closedVolumeFacets: faces.length, femurVertices: component.length,
    skippedDegenerateTriangles, weldedVertices: welded.size, edges: edges.size, signedVolume,
    centeredInradius: kneeInterior.clearance, maximumLowerRestRadius };
}

function poseSampler(object, clip) {
  const channels = clip.tracks.map(track => {
    const parsed = THREE.PropertyBinding.parseTrackName(track.name);
    const bone = object.getObjectByName(parsed.nodeName);
    requireCondition(bone?.isBone && ['position', 'quaternion'].includes(parsed.propertyName)
      && !parsed.objectName && parsed.propertyIndex === undefined, `Unsupported track ${track.name}`);
    requireCondition([...track.times, ...track.values].every(Number.isFinite), `Nonfinite track ${track.name}`);
    return { bone, property: parsed.propertyName, interpolant: track.createInterpolant() };
  });
  return phase => {
    for (const { bone, property, interpolant } of channels)
      bone[property].fromArray(interpolant.evaluate(phase * clip.duration));
    object.updateMatrixWorld(true);
  };
}

function loopTrackDelta(clip) {
  let maximum = 0;
  for (const track of clip.tracks) {
    const size = track.getValueSize(), end = track.values.length - size;
    let direct = 0, opposite = 0;
    for (let index = 0; index < size; index++) {
      direct = Math.max(direct, Math.abs(track.values[index] - track.values[end + index]));
      opposite = Math.max(opposite, Math.abs(track.values[index] + track.values[end + index]));
    }
    maximum = Math.max(maximum, track.ValueTypeName === 'quaternion' ? Math.min(direct, opposite) : direct);
  }
  return maximum;
}

const report = {
  species: 'antler_beetle', geometry: 'continuous rounded femur', passed: false,
  source: 'tools/creature-expansion/crawlers.mjs', sourceSha256: null,
  phasesPerClip: PHASES, groundPhasesPerClip: 9, groundPlaneY: 0,
  groundToleranceMeters: GROUND_TOLERANCE, loopTolerance: LOOP_TOLERANCE,
  rayDirections: DIRECTIONS.map(direction => direction.toArray()),
  legs: [], clips: [], failures: [],
  notes: [
    'Source-only numerical evidence. This does not replace production browser play or screenshot acceptance.',
    'The upper open knee ring no longer exists. Each femur is one connected loft with a welded terminal pole.',
    'Actual merged Float32 femur triangles form the tested volume. A diagnostic rear cap closes only the original hip ring.',
    'Welded topology must have paired edges, consistent outward winding and Euler characteristic 2.',
    'World-skinned lower-ring points are centered at the tibia pivot, rotated by the inverse femur world quaternion, and divided by leg width.',
    'All three ray directions must classify every lower-ring vertex inside. Clearance is the shortest distance to actual triangles or the diagnostic hip cap.',
    'The knee-centered ball bounded by the nearest femur triangle must contain the entire lower ring. Its convexity also covers ring edges and rigid rotations about the same knee pivot.',
    'All eight clips use Three.js track interpolants at 49 phases including both endpoints. Ground checks sample all mesh vertices at every sixth phase.',
    'Idle, Walk and Run require sealed track endpoints and skinned vertex drift below 1e-5. One-shot clips are not required to loop.',
    'Ground penetration over 2 mm fails. These flat-ground source checks do not prove runtime terrain contact.',
  ],
};

try {
  report.sourceSha256 = hash(await readFile(SOURCE));
  const { buildSpecies } = await import('../crawlers.mjs');
  const { object, clips } = await buildSpecies(report.species);
  object.updateMatrixWorld(true);
  requireCondition(clips.length === CLIPS.length && CLIPS.every(name => clips.some(clip => clip.name === name)),
    'Expected exactly the eight authored clips');
  const meshes = [];
  object.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); });
  const shell = object.getObjectByName('antler_beetle_shellAlt'), horn = object.getObjectByName('antler_beetle_horn');
  requireCondition(shell?.isSkinnedMesh && horn?.isSkinnedMesh, 'Missing shellAlt or horn skinned mesh');
  const legs = shell.skeleton.bones.filter(bone => /_leg_[LR]_[123]_coxa$/.test(bone.name))
    .map(bone => extractLeg(shell, horn, bone));
  requireCondition(legs.length === 6, `Expected six legs, found ${legs.length}`);
  for (const bone of shell.skeleton.bones)
    requireCondition(bone.getWorldScale(new THREE.Vector3()).distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-8,
      `${bone.name}: containment audit requires unit bone scale`);
  report.legs = legs.map(leg => ({ leg: leg.name, widthMeters: leg.width, lowerRingVertices: leg.lower.length,
    upperJointOpenRingVertices: 0, femurVertices: leg.femurVertices, actualFacets: leg.actualFacets,
    diagnosticHipCapFacets: 17, closedVolumeFacets: leg.closedVolumeFacets,
    skippedDegenerateTriangles: leg.skippedDegenerateTriangles, weldedVertices: leg.weldedVertices,
    pairedEdges: leg.edges, outwardSignedVolumeInLegWidthsCubed: rounded(leg.signedVolume),
    centeredInradiusInLegWidths: rounded(leg.centeredInradius),
    maximumLowerRestRadiusInLegWidths: rounded(leg.maximumLowerRestRadius),
    allRigidRotationsClearanceMeters: rounded((leg.centeredInradius - leg.maximumLowerRestRadius) * leg.width) }));
  report.meshVertices = meshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0);
  report.ringVerticesPerPhase = legs.reduce((sum, leg) => sum + leg.lower.length, 0);

  for (const clip of clips) {
    const pose = poseSampler(object, clip), isLoop = LOOPS.has(clip.name), firstVertices = new Map();
    let minClearanceMeters = Infinity, minY = Infinity, minYAt = null, worst = null, loopVertexDelta = 0;
    let ringVertexChecks = 0, outsideVertices = 0, rayTriangleTests = 0, distanceTriangleTests = 0;
    const perLeg = Object.fromEntries(legs.map(leg => [leg.name, { outsideVertices: 0, minClearanceMeters: Infinity }]));
    for (let sample = 0; sample < PHASES; sample++) {
      const phase = sample / (PHASES - 1);
      pose(phase);
      for (const leg of legs) {
        const center = leg.k.getWorldPosition(new THREE.Vector3());
        const inverse = leg.h.getWorldQuaternion(new THREE.Quaternion()).invert();
        for (const vertex of leg.lower) {
          worldVertex(horn, vertex, point).sub(center).applyQuaternion(inverse).divideScalar(leg.width);
          requireCondition(point.toArray().every(Number.isFinite), `${clip.name}: nonfinite skinned ring point`);
          requireCondition(point.length() < leg.centeredInradius,
            `${clip.name} ${leg.name}: lower-ring vertex leaves the knee-centered interior ball`);
          const result = inspectPoint(leg.tree, point);
          const clearanceMeters = result.clearance * leg.width;
          if (clearanceMeters < minClearanceMeters) {
            minClearanceMeters = clearanceMeters;
            worst = { leg: leg.name, phase, vertex, closestFemurTriangle: result.closestFace, rayCrossings: result.crossings };
          }
          if (!result.inside) {
            outsideVertices++; perLeg[leg.name].outsideVertices++;
            if (!report.firstContainmentFailure) report.firstContainmentFailure = {
              clip: clip.name, leg: leg.name, phase, vertex, rayCrossings: result.crossings };
          }
          perLeg[leg.name].minClearanceMeters = Math.min(perLeg[leg.name].minClearanceMeters, clearanceMeters);
          ringVertexChecks++; rayTriangleTests += result.rayTriangleTests; distanceTriangleTests += result.distanceTriangleTests;
        }
      }
      if (sample % 6 !== 0) continue;
      for (const mesh of meshes) {
        const count = mesh.geometry.attributes.position.count;
        if (isLoop && sample === 0) firstVertices.set(mesh, new Float64Array(count * 3));
        for (let vertex = 0; vertex < count; vertex++) {
          worldVertex(mesh, vertex, point);
          requireCondition(point.toArray().every(Number.isFinite), `${clip.name}: nonfinite mesh point`);
          if (point.y < minY) { minY = point.y; minYAt = { phase, mesh: mesh.name, vertex }; }
          if (isLoop && sample === 0) point.toArray(firstVertices.get(mesh), vertex * 3);
          if (isLoop && sample === PHASES - 1) {
            const start = firstVertices.get(mesh), offset = vertex * 3;
            loopVertexDelta = Math.max(loopVertexDelta, Math.hypot(point.x - start[offset],
              point.y - start[offset + 1], point.z - start[offset + 2]));
          }
        }
      }
    }
    const trackDelta = isLoop ? loopTrackDelta(clip) : null;
    const containmentPassed = outsideVertices === 0;
    const groundPassed = minY >= -GROUND_TOLERANCE;
    const loopPassed = !isLoop || (trackDelta <= LOOP_TOLERANCE && loopVertexDelta <= LOOP_TOLERANCE);
    if (!containmentPassed) report.failures.push(`${clip.name}: ${outsideVertices} lower-ring vertex samples are outside the femur`);
    if (!groundPassed) report.failures.push(`${clip.name}: minimum y ${minY} m exceeds ground penetration tolerance`);
    if (!loopPassed) report.failures.push(`${clip.name}: loop endpoints exceed ${LOOP_TOLERANCE}`);
    report.clips.push({ clip: clip.name, passed: containmentPassed && groundPassed && loopPassed,
      containmentPassed, groundPassed, loopPassed: isLoop ? loopPassed : null,
      ringVertexChecks, rayQueries: ringVertexChecks * DIRECTIONS.length, rayTriangleTests, distanceTriangleTests,
      outsideVertices, minClearanceMeters: rounded(minClearanceMeters), worst,
      minGroundY: rounded(minY), minGroundAt: minYAt,
      loopTrackEndpointDelta: trackDelta === null ? null : rounded(trackDelta),
      loopSkinnedVertexDeltaMeters: isLoop ? rounded(loopVertexDelta) : null,
      legs: Object.fromEntries(Object.entries(perLeg).map(([key, value]) => [key,
        { outsideVertices: value.outsideVertices, minClearanceMeters: rounded(value.minClearanceMeters) }])) });
  }
  requireCondition(hash(await readFile(SOURCE)) === report.sourceSha256, 'Source changed while the audit was running');
  report.ringVertexChecks = report.clips.reduce((sum, clip) => sum + clip.ringVertexChecks, 0);
  report.rayQueries = report.clips.reduce((sum, clip) => sum + clip.rayQueries, 0);
  report.minClearanceMeters = rounded(Math.min(...report.clips.map(clip => clip.minClearanceMeters)));
  report.minGroundY = rounded(Math.min(...report.clips.map(clip => clip.minGroundY)));
  report.passed = report.failures.length === 0;
} catch (error) {
  report.failures.push(error instanceof Error ? error.message : String(error));
}

await mkdir(new URL('.', OUTPUT), { recursive: true });
await writeFile(OUTPUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, output: fileURLToPath(OUTPUT),
  clips: report.clips.length, ringVertexChecks: report.ringVertexChecks, rayQueries: report.rayQueries,
  minClearanceMeters: report.minClearanceMeters, minGroundY: report.minGroundY, failures: report.failures }, null, 2));
if (!report.passed) process.exitCode = 1;
