import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, resolve, relative, isAbsolute, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';

// Reads source files and GLBs. Only the report is written. Run after both R15
// candidate builds have settled; this is data evidence, not visual acceptance.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = 'runs/tier50-70/evidence/revision-r15.json';
const baselineDir = 'test-results/tier50-70/r14-final-baseline';
const sharedBuild = 'tools/item-models/build.ts';
const sharedBuildSha256 = '1d41afb2cba28fd3b71626897f056c76c6703fbef0dba3a86d5f0e00cefd634e';
const themes = ['dragonhide', 'starhide'];
const pieces = ['hood', 'robe', 'leggings', 'boots', 'wraps'];
const frozenPieces = new Set(['hood', 'leggings', 'boots', 'wraps']);
const upperClothY = 1.08;
const approvedRobeCoverage = [{region: 'torso', minY: 1.02, maxY: 1.48}];
const blueChestBounds = {min: [-.12, 1.325, .05], max: [.12, 1.49, .18]};
const blueNecklineBounds = {min: [-.225, 1.36, -.20], max: [.225, 1.49, .18]};
const redRearBounds = {min: [-.36, .325, -.31], max: [.36, 1.072, -.05]};
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const opposite = theme => theme === 'dragonhide' ? 'starhide' : 'dragonhide';
const candidateRoot = theme => `art/item-models/candidates/armor-${theme}-reference`;
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const digest = value => hash(JSON.stringify(stable(value)));
function absolute(file) {
  assert.equal(typeof file, 'string');
  assert(!isAbsolute(file), `Expected repository-relative path: ${file}`);
  const result = resolve(repo, file), local = relative(repo, result);
  assert(local && local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local), `Path escapes repository: ${file}`);
  return result;
}
const bytesAt = file => readFile(absolute(file));
const jsonAt = async file => JSON.parse((await bytesAt(file)).toString('utf8').replace(/^\uFEFF/, ''));

function expectedFitMetadata(previous, piece) {
  if (piece === 'robe') assert.deepEqual(previous.bodyCoverage, approvedRobeCoverage);
  return previous;
}

