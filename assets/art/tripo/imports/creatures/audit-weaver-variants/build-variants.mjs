import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, Accessor } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import * as THREE from 'three';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const sourceRel = 'assets/art/tripo/imports/creatures/audit-spider-family/blind-cave-weaver-sixleg-candidate.glb';
const sourcePath = path.join(repo, sourceRel);
const source = await readFile(sourcePath);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (sha(source) !== '8b317eb1391d29932ce5704de6a14a0d084b1b7aca0bdafeb2e8e5ef02d7ccaa') throw new Error('Pinned corrected six-leg source changed.');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const variants = [
  { id: 'creature_moonweave_spider', name: 'Moonweaver', file: 'moonweaver-sixleg-candidate.glb', atlas: 'moonweave/moonweaver-basecolor.png', rawAssetHeight: .5201364126930991, originalScale: .82, habitat: 'moonlit woodland' },
  { id: 'creature_amethyst_spider', name: 'Amethyst Weaver', file: 'amethyst-weaver-sixleg-candidate.glb', atlas: 'amethyst/amethyst-weaver-basecolor.png', rawAssetHeight: .5201364126930991, originalScale: .72, habitat: 'amethyst cavern' },
  { id: 'creature_dewglass_weaver', name: 'Dewglass Weaver', file: 'dewglass-weaver-sixleg-candidate.glb', atlas: 'dewglass/dewglass-generated-atlas.png', rawAssetHeight: .4917102624576964 * 1.9, originalScale: .7086123195731177, habitat: 'Gloamgarden fairy region' },
];
const originalCatalog = JSON.parse(await readFile(path.join(repo, 'assets/art/tripo/imports/creatures/starred-vaultweaver/catalog.json')));
const sourceHeight = originalCatalog.candidate.size.y;
const created = [];

function sampleChannel(channel, seconds) {
  const sampler = channel.getSampler();
  const times = sampler.getInput().getArray();
  const values = sampler.getOutput().getArray();
  const width = channel.getTargetPath() === 'rotation' ? 4 : 3;
  let a = 0;
  while (a < times.length - 2 && times[a + 1] < seconds) a++;
  const b = Math.min(a + 1, times.length - 1);
  const fraction = times[b] > times[a] ? Math.max(0, Math.min(1, (seconds - times[a]) / (times[b] - times[a]))) : 0;
  const va = Array.from(values.slice(a * width, a * width + width));
  const vb = Array.from(values.slice(b * width, b * width + width));
  if (width === 4) return new THREE.Quaternion(...va).slerp(new THREE.Quaternion(...vb), fraction).toArray();
  return va.map((v, i) => v * (1 - fraction) + vb[i] * fraction);
}

function floorAt(doc, clip, seconds) {
  const root = doc.getRoot();
  const node = root.listNodes().find(item => item.getMesh() && item.getSkin());
  const primitive = node.getMesh().listPrimitives()[0];
  const positions = primitive.getAttribute('POSITION').getArray();
  const joints = primitive.getAttribute('JOINTS_0').getArray();
  const weights = primitive.getAttribute('WEIGHTS_0').getArray();
  const skin = node.getSkin();
  const bones = skin.listJoints();
  const ibm = skin.getInverseBindMatrices().getArray();
  const overrides = new Map();
  for (const channel of clip.listChannels()) {
    const target = channel.getTargetNode();
    const value = overrides.get(target) ?? {};
    value[channel.getTargetPath()] = sampleChannel(channel, seconds);
    overrides.set(target, value);
  }
  const worlds = new Map();
  const matrix = new THREE.Matrix4();
  const worldOf = item => {
    if (worlds.has(item)) return worlds.get(item);
    const value = overrides.get(item);
    matrix.compose(new THREE.Vector3().fromArray(value?.translation ?? item.getTranslation()),
      new THREE.Quaternion().fromArray(value?.rotation ?? item.getRotation()),
      new THREE.Vector3().fromArray(item.getScale()));
    const local = matrix.clone();
    const parent = item.getParentNode();
    const world = parent ? worldOf(parent).clone().multiply(local) : local;
    worlds.set(item, world);
    return world;
  };
  const inverseMesh = worldOf(node).clone().invert();
  const matrices = bones.map((bone, i) => {
    const inverse = new THREE.Matrix4().fromArray(Array.from(ibm.slice(i * 16, i * 16 + 16)));
    return inverseMesh.clone().multiply(worldOf(bone)).multiply(inverse).elements;
  });
  let minY = Infinity;
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const x = positions[vertex * 3], y = positions[vertex * 3 + 1], z = positions[vertex * 3 + 2];
    let resultY = 0;
    for (let slot = 0; slot < 4; slot++) {
      const index = vertex * 4 + slot;
      const e = matrices[joints[index]];
      resultY += weights[index] * (e[1] * x + e[5] * y + e[9] * z + e[13]);
    }
    minY = Math.min(minY, resultY);
  }
  return minY;
}

