/**
 * Puts native PixeliusVita takes back into every production body built from those packs.
 *
 * Each target keeps its production mesh, skin and (re)textures; only its clips are replaced by the
 * studio keys read from the source FBX takes (Monster01-06) or sampled from the Unity .anim curves
 * (Monster07-09). The skeleton of every target must equal the source rest pose joint by joint.
 *
 *   npx tsx tools/fairy-terraces/monsters-build.ts [--cache=<dir>] [--out=<dir>] [--only=id,id]
 *
 * --cache defaults to .asset-cache/fairy-terraces/unity (run extract_sources.py and
 * monsters-stage.py first). Output: <out>/models/<production path> and <out>/catalog.json.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromium } from 'playwright';
import { NodeIO, PropertyType, type Document, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample } from '@gltf-transform/functions';
import { Quaternion } from 'three';
// @ts-expect-error Existing asset compiler server.
import { startServer } from '../animals/serve.mjs';
import { addChannel, applyClip, duration, removeClip, restorePose, storedPose } from '../creature-motion/pose.js';
import { deformedBounds } from '../creature-motion/validate-deformation.js';

type Take = [clip: string, source: string];
/** keep: production clips that stay as they are because the native take does not work in game. */
type Target = { id: string; monster: string; takes?: Take[]; keep?: string[]; note?: string };

const option = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const cache = path.resolve(option('cache') ?? '.asset-cache/fairy-terraces/unity');
const out = path.resolve(option('out') ?? 'test-results/creature-motion/pixelius');
const only = option('only')?.split(',');

const VERBS: Take[] = [['Idle', 'Idle'], ['Walk', 'Walk'], ['Run', 'Run'], ['Attack', 'Attack01'], ['Hit', 'GetHit'], ['Death', 'Die']];
const TARGETS: Target[] = [
  { id: 'fantasy_monster_01', monster: '01' },
  { id: 'fantasy_monster_02', monster: '02' },
  { id: 'fairy_guardian_02_gloamgarden', monster: '02' },
  { id: 'fantasy_monster_04', monster: '04' },
  { id: 'creature_cinder_ravager', monster: '04', note: 'Monster04 body at its own scale; replaces the IK-compressed gaits and 240 Hz floor lift.' },
  { id: 'creature_basalt_maw', monster: '04', note: 'Monster04 body at its own scale; the animated grounding wrapper channel is dropped.' },
  { id: 'fantasy_monster_05', monster: '05' },
  { id: 'fantasy_monster_06', monster: '06' },
  { id: 'fantasy_monster_07', monster: '07', keep: ['Death'], note: 'Death kept from the current file: native Monster07_Die ends with the legs about 0.7 m below the source floor. Needs death.' },
  { id: 'fairy_guardian_07_gloamgarden', monster: '07', keep: ['Death'], note: 'Death kept from the current file: native Monster07_Die ends with the legs about 0.7 m below the source floor. Needs death.' },
  { id: 'fantasy_monster_08', monster: '08' },
  { id: 'fairy_guardian_08_faeholme', monster: '08' },
  { id: 'fantasy_monster_09', monster: '09' },
  { id: 'fairy_guardian_09_faeholme', monster: '09' },
  { id: 'creature_gorge_mantis', monster: '09', takes: VERBS.map(([clip, take]): Take => [clip, clip === 'Attack' ? 'Attack02' : take]),
    note: 'Monster09 hover legs and open wings; Attack is the Attack02 claw strike.' },
].filter(target => !only || only.includes(target.id));

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sources = JSON.parse(await readFile(path.join(cache, 'sources.json'), 'utf8')) as { package: string; directory: string; files: string[] }[];
function sourceSpec(monster: string, takes: Take[]) {
  const pack = sources.find(p => !p.package.startsWith('FreeTrial') && (p.package.includes(`Monster ${monster} `) || p.package.includes(`Model ${monster} `)));
  if (!pack) throw new Error(`No source package for Monster${monster}`);
  const model = pack.files.find(f => f.endsWith('.fbx') && f.includes(`/Monster${monster}/`));
  if (!model) throw new Error(`No source FBX for Monster${monster}`);
  const base = `/pixelius-source/${path.basename(pack.directory)}`;
  return { number: monster, package: pack.package, model: `${base}/${model}`, takes,
    animationBase: Number(monster) >= 7 ? `${base}/Assets/Stylized3DMonster/Monster${monster}/Anim` : undefined };
}