function parseGLB(bytes, file) {
  assert(bytes.length >= 20, `${file}: missing GLB header`);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${file}: expected GLB`);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${file}: truncated GLB`);
  let raw, bin;
  for (let offset = 12; offset < bytes.length;) {
    assert(offset + 8 <= bytes.length);
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    assert.equal(length % 4, 0); assert(offset + 8 + length <= bytes.length);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) { assert(!raw); raw = JSON.parse(chunk.toString('utf8').trim()); }
    else if (type === 0x004e4942) { assert(!bin); bin = chunk; }
    offset += 8 + length;
  }
  assert(raw && bin, `${file}: expected embedded JSON and binary chunks`);
  assert.equal(raw.buffers?.length, 1); assert(!raw.buffers[0].uri);
  assert(raw.buffers[0].byteLength <= bin.length && bin.length - raw.buffers[0].byteLength < 4);
  return {raw, bin};
}
function imageState(glb, index) {
  const image = glb.raw.images?.[index];
  assert(image && Number.isInteger(image.bufferView) && !image.uri, 'Expected embedded image');
  const view = glb.raw.bufferViews[image.bufferView];
  assert(view && (view.buffer ?? 0) === 0);
  const start = view.byteOffset ?? 0, end = start + view.byteLength;
  assert(start >= 0 && end <= glb.raw.buffers[0].byteLength);
  const {bufferView, ...description} = image;
  return {...description, bytes: view.byteLength, sha256: hash(glb.bin.subarray(start, end))};
}
function textureState(glb, index) {
  const texture = glb.raw.textures?.[index];
  assert(texture && Number.isInteger(texture.source), 'Expected ordinary embedded PBR texture');
  const {source, sampler, ...properties} = texture;
  if (sampler !== undefined) assert(glb.raw.samplers?.[sampler], 'Invalid sampler reference');
  return {...properties, sampler: glb.raw.samplers?.[sampler] ?? {}, image: imageState(glb, source)};
}
function materialState(glb, material) {
  const visit = (value, key = '') => {
    if (Array.isArray(value)) return value.map(entry => visit(entry));
    if (!value || typeof value !== 'object') return value;
    if (key.endsWith('Texture') && Number.isInteger(value.index)) {
      const {index, ...info} = value;
      return {...visit(info), texture: textureState(glb, index)};
    }
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, visit(child, childKey)]));
  };
  return visit(material);
}
function materialsState(glb) {
  const materials = glb.raw.materials ?? [];
  assert(materials.length && materials.every(material => typeof material.name === 'string' && material.name.length));
  assert.equal(new Set(materials.map(material => material.name)).size, materials.length, 'Material names must be unique');
  return {
    materials: Object.fromEntries(materials.map(material => [material.name, materialState(glb, material)])),
    // Compare every embedded image and texture, including unused images. Resolve
    // the index references before sorting, so GLB storage order is irrelevant.
    images: (glb.raw.images ?? []).map((_, index) => imageState(glb, index)).sort((a, b) => digest(a).localeCompare(digest(b))),
    textures: (glb.raw.textures ?? []).map((_, index) => textureState(glb, index)).sort((a, b) => digest(a).localeCompare(digest(b))),
  };
}
function accessorState(accessor) {
  if (!accessor) return null;
  const array = accessor.getArray(); assert(array);
  return {type: accessor.getType(), componentType: accessor.getComponentType(), normalized: accessor.getNormalized(),
    count: accessor.getCount(), sha256: hash(Buffer.from(array.buffer, array.byteOffset, array.byteLength))};
}
function primitiveState(primitive) {
  return {mode: primitive.getMode(), material: primitive.getMaterial()?.getName(), extras: primitive.getExtras(),
    indices: accessorState(primitive.getIndices()), attributes: Object.fromEntries(primitive.listSemantics().sort()
      .map(semantic => [semantic, accessorState(primitive.getAttribute(semantic))]))};
}
function primitiveRows(document) {
  const rows = [], seen = new Map();
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const extras = node.getExtras();
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial()?.getName(); assert(material);
      const group = `${material}|bone=${extras.itemModelBone ?? ''}|deform=${extras.itemModelDeform ?? ''}`;
      const occurrence = seen.get(group) ?? 0; seen.set(group, occurrence + 1);
      rows.push({key: `${group}|part=${occurrence}`, material, node, mesh, primitive});
    }
  }
  return rows;
}
function geometryState(document) {
  return primitiveRows(document).map(({node, mesh, primitive}) => ({node: node.getName(), nodeExtras: node.getExtras(),
    worldMatrix: node.getWorldMatrix(), mesh: mesh.getName(), meshExtras: mesh.getExtras(), meshWeights: mesh.getWeights(),
    nodeWeights: node.getWeights(), primitive: primitiveState(primitive)})).sort((a, b) => digest(a).localeCompare(digest(b)));
}
function rigState(document, itemId) {
  const root = document.getRoot(), skins = root.listSkins();
  assert.equal(skins.length, 1, `${itemId}: expected one skin`);
  const skin = skins[0], joints = skin.listJoints(), jointSet = new Set(joints), names = joints.map(node => node.getName());
  assert.equal(joints.length, 65, `${itemId}: expected 65 bones`);
  assert.equal(new Set(names).size, 65, `${itemId}: duplicate bone names`);
  const inverse = skin.getInverseBindMatrices(); assert(inverse);
  assert.equal(inverse.getType(), 'MAT4'); assert.equal(inverse.getCount(), 65);
  assert(Array.from(inverse.getArray()).every(Number.isFinite), `${itemId}: invalid inverse bind matrix`);
  const scene = root.listScenes(); assert.equal(scene.length, 1);
  assert.equal(root.listAnimations().length, 0); assert.equal(root.listCameras().length, 0);
  for (const node of root.listNodes()) {
    assert(node.getWorldMatrix().every(Number.isFinite), `${itemId}: invalid node transform`);
    if (node.getMesh()) assert.equal(node.getSkin(), skin, `${itemId}: unskinned mesh`);
  }
  return {skinName: skin.getName(), skinExtras: skin.getExtras(), skeleton: skin.getSkeleton()?.getName() ?? null,
    inverseBind: accessorState(inverse), joints: joints.map(node => ({name: node.getName(), matrix: node.getMatrix(),
      worldMatrix: node.getWorldMatrix(), extras: node.getExtras(), children: node.listChildren().filter(child => jointSet.has(child)).map(child => child.getName()).sort()}))};
}
function bounds(rows) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; let vertices = 0;
  for (const {primitive} of rows) {
    const position = primitive.getAttribute('POSITION'), point = [];
    for (let vertex = 0; vertex < position.getCount(); vertex++) {
      position.getElement(vertex, point); vertices++;
      for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]); }
    }
  }
  return {vertices, min, max, size: max.map((value, axis) => value - min[axis])};
}
function validateGeometry(document, baseline, itemId, piece) {
  const rows = primitiveRows(document), oldRows = new Map(primitiveRows(baseline).map(row => [row.key, row]));
  let triangles = 0, vertices = 0, maxWeightSumError = 0, maxNormalLengthError = 0;
  const preservedZeroNormals = [];
  const baselineMatrices = new Set(primitiveRows(baseline).map(row => digest(row.node.getWorldMatrix())));
  for (const row of rows) {
    const {primitive, key, node} = row, old = oldRows.get(key)?.primitive;
    assert(baselineMatrices.has(digest(node.getWorldMatrix())), `${itemId} ${key}: mesh transform changes fitted placement`);
    assert.equal(primitive.getMode(), 4, `${itemId}: non-triangle primitive`);
    assert.equal(primitive.listTargets().length, 0, `${itemId}: unexpected morph targets`);
    const required = {POSITION: 'VEC3', NORMAL: 'VEC3', TEXCOORD_0: 'VEC2', JOINTS_0: 'VEC4', WEIGHTS_0: 'VEC4'};
    const count = primitive.getAttribute('POSITION')?.getCount(); assert(count > 0);
    for (const [semantic, type] of Object.entries(required)) {
      const accessor = primitive.getAttribute(semantic); assert(accessor, `${itemId} ${key}: missing ${semantic}`);
      assert.equal(accessor.getType(), type); assert.equal(accessor.getCount(), count);
    }
    assert.deepEqual(primitive.listSemantics().filter(name => /^(JOINTS|WEIGHTS)_/.test(name)).sort(), ['JOINTS_0', 'WEIGHTS_0']);
    for (const semantic of primitive.listSemantics()) {
      const accessor = primitive.getAttribute(semantic); assert.equal(accessor.getCount(), count);
      assert(Array.from(accessor.getArray()).every(Number.isFinite), `${itemId} ${key}: nonfinite ${semantic}`);
    }
    const indices = primitive.getIndices(), indexCount = indices?.getCount() ?? count;
    assert.equal(indexCount % 3, 0);
    if (indices) {
      assert.equal(indices.getType(), 'SCALAR'); assert(!indices.getNormalized());
      for (const value of indices.getArray()) assert(Number.isInteger(value) && value >= 0 && value < count, `${itemId}: invalid triangle index`);
    }
    triangles += indexCount / 3; vertices += count;
    const normal = primitive.getAttribute('NORMAL'), weight = primitive.getAttribute('WEIGHTS_0'), joint = primitive.getAttribute('JOINTS_0');
    assert(!joint.getNormalized());
    for (let vertex = 0; vertex < count; vertex++) {
      const n = normal.getElement(vertex, []), length = Math.hypot(...n);
      if (length === 0) {
        // R14 already has six blue-hood and two red-hood zero normals at sewn
        // lining tips. Preserve that exact defect only while hood is frozen.
        assert(piece === 'hood' && frozenPieces.has(piece) && old && old.getAttribute('NORMAL').getCount() === count
          && Math.hypot(...old.getAttribute('NORMAL').getElement(vertex, [])) === 0,
        `${itemId} ${key}: new zero-length normal at ${vertex}`);
        preservedZeroNormals.push({primitive: key, vertex});
      } else {
        const error = Math.abs(length - 1); maxNormalLengthError = Math.max(maxNormalLengthError, error);
        assert(error <= .001, `${itemId} ${key}: nonunit normal at ${vertex}`);
      }
      const weights = weight.getElement(vertex, []), joints = joint.getElement(vertex, []);
      assert(weights.every(value => Number.isFinite(value) && value >= 0 && value <= 1), `${itemId}: invalid skin weights`);
      assert(joints.every(value => Number.isInteger(value) && value >= 0 && value < 65), `${itemId}: invalid joint index`);
      const error = Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1);
      maxWeightSumError = Math.max(maxWeightSumError, error); assert(error <= .00001, `${itemId}: weights do not sum to one`);
    }
  }
  assert(triangles > 0 && triangles <= 150000, `${itemId}: triangle budget exceeded`);
  return {vertices, triangles, drawCalls: rows.length, maxWeightSumError, maxNormalLengthError,
    finitePositionsNormalsUVsWeights: true, nonnegativeNormalizedWeights: true, preservedZeroNormals};
}
function upperClothSamples(document, designTheme) {
  const material = `${designTheme}-close-twill-cloth`, samples = [];
  for (const row of primitiveRows(document).filter(row => row.material === material)) {
    const primitive = row.primitive, position = primitive.getAttribute('POSITION'), semantics = primitive.listSemantics().sort();
    for (let vertex = 0; vertex < position.getCount(); vertex++) {
      const point = position.getElement(vertex, []);
      if (point[1] < upperClothY) continue;
      samples.push({position: point, signature: JSON.stringify(semantics.map(name => [name, primitive.getAttribute(name).getElement(vertex, [])]))});
    }
  }
  assert(samples.length > 0, 'Missing upper cloth samples');
  samples.sort((a, b) => a.signature.localeCompare(b.signature));
  return {material, samples, sha256: hash(JSON.stringify(samples.map(sample => sample.signature)))};
}
function sampleState(document, filter = () => true) {
  const entries = new Map(), totalByMaterial = {};
  for (const row of primitiveRows(document)) {
    const {primitive, material, node} = row, position = primitive.getAttribute('POSITION');
    const semantics = primitive.listSemantics().sort();
    const group = {material, bone: node.getExtras().itemModelBone ?? '', deform: node.getExtras().itemModelDeform ?? '', transform: node.getWorldMatrix()};
    for (let vertex = 0; vertex < position.getCount(); vertex++) {
      const point = position.getElement(vertex, []); if (!filter(point, material)) continue;
      const signature = JSON.stringify([group, semantics.map(name => [name, primitive.getAttribute(name).getElement(vertex, [])])]);
      const previous = entries.get(signature);
      if (previous) previous.count++; else entries.set(signature, {position: point, material, count: 1});
      totalByMaterial[material] = (totalByMaterial[material] ?? 0) + 1;
    }
  }
  return {entries, totalByMaterial};
}
function differenceSamples(a, b) {
  const changes = [], byMaterial = {}, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let count = 0;
  for (const [signature, sample] of a.entries) {
    const removed = sample.count - (b.entries.get(signature)?.count ?? 0); if (removed <= 0) continue;
    count += removed; byMaterial[sample.material] = (byMaterial[sample.material] ?? 0) + removed;
    changes.push({...sample, count: removed});
    for (let axis = 0; axis < 3; axis++) {min[axis] = Math.min(min[axis], sample.position[axis]); max[axis] = Math.max(max[axis], sample.position[axis]);}
  }
  return {count, byMaterial, bounds: count ? {min,max} : null, changes};
}
function boundedChanges(changes, allowed, itemId) {
  const regions = Array.isArray(allowed) ? allowed : [{materialPattern: '.*', bounds: allowed}];
  for (const sample of changes.changes) assert(regions.some(region => new RegExp(region.materialPattern).test(sample.material)
    && sample.position.every((value, axis) => value >= region.bounds.min[axis] - 1e-6 && value <= region.bounds.max[axis] + 1e-6)),
    `${itemId}: sample change outside permitted region at ${sample.position.join(', ')} (${sample.material})`);
  const {changes: samples, ...summary} = changes;
  return {...summary, allowedRegions: regions, examples: samples.slice(0,6)};
}
function geometryChanges(before, after, itemId, piece) {
  const oldRows = primitiveRows(before), newRows = primitiveRows(after), oldBounds = bounds(oldRows), newBounds = bounds(newRows);
  assert.deepEqual(newBounds.min, oldBounds.min, `${itemId}: overall minimum bounds changed`);
  assert.deepEqual(newBounds.max, oldBounds.max, `${itemId}: overall maximum bounds changed`);
  if (piece !== 'robe') return {beforeBounds: oldBounds, afterBounds: newBounds};
  const previous = sampleState(before), current = sampleState(after), removed = differenceSamples(previous, current), added = differenceSamples(current, previous);
  const blue = itemId === 'dragonhide_robe', allowed = blue ? blueChestBounds : redRearBounds;
  assert(removed.count > 0, `${itemId}: no expected local samples removed`);
  if (blue) {
    assert(added.count > 0, 'T50 must include the refined neckline rim');
    assert(Object.keys(added.byMaterial).every(name => name === 'starhide-chased-ivory-silver'), 'T50 adds only refined silver rim vertices');
    assert(Object.keys(removed.byMaterial).every(name => /close-twill-cloth|lining|chased/.test(name)), 'T50 unexpected changed material');
  } else {
    assert(added.count > 0, 'T70 missing new raised scales');
    assert(Object.keys(removed.byMaterial).every(name => !/scute|scale/.test(name)), 'T70 existing scales changed');
    assert(Object.keys(added.byMaterial).every(name => /lining|scute|scale/.test(name)), 'T70 unexpected added cloth or trim');
    assert(Object.keys(added.byMaterial).some(name => /scute|scale/.test(name)), 'T70 no raised scale material samples');
  }
  const removedRegions = blue ? [{materialPattern: '.*', bounds: blueChestBounds},
    {materialPattern: '^starhide-chased-ivory-silver$', bounds: blueNecklineBounds}] : allowed;
  return {beforeBounds: oldBounds, afterBounds: newBounds, compareMethod: 'Multiset of complete vertex attributes, material name, bone/deform hint and transform. No mesh order correspondence.',
    removed: boundedChanges(removed, removedRegions, itemId), added: boundedChanges(added, blue ? blueNecklineBounds : allowed, itemId), exactOutsideChangeRegion: true};
}
function verifyUpperCloth(before, after, designTheme, itemId) {
  const baseline = upperClothSamples(before, designTheme), current = upperClothSamples(after, designTheme);
  const oldState = sampleState(before, (point, material) => point[1] >= upperClothY && material === baseline.material);
  const newState = sampleState(after, (point, material) => point[1] >= upperClothY && material === baseline.material);
  const removed = differenceSamples(oldState,newState), added = differenceSamples(newState,oldState);
  assert.equal(added.count,0, `${itemId}: upper cloth was added or changed`);
  if (itemId === 'starhide_robe') assert.equal(removed.count,0, 'T70 upper cloth must remain exact');
  else assert(removed.count > 0, 'T50 crossing outer cloth missing from removal');
  return {material: current.material, minimumY: upperClothY, samples: current.samples.length, sha256: current.sha256,
    baselineSamples: baseline.samples.length, baselineSha256: baseline.sha256, addedSamples: 0,
    removed: boundedChanges(removed,blueChestBounds,itemId), everySurvivingSampleExact: true};
}

