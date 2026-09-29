/**
 * Ashen Ghoul on the Simple Game Assets "Necromancer Army - Ghoul": the studio mesh, skin weights
 * and baked takes on the deform-bone subset of its Auto-Rig Pro rig.
 *
 * The FBX carries the whole 338-bone ARP control rig with every take baked on every bone. Only the
 * bones that carry skin weight (the skin joints) and the control bones they hang from are kept;
 * every other controller is dropped with its tracks. Kept tracks are the native keys unchanged
 * (ARP stretch bones scale non-uniformly, so the parent chain is what keeps the hands exact).
 * Native tempo, the top control bone's XZ held at rest, one uniform scale.
 *
 *   py -3 tools/creature-bodies/extract.py ghoul
 *   node tools/creature-bodies/ashen-ghoul.mjs [--out test-results/creature-motion/bodies] [--colour Purple]
 */
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {prune, resample, weld} from '@gltf-transform/functions';
import {sourceLoader, readFbx} from '../wilderness-dragons/source.mjs';
import {io, option, measure, stageCandidate} from '../wilderness-dragons/stage.mjs';
import {studioMaterial} from './studio-material.mjs';

const SOURCE = 'test-results/creature-bodies/source/ghoul/Assets/SimpleAssets/Necromancers/Ghoul';
const OUT = option('out', 'test-results/creature-motion/bodies');
/** The Ashen Ghoul's own asset id (only it wears this body; Grave Ghoul wears creature_grave_ghoul). */
const ID = 'creature_grave_lantern';
const COLOUR = option('colour', 'Purple');
/** Studio emission colour per base (Material/Ghoul<colour>.mat), normalised to glTF's [0, 1]. */
const EMISSION = {Blue: [0.61, 0.98, 1.68], Green: [2.34, 0.97, 0], Purple: [2.24, 0.49, 4]};
const GLOSS = {Blue: 0.949, Green: 0.944, Purple: 0.923};
/** FBX units are centimetres; the studio ghoul stands 1.83 m. The Ashen Ghoul is a L24-74 undead. */
const SCALE = 0.0105;
const TAKES = {Idle: 'Idle', Walk: 'Walk', Run: 'Run', Attack: 'Attack', Hit: 'Hit', Death: 'Death2', CastSpell: 'CastSpell'};

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(value => { this.result = value; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(value => { this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`; this.onloadend?.(); }); }
};

const loader = await sourceLoader();
const source = await readFbx(loader, `${SOURCE}/FBX/Ghoul.fbx`);
source.updateMatrixWorld(true);
const meshes = []; source.traverse(n => { if (n.isSkinnedMesh) meshes.push(n); });
for (const mesh of meshes) if (!mesh.matrixWorld.equals(new THREE.Matrix4())) throw new Error(`${mesh.name} is not at the scene origin`);

// FBXLoader gives each skinned mesh its own copy of the rig; secondary copies hang at identity
// under the primary bone of the same name. The primary is the copy whose parent has another name.
const primary = new Map();
source.traverse(n => { if (n.isBone && n.parent?.name !== n.name && !primary.has(n.name)) primary.set(n.name, n); });

// Deform bones: any bone with skin weight on any mesh, with its inverse bind.
const inverseBind = new Map();
for (const mesh of meshes) {
  const w = mesh.geometry.attributes.skinWeight, j = mesh.geometry.attributes.skinIndex;
  for (let i = 0; i < w.count; i++) for (let k = 0; k < 4; k++) if (w.getComponent(i, k) > 0) {
    const index = j.getComponent(i, k), name = mesh.skeleton.bones[index].name;
    if (!inverseBind.has(name)) inverseBind.set(name, mesh.skeleton.boneInverses[index].clone());
  }
}
const deform = [...primary.keys()].filter(name => inverseBind.has(name));
// Kept nodes: the deform bones and the control bones they hang from. ARP stretch bones scale
// non-uniformly, so the hands and fingers inherit shear that only the native parent chain can
// express; keeping that chain keeps every native local track exactly as authored.
const keep = new Set();
for (const name of deform) for (let n = primary.get(name); n?.isBone; n = n.parent) keep.add(n);
const doomed = [];
source.traverse(n => { if (n.isBone && (primary.get(n.name) !== n || !keep.has(n))) doomed.push(n); });
for (const n of doomed) n.removeFromParent();
const skeleton = new THREE.Skeleton(deform.map(name => primary.get(name)), deform.map(name => inverseBind.get(name)));
const newIndex = new Map(deform.map((name, i) => [name, i]));
const placeholder = new THREE.MeshStandardMaterial({name: 'placeholder'});
for (const mesh of meshes) {
  const j = mesh.geometry.attributes.skinIndex, w = mesh.geometry.attributes.skinWeight;
  for (let i = 0; i < j.count; i++) for (let k = 0; k < 4; k++) {
    const name = mesh.skeleton.bones[j.getComponent(i, k)].name;
    j.setComponent(i, k, w.getComponent(i, k) > 0 ? newIndex.get(name) : 0);
  }
  mesh.material = placeholder;
  mesh.bind(skeleton, mesh.bindMatrix.clone());
  mesh.normalizeSkinWeights();
}
const kept = new Set([...keep].map(n => n.name));
const topBones = [...keep].filter(n => !n.parent?.isBone);
source.name = `${ID}_native`;

/** One native take restricted to the kept nodes; top control bones' XZ held at rest. */
function nativeClip(take, name) {
  const tracks = take.tracks.filter(track => kept.has(track.name.slice(0, track.name.lastIndexOf('.')))).map(track => {
    const copy = track.clone(), bone = topBones.find(b => `${b.name}.position` === copy.name);
    if (bone) for (let i = 0; i < copy.values.length; i += 3) { copy.values[i] = bone.position.x; copy.values[i + 2] = bone.position.z; }
    return copy;
  });
  return new THREE.AnimationClip(name, take.duration, tracks);
}

const clips = [];
for (const [name, file] of Object.entries(TAKES)) {
  const take = (await readFbx(loader, `${SOURCE}/Animation/${file}.fbx`)).animations[0];
  const clip = nativeClip(take, name); clips.push(clip);
  console.log(`${name} <- ${file}.fbx ${take.duration.toFixed(3)} s, ${clip.tracks.length} of ${take.tracks.length} native tracks`);
}
source.scale.setScalar(SCALE);
const doc = await io.readBinary(new Uint8Array(await new GLTFExporter().parseAsync(source, {binary: true, animations: clips, trs: true, onlyVisible: false})));
await doc.transform(weld(), resample({tolerance: 1e-4}));

const T = `${SOURCE}/Texture/`;
const material = await studioMaterial(doc, {
  name: `ashen_ghoul_${COLOUR.toLowerCase()}`, albedo: `${T}Base${COLOUR}.tga`, normal: `${T}Body_low_Default OBJ_Normal.png`,
  occlusion: `${T}Body_low_Default OBJ_AO.png`,
  smoothness: {file: `${T}Body_low_Default OBJ_Metallic.png`, channel: 3, scale: GLOSS[COLOUR]}, metallic: {file: `${T}Body_low_Default OBJ_Metallic.png`, channel: 0},
  emission: `${T}Body_low_Default OBJ_Emissive.png`, emissiveFactor: EMISSION[COLOUR].map(c => c / Math.max(...EMISSION[COLOUR])),
});
for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) primitive.setMaterial(material);
await doc.transform(prune({keepLeaves: true}));

const m = await measure(doc, {feet: /^foot[lr]$/, head: 'headx'});
const {file} = await stageCandidate({out: OUT, id: ID, doc, measurement: m,
  set: {
    pack: 'simple-game-assets-necromancer-army-ghoul',
    is: 'Ashen Ghoul: a gaunt hunched undead with violet flesh, rust-brown bindings, long bone-blade claws and glowing eyes.',
    tags: ['creature', 'undead', 'ghoul', 'claws', 'wilderness', 'hostile'],
    walkClipSeconds: m.clips.Walk.seconds, runClipSeconds: m.clips.Run.seconds, attackSeconds: m.clips.Attack.seconds,
    metadata: {provenance: {
      author: 'Simple Game Assets', license: 'Standard Unity Asset Store EULA', sourceArchive: 'Necromancer Army - Ghoul.unitypackage',
      archiveSha256: '6cd261bf7f43c60776a3d0814f0c427e35c6f21602c2560b5d9b211d1b680fd7',
      sourceMesh: 'Assets/SimpleAssets/Necromancers/Ghoul/FBX/Ghoul.fbx',
      sourceAnimations: Object.fromEntries(Object.entries(TAKES).map(([k, v]) => [k, `Assets/SimpleAssets/Necromancers/Ghoul/Animation/${v}.fbx`])),
      generator: 'tools/creature-bodies/ashen-ghoul.mjs', nativeScale: SCALE, animationTempo: 1, deformBones: deform.length, keptNodes: keep.size,
      skin: `Studio texture set Base${COLOUR}.tga with the shared normal, AO, metallic-smoothness and emissive maps, resized and repacked only.`,
    }},
  },
  motionProvenance: {native: Object.keys(TAKES), donor: {}, authored: [],
    notes: `Necromancer Army Ghoul takes ${Object.entries(TAKES).map(([k, v]) => `${k}=${v}`).join(', ')} baked in the FBX on the Auto-Rig Pro control rig, restricted to its ${deform.length} weighted deform bones and their ${keep.size - deform.length} control-bone ancestors, native keys (thinned at tolerance 1e-4) and tempo; root XZ held at rest; uniform scale ${SCALE}. Studio texture set Base${COLOUR}.`}});
const f = s => `${s.x.toFixed(2)} x ${s.y.toFixed(2)} x ${s.z.toFixed(2)}`;
console.log(`${ID}: ${deform.length} deform bones; ${f(m.size)} m; ${Object.entries(m.clips).map(([k, c]) => `${k} ${c.seconds.toFixed(2)}s minY ${c.minY.toFixed(3)}`).join(', ')} -> ${file}`);
