import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBulkHandler, isBulkPath, type BulkHandler } from '../devdocs/server/handlers/bulk.js';
import { createMetaHandler } from '../devdocs/server/handlers/meta.js';
import type { DevdocsJsonResponse } from '../devdocs/server/handlers/collections.js';
import type { BulkAction, BulkResponse } from '../devdocs/shared/contracts.js';
import { CONTENT_COLLECTIONS } from '../tools/content/collections.js';
import { contentRevision } from '../tools/content/format.js';
import { emptyMetaRecord, type MetaFile } from '../tools/content/meta.js';
import type { ReferencePools } from '../tools/content/references.js';
import { repoRoot } from '../tools/lib/paths.js';

type Row = Record<string, any>;
const at = '2026-09-13T12:00:00.000Z';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => {
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('corealm-bulk-')) throw new Error('Unexpected fixture cleanup path');
  return rm(root, { recursive: true, force: true });
})); });
const seed = Promise.all(CONTENT_COLLECTIONS.map(async spec => ({ spec,
  text: await readFile(path.join(repoRoot, 'game', 'content', spec.file), 'utf8'),
})));
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'corealm-bulk-'));
  roots.push(root);
  const original = await seed;
  await Promise.all(original.map(async ({ spec, text }) => {
    const file = path.join(root, spec.file);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }));
  const strings = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === 'string') strings.add(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.entries(value).forEach(([key, entry]) => { strings.add(key); collect(entry); });
  };
  original.forEach(({ text }) => collect(JSON.parse(text)));
  const external: ReferencePools = { asset: strings, entity: strings, location: strings, settlement: strings,
    enemyFamily: strings, region: strings, enemy: strings, species: strings, campfireFuel: strings };
  const options = { contentRoot: root, actor: 'Borg', now: () => at, referencePools: async () => external };
  const handler = createBulkHandler(options);
  const load = async (name: string) => {
    const spec = CONTENT_COLLECTIONS.find(row => row.name === name)!;
    const text = await readFile(path.join(root, spec.file), 'utf8');
    return { rows: JSON.parse(text) as Row[], text, revision: contentRevision(text) };
  };
  const meta = async (name: string) => {
    const text = await readFile(path.join(root, 'meta', `${name}.meta.json`), 'utf8');
    return { data: JSON.parse(text) as MetaFile, text, revision: contentRevision(text) };
  };
  return { root, handler, options, load, meta };
}
function parsed<T = BulkResponse>(response: DevdocsJsonResponse | undefined): T {
  if (!response) throw new Error('Expected response');
  return JSON.parse(response.body) as T;
}
function send(handler: BulkHandler, collection: string, recordIds: string[], action: BulkAction, revisions?: BulkResponse['revisions']) {
  return handler({ method: 'POST', url: '/__devdocs/bulk', body: { operation: revisions ? 'apply' : 'preview', collection, recordIds, action, ...(revisions ? { revisions } : {}) } });
}

