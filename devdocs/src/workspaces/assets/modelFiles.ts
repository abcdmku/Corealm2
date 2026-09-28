/**
 * An uploaded model as the files an author picks: one `.glb`, or one `.gltf` with its `.bin` buffers,
 * plus any texture files either names by relative URI. The build ships binary glTF only, so the
 * result is always one GLB with its buffers inside (`glb`), and the textures it names beside it
 * (`resources`, by the URI the GLB keeps, relative to the GLB's own folder). Players load the GLB
 * from the server, and GLTFLoader resolves each texture URI against the GLB's URL.
 *
 * `preview` is the same GLB with the textures inside too, for a page that holds the files only as
 * blobs (a relative URI cannot resolve against a `blob:` URL).
 *
 * No three.js here: this is byte and JSON work, tested in node.
 */

export interface ModelSourceFile { name: string; bytes: Uint8Array }
export interface BundledModel {
  /** Binary glTF, buffers inside, external texture URIs kept. */
  glb: Uint8Array;
  /** Texture bytes by the relative URI the GLB names, such as `fur.png` or `textures/fur.png`. */
  resources: Record<string, Uint8Array>;
  /** Binary glTF with the textures inside as well. */
  preview: Uint8Array;
  /** The picked files the model does not name. */
  unused: string[];
}

interface GltfBuffer { uri?: string; byteLength: number; extensions?: { EXT_meshopt_compression?: { fallback?: boolean } } }
interface GltfJson {
  buffers?: GltfBuffer[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; extensions?: { EXT_meshopt_compression?: { buffer: number; byteOffset?: number } } }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string; name?: string }[];
  [key: string]: unknown;
}

const GLB_MAGIC = 0x46546c67, CHUNK_JSON = 0x4e4f534a, CHUNK_BIN = 0x004e4942;
const IMAGE_TYPES: Readonly<Record<string, string>> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
/** One segment the server's file store accepts (`CONTENT_ASSET_PATH`). */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

export class ModelFileProblem extends Error { constructor(message: string) { super(message); this.name = "ModelFileProblem"; } }

const extension = (name: string): string => name.slice(name.lastIndexOf(".") + 1).toLowerCase();
const pad4 = (length: number): number => (length + 3) & ~3;

function readGlb(bytes: Uint8Array): { json: GltfJson; bin: Uint8Array | null } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) throw new ModelFileProblem("That .glb is not binary glTF.");
  if (view.getUint32(4, true) !== 2) throw new ModelFileProblem("Only glTF 2.0 models can be read.");
  let json: GltfJson | null = null, bin: Uint8Array | null = null;
  for (let at = 12; at + 8 <= bytes.byteLength;) {
    const length = view.getUint32(at, true), type = view.getUint32(at + 4, true), body = bytes.subarray(at + 8, at + 8 + length);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(body)) as GltfJson;
    else if (type === CHUNK_BIN && !bin) bin = body;
    at += 8 + pad4(length);
  }
  if (!json) throw new ModelFileProblem("That .glb has no JSON chunk.");
  return { json, bin };
}

export function writeGlb(json: GltfJson, bin: Uint8Array): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = pad4(text.length), binLength = bin.length ? pad4(bin.length) : 0;
  const total = 12 + 8 + jsonLength + (binLength ? 8 + binLength : 0);
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, CHUNK_JSON, true);
  out.set(text, 20); out.fill(0x20, 20 + text.length, 20 + jsonLength);
  if (binLength) {
    const at = 20 + jsonLength;
    view.setUint32(at, binLength, true); view.setUint32(at + 4, CHUNK_BIN, true);
    out.set(bin, at + 8);
  }
  return out;
}

function decodeDataUri(uri: string): Uint8Array {
  const comma = uri.indexOf(",");
  const meta = uri.slice(5, comma);
  if (!meta.endsWith(";base64")) return new TextEncoder().encode(decodeURIComponent(uri.slice(comma + 1)));
  const text = atob(uri.slice(comma + 1));
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index);
  return bytes;
}

/** A URI relative to the model, as the path segments the store will hold, or a sentence why not. */
function relativePath(uri: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(uri); } catch { throw new ModelFileProblem(`The model names ${uri}, which is not a valid URI.`); }
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith("/")) throw new ModelFileProblem(`The model names ${uri}: only files beside it can be uploaded with it.`);
  const segments = decoded.split("/").filter(segment => segment !== "" && segment !== ".");
  if (!segments.length || segments.some(segment => segment === ".." || !SEGMENT.test(segment)))
    throw new ModelFileProblem(`The model names ${uri}: rename the file to letters, digits, -, _ and . (no spaces), inside the model's folder.`);
  return segments.join("/");
}