type Extracted = { rest: Record<string, { translation: number[]; rotation: number[]; scale: number[] }>; bind: Record<string, number[]>;
  clips: { name: string; source: string; duration: number; tracks: { node: string; path: 'translation' | 'rotation' | 'scale'; times: number[]; values: number[] }[] }[] };

/**
 * Proves the production skin is the source skin (same inverse bind matrix per joint name), then
 * stores the source rest transform on every joint. Returns how many joints held a posed transform.
 */
function setSourceRest(doc: Document, source: Extracted) {
  let reposed = 0, residual = 0;
  for (const skin of doc.getRoot().listSkins()) {
    const inverse = skin.getInverseBindMatrices()!, matrix: number[] = [];
    skin.listJoints().forEach((joint, i) => {
      const rest = source.rest[joint.getName()], bind = source.bind[joint.getName()];
      if (!rest || !bind) throw new Error(`Joint ${joint.getName()} is not in the source skin`);
      inverse.getElement(i, matrix);
      const scale = Math.max(...bind.map(Math.abs));
      residual = Math.max(residual, ...matrix.map((v, k) => Math.abs(v - bind[k]!) / scale));
      if (joint.getTranslation().some((v, k) => Math.abs(v - rest.translation[k]!) > 1e-3)
        || new Quaternion(...joint.getRotation()).angleTo(new Quaternion(...(rest.rotation as [number, number, number, number]))) > 1e-4) reposed++;
      joint.setTranslation(rest.translation as [number, number, number]).setRotation(rest.rotation as [number, number, number, number]).setScale(rest.scale as [number, number, number]);
    });
  }
  return { reposed, residual };
}

