/**
 * Dungeon Mason "Dragon for Boss Monster PBR" bodies with the studio's own mesh, rig and takes.
 *
 * Per body: the lineage mesh FBX and its single-take clips (Idle, Walk, Run, Attack, Hit, Death
 * and, where the lineage has one, Breath) bound by FBX node identity at native tempo, root bone XZ held at rest, one
 * uniform scale on the rig node. Nothing else touches the rig or the curves: no sculpt, no tempo,
 * no substituted Run, no overlays, no grounding wrapper. Grounding is the manifest `base.y`.
 *
 * Skins are texture-only and UV-mapped. A body with a design `skin` wears one of the pack's own
 * colour sets (tools/creature-bodies/studio-material.mjs). Any other body takes its material (and
 * any bone-bound thorn/crystal attachments) from the current production file of the same lineage;
 * attachments are re-seated on the native joints, each keeping its offset from the nearest body
 * vertex, matched by UV.
 *
 *   node tools/wilderness-dragons/build.mjs [--only <asset id>] [--fit]
 *        [--source <dir holding Assets/FourEvilDragonsPBR>] [--out test-results/creature-motion/dragons]
 *
 * `--fit` prints, per body, the uniform scale whose Idle length x height best matches the
 * production body; designs.mjs freezes the chosen values.
 */
import {copyToDocument, createDefaultPropertyResolver, prune, weld} from '@gltf-transform/functions';
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {readFile} from 'node:fs/promises';
import {sourceLoader, readFbx, identities, nameRig, importClip} from './source.mjs';
import {DRAGON_BODIES, LINEAGES} from './designs.mjs';
import {studioMaterial} from '../creature-bodies/studio-material.mjs';
import {io, option, manifestEntry, measure, stageCandidate, PUBLIC} from './stage.mjs';

