import { readFile, writeFile } from 'node:fs/promises';

// Authored formations and the browser use the same promoted source bounds. No render imports.
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const actors = manifest.assets.filter((asset: any) => asset.category === 'character' || asset.category === 'outfit');
const lines = actors.map((asset: any) => {
  const radius = Math.max(asset.size.x, asset.size.z) / 2;
  if (!(radius > 0 && Number.isFinite(radius))) throw new Error(`Invalid actor footprint ${asset.id}`);
  return `  ${JSON.stringify(asset.id)}: ${Number(radius.toFixed(5))},`;
});
await writeFile('game/src/content/encounterFootprints.ts',
  '// Generated from promoted asset bounds by tools/build-encounter-footprints.ts.\n'
  + 'export const ENCOUNTER_ASSET_RADII: Readonly<Record<string, number>> = {\n' + lines.join('\n') + '\n};\n');
console.log(`Recorded ${actors.length} promoted actor footprints`);