const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const server = await startServer(), browser = await chromium.launch({ headless: true }), page = await browser.newPage();
const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/pixelius-source/**', route => {
  const relative = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/pixelius-source\//, '');
  const file = path.resolve(cache, relative);
  if (!file.startsWith(cache + path.sep)) return route.abort();
  return route.fulfill({ path: file });
});
const catalogPath = path.join(out, 'catalog.json');
let catalog: { assets: any[] } = { assets: [] };
try { catalog = JSON.parse(await readFile(catalogPath, 'utf8')); } catch {}
try {
  await page.goto(`${server.url}/tools/fairy-terraces/monsters-convert.html`);
  await page.waitForFunction(() => typeof (window as any).extractPixeliusTakes === 'function');
  const extracted = new Map<string, Extracted>();
  for (const target of TARGETS) {
    const takes = target.takes ?? VERBS, spec = sourceSpec(target.monster, takes);
    const key = JSON.stringify([target.monster, takes]);
    if (!extracted.has(key)) extracted.set(key, await page.evaluate(s => (window as any).extractPixeliusTakes(s), spec));
    const source = extracted.get(key)!;
    const entry = manifest.assets.find((asset: { id: string }) => asset.id === target.id);
    if (!entry) throw new Error(`${target.id} is not in the manifest`);
    const productionBytes = await readFile(path.join('game/public/assets', entry.file));
    if (hash(productionBytes) !== entry.sha256) throw new Error(`${target.id}: production file differs from its manifest hash`);
    const doc = await io.readBinary(productionBytes);
    const nodes = new Map<string, Node>();
    for (const node of doc.getRoot().listNodes()) {
      if (nodes.has(node.getName())) throw new Error(`${target.id}: duplicate node ${node.getName()}`);
      nodes.set(node.getName(), node);
    }
    const rest = setSourceRest(doc, source);
    if (rest.residual > 1e-4) throw new Error(`${target.id}: skin differs from the Monster${target.monster} source skin ${JSON.stringify(rest)}`);
    const keep = target.keep ?? [], kept = new Map(doc.getRoot().listAnimations().filter(clip => keep.includes(clip.getName())).map(clip => [clip.getName(), clip]));
    if (kept.size !== keep.length) throw new Error(`${target.id}: missing kept clip`);
    for (const clip of doc.getRoot().listAnimations().map(clip => clip.getName())) if (!kept.has(clip)) removeClip(doc, clip);
    for (const clip of source.clips) {
      const old = kept.get(clip.name);
      if (old) {
        // Recreate in state order; the channels and samplers move unchanged.
        const animation = doc.createAnimation(clip.name);
        for (const channel of old.listChannels()) animation.addSampler(channel.getSampler()!).addChannel(channel);
        old.dispose();
        continue;
      }
      const animation = doc.createAnimation(clip.name);
      for (const track of clip.tracks) {
        const node = nodes.get(track.node);
        if (!node) throw new Error(`${target.id}: ${clip.source} animates missing node ${track.node}`);
        addChannel(doc, animation, node, track.path, track.times, track.values);
      }
    }
    await doc.transform(prune({ propertyTypes: [PropertyType.ACCESSOR] }), resample({ tolerance: 1e-6 }), dedup({ propertyTypes: [PropertyType.ACCESSOR] }));
    const clips = doc.getRoot().listAnimations(), pose = storedPose(doc);
    const idle = clips.find(clip => clip.getName() === 'Idle')!;
    restorePose(pose); applyClip(idle, 0);
    const bounds = deformedBounds(doc), lowest: Record<string, number> = {};
    for (const clip of clips) {
      lowest[clip.getName()] = Infinity;
      for (let i = 0; i <= 24; i++) { restorePose(pose); applyClip(clip, duration(clip) * i / 24); lowest[clip.getName()] = Math.min(lowest[clip.getName()]!, deformedBounds(doc).min[1]!); }
    }
    restorePose(pose);
    const bytes = await io.writeBinary(doc);
    await mkdir(path.dirname(path.join(out, entry.file)), { recursive: true });
    await writeFile(path.join(out, entry.file), bytes);
    const seconds = (name: string) => duration(clips.find(clip => clip.getName() === name)!);
    // The source floor is the Unity root origin; 07-09 hover above it and land on it when they die.
    const sourceFloor = nodes.get('root')!.getWorldTranslation()[1];
    const asset = { ...entry, bytes: bytes.length, sha256: hash(bytes), groundY: sourceFloor,
      size: { x: bounds.max[0]! - bounds.min[0]!, y: bounds.max[1]! - bounds.min[1]!, z: bounds.max[2]! - bounds.min[2]! },
      base: { x: bounds.min[0]!, y: bounds.min[1]!, z: bounds.min[2]! },
      animations: clips.map(clip => clip.getName()), materials: doc.getRoot().listMaterials().map(m => m.getName()),
      ...('walkClipSeconds' in entry ? { walkClipSeconds: seconds('Walk') } : {}),
      ...('runClipSeconds' in entry ? { runClipSeconds: seconds('Run') } : {}),
      ...('attackSeconds' in entry ? { attackSeconds: seconds('Attack') } : {}),
      ...(entry.sourceProvenance ? { sourceProvenance: { ...entry.sourceProvenance, modifications: 'Original body and atlas (retextures kept). Six native source takes; source units converted to metres and horizontal root travel removed. No floor correction, loop-end edits or retiming.' } } : {}),
      candidateFile: entry.file,
      motionProvenance: { native: source.clips.map(clip => clip.name).filter(name => !keep.includes(name)), donor: {}, authored: [],
        ...(keep.length ? { kept: keep } : {}),
        notes: [`${spec.package}: ${source.clips.map(clip => `${clip.name}=${clip.source}`).join(', ')}.`,
          `Skin equals the source skin (inverse bind residual ${rest.residual.toExponential(1)})${rest.reposed ? `; ${rest.reposed} joints had a posed stored transform and were reset to rest` : ''}.`,
          `groundY is the source floor (Unity root origin). Lowest skinned point per clip relative to it (m): ${Object.entries(lowest).map(([name, y]) => `${name} ${(y - sourceFloor).toFixed(3)}`).join(', ')}.`,
          target.note].filter(Boolean).join(' ') } };
    catalog.assets = [...catalog.assets.filter(a => a.id !== target.id), asset];
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
    console.log(JSON.stringify({ id: target.id, bytes: bytes.length, rest, sourceFloor, lowest: Object.fromEntries(Object.entries(lowest).map(([name, y]) => [name, +(y - sourceFloor).toFixed(3)])) }));
  }
  if (errors.length) throw new Error(errors.join('; '));
} finally { await browser.close(); await server.close(); }
