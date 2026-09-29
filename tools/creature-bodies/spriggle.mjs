/**
 * The spriggle bodies (fairy_monster_10 and its two garden reskins) rebuilt on the PixeliusVita
 * "Free Fantasy Monster 10" full pack: the same mesh as the trial-pack body 10, with the studio's
 * own Idle, Walk, Run, Attack01, GetHit and Die takes (Unity `.anim` curves from InPlace_Anim).
 *
 * The takes exist only as Unity `.anim` Hermite curves; they are sampled at 60 Hz with their own
 * tangents (tools/creature-expansion/monsters/mantis.mjs: parse + sample, keys optimised
 * losslessly), undoing Unity's FBX X mirror and metre conversion. The Unity `root` object keeps
 * its Y and loses XZ. Each body keeps its current production material (texture-only skin) and its
 * placement node (uniform scale and XZ centring); nothing else from the old file is used.
 *
 *   py -3 tools/creature-bodies/extract.py monster10
 *   node tools/creature-bodies/spriggle.mjs [--out test-results/creature-motion/bodies]
 */
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {copyToDocument, createDefaultPropertyResolver, prune, weld} from '@gltf-transform/functions';
import {readFile} from 'node:fs/promises';
import {sourceLoader, readFbx} from '../wilderness-dragons/source.mjs';
import {io, option, measure, stageCandidate, manifestEntry, PUBLIC} from '../wilderness-dragons/stage.mjs';
import {convertMantisUnityAnimation} from '../creature-expansion/monsters/mantis.mjs';

const SOURCE = 'test-results/creature-bodies/source/monster10/Assets/Stylized3DMonster/Monster10';
const OUT = option('out', 'test-results/creature-motion/bodies');
const IDS = ['fairy_monster_10', 'fairy_garden_spriggle_gloamgarden', 'fairy_garden_spriggle_faeholme'];
const TAKES = {Idle: 'Monster10_Idle', Walk: 'Monster10_Walk_InPlace', Run: 'Monster10_Run_InPlace', Attack: 'Monster10_Attack01_InPlace', Hit: 'Monster10_GetHit', Death: 'Monster10_Die'};

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(value => { this.result = value; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(value => { this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`; this.onloadend?.(); }); }
};

const loader = await sourceLoader();
for (const id of IDS) {
  const entry = await manifestEntry(id);
  const production = await io.readBinary(new Uint8Array(await readFile(`${PUBLIC}/${entry.file}`)));
  const placement = production.getRoot().listScenes()[0].listChildren()[0];

  const rig = await readFbx(loader, `${SOURCE}/Monster10.fbx`);
  const clips = [];
  for (const [name, file] of Object.entries(TAKES)) {
    // Unity wraps long flow mappings onto a second line after a comma; unwrap before parsing.
    const text = (await readFile(`${SOURCE}/Anim/InPlace_Anim/${file}.anim`, 'utf8')).replace(/,\r?\n[ \t]+/g, ', ');
    const clip = convertMantisUnityAnimation(text, rig, name);
    clip.userData = {};
    clips.push(clip);
  }
  rig.traverse(n => { if (n.isMesh) { n.material = new THREE.MeshStandardMaterial({name: 'placeholder'}); if (n.isSkinnedMesh) n.normalizeSkinWeights(); } });
  rig.name = placement.getName();
  const [x, , z] = placement.getTranslation();
  rig.position.set(x, 0, z);
  rig.scale.setScalar(placement.getScale()[0]);
  const doc = await io.readBinary(new Uint8Array(await new GLTFExporter().parseAsync(rig, {binary: true, animations: clips, trs: true, onlyVisible: false})));
  await doc.transform(weld());

  // Texture-only skin from the production file (same mesh and UVs).
  for (const extension of production.getRoot().listExtensionsUsed()) {
    const target = doc.createExtension(extension.constructor);
    if (extension.isRequired()) target.setRequired(true);
  }
  const buffer = doc.getRoot().listBuffers()[0], fallback = createDefaultPropertyResolver(doc, production);
  const skinMaterial = production.getRoot().listMeshes()[0].listPrimitives()[0].getMaterial();
  const material = copyToDocument(doc, production, [skinMaterial], p => p.propertyType === 'Buffer' ? buffer : fallback(p)).get(skinMaterial);
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) primitive.setMaterial(material);
  await doc.transform(prune({keepLeaves: true}));

  const m = await measure(doc, {feet: /^foot/i, head: 'headx'});
  const {file} = await stageCandidate({out: OUT, id, doc, measurement: m,
    set: {
      pack: 'pixeliusvita-monster10',
      walkClipSeconds: m.clips.Walk.seconds, runClipSeconds: m.clips.Run.seconds, attackSeconds: m.clips.Attack.seconds,
    },
    motionProvenance: {native: Object.keys(TAKES), donor: {}, authored: [],
      notes: `Free Fantasy Monster 10 (PixeliusVita) takes ${Object.entries(TAKES).map(([k, v]) => `${k}=InPlace_Anim/${v}.anim`).join(', ')}: Unity Hermite curves sampled at 60 Hz with their tangents, keys optimised losslessly, Unity root XZ removed, on the pack's Monster10.fbx mesh and rig (same mesh as the trial body 10). Uniform scale ${placement.getScale()[0]}, XZ centring kept from the previous file. Material and texture from the previous production file.`}});
  const f = s => `${s.x.toFixed(2)} x ${s.y.toFixed(2)} x ${s.z.toFixed(2)}`;
  console.log(`${id}: ${f(entry.size)} m -> ${f(m.size)} m; ${Object.entries(m.clips).map(([k, c]) => `${k} ${c.seconds.toFixed(2)}s minY ${c.minY.toFixed(3)}`).join(', ')} -> ${file}`);
}
