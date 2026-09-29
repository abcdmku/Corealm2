/**
 * Minimal raw GLB reader for rig inspection: JSON, accessors as Float64Arrays and node world
 * matrices. Used where loading a full gltf-transform document would be wasteful (scanning a few
 * hundred source exports) and where the check must see the file exactly as written.
 */
import { readFileSync } from "node:fs";

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const NORMALIZER = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

export function readGlb(file) {
  const buffer = readFileSync(file);
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a GLB`);
  let offset = 12;
  let json;
  let bin;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8"));
    else if (type === 0x004e4942) bin = chunk;
    offset += 8 + length;
  }
  const parent = [];
  (json.nodes ?? []).forEach((node, index) => (node.children ?? []).forEach((child) => (parent[child] = index)));
  return { json, bin, parent, bytes: buffer.length };
}

export function accessor(glb, index) {
  const a = glb.json.accessors[index];
  const width = TYPE_SIZE[a.type];
  const size = COMPONENT_BYTES[a.componentType];
  const out = new Float64Array(a.count * width);
  if (a.bufferView === undefined) return out;
  const view = glb.json.bufferViews[a.bufferView];
  if (view.extensions?.EXT_meshopt_compression) throw new Error("meshopt-compressed accessor; decode with gltf-transform instead");
  const stride = view.byteStride || size * width;
  const base = (view.byteOffset || 0) + (a.byteOffset || 0);
  const data = new DataView(glb.bin.buffer, glb.bin.byteOffset, glb.bin.byteLength);
  const read = {
    5120: (o) => data.getInt8(o), 5121: (o) => data.getUint8(o), 5122: (o) => data.getInt16(o, true),
    5123: (o) => data.getUint16(o, true), 5125: (o) => data.getUint32(o, true), 5126: (o) => data.getFloat32(o, true),
  }[a.componentType];
  const scale = a.normalized ? NORMALIZER[a.componentType] : 1;
  for (let i = 0; i < a.count; i += 1)
    for (let c = 0; c < width; c += 1) out[i * width + c] = read(base + i * stride + c * size) / scale;
  return out;
}

/** Column-major 4x4 product a*b. */
export function mul4(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r += 1)
    for (let c = 0; c < 4; c += 1)
      for (let k = 0; k < 4; k += 1) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

export function localMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const t = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}

export function worldMatrix(glb, index) {
  const own = localMatrix(glb.json.nodes[index]);
  const parent = glb.parent[index];
  return parent === undefined ? own : mul4(worldMatrix(glb, parent), own);
}

export const transformPoint = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