async function verifyAuthoredScope() {
  const file = 'tools/item-models/tier50-70/robe.ts', baselineFile = `${baselineDir}/robe.ts`;
  const before = (await bytesAt(baselineFile)).toString().replaceAll('\r\n', '\n');
  const after = (await bytesAt(file)).toString().replaceAll('\r\n', '\n');
  const section = (source, start, end) => {
    const at = source.indexOf(start); assert(at >= 0, `Missing source section ${start}`);
    const to = end ? source.indexOf(end, at + start.length) : source.length;
    assert(to > at); return source.slice(at, to);
  };
  const preserved = [
    ['scale border inset', 'function scaleSurfaceInsideBinding', 'function scutes'],
    ['bodice, fitted chest underlay and upper yoke', 'function torso', "  ribbon(g, 'Turned metal bound armhole and neck edge'"],
    ['chest scales, long lapels, collar and clasp', '  for (const side of [-1, 1]) {\n    const chestRaw', 'function shoulders'],
    ['shoulders', 'function shoulders', '/** Gentle widening'],
    ['accepted coat loft, flare and front drape', 'export function robeCoatPoint', 'function tails'],
    ['side scale gores and hip tassets', '    if ((dragon && (k === 1 || k === 7))', 'function waist'],
    ['waist and width normalization', 'function waist', null],
  ];
  for (const [name, start, end] of preserved) {
    const currentEnd = name === 'bodice, fitted chest underlay and upper yoke'
      ? '  // The sharper blue V needs closer samples' : end;
    assert.equal(section(after, start, currentEnd), section(before, start, end), `${name} authoring changed`);
  }
  const oldPanel = section(before, 'function tails', "    shell(g, dragon && front ?");
  const newPanel = section(after, 'function tails', '    const rearScales =');
  assert.equal(newPanel, oldPanel, 'Rear panel loft, hem or tip formula changed');
  assert(after.includes('const rearScales = dragon && (k === 3 || k === 5);'));
  assert(after.includes("scutes(g, `Long pointed rear scale panel ${k}`, rearScaleCarrier, m, 4, 18, 'skirt', 181 + k, .009, 12, .001);"));
  const expectedCarrier = `const rearScaleCarrier: Surface = (u, v) => {
        // Clear the central panel's concealed gold binding while returning to
        // the original loft at the perimeter and pointed hem.
        const clearance = .004
          * THREE.MathUtils.smootherstep(u, .06, .18)
          * (1 - THREE.MathUtils.smootherstep(u, .82, .94))
          * THREE.MathUtils.smootherstep(v, .10, .35)
          * (1 - THREE.MathUtils.smootherstep(v, .90, .98));
        return panel(u, v).addScaledVector(normalAt(panel, u, v), clearance);
      };`;
  assert(after.includes(expectedCarrier), 'Rear scale carrier must have the approved bounded clearance and fixed edge returns');
  assert(after.includes('const necklinePath = Array.from({length: dragon ? 9 : 17}, (_, k) => [k / (dragon ? 8 : 16), 1] as [number, number]);'));
  assert(after.includes("necklinePath, dragon ? .0084 : .007, m.metal, 'spine_03', false, true);"));
  assert(after.includes('const clearance = .004') && after.includes('return panel(u, v).addScaledVector(normalAt(panel, u, v), clearance);'));
  const frameLine = "    frame(g, `Cloth tail ${k}`, panel, m, dragon ? .009 : .0073, 'skirt');";
  assert(before.includes(frameLine) && after.includes(frameLine), 'Original panel gold frame changed');
  assert(!after.includes('crossing folded inner chest cloth') && !after.includes('crossing inner cloth turned edge'));
  return {file, baselineFile, beforeSha256: hash(before), afterSha256: hash(after),
    exactSections: preserved.map(([name]) => name),
    exactTailPanelLoftHemAndTipFormula: true, exactTailGoldFrameCall: true,
    redReplacedRearPanels: [3,5], redRaisedScaleCourses: {columns: 4, rows: 18},
    rearInteriorClearanceMm: 4, rearCarrierClearanceFadesAtEveryEdge: true,
    redBackingRecessMetres: .001,
    blueCrossedBandAndTinyTrimCallsRemoved: true, necklinePoints: {blue: 17, red: 9},
    limits: 'Source scope accompanies exported vertex comparisons. It is not rendered appearance proof.'};
}

