import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { ALL_ITEMS } from '../../game/src/content/items.js';
import { gearAppearanceParts } from '../../game/src/render/equipmentVisuals.js';
import type { AssetEntry, AssetManifest } from '../../game/src/render/assets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicRoot = path.join(root, 'game/public/assets');
const candidateRoot = path.join(root, 'art/item-models/candidates');
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
interface Candidate extends AssetEntry { sha256?: string; itemId?: string }
interface Row {
  key: string; label: string; itemId: string; source: 'current' | 'staged'; group: string;
  status: string; assetIds: string[]; size: number[]; equipSlot?: string;
  kit: { slot: string; itemId: string }[];
}

export async function startAssetReview(port = 4186) {
  const manifest: AssetManifest = JSON.parse(await readFile(path.join(publicRoot, 'manifest.json'), 'utf8'));
  const active = new Map(manifest.assets.map(entry => [entry.id, entry]));
  const groups = new Map<string, Candidate[]>();
  const files = new Map<string, { file: string; type: string }>();
  const skipped: { group: string; reason: string }[] = [];
  const packs = new Map(manifest.packs.map(pack => [pack.id, pack]));
  const hashes = new Map<string, string>();
  const within = (directory: string, relative: string) => {
    const resolved = path.resolve(directory, relative);
    if (!resolved.startsWith(directory + path.sep)) throw new Error('Candidate path leaves its directory');
    return resolved;
  };
  const directories = (await readdir(candidateRoot, { withFileTypes: true })).filter(entry => entry.isDirectory())
    .map(entry => entry.name).sort((a, b) => Number(b.startsWith('pilot-')) - Number(a.startsWith('pilot-')) || a.localeCompare(b));
  for (const group of directories) {
    const directory = path.join(candidateRoot, group);
    try {
      const catalogue = JSON.parse(await readFile(path.join(directory, 'catalogue.json'), 'utf8'));
      const entries: Candidate[] = [];
      for (const entry of catalogue.assets as Candidate[]) {
        try {
          const file = within(directory, entry.file);
          const bytes = await readFile(file);
          if (bytes.length !== entry.bytes || (entry.sha256 && digest(bytes) !== entry.sha256)) throw new Error('File differs from its staging catalog');
          const servedFile = `__review/${group}/${entry.file}`;
          files.set(`/assets/${servedFile}`, { file, type: 'model/gltf-binary' });
          // Preserve relative external image URLs while limiting access to declared GLB dependencies.
          const jsonLength = bytes.readUInt32LE(12);
          const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
          for (const dependency of [...(gltf.images ?? []), ...(gltf.buffers ?? [])]) {
            if (!dependency.uri || dependency.uri.startsWith('data:')) continue;
            const dependencyFile = within(directory, path.join(path.dirname(entry.file), dependency.uri));
            await readFile(dependencyFile);
            const url = new URL(dependency.uri, `http://localhost/assets/${servedFile}`).pathname;
            const ext = path.extname(dependencyFile).toLowerCase();
            files.set(url, { file: dependencyFile, type: ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : 'application/octet-stream' });
          }
          entries.push({ ...entry, file: servedFile, tags: [...entry.tags, 'temporary-asset-review'] });
          hashes.set(`${group}:${entry.id}`, digest(bytes));
        } catch (error) { skipped.push({ group, reason: `${entry.id}: ${String(error)}` }); }
      }
      if (entries.length) groups.set(group, entries);
      if (catalogue.pack) packs.set(catalogue.pack.id, catalogue.pack);
    } catch (error) { skipped.push({ group, reason: String(error) }); }
  }
  const preferred = new Map<string, Candidate>();
  for (const entries of groups.values()) for (const entry of entries) preferred.set(entry.id, entry);
  const armorSlots = new Set(['head', 'body', 'hands', 'legs', 'feet']);
  const visibleSlot = (slot?: string) => slot && !slot.startsWith('accessory') ? slot : undefined;
  const kit = (id: string) => {
    const prefix = id.startsWith('nightmarshal_') ? 'nightglass' : id.split('_')[0];
    const pieces = ALL_ITEMS.filter(item => item.id.startsWith(`${prefix}_`) && item.equip && armorSlots.has(item.equip.slot))
      .map(item => ({ slot: item.equip!.slot, itemId: item.id }));
    if (id.startsWith('nightmarshal_')) { const body = pieces.find(item => item.slot === 'body'); if (body) body.itemId = id; }
    return pieces;
  };
  const rows: Row[] = [];
  for (const item of ALL_ITEMS) {
    const appearances = gearAppearanceParts(item.id);
    const gear = appearances.map(part => part.assetId).filter(id => active.has(id));
    const authored = active.get(`corealm_item_${item.id}`);
    const useAuthored = authored && !appearances.some(part => part.attach === 'skin');
    const assetIds = [...new Set(useAuthored ? [authored.id] : gear.length ? gear : [])];
    if (!assetIds.length) continue;
    const first = active.get(assetIds[0]!)!;
    rows.push({ key: `current:${item.id}`, label: item.name, itemId: item.id, source: 'current', group: 'current', status: 'Used in the current game', assetIds,
      size: [first.size.x, first.size.y, first.size.z], equipSlot: visibleSlot(item.equip?.slot), kit: item.equip && armorSlots.has(item.equip.slot) ? kit(item.id) : [] });
  }
  for (const [group, entries] of groups) for (const entry of entries) {
    const itemId = entry.itemModel?.itemId ?? entry.itemId;
    const item = ALL_ITEMS.find(item => item.id === itemId);
    if (!item) { skipped.push({ group, reason: `${entry.id}: no current item definition` }); continue; }
    const current = rows.find(row => row.source === 'current' && row.itemId === itemId);
    const activeEntry = active.get(entry.id);
    let same = false;
    if (current?.assetIds.includes(entry.id) && activeEntry) {
      same = digest(await readFile(path.join(publicRoot, activeEntry.file))) === hashes.get(`${group}:${entry.id}`);
    }
    rows.push({ key: `${group}:${itemId}`, label: item.name, itemId: item.id, source: 'staged', group,
      status: same ? 'Same model as current' : current ? 'Staged alternative' : 'Staged only', assetIds: [entry.id],
      size: [entry.size.x, entry.size.y, entry.size.z], equipSlot: visibleSlot(item.equip?.slot), kit: item.equip && armorSlots.has(item.equip.slot) ? kit(item.id) : [] });
  }
  const server = await createServer({ root: path.join(root, 'game'), logLevel: 'error',
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
    plugins: [{ name: 'temporary-asset-review', configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        try {
          let body: string | Buffer | undefined;
          let type = 'application/json';
          if (url.pathname === '/review/' || url.pathname === '/review') {
            body = await readFile(path.join(root, 'tools/asset-review/review.html')); type = 'text/html';
          } else if (url.pathname === '/__asset-review/catalog') body = JSON.stringify({ rows, skipped });
          else if (url.pathname === '/assets/manifest.json') {
            const group = new URL(request.headers.referer ?? 'http://localhost').searchParams.get('reviewStaged');
            if (group && groups.has(group)) {
              const merged = new Map(manifest.assets.map(entry => [entry.id, entry]));
              for (const entry of preferred.values()) merged.set(entry.id, entry);
              for (const entry of groups.get(group)!) merged.set(entry.id, entry);
              body = JSON.stringify({ ...manifest, assets: [...merged.values()], packs: [...packs.values()] });
            }
          } else if (files.has(url.pathname)) {
            const file = files.get(url.pathname)!; body = await readFile(file.file); type = file.type;
          }
          if (body === undefined) { next(); return; }
          response.setHeader('Content-Type', type); response.setHeader('Cache-Control', 'no-store'); response.end(body);
        } catch (error) { response.statusCode = 500; response.end(String(error)); }
      });
    } }],
  });
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === 'string') throw new Error('No review server address');
  return { url: `http://127.0.0.1:${address.port}/review/`, rows, skipped, close: () => server.close() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const portIndex = process.argv.indexOf('--port');
  const server = await startAssetReview(portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 4186);
  console.log(JSON.stringify({ url: server.url, current: server.rows.filter(row => row.source === 'current').length,
    staged: server.rows.filter(row => row.source === 'staged').length, skipped: server.skipped }));
  process.once('SIGINT', async () => { await server.close(); process.exit(0); });
  process.once('SIGTERM', async () => { await server.close(); process.exit(0); });
}
