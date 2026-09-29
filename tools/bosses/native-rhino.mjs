/**
 * Stage the Fantasy Rhino bosses with the studio's own six takes.
 *
 * `92da7c6` holds the faithful import: tools/rebuild-creature-motion.ts bound Rhino@Idle, Walk,
 * Run, Attack, Get_Hit and Dead by FBX node identity (the CAT rig repeats spine names), stripped
 * root XZ and thinned keys at 1e-6. Later commits replaced Attack and Hit with synthesized clips.
 * This reads that blob, drops the synthesized HitLeft/HitRight, and takes every texture image from
 * the current production file so each element keeps its skin.
 *
 *   node tools/bosses/native-rhino.mjs [--out test-results/creature-motion/dragons]
 */
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {prune} from '@gltf-transform/functions';
import {io, option, PUBLIC, stageCandidate, measure} from '../wilderness-dragons/stage.mjs';

const FAITHFUL_COMMIT = '92da7c6';
const out = option('out', 'test-results/creature-motion/dragons');
const TAKES = {Idle: 'Rhino@Idle', Walk: 'Rhino@Walk', Run: 'Rhino@Run', Attack: 'Rhino@Attack', Hit: 'Rhino@Get_Hit', Death: 'Rhino@Dead'};

for (const element of ['air', 'earth', 'water']) {
  const id = `boss_rhino_${element}`, file = `models/boss/${id}.glb`;
  const doc = await io.readBinary(new Uint8Array(execFileSync('git', ['show', `${FAITHFUL_COMMIT}:game/public/assets/${file}`], {maxBuffer: 1 << 30})));
  const production = await io.readBinary(new Uint8Array(await readFile(`${PUBLIC}/${file}`)));
  for (const animation of doc.getRoot().listAnimations()) if (!(animation.getName() in TAKES)) animation.dispose();
  const names = doc.getRoot().listAnimations().map(a => a.getName());
  if (names.join() !== Object.keys(TAKES).join()) throw new Error(`${id}: unexpected clips ${names}`);
  // Same material graph in both files (checked by count), so textures correspond by index.
  const skins = production.getRoot().listTextures(), textures = doc.getRoot().listTextures();
  if (skins.length !== textures.length) throw new Error(`${id}: texture layout changed`);
  textures.forEach((texture, i) => texture.setImage(skins[i].getImage()).setMimeType(skins[i].getMimeType()));
  await doc.transform(prune({keepLeaves: true}));
  const measurement = await measure(doc);
  const {row, file: written} = await stageCandidate({out, id, doc, measurement,
    motionProvenance: {native: Object.keys(TAKES), donor: {}, authored: [],
      notes: `Fantasy Rhino takes ${Object.entries(TAKES).map(([k, v]) => `${k}=${v}`).join(', ')} bound by FBX node identity (${FAITHFUL_COMMIT} import). Root XZ stripped, keys thinned at 1e-6. Synthesized HitLeft/HitRight dropped. Textures from the current production file.`},
    set: {walkClipSeconds: measurement.clips.Walk.seconds, runClipSeconds: measurement.clips.Run.seconds}});
  console.log(`${id}: ${row.animations.join(',')} ${row.bytes} bytes -> ${written}`);
}
