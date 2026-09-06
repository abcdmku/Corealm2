import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Page, Response } from 'playwright';

/** Bind browser evidence to the actual response bytes, rather than only a candidate URL. */
export async function recordCandidateResponses(page: Page, catalogFile: string, requiredIds: readonly string[]) {
  const bytes = await readFile(catalogFile);
  const catalog = JSON.parse(bytes.toString());
  const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
  const entries = catalog.assets.filter((entry: any) => requiredIds.includes(entry.id));
  if (entries.length !== requiredIds.length) throw new Error('Response audit catalog lacks required candidates');
  const records: any[] = [], errors: string[] = [], pending: Promise<void>[] = [];
  const listener = (response: Response) => {
    const pathname = decodeURIComponent(new URL(response.url()).pathname);
    const entry = entries.find((candidate: any) => pathname.endsWith(`/assets/${candidate.file}`));
    if (!entry) return;
    pending.push((async () => {
      const body = await response.body();
      const actualSha256 = sha(body), passed = response.ok() && actualSha256 === entry.sha256.toLowerCase() && body.length === entry.bytes;
      records.push({ id: entry.id, url: response.url(), status: response.status(), bytes: body.length, actualSha256,
        expectedSha256: entry.sha256.toLowerCase(), passed });
      if (!passed) errors.push(`Served candidate byte mismatch ${entry.id}`);
    })().catch(error => { errors.push(`Failed served-byte audit ${entry.id}: ${String(error)}`); }));
  };
  page.on('response', listener);
  return async () => {
    page.off('response', listener);
    await Promise.all(pending);
    for (const id of requiredIds) if (!records.some(record => record.id === id && record.passed)) errors.push(`No verified response bytes for ${id}`);
    return { catalogSha256: sha(bytes), requiredIds, records, errors, passed: errors.length === 0 };
  };
}