describe('devdocs bulk handler', () => {
  it('previews metadata without writing files and applies all notes with one fresh collection revision', async () => {
    const { root, handler, load, meta } = await fixture();
    const before = await load('shops');
    const ids = before.rows.slice(0, 3).map(row => row.id);
    const action: BulkAction = { kind: 'note', text: 'Review stock', label: 'M5' };
    const result = await send(handler, 'shops', [...ids].reverse(), action);
    expect(result?.status, result?.body).toBe(200);
    const preview = parsed(result);
    expect(preview.recordIds).toEqual(ids);
    expect(preview.revisions).toEqual({ content: before.revision, meta: contentRevision('{}\n') });
    expect(preview.diffs.map(diff => diff.before)).toEqual(ids.map(() => ({ notesCount: 0 })));
    await expect(meta('shops')).rejects.toMatchObject({ code: 'ENOENT' });
    const applied = await send(handler, 'shops', ids, action, preview.revisions);
    expect(applied?.status, applied?.body).toBe(200);
    const saved = await meta('shops');
    expect(parsed(applied).revisions).toEqual({ content: before.revision, meta: saved.revision });
    expect(saved.revision).not.toBe(preview.revisions.meta);
    for (const id of ids) {
      expect(saved.data[id]!.notes).toEqual([{ at, by: 'Borg', text: 'Review stock', label: 'M5' }]);
      expect(saved.data[id]!.history).toEqual([{ at, by: 'Borg', action: 'note.add' }]);
    }
    expect((await load('shops')).text).toBe(before.text);
    expect(await readdir(path.join(root, 'meta'))).toEqual(['shops.meta.json']);
    expect((await readdir(root)).some(name => name.endsWith('.lock'))).toBe(false);
  });

  it('preserves approvals and prior metadata when setting status, including special own-property IDs', async () => {
    const { root, handler, load, meta } = await fixture();
    const shops = await load('shops');
    shops.rows.push({ ...shops.rows[0], id: '__proto__' });
    await writeFile(path.join(root, 'data/shops.json'), JSON.stringify(shops.rows));
    const id = shops.rows[0]!.id as string;
    const prior = { ...emptyMetaRecord('live'), approvals: { male: true, female: true }, sourceRefs: ['seed'] };
    await mkdir(path.join(root, 'meta'));
    await writeFile(path.join(root, 'meta/shops.meta.json'), JSON.stringify({ [id]: prior }));
    const action: BulkAction = { kind: 'status', status: 'rejected' };
    const preview = parsed(await send(handler, 'shops', ['__proto__', id], action));
    expect((await send(handler, 'shops', preview.recordIds, action, preview.revisions))?.status).toBe(200);
    const saved = await meta('shops');
    expect(saved.data[id]).toMatchObject({ ...prior, status: 'rejected', history: [{ at, by: 'Borg', action: 'status.set', detail: 'rejected' }] });
    expect(Object.hasOwn(saved.data, '__proto__')).toBe(true);
    expect(saved.data['__proto__']!.status).toBe('rejected');
  });

  it('changes only differing status rows and preserves exact metadata bytes for an all-noop apply', async () => {
    const { root, handler, load, meta } = await fixture();
    const shops = await load('shops');
    const ids = shops.rows.slice(0, 2).map(row => row.id);
    const existing = { ...emptyMetaRecord('candidate'), history: [{ at, by: 'Original author', action: 'status.set', detail: 'candidate' }] };
    await mkdir(path.join(root, 'meta'));
    await writeFile(path.join(root, 'meta/shops.meta.json'), JSON.stringify({ [ids[0]]: emptyMetaRecord(), [ids[1]]: existing }));
    const action: BulkAction = { kind: 'status', status: 'candidate' };
    const original = await meta('shops');
    const previewResult = await send(handler, 'shops', ids, action);
    expect(previewResult?.status, previewResult?.body).toBe(200);
    const preview = parsed(previewResult);
    expect(preview.diffs).toEqual([{ recordId: ids[0], before: { status: 'draft' }, after: { status: 'candidate' } }]);
    expect((await meta('shops')).text).toBe(original.text);
    const applied = await send(handler, 'shops', ids, action, preview.revisions);
    expect(applied?.status, applied?.body).toBe(200);
    const mixed = await meta('shops');
    expect(mixed.data[ids[1]]).toEqual(existing);
    expect(mixed.data[ids[0]]!.history).toEqual([{ at, by: 'Borg', action: 'status.set', detail: 'candidate' }]);
    expect(parsed(applied).diffs).toEqual(preview.diffs);
    // Deliberately noncanonical whitespace proves a no-op does not rewrite the file.
    await writeFile(path.join(root, 'meta/shops.meta.json'), JSON.stringify(mixed.data));
    const beforeNoop = await meta('shops');
    const noopPreview = parsed(await send(handler, 'shops', ids, action));
    expect(noopPreview.diffs).toEqual([]);
    expect((await meta('shops')).text).toBe(beforeNoop.text);
    const noopApply = await send(handler, 'shops', ids, action, noopPreview.revisions);
    expect(noopApply?.status, noopApply?.body).toBe(200);
    expect(parsed(noopApply)).toEqual(noopPreview);
    expect((await meta('shops')).text).toBe(beforeNoop.text);
    expect((await load('shops')).text).toBe(shops.text);
  });

  it('does not create metadata for default-draft rows on an all-noop preview or apply', async () => {
    const { handler, load, meta } = await fixture();
    const shops = await load('shops');
    const ids = shops.rows.slice(0, 2).map(row => row.id);
    const action: BulkAction = { kind: 'status', status: 'draft' };
    const preview = parsed(await send(handler, 'shops', ids, action));
    expect(preview.diffs).toEqual([]);
    await expect(meta('shops')).rejects.toMatchObject({ code: 'ENOENT' });
    const applied = await send(handler, 'shops', ids, action, preview.revisions);
    expect(applied?.status, applied?.body).toBe(200);
    expect(parsed(applied)).toEqual(preview);
    await expect(meta('shops')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('serializes bulk and individual metadata writers and rejects stale revisions without partial notes', async () => {
    const { root, handler, load, meta, options } = await fixture();
    const shops = await load('shops');
    const ids = shops.rows.slice(0, 2).map(row => row.id);
    const action: BulkAction = { kind: 'note', text: 'Bulk writer' };
    const preview = parsed(await send(handler, 'shops', ids, action));
    const sibling = createBulkHandler(options);
    const responses = await Promise.all([
      send(handler, 'shops', ids, action, preview.revisions),
      send(sibling, 'shops', ids, { kind: 'note', text: 'Other bulk' }, preview.revisions),
    ]);
    expect(responses.map(result => result!.status).sort()).toEqual([200, 409]);
    const saved = await meta('shops');
    expect(Object.values(saved.data).flatMap(row => row.notes)).toHaveLength(2);
    expect(parsed(responses.find(result => result!.status === 409)).revisions.meta).toBe(saved.revision);
    const individual = createMetaHandler(options);
    const next = parsed(await send(handler, 'shops', ids, action));
    const race = await Promise.all([
      send(handler, 'shops', ids, action, next.revisions),
      individual({ method: 'PATCH', url: `/__devdocs/meta/shops/${ids[0]}`, body: { revision: next.revisions.meta, operation: { kind: 'note', text: 'Individual writer' } } }),
    ]);
    expect(race.map(result => result!.status).sort()).toEqual([200, 409]);
    const final = await meta('shops');
    const length = Object.values(final.data).flatMap(row => row.notes).length;
    expect(length).toBe(race[0]!.status === 200 ? 4 : 3);
    const stale = await send(handler, 'shops', ids, action, next.revisions);
    expect(stale?.status).toBe(409);
    expect((await meta('shops')).text).toBe(final.text);
    await writeFile(path.join(root, 'data/shops.json'), `${shops.text}\n`);
    expect((await send(handler, 'shops', ids, action, { content: shops.revision, meta: final.revision }))?.status).toBe(409);
    expect((await meta('shops')).text).toBe(final.text);
  });

  it('retier requires explicit formula unlink and preserves row order, identities, and every other field', async () => {
    const { handler, load, root } = await fixture();
    const before = await load('equipmentSets');
    const selected = before.rows.filter(row => row.derivation).slice(0, 2);
    const ids = selected.map(row => row.id);
    expect(ids).toHaveLength(2);
    const refused = await send(handler, 'equipmentSets', ids, { kind: 'retier', tier: 31, unlinkFormulas: false });
    expect(refused?.status, refused?.body).toBe(422);
    expect(refused?.body).toContain('unlinkFormulas');
    const action: BulkAction = { kind: 'retier', tier: 31, unlinkFormulas: true };
    const previewResult = await send(handler, 'equipmentSets', [...ids].reverse(), action);
    expect(previewResult?.status, previewResult?.body).toBe(200);
    const preview = parsed(previewResult);
    expect(preview.recordIds).toEqual(ids);
    expect(preview.diffs[0]!.before).toEqual({ tier: selected[0]!.tier, derivation: selected[0]!.derivation });
    expect((await load('equipmentSets')).text).toBe(before.text);
    const result = await send(handler, 'equipmentSets', ids, action, preview.revisions);
    expect(result?.status, result?.body).toBe(200);
    const after = await load('equipmentSets');
    expect(after.rows).toEqual(before.rows.map(row => {
      if (!ids.includes(row.id)) return row;
      const { derivation: _removed, ...rest } = row;
      return { ...rest, tier: 31 };
    }));
    expect(parsed(result).revisions.content).toBe(after.revision);
    for (const source of await seed) if (source.spec.name !== 'equipmentSets') {
      expect(await readFile(path.join(root, source.spec.file), 'utf8'), source.spec.name).toBe(source.text);
    }
    expect((await send(handler, 'equipmentSets', ids, action, preview.revisions))?.status).toBe(409);
    expect((await load('equipmentSets')).text).toBe(after.text);
    expect(parsed(await send(handler, 'equipmentSets', ids, action)).diffs).toEqual([]);
  });

  it('rejects an entire mixed batch, unknown IDs, and tier identity changes before writing', async () => {
    const { root, handler, load, meta } = await fixture();
    const items = await load('items');
    const numeric = items.rows.find(row => typeof row.tier === 'number' && !row.derivation)!;
    const tagged = items.rows.find(row => row.derivation)!;
    expect(numeric).toBeTruthy(); expect(tagged).toBeTruthy();
    const mixed = await send(handler, 'items', [numeric.id, tagged.id], { kind: 'retier', tier: 2, unlinkFormulas: false }, { content: items.revision });
    expect(mixed?.status).toBe(422);
    expect((await load('items')).text).toBe(items.text);
    const shops = await load('shops');
    expect((await send(handler, 'shops', [shops.rows[0]!.id], { kind: 'retier', tier: 2, unlinkFormulas: true }, { content: shops.revision }))?.status).toBe(422);
    expect((await load('shops')).text).toBe(shops.text);
    const missing = await send(handler, 'shops', [shops.rows[0]!.id, 'missing-id'], { kind: 'note', text: 'No partial notes' }, { content: shops.revision, meta: contentRevision('{}\n') });
    expect(missing?.status).toBe(422);
    await expect(meta('shops')).rejects.toMatchObject({ code: 'ENOENT' });
    const tiers = await load('gatheringTiers');
    const identity = await send(handler, 'gatheringTiers', [String(tiers.rows[0]!.tier)], { kind: 'retier', tier: 999, unlinkFormulas: true }, { content: tiers.revision });
    expect(identity?.status, identity?.body).toBe(422);
    expect(identity?.body).toMatch(/identity|read.only/i);
    expect((await load('gatheringTiers')).text).toBe(tiers.text);
    expect((await readdir(root)).some(name => name.endsWith('.lock'))).toBe(false);
  });

  it('validates fresh reference files again on apply and leaves the target untouched', async () => {
    const { root, handler, load } = await fixture();
    const sets = await load('equipmentSets');
    const ids = sets.rows.slice(0, 2).map(row => row.id);
    const action: BulkAction = { kind: 'retier', tier: 31, unlinkFormulas: true };
    const previewResult = await send(handler, 'equipmentSets', ids, action);
    expect(previewResult?.status, previewResult?.body).toBe(200);
    const shops = await load('shops');
    shops.rows[0]!.stock = [{ itemId: 'missing-reference-from-fresh-snapshot', quantity: 1 }];
    await writeFile(path.join(root, 'data/shops.json'), JSON.stringify(shops.rows));
    const result = await send(handler, 'equipmentSets', ids, action, parsed(previewResult).revisions);
    expect(result?.status, result?.body).toBe(422);
    expect(result?.body).toContain('missing-reference-from-fresh-snapshot');
    expect((await load('equipmentSets')).text).toBe(sets.text);
  });

  it('serializes retier validation and rejects the stale concurrent batch without overwriting the winner', async () => {
    const { handler, load, options } = await fixture();
    const before = await load('equipmentSets');
    const ids = before.rows.slice(0, 2).map(row => row.id);
    let validations = 0;
    const pools = async () => { validations++; return options.referencePools(); };
    const left = createBulkHandler({ ...options, referencePools: pools });
    const right = createBulkHandler({ ...options, referencePools: pools });
    const action: BulkAction = { kind: 'retier', tier: 31, unlinkFormulas: true };
    const preview = parsed(await send(handler, 'equipmentSets', ids, action));
    const results = await Promise.all([
      send(left, 'equipmentSets', ids, action, preview.revisions),
      send(right, 'equipmentSets', ids, { ...action, tier: 32 }, preview.revisions),
    ]);
    expect(results.map(result => result!.status).sort()).toEqual([200, 409]);
    expect(validations).toBe(1);
    const winner = parsed(results.find(result => result!.status === 200));
    const saved = await load('equipmentSets');
    expect(saved.revision).toBe(winner.revisions.content);
    expect(saved.rows.filter(row => ids.includes(row.id)).map(row => row.tier)).toEqual(ids.map(() => winner.action.kind === 'retier' ? winner.action.tier : undefined));
  });

  it('leaves invalid authored rows and malformed metadata untouched', async () => {
    const { root, handler, load } = await fixture();
    const shops = await load('shops');
    const ids = shops.rows.slice(0, 2).map(row => row.id);
    shops.rows[1]!.name = 42;
    const invalid = JSON.stringify(shops.rows);
    await writeFile(path.join(root, 'data/shops.json'), invalid);
    const action: BulkAction = { kind: 'status', status: 'candidate' };
    const response = await send(handler, 'shops', ids, action, { content: contentRevision(invalid), meta: contentRevision('{}\n') });
    expect(response?.status).toBe(422);
    expect((await load('shops')).text).toBe(invalid);
    await expect(readFile(path.join(root, 'meta/shops.meta.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(path.join(root, 'data/shops.json'), shops.text);
    await mkdir(path.join(root, 'meta'), { recursive: true });
    await writeFile(path.join(root, 'meta/shops.meta.json'), '{broken');
    const broken = await send(handler, 'shops', ids, action, { content: shops.revision, meta: contentRevision('{broken') });
    expect(broken?.status).toBe(500);
    expect(broken?.body).not.toContain(root);
    expect(await readFile(path.join(root, 'meta/shops.meta.json'), 'utf8')).toBe('{broken');
    expect((await load('shops')).text).toBe(shops.text);
    expect(await readdir(path.join(root, 'meta'))).toEqual(['shops.meta.json']);
  });

  it('rejects unknown fields, forged metadata, invalid actions, and malformed selections', async () => {
    const { handler, load, meta } = await fixture();
    const shops = await load('shops');
    const base = { operation: 'preview', collection: 'shops', recordIds: [shops.rows[0]!.id], action: { kind: 'note', text: 'Review' } };
    const invalid = [
      { ...base, actor: 'Forged' }, { ...base, recordIds: [] }, { ...base, recordIds: [' '] },
      { ...base, recordIds: [base.recordIds[0], base.recordIds[0]] }, { ...base, recordIds: Array.from({ length: 1001 }, (_, i) => `id-${i}`) },
      { ...base, recordIds: [1] }, { ...base, action: { kind: 'note', text: ' ' } },
      { ...base, action: { kind: 'note', text: 'Forged', by: 'Agent', at } },
      { ...base, action: { kind: 'status', status: 'approved' } }, { ...base, action: { kind: 'status', status: 'live' } },
      { ...base, action: { kind: 'retier', tier: 2 } }, { ...base, action: { kind: 'retier', tier: 0, unlinkFormulas: false } },
      { ...base, action: { kind: 'retier', tier: 1.5, unlinkFormulas: false } },
      { ...base, action: { kind: 'status', status: 'draft', approvals: {} } },
      { ...base, action: { kind: 'note', text: 'x', record: { id: 'replacement' } } },
      { ...base, operation: 'apply' }, { ...base, operation: 'apply', revisions: { content: shops.revision } },
      { ...base, revisions: { content: 'bad', meta: 'a'.repeat(64) } },
      { ...base, revisions: { content: shops.revision, meta: 'a'.repeat(64), extra: true } },
      undefined,
    ];
    for (const body of invalid) {
      const result = await handler({ method: 'POST', url: '/__devdocs/bulk', body });
      expect(result?.status, JSON.stringify(body)).toBe(422);
    }
    expect((await send(handler, '../shops', base.recordIds, { kind: 'status', status: 'draft' }))?.status).toBe(404);
    expect((await send(handler, 'audio', ['$collection'], { kind: 'status', status: 'draft' }))?.status).toBe(422);
    expect((await load('shops')).text).toBe(shops.text);
    await expect(meta('shops')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('guards remote requests before body processing and rejects malformed paths and methods', async () => {
    const { handler } = await fixture();
    const request = { method: 'POST', url: '/__devdocs/bulk' };
    for (const headers of [{ origin: 'https://evil.example' }, { origin: 'null' }, { host: 'evil.example' }]) {
      expect((await handler({ ...request, headers, get body(): never { throw new Error('Body must not be processed'); } }))?.status).toBe(403);
    }
    expect((await handler({ method: 'POST', url: 'https://evil.example/__devdocs/bulk' }))?.status).toBe(403);
    expect((await handler({ method: 'POST', url: request.url, socket: { remoteAddress: '192.0.2.1' } }))?.status).toBe(403);
    for (const url of ['/__devdocs/bulk/', '/__devdocs/bulk/../shops', '/__devdocs/bulk/%2e%2e', '/__devdocs/bulk/%', '/__devdocs/bulk/%00', '/__devdocs/bulk/a%2fb']) {
      expect((await handler({ method: 'POST', url }))?.status, url).toBe(400);
    }
    expect((await handler({ url: '/__devdocs/bulk', method: 'PUT' }))?.headers.Allow).toBe('POST');
    expect(await handler({ url: '/items' })).toBeUndefined();
    expect(isBulkPath('/__devdocs/bulky')).toBe(false);
  });
});