async function filesIn(directory) {
  const rows = await readdir(absolute(directory), {withFileTypes: true});
  return (await Promise.all(rows.map(row => row.isDirectory() ? filesIn(`${directory}/${row.name}`) : [`${directory}/${row.name}`]))).flat();
}
async function sourceDependencies() {
  const inputs = [...themes.map(theme => `tools/item-models/authors/armor-${theme}-reference.ts`),
    ...(await filesIn('tools/item-models/tier50-70')).filter(file => /\.(ts|json|py)$/.test(file)),
    ...(await filesIn('tools/item-models/starhide')).filter(file => /\.(ts|json|py)$/.test(file)),
    ...(await filesIn('art/tier50-70/textures')).filter(file => /\.(png|json|txt)$/.test(file)),
    sharedBuild, 'tools/item-models/contracts.ts', 'tools/item-models/skin.ts',
    'tools/item-models/core/profile.ts', 'tools/item-models/core/contracts.ts', 'tools/item-models/core/body-profile.json',
    'game/public/assets/models/character/base_male.glb', 'art/tier50-70/references/embroidered-fabric-r12.png',
    ...themes.flatMap(theme => pieces.map(piece => `art/item-icons/generated/${theme}_${piece}.png`)),
  ].sort();
  assert.equal(new Set(inputs).size, inputs.length);
  return Promise.all(inputs.map(async file => {
    const raw = await bytesAt(file), text = /\.(ts|json|py)$/.test(file), bytes = text ? Buffer.from(raw.toString().replaceAll('\r\n', '\n')) : raw;
    return {file, sha256: hash(bytes), bytes: bytes.length, encoding: text ? 'utf8-lf' : 'binary'};
  }));
}

