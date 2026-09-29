/**
 * Furnace Grazer on the Maksim Bugrimov Fantasy Rhino: the studio mesh, CAT rig and takes, in the
 * pack's own PBR texture set.
 *
 * Rino_mesh.FBX and the per-take Rhino@*.FBX files are bound by FBX node identity (the CAT rig
 * repeats names, so duplicates are named by ancestry), at native tempo, with the root bones' XZ
 * held at rest and one uniform scale. The CAT helper mesh `Character001` is dropped. Eats ships
 * as an extra native take.
 *
 *   py -3 tools/creature-bodies/extract.py rhino
 *   node tools/creature-bodies/furnace-grazer.mjs [--out test-results/creature-motion/bodies]
 */
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {prune, weld} from '@gltf-transform/functions';
import {sourceLoader, readFbx, identities, nameRig, importClip} from '../wilderness-dragons/source.mjs';
import {io, option, measure, stageCandidate, manifestEntry} from '../wilderness-dragons/stage.mjs';
import {studioMaterial} from './studio-material.mjs';

const SOURCE = 'test-results/creature-bodies/source/rhino/Assets/Rhino';
const OUT = option('out', 'test-results/creature-motion/bodies');
const ID = 'creature_furnace_grazer';
/** FBX units are millimetres: 0.001 is the studio's 2.6 m rhino. The grazer is a L50-70 heavy. */
const SCALE = 0.0012;
const TAKES = {Idle: 'Idle', Walk: 'Walk', Run: 'Run', Attack: 'Attack', Hit: 'Get_Hit', Death: 'Dead', Eats: 'Eats'};

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(value => { this.result = value; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(value => { this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`; this.onloadend?.(); }); }
};

const loader = await sourceLoader();
const rig = await readFbx(loader, `${SOURCE}/Mesh/Rino_mesh.FBX`), ids = identities(rig);
nameRig(rig, ids); rig.name = `${ID}_native`;
const clips = [];
for (const [name, take] of Object.entries(TAKES)) clips.push(importClip(await readFbx(loader, `${SOURCE}/animation/Rhino@${take}.FBX`), ids, name));
rig.getObjectByName('Character001')?.removeFromParent();
for (const clip of clips) clip.tracks = clip.tracks.filter(track => !track.name.startsWith('Character001.'));
rig.traverse(n => { if (n.isMesh) { n.material = new THREE.MeshStandardMaterial({name: 'placeholder'}); if (n.isSkinnedMesh) n.normalizeSkinWeights(); } });
rig.scale.setScalar(SCALE);
const doc = await io.readBinary(new Uint8Array(await new GLTFExporter().parseAsync(rig, {binary: true, animations: clips, trs: true, onlyVisible: false})));
await doc.transform(weld());

const T = `${SOURCE}/Texture/Rhinoceros_`;
const material = await studioMaterial(doc, {
  name: 'furnace_grazer_rhino_pbr', albedo: `${T}Albedo.tga`, normal: `${T}normals.tga`, occlusion: `${T}Ao.tga`,
  smoothness: {file: `${T}Metallic.tga`, channel: 3}, metallic: {file: `${T}Metallic.tga`, channel: 0},
  emission: `${T}Emissive.tga`, emissiveFactor: [1, 1, 1],
});
for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) primitive.setMaterial(material);
await doc.transform(prune({keepLeaves: true}));

const m = await measure(doc, {feet: /Foot|Toe|Ankle/i, head: null});
const entry = await manifestEntry(ID);
const {file} = await stageCandidate({out: OUT, id: ID, doc, measurement: m,
  set: {
    pack: 'fantasy-rhino',
    is: 'Furnace Grazer: a heavy armoured fantasy rhino with a horned brow plate, dark hide and glowing cyan markings.',
    walkClipSeconds: m.clips.Walk.seconds, runClipSeconds: m.clips.Run.seconds, attackSeconds: m.clips.Attack.seconds,
    metadata: {...entry.metadata, provenance: {
      author: 'Maksim Bugrimov', license: 'Standard Unity Asset Store EULA', sourceArchive: 'Fantasy Rhino.unitypackage',
      archiveSha256: 'c3fca8ff44e3102c0bb880e6db70ee1cdc5850b1cd4a6465c5d761f8276f10e8',
      sourceMesh: 'Assets/Rhino/Mesh/Rino_mesh.FBX', sourceAnimations: Object.fromEntries(Object.entries(TAKES).map(([k, v]) => [k, `Assets/Rhino/animation/Rhino@${v}.FBX`])),
      generator: 'tools/creature-bodies/furnace-grazer.mjs', nativeScale: SCALE, animationTempo: 1,
      skin: 'Studio texture set Assets/Rhino/Texture/Rhinoceros_{Albedo,normals,Ao,Metallic,Emissive}.tga, resized and repacked only.',
    }},
  },
  motionProvenance: {native: Object.keys(TAKES), donor: {}, authored: [],
    notes: `Fantasy Rhino takes ${Object.entries(TAKES).map(([k, v]) => `${k}=Rhino@${v}`).join(', ')} bound by FBX node identity at native tempo; root XZ held at rest; uniform scale ${SCALE}. Native CAT skeleton and mesh; helper mesh Character001 dropped. Studio PBR texture set.`}});
const f = s => `${s.x.toFixed(2)} x ${s.y.toFixed(2)} x ${s.z.toFixed(2)}`;
console.log(`${ID}: ${f(entry.size)} m -> ${f(m.size)} m; ${Object.entries(m.clips).map(([k, c]) => `${k} ${c.seconds.toFixed(2)}s minY ${c.minY.toFixed(3)}`).join(', ')} -> ${file}`);
