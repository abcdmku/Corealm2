import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** SHA-256 of a generator source file with CRLF normalized to LF.
 * Git's `text=auto` checks these files out with platform line endings, so a raw byte hash of the
 * same committed source differs between Windows and POSIX checkouts. Provenance pins must not. */
export function generatorSourceSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes).toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
}

export async function generatorFileSha256(file: string): Promise<string> {
  return generatorSourceSha256(await readFile(file));
}