const report = {round: 'r15', date: new Date().toISOString(), passed: false,
  scope: 'Read-only GLB and source verification. No rendering, gameplay acceptance, fit acceptance, or production promotion.',
  baselineDirectory: baselineDir, designByItemTheme: {dragonhide: {tier: 50, designTheme: 'starhide', color: 'blue'},
    starhide: {tier: 70, designTheme: 'dragonhide', color: 'red'}},
  policy: {exactGeometryPieces: [...frozenPieces], mutableGeometryPieces: ['robe'], exactAllR14MaterialsAndImageBytes: true,
    upperRobe: 'T50 removes redundant crossing chest bands and their tiny trim; only its silver neckline rim gets finer sampling. T50 cloth and lining only lose bounded crossing-band samples, with no added or altered samples. T70 upper robe cloth stays exact.',
    rearRobe: 'T70 replaces two rear flanking cloth panels with raised scales. The original authored panel loft and gold frames stay exact; the new scale carrier adds up to 4 mm clearance inside fixed edges, with its backing recessed 1 mm. All other samples stay exact.',
    unchangedBodyCoverage: approvedRobeCoverage, permittedT50ChestBounds: blueChestBounds, permittedT50SilverNecklineBounds: blueNecklineBounds, permittedT70RearBounds: redRearBounds,
    preservedDefect: 'Only existing zero-length hood lining normals may remain. All other normals must be finite unit vectors.',
    limits: 'Bounds and changed samples do not establish fit, clearance, movement quality, or visual acceptance. Root browser gates own those checks.'},
  sharedBuild: {file: sharedBuild, pinnedSha256: sharedBuildSha256}, provenance: [], currentFiles: [], assets: [], errors: []};