export function bundleModelFiles(files: readonly ModelSourceFile[]): BundledModel {
  const mains = files.filter(file => ["glb", "gltf"].includes(extension(file.name)));
  if (mains.length !== 1) throw new ModelFileProblem(mains.length ? "Choose one model (.glb or .gltf) at a time." : "Choose a .glb, or a .gltf with its .bin and textures.");
  const main = mains[0]!;
  const byName = new Map<string, ModelSourceFile>();
  for (const file of files) if (file !== main) byName.set(file.name, file);
  const used = new Set<string>();
  /** A picked file for a URI: its whole relative path, else its file name (a browser picker drops folders). */
  const pick = (path: string, uri: string): ModelSourceFile => {
    const found = byName.get(path) ?? byName.get(path.split("/").at(-1)!);
    if (!found) throw new ModelFileProblem(`The model names ${uri}. Choose that file too.`);
    used.add(found.name);
    return found;
  };

  let json: GltfJson, glbBin: Uint8Array | null = null;
  if (extension(main.name) === "glb") ({ json, bin: glbBin } = readGlb(main.bytes));
  else {
    try { json = JSON.parse(new TextDecoder().decode(main.bytes)) as GltfJson; }
    catch { throw new ModelFileProblem("That .gltf is not JSON."); }
  }
  json = structuredClone(json);

  // Every buffer with data into one binary chunk, each at a four-byte boundary. A meshopt fallback
  // buffer has no data by design (a decoder never reads it) and stays a buffer of its own.
  const source = json.buffers ?? [];
  const fallback = (index: number): boolean => Boolean(source[index]?.extensions?.EXT_meshopt_compression?.fallback);
  const buffers = source.map((buffer, index) => {
    if (fallback(index)) return new Uint8Array(0);
    if (buffer.uri === undefined) {
      if (index !== 0 || !glbBin) throw new ModelFileProblem(`Buffer ${index} has no data.`);
      return glbBin.subarray(0, buffer.byteLength);
    }
    if (buffer.uri.startsWith("data:")) return decodeDataUri(buffer.uri);
    return pick(relativePath(buffer.uri), buffer.uri).bytes.subarray(0, buffer.byteLength);
  });
  const offsets: number[] = [], moved: number[] = [];
  const kept: GltfBuffer[] = [];
  let length = 0;
  buffers.forEach((buffer, index) => {
    if (fallback(index)) { moved.push(-1); offsets.push(0); return; }
    moved.push(0); offsets.push(length); length = pad4(length + buffer.length);
  });
  const bin = new Uint8Array(length);
  buffers.forEach((buffer, index) => { if (!fallback(index)) bin.set(buffer, offsets[index]!); });
  const merged = length ? 1 : 0;
  source.forEach((buffer, index) => { if (fallback(index)) { moved[index] = merged + kept.length; kept.push({ byteLength: buffer.byteLength, extensions: buffer.extensions! }); } });
  const remap = (target: { buffer: number; byteOffset?: number }): void => { target.byteOffset = (target.byteOffset ?? 0) + offsets[target.buffer]!; target.buffer = moved[target.buffer]!; };
  for (const view of json.bufferViews ?? []) {
    remap(view);
    // Meshopt-compressed views read their bytes from the buffer the extension names.
    const compressed = view.extensions?.EXT_meshopt_compression;
    if (compressed) remap(compressed);
  }
  json.buffers = [...(length ? [{ byteLength: length }] : []), ...kept];

  // Textures stay files beside the GLB, named by a clean relative URI.
  const resources: Record<string, Uint8Array> = {};
  for (const image of json.images ?? []) {
    if (image.uri === undefined || image.uri.startsWith("data:")) continue;
    const path = relativePath(image.uri);
    if (!IMAGE_TYPES[extension(path)]) throw new ModelFileProblem(`The model names ${image.uri}: textures must be .png, .jpg or .webp.`);
    resources[path] = pick(path, image.uri).bytes;
    image.uri = path;
  }
  const glb = writeGlb(json, bin);

  // The preview: the same model with each texture appended to the binary chunk.
  const preview = structuredClone(json);
  let previewLength = length;
  const appended: { at: number; bytes: Uint8Array }[] = [];
  preview.bufferViews ??= [];
  for (const image of preview.images ?? []) {
    if (image.uri === undefined || image.uri.startsWith("data:")) continue;
    const bytes = resources[image.uri]!;
    appended.push({ at: previewLength, bytes });
    preview.bufferViews.push({ buffer: 0, byteOffset: previewLength, byteLength: bytes.length });
    image.bufferView = preview.bufferViews.length - 1;
    image.mimeType = IMAGE_TYPES[extension(image.uri)];
    delete image.uri;
    previewLength = pad4(previewLength + bytes.length);
  }
  const previewBin = new Uint8Array(previewLength);
  previewBin.set(bin);
  for (const piece of appended) previewBin.set(piece.bytes, piece.at);
  if (previewLength) preview.buffers = [{ byteLength: previewLength }];

  return { glb, resources, preview: appended.length ? writeGlb(preview, previewBin) : glb,
    unused: [...byName.keys()].filter(name => !used.has(name)) };
}

/** Where an uploaded model's files live under `assets/`: a lone GLB as the build names it, a GLB with textures in its own folder. */
export function uploadedModelFile(category: string, id: string, withResources: boolean): string {
  return withResources ? `models/${category}/${id}/${id}.glb` : `models/${category}/${id}.glb`;
}
