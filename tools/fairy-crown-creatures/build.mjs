/** Material-only variants of shipped bodies. This script never changes the shared manifest. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const assetRoot = path.join(root, 'game/public/assets');
const output = path.join(assetRoot, 'models/fairy-crown');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(path.join(assetRoot, 'manifest.json'), 'utf8'));

const plans = [
  { id: 'pearl_knight', source: 'creature_nightforge_marshal', region: 'crownward', look: 'knight',
    body: [1, 1, .98], accent: [.76, .9, 1], glow: [.012, .02, .025] },
  { id: 'ivory_castellan', source: 'creature_nightforge_marshal', region: 'crownward', look: 'castellan',
    body: [1, 1, .96], accent: [1, .84, .49], glow: [.028, .035, .043] },
  { id: 'crown_hart', source: 'animal_deer', region: 'crownward', look: 'hart',
    body: [.9, 1, .83], accent: [.78, .9, 1], glow: [.006, .014, .012] },
  { id: 'silverthorn_harrow', source: 'creature_briar_harrow', region: 'crownward', look: 'tree',
    body: [.85, .92, .91], accent: [.18, .49, .31], glow: [.006, .014, .01] },
  { id: 'lantern_sprite', source: 'creature_marsh_wasp', region: 'gloamgarden', look: 'sprite',
    body: [.17, .92, .76], accent: [.76, .43, 1], glow: [.018, .065, .046] },
  { id: 'moonpetal_stalker', source: 'creature_heath_jack', region: 'gloamgarden', look: 'stalker',
    body: [.36, .85, .74], accent: [.6, .3, .85], glow: [.006, .027, .022] },
  { id: 'dewglass_weaver', source: 'creature_fen_crawler', region: 'gloamgarden', look: 'weaver',
    body: [.17, .78, .72], accent: [.72, .39, .9], glow: [.01, .044, .038] },
  { id: 'bloomheart_matriarch', source: 'creature_boss_rootheart', region: 'gloamgarden', look: 'matriarch',
    body: [.48, .25, .68], accent: [.22, 1, .75], glow: [.018, .07, .046] },
  { id: 'prismatic_sprite', source: 'creature_marsh_wasp', region: 'faeholme', look: 'sprite',
    body: [.26, .76, .86], accent: [.83, .22, 1], glow: [.05, .025, .085] },
  { id: 'orchid_reaper', source: 'creature_veil_reaper', region: 'faeholme', look: 'reaper',
    body: [.72, .27, .91], accent: [.39, .91, .82], glow: [.015, .035, .03] },
  { id: 'starroot_guardian', source: 'creature_briar_harrow', region: 'faeholme', look: 'tree',
    body: [.37, .2, .56], accent: [.18, .9, .82], glow: [.016, .065, .054] },
  { id: 'amethyst_sovereign', source: 'creature_hollow_star', region: 'faeholme', look: 'sovereign',
    body: [.69, .49, .93], accent: [.19, .89, .82], glow: [.038, .023, .058] },
];

function paint(material, plan) {
  const name = material.getName();
  if (/eyes|teeth|mouth|knife_steel|knife_leather/i.test(name)) return;
  let colour = plan.body, emission = [0, 0, 0], roughness = .72, metal = .03;
  if (plan.look === 'knight' || plan.look === 'castellan') {
    if (/Superhero/i.test(name)) {
      colour = [.19, .23, .27]; roughness = .9; metal = 0;
    } else {
      const trim = /Pauldron|Armet/i.test(name);
      colour = trim ? plan.accent : plan.body;
      roughness = trim ? .26 : .32;
      metal = trim ? .38 : .29;
      emission = plan.glow;
    }
  } else if (plan.look === 'sprite') {
    const wings = /LightBlue/i.test(name);
    colour = wings || /Orange/i.test(name) ? plan.accent : plan.body;
    emission = wings ? plan.glow.map(value => value * .55) : plan.glow;
    roughness = wings ? .29 : .48;
    metal = .08;
  } else if (plan.look === 'stalker') {
    colour = /Peasant|Superhero/i.test(name) ? plan.accent : plan.body;
    emission = /inner|heartwood|cambium/i.test(name) ? plan.glow : [0, 0, 0];
    roughness = /Peasant/i.test(name) ? .91 : .65;
  } else if (plan.look === 'tree' || plan.look === 'matriarch') {
    const inner = /inner|growth|fibres/i.test(name);
    colour = inner ? plan.accent : plan.body;
    if (plan.look === 'matriarch' && /eroded_edges/i.test(name)) colour = [.89, .52, .74];
    emission = inner ? plan.glow : plan.glow.map(value => value * .1);
    roughness = inner ? .61 : .84;
  } else if (plan.look === 'weaver') {
    const accent = /fibres|cambium|Material\.001/i.test(name);
    colour = accent ? plan.accent : plan.body;
    emission = accent ? plan.glow.map(value => value * .5) : plan.glow;
    roughness = .43; metal = .1;
  } else if (plan.look === 'reaper') {
    const hands = /hands/i.test(name), hood = /cowl/i.test(name);
    colour = hands ? plan.accent : hood ? [.86, .91, .91] : plan.body;
    emission = hands ? plan.glow : [0, 0, 0];
    roughness = .88;
  } else if (plan.look === 'sovereign') {
    emission = plan.glow; roughness = .44; metal = .1;
  } else {
    emission = plan.glow; roughness = .78;
  }
  const opacity = material.getBaseColorFactor()[3];
  material.setBaseColorFactor([...colour, opacity]);
  material.setEmissiveFactor(emission);
  material.setRoughnessFactor(roughness);
  material.setMetallicFactor(metal);
}

await mkdir(output, { recursive: true });
const catalog = { assets: [], files: {}, sourceAliases: {} };
for (const plan of plans) {
  const parent = manifest.assets.find(asset => asset.id === plan.source);
  if (!parent) throw new Error(`Missing shipped source ${plan.source}`);
  const sourceFile = path.join(assetRoot, parent.file);
  const sourceBytes = await readFile(sourceFile);
  if (sha(sourceBytes) !== parent.sha256) throw new Error(`Source manifest hash changed for ${plan.source}`);
  const doc = await io.read(sourceFile);
  for (const material of doc.getRoot().listMaterials()) paint(material, plan);
  // Embed the exact original maps; no relative dependency changes when the GLB moves folders.
  for (const texture of doc.getRoot().listTextures()) texture.setURI('');
  const id = `creature_${plan.id}`, file = `models/fairy-crown/${id}.glb`;
  const destination = path.join(assetRoot, file);
  await io.write(destination, doc);
  const bytes = await readFile(destination);
  const entry = {
    ...structuredClone(parent), id, file, bytes: bytes.length, sha256: sha(bytes),
    is: plan.id.replaceAll('_', ' '), tags: ['creature', plan.region, 'regional_variant', plan.id],
    materials: doc.getRoot().listMaterials().map(material => material.getName()),
    metadata: {
      ...structuredClone(parent.metadata ?? {}),
      fairyCrownVariant: {
        sourceAssetId: parent.id, sourceSha256: parent.sha256,
        generator: 'tools/fairy-crown-creatures/build.mjs',
        geometrySkinMotionUnchanged: true, regionId: plan.region,
        materialRecipe: { look: plan.look, body: plan.body, accent: plan.accent, glow: plan.glow },
        scope: 'Existing source geometry, normals, UVs, skin, skeleton, animation and texture pixels preserved. Material factors only; scale belongs to species data.',
      },
    },
    acceptance: { exported: true, labAccepted: false, worldIntegrated: false },
  };
  catalog.assets.push(entry);
  catalog.files[id] = path.relative(directory, destination).replaceAll('\\', '/');
  catalog.sourceAliases[id] = parent.id;
  console.log(`${id}: ${parent.id}, ${(bytes.length / 1048576).toFixed(2)} MiB`);
}
await writeFile(path.join(directory, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
console.log('Staged 12 source-preserving variants. Shared manifest unchanged.');