for (const variant of variants) {
  const doc = await io.read(sourcePath);
  const root = doc.getRoot();
  const sceneScale = variant.rawAssetHeight / sourceHeight;
  const container = root.listNodes().find(node => node.getName() === 'VaultweaverNativeRigContainer');
  if (!container) throw new Error('Corrected six-leg source container missing.');
  container.setScale([sceneScale, sceneScale, sceneScale]);
  const primitive = root.listMeshes()[0].listPrimitives()[0];
  const material = primitive.getMaterial();
  const base = material.getBaseColorTexture();
  let atlasProvenance;
  if (variant.atlas) {
    const atlasPath = path.join(here, variant.atlas);
    const atlasBytes = await readFile(atlasPath);
    const runtime = await sharp(atlasBytes).resize(2048, 2048, { kernel: 'lanczos3' }).jpeg({ quality: 93, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
    const runtimeName = `${variant.id}-basecolor-2k.jpg`;
    await writeFile(path.join(here, runtimeName), runtime);
    base.setImage(new Uint8Array(runtime)).setMimeType('image/jpeg').setName(`${variant.name} generated layered base color`);
    const meta = await sharp(atlasBytes).metadata();
    atlasProvenance = { generatedAtlas: variant.atlas, generatedSha256: sha(atlasBytes), generatedDimensions: `${meta.width}x${meta.height}`, runtimeAtlas: runtimeName, runtimeSha256: sha(runtime), runtimeDimensions: '2048x2048', method: 'imagegen edit of the exact source UV atlas; generated island alignment requires root visual review' };
  } else {
    atlasProvenance = { sourceAtlas: sourceRel, sourceAtlasSha256: sha(Buffer.from(base.getImage())), runtimeDimensions: '2048x2048', method: 'unchanged image-generated layered mineral atlas from approved Tripo source' };
  }
  material.setName(`animal_${variant.id.replace('creature_', '')}_layered_shell`);
  const correction = {};
  for (const clip of root.listAnimations()) {
    const name = clip.getName();
    const translation = clip.listChannels().find(channel => channel.getTargetNode()?.getName() === 'BodyCore' && channel.getTargetPath() === 'translation');
    if (!translation) continue;
    const duration = Math.max(...translation.getSampler().getInput().getArray());
    const times = Array.from({ length: 17 }, (_, index) => duration * index / 16);
    const original = times.map(t => sampleChannel(translation, t));
    const before = times.map(t => floorAt(doc, clip, t));
    const desired = original.map((value, index) => [value[0], value[1] + Math.max(0, .002 - before[index]), value[2]]);
    const buffer = root.listBuffers()[0];
    translation.getSampler().setInput(doc.createAccessor(`${name}_grounded_times`).setArray(new Float32Array(times)).setType(Accessor.Type.SCALAR).setBuffer(buffer));
    translation.getSampler().setOutput(doc.createAccessor(`${name}_grounded_body`).setArray(new Float32Array(desired.flat())).setType(Accessor.Type.VEC3).setBuffer(buffer));
    const after = times.map(t => floorAt(doc, clip, t));
    correction[name] = { beforeMinY: Math.min(...before), afterMinY: Math.min(...after), maximumBodyLift: Math.max(...desired.map((p, i) => p[1] - original[i][1])) };
    if (Math.min(...after) < -.005) throw new Error(`${variant.name} ${name} still sinks after floor correction.`);
  }
  const output = path.join(here, variant.file);
  await io.write(output, doc);
  const bytes = await readFile(output);
  const written = await io.read(output);
  const writtenRoot = written.getRoot();
  const writtenContainer = writtenRoot.listNodes().find(node => node.getName() === 'VaultweaverNativeRigContainer');
  if (!writtenContainer || writtenContainer.getScale().some(value => Math.abs(value - sceneScale) > 1e-6)) throw new Error(`${variant.name} lost scene scale after GLB serialization.`);
  const sourceJoints = root.listSkins()[0].listJoints().map(node => node.getName());
  const writtenJoints = writtenRoot.listSkins()[0].listJoints().map(node => node.getName());
  if (sourceJoints.some((name, index) => name !== writtenJoints[index])) throw new Error(`${variant.name} changed joint index order.`);
  const writtenClips = writtenRoot.listAnimations().map(clip => clip.getName());
  if (writtenClips.join(',') !== 'Idle,Walk,Run,Attack,Hit,Death') throw new Error(`${variant.name} lost required clips.`);
  const writtenBase = writtenRoot.listMaterials()[0].getBaseColorTexture();
  const writtenTextureMeta = await sharp(Buffer.from(writtenBase.getImage())).metadata();
  if (writtenTextureMeta.width !== 2048 || writtenTextureMeta.height !== 2048) throw new Error(`${variant.name} lost 2K base color.`);
  const serializedFloor = Object.fromEntries(writtenRoot.listAnimations().map(clip => {
    const duration = Math.max(...clip.listSamplers().map(sampler => Math.max(...sampler.getInput().getArray())));
    const samples = Array.from({ length: 17 }, (_, index) => floorAt(written, clip, duration * index / 16) * sceneScale);
    const minY = Math.min(...samples);
    if (minY < -.005) throw new Error(`${variant.name} ${clip.getName()} sinks ${(-minY).toFixed(4)}m after serialization.`);
    return [clip.getName(), minY];
  }));
  const sourceSize = originalCatalog.candidate.size;
  const sourceBounds = originalCatalog.candidate.bounds;
  const size = Object.fromEntries(Object.entries(sourceSize).map(([axis, value]) => [axis, value * sceneScale]));
  const bounds = { min: sourceBounds.min.map(value => value * sceneScale), max: sourceBounds.max.map(value => value * sceneScale) };
  const clipSeconds = name => {
    const clip = root.listAnimations().find(item => item.getName() === name);
    if (!clip) throw new Error(`Missing ${name} clip for ${variant.name}.`);
    return Math.max(...clip.listSamplers().map(sampler => Math.max(...sampler.getInput().getArray())));
  };
  const authoredTiming = { walkClipSeconds: clipSeconds('Walk'), runClipSeconds: clipSeconds('Run'), attackSeconds: clipSeconds('Attack'), contactNormalized: .42 / clipSeconds('Attack') };
  if (Math.abs(authoredTiming.walkClipSeconds - 1.08) > 1e-5 || Math.abs(authoredTiming.runClipSeconds - .72) > 1e-5 || Math.abs(authoredTiming.attackSeconds - .88) > 1e-5) throw new Error('Vaultweaver clip timing changed.');
  const candidate = { id: variant.id, displayName: variant.name, status: 'awaiting-root-lab-review', accepted: false,
    source: { candidate: sourceRel, candidateSha256: sha(source), tripoModel: originalCatalog.source.modelId, tripoExport: originalCatalog.source.file, tripoExportSha256: originalCatalog.source.sha256, originalReference: originalCatalog.source.sourceImage, originalReferenceSha256: originalCatalog.source.sourceImageSha256, anatomy: 'six walking legs and two short mouth palps; not a spider' },
    candidate: { file: variant.file, sha256: sha(bytes), bytes: bytes.length, size, bounds, triangles: originalCatalog.candidate.triangles, rig: originalCatalog.candidate.rig, animations: writtenClips, ...authoredTiming, attackContactSeconds: .42, gaitCalibration: { status: 'pending-world-speed-fit', impliedWalkMps: null, impliedRunMps: null }, sourceHeight, presentation: { sceneScale, rawAssetHeightMeters: variant.rawAssetHeight, existingSpeciesScale: variant.originalScale, desiredInGameHeightMeters: variant.rawAssetHeight * variant.originalScale, habitat: variant.habitat }, texture: atlasProvenance, floorCorrection: correction, serializedValidation: { skinJointOrderPreserved: true, texture2K: true, sixClips: true, minimumFloorYByClip: serializedFloor } },
    acceptance: { imageAudit: false, geometryAudit: false, textureAudit: false, motionAudit: false, labReview: false, productionReady: false } };
  await writeFile(path.join(here, `${variant.id}-catalog.json`), `${JSON.stringify(candidate, null, 2)}\n`);
  const lab = { schema: 'corealm-lab-asset-candidates/1', assets: [{ id: variant.id, file: variant.file, pack: 'corealm-tripo-creature-candidates', category: 'character', is: `${variant.name} six-leg candidate`, tags: ['creature', 'six-legged', 'candidate'], bytes: bytes.length, sha256: sha(bytes), size, bounds, base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] }, groundY: 0, triangles: originalCatalog.candidate.triangles, animations: root.listAnimations().map(clip => clip.getName()), ...authoredTiming, gaitCalibration: candidate.candidate.gaitCalibration, materials: [material.getName()], presentation: candidate.candidate.presentation, sourceProvenance: candidate.source, acceptance: { assetAudit: false, labAccepted: false, worldIntegrated: false } }], files: { [variant.id]: variant.file } };
  await writeFile(path.join(here, `${variant.id}-lab-catalog.json`), `${JSON.stringify(lab, null, 2)}\n`);
  created.push({ id: variant.id, file: variant.file, sha256: sha(bytes), floorCorrection: correction });
}
const individualLabs = await Promise.all(variants.map(variant => readFile(path.join(here, `${variant.id}-lab-catalog.json`), 'utf8').then(JSON.parse)));
await writeFile(path.join(here, 'lab-catalog.json'), `${JSON.stringify({
  schema: 'corealm-lab-asset-candidates/1',
  assets: individualLabs.flatMap(lab => lab.assets),
  files: Object.assign({}, ...individualLabs.map(lab => lab.files)),
}, null, 2)}\n`);
console.log(JSON.stringify(created, null, 2));