async function checked(label, action) {
  try { return await action(); }
  catch (error) { report.errors.push({check: label, message: String(error.message ?? error).slice(0, 3000)}); return null; }
}
const currentCatalogs = new Map(), baselineCatalogs = new Map(), readHashes = new Map();
const dependencySnapshot = await checked('source dependency snapshot', sourceDependencies);
await checked('shared exporter pinned to R14', async () => {
  const actual = hash(await bytesAt(sharedBuild)); report.sharedBuild.actualSha256 = actual;
  assert.equal(actual, sharedBuildSha256, 'Shared exporter changed from the pinned R14 version');
});
for (const theme of themes) {
  for (const [directory, store] of [[baselineDir, baselineCatalogs], [candidateRoot(theme), currentCatalogs]]) {
    const file = directory === baselineDir ? `${directory}/${theme}-catalogue.json` : `${directory}/catalogue.json`;
    const catalog = await checked(`${theme} ${directory === baselineDir ? 'baseline' : 'candidate'} catalog`, async () => {
      const bytes = await bytesAt(file); readHashes.set(file, hash(bytes)); return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    });
    if (catalog) store.set(theme, catalog);
  }
  await checked(`${theme} candidate source provenance`, async () => {
    const catalog = currentCatalogs.get(theme); assert(catalog && dependencySnapshot);
    const baseline = baselineCatalogs.get(theme); assert(baseline);
    const oldDependencies = new Map(baseline.sourceDependencies.map(entry => [entry.file,entry]));
    assert.deepEqual(dependencySnapshot.map(entry => entry.file), baseline.sourceDependencies.map(entry => entry.file), 'Source dependency inventory changed');
    const changedDependencies = dependencySnapshot.filter(entry => digest(entry) !== digest(oldDependencies.get(entry.file))).map(entry => entry.file);
    assert.deepEqual(changedDependencies, ['tools/item-models/tier50-70/robe.ts'], 'Source changes extend beyond the robe author');
    assert.deepEqual(catalog.sourceDependencies, dependencySnapshot, 'Candidate build dependencies are stale or incomplete');
    assert.equal(catalog.dependencySha256, hash(JSON.stringify(dependencySnapshot)));
    assert.equal(catalog.pack.source, sharedBuild); assert.equal(catalog.pack.generatorSha256, sharedBuildSha256);
    assert.deepEqual(catalog.assets.map(asset => asset.itemId).sort(), pieces.map(piece => `${theme}_${piece}`).sort());
    const author = `tools/item-models/authors/armor-${theme}-reference.ts`, authorSha256 = hash(await bytesAt(author));
    for (const asset of catalog.assets) {
      assert.equal(asset.sourceSha256, authorSha256, `${asset.itemId}: stale author source hash`);
      assert.equal(asset.dependencySha256, catalog.dependencySha256);
      assert.equal(asset.referenceSha256, hash(await bytesAt(asset.metadata.reference)), `${asset.itemId}: stale reference hash`);
    }
    report.provenance.push({theme, author, authorSha256, dependencySha256: catalog.dependencySha256, sourceDependencies: dependencySnapshot.length, changedDependencies});
  });
}
report.authoredScope = await checked('authored robe change scope', verifyAuthoredScope);
for (const theme of themes) for (const piece of pieces) {
  const itemId = `${theme}_${piece}`, file = `${candidateRoot(theme)}/models/items/${itemId}.glb`, baselineFile = `${baselineDir}/${itemId}.glb`;
  await checked(`${itemId} R14 preservation and geometry`, async () => {
    const [currentBytes, baselineBytes] = await Promise.all([bytesAt(file), bytesAt(baselineFile)]);
    const sha256 = hash(currentBytes), baselineSha256 = hash(baselineBytes);
    readHashes.set(file, sha256); readHashes.set(baselineFile, baselineSha256);
    report.currentFiles.push({itemId, file, bytes: currentBytes.length, sha256});
    const current = currentCatalogs.get(theme)?.assets.find(asset => asset.itemId === itemId);
    const previous = baselineCatalogs.get(theme)?.assets.find(asset => asset.itemId === itemId); assert(current && previous);
    assert.equal(current.sha256, sha256); assert.equal(current.bytes, currentBytes.length);
    assert.equal(previous.sha256, baselineSha256); assert.equal(previous.bytes, baselineBytes.length);
    for (const key of ['id', 'file', 'pack', 'category', 'is', 'itemId', 'animations']) {
      assert.deepEqual(current[key], previous[key], `${itemId}: catalog identity or fit metadata changed at ${key}`);
    }
    for (const key of ['itemModel', 'metadata']) {
      assert.deepEqual(current[key], expectedFitMetadata(previous[key], piece), `${itemId}: catalog metadata differs from approved fit at ${key}`);
    }
    const identityTags = tags => tags.filter(tag => !['reference-tailored-candidate', 'tier50-70-tailored-approved'].includes(tag));
    assert.deepEqual(identityTags(current.tags), identityTags(previous.tags));
    assert.deepEqual([...current.materials].sort(), [...previous.materials].sort(), 'Catalog material names changed');
    const oldMaterials = materialsState(parseGLB(baselineBytes, baselineFile)), newMaterials = materialsState(parseGLB(currentBytes, file));
    assert.deepEqual(newMaterials, oldMaterials, `${itemId}: R14 material state, texture mapping, or embedded image bytes changed`);
    const [before, after] = await Promise.all([io.readBinary(baselineBytes), io.readBinary(currentBytes)]);
    const oldRig = rigState(before, itemId), newRig = rigState(after, itemId);
    assert.deepEqual(newRig, oldRig, `${itemId}: skeleton, bone transforms, or inverse binds changed`);
    const metadata = after.getRoot().listScenes()[0].getExtras().itemModel;
    assert.deepEqual(metadata, expectedFitMetadata(before.getRoot().listScenes()[0].getExtras().itemModel, piece),
      `${itemId}: embedded metadata differs from approved fit`);
    assert.equal(metadata.itemId, itemId); assert.equal(metadata.author, `armor-${theme}-reference`);
    assert.equal(metadata.designTheme, opposite(theme)); assert.equal(metadata.wearable, true);
    assert.equal(metadata.reference, `art/item-icons/generated/${opposite(theme)}_${piece}.png`);
    const validation = validateGeometry(after, before, itemId, piece);
    assert.equal(validation.triangles, current.triangles); assert.equal(validation.drawCalls, current.drawCalls);
    const geometry = geometryChanges(before, after, itemId, piece);
    const geometrySha256 = digest(geometryState(after)), baselineGeometrySha256 = digest(geometryState(before));
    if (frozenPieces.has(piece)) assert.equal(geometrySha256, baselineGeometrySha256, `${itemId}: frozen piece geometry, topology, UVs, or skin data changed`);
    let upperCloth;
    if (piece === 'robe') {
      upperCloth = verifyUpperCloth(before, after, opposite(theme), itemId);
    }
    report.assets.push({itemId, tier: theme === 'dragonhide' ? 50 : 70, designTheme: opposite(theme), file, sha256,
      baselineFile, baselineSha256, itemCatalogIdentityPreserved: true, fitMetadataMatchesApprovedScope: true,
      itemCatalogIdentityAndFitMetadataPreserved: true,
      exactR14MaterialsAndTextureImageBytes: true,
      materials: Object.keys(newMaterials.materials).length, imageBytes: newMaterials.images, materialStateSha256: digest(newMaterials),
      bones: 65, exactR14RigAndInverseBinds: true, inverseBindSha256: newRig.inverseBind.sha256,
      exactR14GeometryRequired: frozenPieces.has(piece), geometryUnchanged: geometrySha256 === baselineGeometrySha256,
      geometrySha256, baselineGeometrySha256, upperCloth, validation, geometry});
  });
}
await checked('inputs remained unchanged during verification', async () => {
  assert(dependencySnapshot); assert.deepEqual(await sourceDependencies(), dependencySnapshot, 'Source dependencies changed during verification');
  for (const [file, sha256] of readHashes) assert.equal(hash(await bytesAt(file)), sha256, `${file}: changed during verification`);
});
report.passed = report.errors.length === 0 && report.provenance.length === 2 && report.currentFiles.length === 10 && report.assets.length === 10;
await mkdir(dirname(absolute(output)), {recursive: true});
await writeFile(absolute(output), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({round: report.round, passed: report.passed, assets: report.assets.length, report: output,
  changedAssets: report.assets.filter(asset => !asset.geometryUnchanged).map(asset => asset.itemId),
  errors: report.errors.map(error => ({check: error.check, message: error.message.split('\n')[0]}))}));
if (!report.passed) process.exitCode = 1;
