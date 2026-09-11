import { expect, it } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import manifest from '../game/public/assets/manifest.json';
import { REGIONAL_CREATURE_VARIANTS } from '../game/src/content/regionalCreatureVariants.js';
import { REGIONAL_VARIANT_RESERVED_PACK_IDS, AMETHYST_CAVE_HABITAT } from '../game/src/content/regionalVariantHabitats.js';
import { activatedRegionalPackIds } from '../game/src/content/regionalPackActivation.js';

it('changes regional materials while preserving complete source rigs and animation samples', async () => {
 const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
 for (const species of REGIONAL_CREATURE_VARIANTS) {
  const asset = manifest.assets.find(row => row.id === species.assetId)!;
  const metadata = asset.metadata as unknown as {regionalVariant:{sourceAssetId:string;sourceSha256:string}};
  const parent = manifest.assets.find(row => row.id === metadata.regionalVariant.sourceAssetId)!;
  const sourceBytes = await readFile(`game/public/assets/${parent.file}`);
  expect(createHash('sha256').update(sourceBytes).digest('hex')).toBe(metadata.regionalVariant.sourceSha256);
  const original = (await io.readBinary(sourceBytes)).getRoot();
  const variant = (await io.read(`game/public/assets/${asset.file}`)).getRoot();
  const samples = (root: typeof original) => root.listAnimations().map(clip => ({name:clip.getName(),
   samples:clip.listSamplers().map(sampler => [Array.from(sampler.getInput()!.getArray()!),Array.from(sampler.getOutput()!.getArray()!)])}));
  expect(samples(variant),species.id).toEqual(samples(original));
  expect(variant.listSkins().map(skin=>skin.listJoints().map(joint=>joint.getName())))
   .toEqual(original.listSkins().map(skin=>skin.listJoints().map(joint=>joint.getName())));
  expect(variant.listMaterials().map(material=>material.getBaseColorFactor()))
   .not.toEqual(original.listMaterials().map(material=>material.getBaseColorFactor()));
 }
});

it('never overlays a regional pack on an occupied variant reservation when regions activate', () => {
 const active = activatedRegionalPackIds({regions:['fallowmarch','vellenwood','karrowmoor','kilnhalt'],
  excludedPackIds:REGIONAL_VARIANT_RESERVED_PACK_IDS,assignmentOverrides:{}});
 for (const id of REGIONAL_VARIANT_RESERVED_PACK_IDS) expect(active).not.toContain(id);
});

it('contains cave activity anchors within the authored patrol radius', () => {
 const habitat = AMETHYST_CAVE_HABITAT;
 for (const [x,z] of habitat.anchors) expect(Math.hypot(x-habitat.centre[0],z-habitat.centre[1])).toBeLessThanOrEqual(habitat.radius);
});
