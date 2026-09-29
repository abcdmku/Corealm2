/**
 * Re-splice the Dungeon Mason Dragon Boar's six native takes into the current basalt drake and
 * furnace grazer bodies (mesh, skin and textures unchanged).
 *
 * The previous clips were native except for a 240 Hz upward-only `Root.position` floor lift and a
 * loop-end key overwrite (tools/creature-expansion/monsters/basalt.mjs). Here each take is read
 * from its FBX, bound by source node identity, root XZ held at rest, and written as-is. The grazer's
 * animated `*_ground` wrapper is removed; its uniform scale node stays.
 *
 *   py -3 tools/creature-expansion/monsters/extract.py        # once, writes test-results/creature-expansion/...
 *   node tools/wilderness-dragons/dragon-boar.mjs [--source <dir holding Assets/FreeDragons>] [--out ...]
 */
import * as THREE from 'three';
import {readFile} from 'node:fs/promises';
import {prune} from '@gltf-transform/functions';
import {sourceLoader, readFbx, identities, nameRig, importClip} from './source.mjs';
import {io, option, manifestEntry, measure, stageCandidate, PUBLIC} from './stage.mjs';

const SOURCE = `${option('source', 'test-results/creature-expansion/sources/monsters/basalt')}/Assets/FreeDragons`;
const OUT = option('out', 'test-results/creature-motion/dragons');
const TAKES = {Idle: 'idle', Walk: 'walk', Run: 'run', Attack: 'HornAttack', Hit: 'GetHit', Death: 'Die'};
const PATHS = {position: 'translation', quaternion: 'rotation', scale: 'scale'};

const loader = await sourceLoader();
const rig = await readFbx(loader, `${SOURCE}/Mesh/DragonBoarMesh.fbx`), ids = identities(rig);
nameRig(rig, ids);
const clips = [];
for (const [name, file] of Object.entries(TAKES)) clips.push(importClip(await readFbx(loader, `${SOURCE}/Animations/DragonBoar/${file}.fbx`), ids, name));

for (const id of ['creature_basalt_drake', 'creature_furnace_grazer']) {
  const entry = await manifestEntry(id);
  const doc = await io.readBinary(new Uint8Array(await readFile(`${PUBLIC}/${entry.file}`)));
  const root = doc.getRoot(), buffer = root.listBuffers()[0], scene = root.listScenes()[0];
  for (const animation of root.listAnimations()) animation.dispose();
  for (const node of scene.listChildren()) if (/_ground$/.test(node.getName())) {
    for (const child of node.listChildren()) { node.removeChild(child); scene.addChild(child); }
    node.dispose();
  }
  // Joint nodes take the source rest TRS. The drake's already equal it; the grazer's had drifted by
  // up to 3.4 degrees while its mesh and inverse binds are byte-identical to the drake's.
  const skin = root.listSkins()[0], joints = new Map(skin.listJoints().map(j => [j.getName(), j]));
  let restDrift = 0;
  for (const [name, joint] of joints) {
    const bone = rig.getObjectByName(name);
    if (!bone) throw new Error(`${id}: joint ${name} missing from DragonBoarMesh.fbx`);
    restDrift = Math.max(restDrift, 2 * Math.acos(Math.min(1, Math.abs(bone.quaternion.dot(new THREE.Quaternion(...joint.getRotation()))))));
    joint.setTranslation(bone.position.toArray()).setRotation(bone.quaternion.toArray()).setScale(bone.scale.toArray());
  }
  const dropped = new Set();
  for (const clip of clips) {
    const animation = doc.createAnimation(clip.name);
    for (const track of clip.tracks) {
      const [name, property] = [track.name.slice(0, track.name.lastIndexOf('.')), track.name.slice(track.name.lastIndexOf('.') + 1)];
      const joint = joints.get(name);
      if (!joint) { dropped.add(name); continue; }
      const sampler = doc.createAnimationSampler().setInterpolation('LINEAR')
        .setInput(doc.createAccessor().setType('SCALAR').setArray(Float32Array.from(track.times)).setBuffer(buffer))
        .setOutput(doc.createAccessor().setType(property === 'quaternion' ? 'VEC4' : 'VEC3').setArray(Float32Array.from(track.values)).setBuffer(buffer));
      animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(joint).setTargetPath(PATHS[property]).setSampler(sampler));
    }
  }
  await doc.transform(prune({keepLeaves: true}));
  const m = await measure(doc);
  const {file} = await stageCandidate({out: OUT, id, doc, measurement: m,
    set: {walkClipSeconds: m.clips.Walk.seconds, runClipSeconds: m.clips.Run.seconds, attackSeconds: m.clips.Attack.seconds},
    motionProvenance: {native: Object.keys(TAKES), donor: {}, authored: [],
      notes: `Dragon Boar takes ${Object.entries(TAKES).map(([k, v]) => `${k}=${v}`).join(', ')} bound by FBX node identity, native keys, root XZ held at rest; no floor lift, no loop-end overwrite${id.includes('grazer') ? ', ground wrapper removed' : ''}. Mesh, skin and textures unchanged from production.${dropped.size ? ` Non-joint source tracks dropped: ${[...dropped].join(', ')}.` : ''}`}});
  console.log(`${id}: rest drift corrected ${(restDrift * 180 / Math.PI).toFixed(2)} deg, ${root.listAnimations().map(a => `${a.getName()}(${a.listChannels().length})`).join(' ')}, base.y ${m.base.y.toFixed(4)}, clip minY ${Object.entries(m.clips).map(([k, c]) => `${k}:${c.minY.toFixed(3)}`).join(' ')} -> ${file}`);
}
