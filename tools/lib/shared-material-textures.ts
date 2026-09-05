import path from "node:path";
import { createHash } from "node:crypto";

export interface SharedMaterialTexture {
  file: string;
  bytes: Uint8Array;
  mimeType: string;
  sha256: string;
}

interface BufferViewDef {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  [key: string]: unknown;
}

interface GlbJson {
  buffers?: Array<{ byteLength: number; uri?: string }>;
  bufferViews?: BufferViewDef[];
  images?: Array<{ bufferView?: number; uri?: string; mimeType?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/** Externalizes exact encoded images, then compacts only their now-unused binary ranges. */
export function externalizeGlbMaterialTextures(
  source: Uint8Array,
  modelRelativePath: string,
): { glb: Uint8Array; textures: SharedMaterialTexture[] } {
  const modelPath = modelRelativePath.replace(/\\/g, "/");
  if (!/^models\/[a-z0-9_-]+\/[a-z0-9_-]+\.glb$/.test(modelPath)) {
    throw new Error(`Expected a staged models/<category>/<id>.glb path, got ${modelRelativePath}`);
  }
  const bytes = Buffer.from(source);
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF"
    || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length
    || bytes.toString("ascii", 16, 20) !== "JSON") throw new Error("Invalid GLB 2 header");
  const jsonLength = bytes.readUInt32LE(12);
  const binaryHeader = 20 + jsonLength;
  if (binaryHeader > bytes.length) throw new Error("GLB JSON chunk exceeds its file");
  const json = JSON.parse(bytes.subarray(20, binaryHeader).toString("utf8")) as GlbJson;
  if (!json.images?.length) return { glb: source, textures: [] };
  if (binaryHeader + 8 > bytes.length || bytes.toString("ascii", binaryHeader + 4, binaryHeader + 8) !== "BIN\0") {
    throw new Error("Expected standalone embedded images in a GLB BIN chunk");
  }
  const binaryLength = bytes.readUInt32LE(binaryHeader);
  if (binaryHeader + 8 + binaryLength !== bytes.length) throw new Error("Unexpected GLB chunks or truncated BIN payload");
  if (json.buffers?.length !== 1 || json.buffers[0]!.uri) throw new Error("Expected one embedded GLB buffer");
  const binary = bytes.subarray(binaryHeader + 8);
  const views = json.bufferViews ?? [];
  for (const view of views) {
    const offset = view.byteOffset ?? 0;
    if (view.buffer !== 0 || !Number.isInteger(offset) || !Number.isInteger(view.byteLength)
      || offset < 0 || view.byteLength <= 0 || offset + view.byteLength > binaryLength) {
      throw new Error("Invalid source buffer view");
    }
  }
  const imageViews = new Set<number>();
  const textures = new Map<string, SharedMaterialTexture>();
  for (const image of json.images) {
    if (image.bufferView === undefined || image.uri !== undefined) throw new Error("Texture externalization requires embedded source images");
    const view = views[image.bufferView];
    if (!view) throw new Error(`Image references missing buffer view ${image.bufferView}`);
    const mimeType = image.mimeType;
    const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/avif": "avif", "image/ktx2": "ktx2" } as Record<string, string>)[mimeType ?? ""];
    if (!extension || !mimeType) throw new Error(`Unsupported image media type ${mimeType ?? "missing"}`);
    const offset = view.byteOffset ?? 0;
    const imageBytes = binary.subarray(offset, offset + view.byteLength);
    const sha256 = createHash("sha256").update(imageBytes).digest("hex");
    const file = `textures/imported/${sha256}.${extension}`;
    textures.set(file, { file, bytes: new Uint8Array(imageBytes), mimeType, sha256 });
    imageViews.add(image.bufferView);
    delete image.bufferView;
    image.uri = path.posix.relative(path.posix.dirname(modelPath), file);
  }

  // A buffer view can be shared by an image, accessor or extension. Retain it if
  // anything still references it after the image binding changes to a URI.
  const retainedReferences = new Set<number>();
  const walk = (value: unknown, visit: (record: Record<string, unknown>) => void): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const child of value) walk(child, visit); return; }
    const record = value as Record<string, unknown>;
    visit(record);
    for (const child of Object.values(record)) walk(child, visit);
  };
  walk(json, record => { if (typeof record.bufferView === "number") retainedReferences.add(record.bufferView); });
  const keep = views.map((_view, index) => index).filter(index => !imageViews.has(index) || retainedReferences.has(index));
  const ranges: Array<{ start: number; end: number; offset: number }> = [];
  for (const index of [...keep].sort((a, b) => (views[a]!.byteOffset ?? 0) - (views[b]!.byteOffset ?? 0))) {
    const view = views[index]!;
    const start = view.byteOffset ?? 0;
    const end = start + view.byteLength;
    const last = ranges.at(-1);
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else ranges.push({ start, end, offset: 0 });
  }
  let cursor = 0;
  const chunks: Buffer[] = [];
  for (const range of ranges) {
    const padding = ((range.start % 4) - (cursor % 4) + 4) % 4;
    if (padding) chunks.push(Buffer.alloc(padding));
    range.offset = cursor + padding;
    chunks.push(binary.subarray(range.start, range.end));
    cursor = range.offset + range.end - range.start;
  }
  const compacted = Buffer.concat(chunks);
  const remap = new Map(keep.map((index, next) => [index, next]));
  json.bufferViews = keep.map(index => {
    const view = views[index]!;
    const start = view.byteOffset ?? 0;
    const range = ranges.find(candidate => start >= candidate.start && start + view.byteLength <= candidate.end)!;
    return { ...view, byteOffset: range.offset + start - range.start };
  });
  walk(json, record => {
    if (typeof record.bufferView !== "number") return;
    const mapped = remap.get(record.bufferView);
    if (mapped === undefined) throw new Error(`Unresolved retained buffer view ${record.bufferView}`);
    record.bufferView = mapped;
  });
  if (compacted.length) json.buffers[0]!.byteLength = compacted.length;
  else { delete json.buffers; delete json.bufferViews; }
  const text = Buffer.from(JSON.stringify(json));
  const paddedJson = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20);
  text.copy(paddedJson);
  const paddedBinary = Buffer.alloc(Math.ceil(compacted.length / 4) * 4);
  compacted.copy(paddedBinary);
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "ascii"); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + paddedJson.length + (paddedBinary.length ? 8 + paddedBinary.length : 0), 8);
  header.writeUInt32LE(paddedJson.length, 12); header.write("JSON", 16, "ascii");
  const binaryChunk = Buffer.alloc(paddedBinary.length ? 8 : 0);
  if (binaryChunk.length) { binaryChunk.writeUInt32LE(paddedBinary.length, 0); binaryChunk.write("BIN\0", 4, "ascii"); }
  return { glb: new Uint8Array(Buffer.concat([header, paddedJson, binaryChunk, paddedBinary])), textures: [...textures.values()] };
}
