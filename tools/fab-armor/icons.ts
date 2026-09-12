import { readFile, writeFile, copyFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { generateItemIcons } from '../generate-item-icons.js';
import { repoRoot, argValue } from '../lib/paths.js';

const directory = path.join(repoRoot, 'art/fab-armor/icons');
const plans = JSON.parse(await readFile(path.join(directory, 'prompts.json'), 'utf8'));
const registryDirectory = path.join(repoRoot, 'art/item-icons/generated');
const registryPath = path.join(registryDirectory, 'registry.json');
const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const accept = process.argv.includes('--accept');
const selectedSets = argValue(process.argv, '--sets')?.split(',');
if (selectedSets?.some(name => !plans.sets.some((set: { set: string }) => set.set === name))) throw new Error('Unknown armor icon set');
const sets = plans.sets.filter((set: { set: string }) => !selectedSets || selectedSets.includes(set.set));
const ids: string[] = [];
const updates: { id: string; source: string; destination: string; row: unknown }[] = [];
for (const set of sets) {
  const result = JSON.parse(await readFile(path.join(directory, set.set, 'result.json'), 'utf8'));
  const rows = Array.isArray(result) ? result : result.items ?? result.rows;
  if (!Array.isArray(rows)) throw new Error(`Invalid icon result ${set.set}`);
  for (const job of set.jobs) {
    const icon = rows.find((row: { id: string }) => row.id === job.id);
    if (!icon || icon.status !== 'accepted') throw new Error(`Unreviewed generated icon ${job.id}`);
    const source = path.resolve(repoRoot, icon.source);
    if (!source.startsWith(directory + path.sep)) throw new Error(`Icon outside owned folder ${job.id}`);
    const bytes = await readFile(source);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== icon.sha256) throw new Error(`Changed icon ${job.id}`);
    const metadata = await sharp(bytes).metadata();
    if (!metadata.hasAlpha) throw new Error(`Opaque generated icon ${job.id}`);
    const old = registry.items[job.id];
    const shared = old && Object.entries(registry.items).some(([id, row]) => id !== job.id && (row as { source: string }).source === old.source);
    const relative = old && !shared ? old.source : `fab-armor/${job.id}.png`;
    const destination = path.resolve(registryDirectory, relative);
    if (!destination.startsWith(registryDirectory + path.sep)) throw new Error('Icon output leaves registry');
    updates.push({ id: job.id, source, destination, row: {
      status: accept ? 'accepted' : 'pending', source: relative, sha256: hash, prompt: icon.prompt,
      generator: 'built-in image_gen',
      sourceLookup: 'Owner requested generated icons matching the imported armor and its new material finishes. See art/fab-armor/icons/prompts.json and docs/fab-armor.md.',
      review: `${typeof icon.review === 'string' ? icon.review : JSON.stringify(icon.review)} ${accept ? 'Root reviewed the staged 48px contact sheet and accepted it for the inventory.' : 'Awaiting root review of staged 48px derivatives.'}`,
    } });
    ids.push(job.id);
  }
}
const expected = selectedSets ? sets.reduce((sum: number, set: { jobs: unknown[] }) => sum + set.jobs.length, 0) : 57;
if (ids.length !== expected || new Set(ids).size !== expected) throw new Error(`Expected ${expected} unique armor icons`);
const backup = path.join(repoRoot, '.asset-cache/fab-armor/icons-previous');
await mkdir(backup, { recursive: true });
if (!await access(path.join(backup, 'registry.json')).then(() => true, () => false)) {
  await copyFile(registryPath, path.join(backup, 'registry.json'));
}
for (const update of updates) {
  const prior = path.join(backup, `${update.id}.png`);
  if (!await access(prior).then(() => true, () => false)) {
    await copyFile(update.destination, prior).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
  await mkdir(path.dirname(update.destination), { recursive: true });
  await copyFile(update.source, update.destination);
  registry.items[update.id] = update.row;
}
await writeFile(registryPath, JSON.stringify(registry, null, 2) + '\n');
const result = await generateItemIcons({ all: true, only: ids,
  url: argValue(process.argv, '--url') ?? 'http://127.0.0.1:57375',
  ...(accept ? {} : { out: 'test-results/fab-armor/icons' }),
});
console.log(JSON.stringify({ accepted: accept, icons: ids.length, paths: result.paths }));
