import { afterEach, expect, test } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Page } from 'playwright';
import { recordCandidateResponses } from '../tools/creature-motion/record-candidate-responses.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true }))); });
async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'corealm-response-proof-')); dirs.push(dir);
  const bytes = Buffer.from('frozen candidate'), digest = createHash('sha256').update(bytes).digest('hex');
  const catalog = path.join(dir, 'catalog.json');
  await writeFile(catalog, JSON.stringify({ assets: [{ id: 'test', file: 'models/test.glb', bytes: bytes.length, sha256: digest }] }));
  const page = new EventEmitter();
  return { page, bytes, digest, finish: await recordCandidateResponses(page as unknown as Page, catalog, ['test']) };
}
test('records the response body digest, independent of an expected URL', async () => {
  const { page, bytes, digest, finish } = await setup();
  page.emit('response', { url: () => 'http://localhost/assets/models/test.glb?v=1', ok: () => true, status: () => 200, body: async () => bytes });
  const result = await finish();
  expect(result.passed).toBe(true);
  expect(result.records[0].actualSha256).toBe(digest);
});
test('rejects changed bytes at the same candidate URL', async () => {
  const { page, finish } = await setup();
  page.emit('response', { url: () => 'http://localhost/assets/models/test.glb', ok: () => true, status: () => 200, body: async () => Buffer.from('different candidate') });
  const result = await finish();
  expect(result.passed).toBe(false);
  expect(result.errors).toContain('Served candidate byte mismatch test');
});
test('missing requests cannot satisfy candidate identity proof', async () => {
  const { finish } = await setup();
  const result = await finish();
  expect(result.passed).toBe(false);
  expect(result.errors).toContain('No verified response bytes for test');
});
