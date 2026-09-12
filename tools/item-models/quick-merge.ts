import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ALL_ITEMS } from '../../game/src/content/items.js';
import { gatheringToolAppearance } from '../../game/src/render/equipmentVisuals.js';

// Owner-approved scope: held weapons/tools and jewelry only. Reuse exact-file runtime proof.
const groups = ['pilot-sword','blades-a','blades-b','blades-boss','boss-staves','elemental-staves','orbs-wands','shields','wood-magic-a','wood-magic-b','hatchets','pickaxes','rods','pilot-ring','jewelry-metal-a','jewelry-metal-b','jewelry-magic-a','jewelry-magic-b','jewelry-trophies'];
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const evidence: { file: string; report: any }[] = [];
for (const file of await readdir('test-results/item-models', { recursive: true })) {
  if (path.basename(file) !== 'report.json') continue;
  const full = path.join('test-results/item-models', file);
  try { const report = JSON.parse(await readFile(full, 'utf8')); if (report.passed) evidence.push({ file: full.replaceAll('\\','/'), report }); } catch {}
}
const manifestPath = 'game/public/assets/manifest.json';
const registryPath = 'art/item-models/registry.json';
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const selected: any[] = [];
for (const group of groups) {
  const directory = `art/item-models/candidates/${group}`;
  const catalog = JSON.parse(await readFile(`${directory}/catalogue.json`, 'utf8'));
  const sourceHash = hash(await readFile(`tools/item-models/authors/${group}.ts`));
  for (const entry of catalog.assets) {
    const item = ALL_ITEMS.find(item => item.id === entry.itemId)!;
    const slot = item?.equip?.slot;
    const jewelry = slot?.startsWith('accessory');
    assert(item, `Unknown item ${entry.itemId}`);
    if (!(jewelry || slot === 'mainHand' || slot === 'offHand' || gatheringToolAppearance(item.id) || item.id.endsWith('_rod'))) continue;
    assert(!entry.itemModel?.wearable, `Armor is excluded: ${entry.itemId}`);
    assert(/^models\/items\/[a-z0-9_]+\.glb$/.test(entry.file));
    const file = path.join(directory, entry.file), bytes = await readFile(file);
    assert(hash(bytes) === entry.sha256 && bytes.length === entry.bytes, `Changed candidate ${entry.itemId}`);
    assert(sourceHash === entry.sourceSha256, `Changed author ${group}`);
    const matching = evidence.filter(({report}) => report.assets?.some((asset: any) => asset.sha256 === entry.sha256 && (asset.itemId === item.id || asset.itemModel?.itemId === item.id)));
    const runtime = matching.filter(({report}) => report.heldItems?.some((held: any) => held.itemId === item.id)
      || report.tools?.some((tool: any) => tool.itemId === item.id)
      || report.authoredRod?.rodId === item.id
      || report.captures?.some((capture: any) => Object.values(capture.state?.motion?.attachments ?? {}).some(name => String(name).endsWith(entry.id))));
    selected.push({ group, entry, file, jewelry: !!jewelry, evidence: matching.map(row => row.file), runtimeEvidence: runtime.map(row => row.file), pack: catalog.pack });
  }
}
const missing = selected.filter(row => !row.jewelry && !row.runtimeEvidence.length).map(row => row.entry.itemId);
await mkdir('test-results/item-models', { recursive: true });
await writeFile('test-results/item-models/quick-merge-plan.json', JSON.stringify({ count: selected.length, missingRuntime: missing, items: selected.map(({entry,file,group,jewelry,evidence,runtimeEvidence}) => ({ itemId: entry.itemId, sha256: entry.sha256, file, group, jewelry, evidence, runtimeEvidence })) }, null, 2));
if (process.argv.includes('--apply')) {
  assert.equal(missing.length, 0, `Missing grip proof: ${missing.join(', ')}`);
  for (const { entry, file, evidence, runtimeEvidence, pack } of selected) {
    const destination = path.join('game/public/assets', entry.file);
    await mkdir(path.dirname(destination), { recursive: true }); await copyFile(file, destination);
    const runtime: Record<string, unknown> = {};
    for (const key of ['id','file','pack','category','is','tags','bytes','size','base','animations','materials','itemModel','sha256']) runtime[key] = entry[key];
    const index = manifest.assets.findIndex((asset: any) => asset.id === entry.id);
    if (index < 0) manifest.assets.push(runtime); else manifest.assets[index] = runtime;
    if (!manifest.packs.some((candidate: any) => candidate.id === pack.id)) manifest.packs.push(pack);
    registry.items[entry.itemId] = { ...registry.items[entry.itemId], ...entry, status: 'visual-approved', promoted: true,
      revisionRequired: false, productionFile: path.resolve(destination), runtimeEvidence,
      evidence: evidence[0], review: 'Owner approved the staged weapon/tool and jewelry artwork; quick grip/facing review reuses matching GLB runtime captures. No armor approval.' };
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(registryPath, JSON.stringify(registry, null, 2));
}
console.log(JSON.stringify({ count: selected.length, jewelry: selected.filter(row => row.jewelry).length, missingRuntime: missing, applied: process.argv.includes('--apply') }));