const SOURCE = `${option('source', 'test-results/wilderness-dragons/source')}/Assets/FourEvilDragonsPBR`;
const OUT = option('out', 'test-results/creature-motion/dragons');
const ARCHIVE_SHA256 = '01b15c6e6ac1339acc40e653924691583cbf44303397878ae7f79a59112b7383';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(value => { this.result = value; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(value => { this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`; this.onloadend?.(); }); }
};

async function nativeDocument(body, loader, scale) {
  const lineage = LINEAGES[body.lineage];
  const rig = await readFbx(loader, `${SOURCE}/Mesh/${lineage.mesh}.fbx`), ids = identities(rig);
  nameRig(rig, ids); rig.name = `${body.id}_native`;
  const clips = [];
  for (const [name, file] of Object.entries(lineage.clips)) clips.push(importClip(await readFbx(loader, `${SOURCE}/Animations/${lineage.animations}/${file}.fbx`), ids, name));
  rig.traverse(n => { if (n.isMesh) { n.material = new THREE.MeshStandardMaterial({name: 'placeholder'}); if (n.isSkinnedMesh) n.normalizeSkinWeights(); } });
  rig.scale.setScalar(scale);
  const bytes = await new GLTFExporter().parseAsync(rig, {binary: true, animations: clips, trs: true, onlyVisible: false});
  const doc = await io.readBinary(new Uint8Array(bytes));
  await doc.transform(weld());
  return doc;
}

const skinnedPrimitive = doc => {
  const node = doc.getRoot().listNodes().find(n => n.getSkin() && n.getMesh());
  return {node, primitive: node.getMesh().listPrimitives()[0]};
};

/** Bind-pose world positions of a skinned primitive (glTF skinning: sum w * joint * inverseBind). */
function restPositions(doc) {
  const {node, primitive} = skinnedPrimitive(doc), skin = node.getSkin();
  const ibm = skin.getInverseBindMatrices().getArray();
  const matrices = skin.listJoints().map((j, i) => new THREE.Matrix4().fromArray(j.getWorldMatrix()).multiply(new THREE.Matrix4().fromArray(ibm, i * 16)));
  const pos = primitive.getAttribute('POSITION'), j = primitive.getAttribute('JOINTS_0'), w = primitive.getAttribute('WEIGHTS_0');
  const out = new Float32Array(pos.getCount() * 3), p = new THREE.Vector3(), q = new THREE.Vector3(), jj = [], ww = [];
  for (let i = 0; i < pos.getCount(); i++) {
    p.fromArray(pos.getElement(i, [])); j.getElement(i, jj); w.getElement(i, ww); q.set(0, 0, 0);
    for (let k = 0; k < 4; k++) if (ww[k]) q.addScaledVector(p.clone().applyMatrix4(matrices[jj[k]]), ww[k]);
    q.toArray(out, i * 3);
  }
  return {positions: out, uvs: primitive.getAttribute('TEXCOORD_0').getArray()};
}

/** Index in `native` of the vertex matching production vertex `i`: same UV, then nearest mirrored side. */
function vertexMatcher(production, native) {
  const key = (uv, i) => `${Math.round(uv[i * 2] * 4096)},${Math.round(uv[i * 2 + 1] * 4096)}`;
  const byUv = new Map();
  for (let i = 0; i < native.uvs.length / 2; i++) { const k = key(native.uvs, i); if (!byUv.has(k)) byUv.set(k, []); byUv.get(k).push(i); }
  return i => {
    const candidates = byUv.get(key(production.uvs, i));
    if (!candidates) throw new Error(`No native vertex with production UV ${key(production.uvs, i)}`);
    const side = Math.sign(production.positions[i * 3]);
    return candidates.find(c => Math.sign(native.positions[c * 3]) === side) ?? candidates[0];
  };
}

/** Dress the body in one of the pack's own colour sets. */
async function applyStudioSkin(doc, body) {
  const {material: m} = LINEAGES[body.lineage], dir = `${SOURCE}/Texture/${body.skin.set}`;
  const material = await studioMaterial(doc, {
    name: body.skin.name, albedo: `${dir}/Albedo.png`, normal: `${dir}/Normal.png`, normalScale: m.normalScale,
    occlusion: `${dir}/AO.png`,
    smoothness: {file: `${dir}/${m.workflow === 'specular' ? 'Specular' : 'Metallic'}.png`, channel: 3},
    ...(m.workflow === 'metallic' ? {metallic: {file: `${dir}/Metallic.png`, channel: 0}} : {}),
    ...(m.emission ? {emission: `${dir}/Emission.png`, emissiveFactor: [m.emission, m.emission, m.emission]} : {}),
  });
  skinnedPrimitive(doc).primitive.setMaterial(material);
}

/** Copy the body material and the bone-bound attachments from the production file. */
function applySkin(doc, production, body) {
  for (const extension of production.getRoot().listExtensionsUsed()) {
    const target = doc.createExtension(extension.constructor);
    if (extension.isRequired()) target.setRequired(true);
  }
  const buffer = doc.getRoot().listBuffers()[0], fallback = createDefaultPropertyResolver(doc, production);
  const resolve = p => p.propertyType === 'Buffer' ? buffer : fallback(p);
  const source = skinnedPrimitive(production), target = skinnedPrimitive(doc);
  const material = copyToDocument(doc, production, [source.primitive.getMaterial()], resolve).get(source.primitive.getMaterial());
  target.primitive.setMaterial(material);

  const attachments = production.getRoot().listNodes().filter(n => n.getMesh() && !n.getSkin());
  if (!attachments.length) return [];
  const before = restPositions(production), after = restPositions(doc), match = vertexMatcher(before, after);
  const joints = new Map(doc.getRoot().listNodes().map(n => [n.getName(), n]));
  const report = [];
  for (const attachment of attachments) {
    const parent = attachment.getParentNode(), joint = joints.get(parent?.getName());
    if (!joint) throw new Error(`${body.id}: attachment ${attachment.getName()} has no native joint ${parent?.getName()}`);
    const mesh = copyToDocument(doc, production, [attachment.getMesh()], resolve).get(attachment.getMesh());
    const fromWorld = new THREE.Matrix4().fromArray(attachment.getWorldMatrix());
    const toLocal = new THREE.Matrix4().fromArray(joint.getWorldMatrix()).invert();
    const normalFrom = new THREE.Matrix3().getNormalMatrix(fromWorld), normalTo = new THREE.Matrix3().getNormalMatrix(toLocal);
    // Anchor on the body vertex nearest the attachment's centroid.
    const centroid = new THREE.Vector3(); let count = 0;
    for (const p of attachment.getMesh().listPrimitives()) { const pos = p.getAttribute('POSITION'); for (let i = 0; i < pos.getCount(); i++, count++) centroid.add(new THREE.Vector3().fromArray(pos.getElement(i, [])).applyMatrix4(fromWorld)); }
    centroid.divideScalar(count);
    let nearest = 0, best = Infinity;
    for (let i = 0; i < before.positions.length / 3; i++) { const d = centroid.distanceToSquared(new THREE.Vector3().fromArray(before.positions, i * 3)); if (d < best) { best = d; nearest = i; } }
    const shift = new THREE.Vector3().fromArray(after.positions, match(nearest) * 3).sub(new THREE.Vector3().fromArray(before.positions, nearest * 3));
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION'), normal = p.getAttribute('NORMAL');
      const a = new Float32Array(pos.getCount() * 3), n = normal ? new Float32Array(pos.getCount() * 3) : null;
      for (let i = 0; i < pos.getCount(); i++) {
        new THREE.Vector3().fromArray(pos.getElement(i, [])).applyMatrix4(fromWorld).add(shift).applyMatrix4(toLocal).toArray(a, i * 3);
        if (n) new THREE.Vector3().fromArray(normal.getElement(i, [])).applyMatrix3(normalFrom).applyMatrix3(normalTo).normalize().toArray(n, i * 3);
      }
      p.setAttribute('POSITION', pos.clone().setArray(a));
      if (n) p.setAttribute('NORMAL', normal.clone().setArray(n));
    }
    joint.addChild(doc.createNode(attachment.getName()).setMesh(mesh));
    report.push({name: attachment.getName(), joint: joint.getName(), shift: shift.toArray().map(v => +v.toFixed(3))});
  }
  return report;
}

async function main() {
  const loader = await sourceLoader(), only = option('only', null), fit = process.argv.includes('--fit');
  for (const body of DRAGON_BODIES.filter(b => !only || b.id === only)) {
    const entry = await manifestEntry(body.id);
    const production = await io.readBinary(new Uint8Array(await readFile(`${PUBLIC}/${entry.file}`)));
    if (fit) {
      const unit = await measure(await nativeDocument(body, loader, 1)), current = await measure(production);
      const length = current.size.z / unit.size.z, height = current.size.y / unit.size.y;
      console.log(`${body.id}: length ratio ${length.toFixed(4)}, height ratio ${height.toFixed(4)}, geometric mean ${Math.sqrt(length * height).toFixed(4)} (designs ${body.scale})`);
      continue;
    }
    const doc = await nativeDocument(body, loader, body.scale);
    const attachments = body.skin ? (await applyStudioSkin(doc, body), []) : applySkin(doc, production, body);
    await doc.transform(prune({keepLeaves: true}));
    const m = await measure(doc, {feet: /feet/i, head: 'Head'}), previous = entry.size;
    const provenance = {
      author: 'Dungeon Mason', license: 'Standard Unity Asset Store EULA', archiveSha256: ARCHIVE_SHA256,
      sourceMesh: `Assets/FourEvilDragonsPBR/Mesh/${LINEAGES[body.lineage].mesh}.fbx`, sourceAnimations: LINEAGES[body.lineage].clips,
      generator: 'tools/wilderness-dragons/build.mjs', nativeScale: body.scale, animationTempo: 1,
      skin: body.skin ? `Studio colour set Assets/FourEvilDragonsPBR/Texture/${body.skin.set} (albedo, normal, AO, smoothness${LINEAGES[body.lineage].material.emission ? ', emission' : ''}), resized and repacked only.` : `Material and textures from the previous production file (${entry.sha256.slice(0, 12)}).`,
      attachments,
    };
    const set = {
      ...(body.is ? {is: body.is} : {}),
      ...(entry.walkClipSeconds !== undefined ? {walkClipSeconds: m.clips.Walk.seconds} : {}),
      ...(entry.runClipSeconds !== undefined ? {runClipSeconds: m.clips.Run.seconds} : {}),
      ...(entry.attackSeconds !== undefined ? {attackSeconds: m.clips.Attack.seconds} : {}),
      ...(entry.contactNormalized !== undefined && m.attackContact !== null ? {contactNormalized: m.attackContact} : {}),
      ...(entry.impliedWalkMps !== undefined ? {impliedWalkMps: m.clips.Walk.impliedMps} : {}),
      ...(entry.impliedRunMps !== undefined ? {impliedRunMps: m.clips.Run.impliedMps} : {}),
      pack: 'dungeon-mason-four-evil-dragons-pbr',
      // A studio-skinned body is a new body: nothing of the previous file's provenance applies.
      metadata: body.skin ? {provenance, measurement: m} : {...entry.metadata, provenance: {...entry.metadata?.provenance, ...provenance}, measurement: m},
    };
    delete set.metadata.provenance.sculptedVertices;
    const {file} = await stageCandidate({out: OUT, id: body.id, doc, measurement: m, set, motionProvenance: {
      native: Object.keys(LINEAGES[body.lineage].clips), donor: {}, authored: [],
      notes: `${body.lineage} takes ${Object.entries(LINEAGES[body.lineage].clips).map(([k, v]) => `${k}=${v}`).join(', ')} bound by FBX node identity at native tempo; root XZ held at rest; uniform scale ${body.scale}. Native skeleton and mesh (no sculpt). ${body.skin ? `Studio colour set ${body.skin.set}` : 'Skin from the previous production file'}${attachments.length ? `; ${attachments.length} bone-bound attachments re-seated on native joints` : ''}.`,
    }});
    const f = s => `${s.x.toFixed(2)} x ${s.y.toFixed(2)} x ${s.z.toFixed(2)}`;
    console.log(`${body.id}: ${f(previous)} m -> ${f(m.size)} m; walk ${m.clips.Walk.seconds.toFixed(3)} s @ ${m.clips.Walk.impliedMps.toFixed(2)} m/s, run ${m.clips.Run.seconds.toFixed(3)} s @ ${m.clips.Run.impliedMps.toFixed(2)} m/s -> ${file}`);
  }
}
await main();
