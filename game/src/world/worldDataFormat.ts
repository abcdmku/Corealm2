/** Portable generated-data container. JSON describes objects; typed arrays retain their exact bytes. */
const MAGIC = 0x43525731;
const types = { Float32Array, Uint8Array, Uint16Array, Uint32Array };
type ArrayName = keyof typeof types;

export interface WorldDataManifest {
  format: 'corealm-world'; version: 1; revision: string; scope: string;
  tiles: string[];
  records: Record<string, { file: string; sha256: string; bytes: number }>;
}

export function encodeWorldData(data: unknown): Uint8Array {
  const arrays: Uint8Array[] = [];
  let length = 0;
  const json = JSON.stringify(data, (_key, value) => {
    if (!ArrayBuffer.isView(value)) return value;
    const type = value.constructor.name as ArrayName;
    if (!Object.hasOwn(types, type)) throw new Error(`Unsupported world array: ${type}`);
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const offset = length;
    arrays.push(bytes); length += bytes.byteLength;
    return { $worldArray: type, offset, bytes: bytes.byteLength };
  });
  const header = new TextEncoder().encode(json);
  const result = new Uint8Array(12 + header.length + length);
  const view = new DataView(result.buffer);
  view.setUint32(0, MAGIC); view.setUint32(4, header.length); view.setUint32(8, length);
  result.set(header, 12);
  let offset = 12 + header.length;
  for (const array of arrays) { result.set(array, offset); offset += array.length; }
  return result;
}

export function decodeWorldData(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || view.getUint32(0) !== MAGIC) throw new Error('Invalid world data header');
  const start = 12 + view.getUint32(4);
  if (start + view.getUint32(8) !== bytes.length) throw new Error('Truncated world data');
  return JSON.parse(new TextDecoder().decode(bytes.subarray(12, start)), (_key, value) => {
    if (!value || !Object.hasOwn(value, '$worldArray')) return value;
    const type = value.$worldArray as ArrayName;
    if (!Object.hasOwn(types, type) || !Number.isInteger(value.offset) || value.offset < 0
      || !Number.isInteger(value.bytes) || value.bytes < 0 || start + value.offset + value.bytes > bytes.length
      || value.bytes % types[type].BYTES_PER_ELEMENT !== 0) throw new Error('Invalid world array');
    return new types[type](bytes.slice(start + value.offset, start + value.offset + value.bytes).buffer);
  });
}

export async function worldDataSha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function generationScope(kind: string, seed: number, search: string): string {
  if (kind === 'game') return `${kind}/${seed}/world`;
  const query = new URLSearchParams(search);
  for (const key of ['world-bake', 'world-data', 'startup-cache', 'performance']) query.delete(key);
  query.sort();
  return `${kind}/${seed}/?${query}`;
}
