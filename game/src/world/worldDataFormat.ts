/** Portable generated-data container. JSON describes objects; typed arrays retain their exact bytes. */
const MAGIC = 0x43525731;
const types = { Float32Array, Uint8Array, Uint16Array, Uint32Array };
type ArrayName = keyof typeof types;

export interface WorldDataManifest {
  format: 'corealm-world'; version: 1; revision: string; scope: string;
  tiles: string[];
  records: Record<string, { file: string; sha256: string; bytes: number }>;
  assetTiles?: {minX:number;maxX:number;minZ:number;maxZ:number;ids:string[];record?:string}[];
  assetObjects?: {x:number;z:number;ids:string[]}[];
}

export function encodeWorldData(data: unknown): Uint8Array {
  const arrays: Uint8Array[] = [];
  const shared = new Map<ArrayBufferView, { $worldArray: ArrayName; offset: number; bytes: number; encoding: string; stride: number }>();
  let length = 0;
  const json = JSON.stringify(data, function (_key, value) {
    if (!ArrayBuffer.isView(value)) return value;
    const existing = shared.get(value);
    if (existing) return existing;
    const type = value.constructor.name as ArrayName;
    if (!Object.hasOwn(types, type)) throw new Error(`Unsupported world array: ${type}`);
    const source = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const size = types[type].BYTES_PER_ELEMENT;
    const stride = Number.isInteger(this.itemSize) && this.itemSize >= 1 && this.itemSize <= 4 ? this.itemSize : 1;
    // Put neighbouring component bytes together before gzip. Subtraction is byte-exact,
    // including signed zero and every float mantissa bit; no terrain quantization occurs.
    const bytes = new Uint8Array(source.length);
    const count = source.length / size;
    for (let lane = 0; lane < size; lane++) for (let i = 0; i < count; i++) {
      bytes[lane * count + i] = (source[i * size + lane]! - (i >= stride ? source[(i - stride) * size + lane]! : 0)) & 255;
    }
    const offset = length;
    arrays.push(bytes); length += bytes.byteLength;
    const descriptor = { $worldArray: type, offset, bytes: bytes.byteLength, encoding: 'delta-planes', stride };
    shared.set(value, descriptor);
    return descriptor;
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
  const restore = (value: any): any => {
    if (!value || typeof value !== 'object') return value;
    if (!Object.hasOwn(value, '$worldArray')) {
      // A JSON reviver crosses the JS/native boundary for every coordinate and count. Walk
      // object children after parsing instead; only typed-array descriptors need conversion.
      if (Array.isArray(value)) {
        for(let i=0;i<value.length;i++) if(value[i] && typeof value[i]==='object') value[i]=restore(value[i]);
      } else for(const key of Object.keys(value)) if(value[key] && typeof value[key]==='object') value[key]=restore(value[key]);
      return value;
    }
    const type = value.$worldArray as ArrayName;
    if (!Object.hasOwn(types, type) || !Number.isInteger(value.offset) || value.offset < 0
      || !Number.isInteger(value.bytes) || value.bytes < 0 || start + value.offset + value.bytes > bytes.length
      || value.bytes % types[type].BYTES_PER_ELEMENT !== 0) throw new Error('Invalid world array');
    const packed = bytes.subarray(start + value.offset, start + value.offset + value.bytes);
    if (value.encoding === undefined) return new types[type](Uint8Array.from(packed).buffer);
    if (value.encoding !== 'delta-planes' || !Number.isInteger(value.stride) || value.stride < 1 || value.stride > 4)
      throw new Error('Invalid world array encoding');
    const size = types[type].BYTES_PER_ELEMENT, count = packed.length / size;
    const decoded = new Uint8Array(packed.length);
    for (let lane = 0; lane < size; lane++) for (let i = 0; i < count; i++) {
      decoded[i * size + lane] = (packed[lane * count + i]! + (i >= value.stride ? decoded[(i - value.stride) * size + lane]! : 0)) & 255;
    }
    return new types[type](decoded.buffer);
  };
  return restore(JSON.parse(new TextDecoder().decode(bytes.subarray(12, start))));
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
