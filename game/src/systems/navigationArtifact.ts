import * as THREE from "three";

export const NAVMESH_ARTIFACT_FORMAT = "corealm-navmesh" as const;
export const NAVMESH_ARTIFACT_VERSION = 1 as const;
export const RECAST_NAVIGATION_VERSION = "0.43.1" as const;

const MAGIC = new Uint8Array([0x43, 0x52, 0x4e, 0x41, 0x56, 0x01, 0x0d, 0x0a]);
const HEADER_BYTES = MAGIC.byteLength + 8;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type NavigationGeometryCategory =
  | "terrain"
  | "road"
  | "water"
  | "solid-carve"
  | "dungeon"
  | "other";

/**
 * Revisions for authored inputs which are not all represented by Recast triangles.
 *
 * Terrain, water profiles, solid carves and dungeon geometry are also protected by the geometry
 * digest. Roads currently change surface colour and route costs, not terrain height, so their
 * authored source revision has to be carried separately.
 */
export interface NavigationAuthoredInputs {
  terrainGeometry: string;
  roads: string;
  water: string;
  solidCarves: string;
  dungeonGeometry: string;
  seedDependentInputs: string;
  navigationSettings: string;
}

export interface NavigationArtifactSettings {
  strategy: "solo" | "tiled";
  cs: number;
  ch: number;
  walkableRadius: number;
  walkableClimb: number;
  walkableHeight: number;
  walkableSlopeAngle: number;
  minRegionArea: number;
  tileSizeVoxels: number | null;
}

export interface NavigationArtifactFingerprintInput {
  worldSeed: string;
  authored: NavigationAuthoredInputs;
  settings: NavigationArtifactSettings;
  geometryDigest: string;
  sourceMeshes: number;
  sourceTriangles: number;
  categories: Record<NavigationGeometryCategory, number>;
}

export interface NavigationArtifactMetadata {
  format: typeof NAVMESH_ARTIFACT_FORMAT;
  formatVersion: typeof NAVMESH_ARTIFACT_VERSION;
  recastVersion: typeof RECAST_NAVIGATION_VERSION;
  fingerprint: string;
  navDataSha256: string;
  settings: NavigationArtifactSettings;
  sourceMeshes: number;
  sourceTriangles: number;
  categories: Record<NavigationGeometryCategory, number>;
  polyCount: number;
  tileCount: number;
}

export interface NavigationArtifact {
  metadata: NavigationArtifactMetadata;
  navData: Uint8Array;
}

export interface NavigationGeometryFingerprint {
  digest: string;
  categories: Record<NavigationGeometryCategory, number>;
}

/** Recast consumes transformed float32 vertices, not the intermediate float64 object matrices. */
export function navigationMeshPositions(mesh: THREE.Mesh): Float32Array | null {
  const attribute = mesh.geometry.getAttribute("position");
  if (!attribute || attribute.itemSize !== 3) return null;
  mesh.updateWorldMatrix(true, false);
  const positions = new Float32Array(attribute.count * 3);
  const point = new THREE.Vector3();
  for (let vertex = 0; vertex < attribute.count; vertex++) {
    point.fromBufferAttribute(attribute, vertex).applyMatrix4(mesh.matrixWorld);
    point.toArray(positions, vertex * 3);
  }
  if (!positions.every(Number.isFinite)) throw new Error("navigation geometry contains non-finite positions");
  return positions;
}

/** Hash the same transformed inputs as the generator, including real sub-millimetre changes. */
export async function fingerprintNavigationGeometry(
  meshes: readonly THREE.Mesh[],
): Promise<NavigationGeometryFingerprint> {
  const categories = emptyCategories();
  const chunks: Uint8Array[] = [];

  for (let index = 0; index < meshes.length; index += 1) {
    const mesh = meshes[index]!;
    const category = navigationGeometryCategory(mesh.name);
    categories[category] += 1;

    const positions = navigationMeshPositions(mesh);
    const indices = mesh.geometry.getIndex()?.array
      ?? (positions ? Uint32Array.from({ length: positions.length / 3 }, (_, vertex) => vertex) : null);
    chunks.push(textEncoder.encode(stableJson({
      order: index,
      category,
      name: mesh.name,
      positionCount: positions?.length ?? 0,
      indexCount: indices?.length ?? 0,
    })));
    if (positions) chunks.push(arrayBytes(positions));
    if (indices) chunks.push(arrayBytes(indices));
  }

  return { digest: await sha256(concatBytes(chunks)), categories };
}

export async function fingerprintNavigationInputs(
  input: NavigationArtifactFingerprintInput,
): Promise<string> {
  return sha256(textEncoder.encode(stableJson({
    format: NAVMESH_ARTIFACT_FORMAT,
    formatVersion: NAVMESH_ARTIFACT_VERSION,
    recastVersion: RECAST_NAVIGATION_VERSION,
    ...input,
  })));
}

export async function encodeNavigationArtifact(
  metadata: Omit<NavigationArtifactMetadata, "format" | "formatVersion" | "recastVersion" | "navDataSha256">,
  navData: Uint8Array,
): Promise<Uint8Array> {
  const complete: NavigationArtifactMetadata = {
    format: NAVMESH_ARTIFACT_FORMAT,
    formatVersion: NAVMESH_ARTIFACT_VERSION,
    recastVersion: RECAST_NAVIGATION_VERSION,
    ...metadata,
    navDataSha256: await sha256(navData),
  };
  const metadataBytes = textEncoder.encode(stableJson(complete));
  const output = new Uint8Array(HEADER_BYTES + metadataBytes.byteLength + navData.byteLength);
  output.set(MAGIC, 0);
  const view = new DataView(output.buffer);
  view.setUint32(MAGIC.byteLength, metadataBytes.byteLength, true);
  view.setUint32(MAGIC.byteLength + 4, navData.byteLength, true);
  output.set(metadataBytes, HEADER_BYTES);
  output.set(navData, HEADER_BYTES + metadataBytes.byteLength);
  return output;
}

export async function decodeNavigationArtifact(bytes: Uint8Array): Promise<NavigationArtifact> {
  if (bytes.byteLength < HEADER_BYTES) throw new Error("navigation artifact is truncated");
  for (let index = 0; index < MAGIC.byteLength; index += 1) {
    if (bytes[index] !== MAGIC[index]) throw new Error("navigation artifact has an unknown format");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metadataLength = view.getUint32(MAGIC.byteLength, true);
  const navDataLength = view.getUint32(MAGIC.byteLength + 4, true);
  if (HEADER_BYTES + metadataLength + navDataLength !== bytes.byteLength) {
    throw new Error("navigation artifact lengths do not match its payload");
  }

  const metadataStart = HEADER_BYTES;
  const metadataEnd = metadataStart + metadataLength;
  const parsed: unknown = JSON.parse(textDecoder.decode(bytes.subarray(metadataStart, metadataEnd)));
  const metadata = validateMetadata(parsed);
  const navData = bytes.slice(metadataEnd);
  if (await sha256(navData) !== metadata.navDataSha256) {
    throw new Error("navigation artifact payload hash does not match");
  }
  return { metadata, navData };
}

export function navigationGeometryCategory(name: string): NavigationGeometryCategory {
  if (/solid-carve|nav-obstacle/i.test(name)) return "solid-carve";
  if (/dungeon|gravelmaw|chamber|cavern/i.test(name)) return "dungeon";
  if (/road|path|track/i.test(name)) return "road";
  if (/water|lake|basin|shore/i.test(name)) return "water";
  if (/terrain|ground|world-chunk/i.test(name)) return "terrain";
  return "other";
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("WebCrypto SHA-256 is unavailable");
  const source = Uint8Array.from(bytes).buffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", source);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function arrayBytes(array: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }): Uint8Array {
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength).slice();
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength + 4, 0);
  const output = new Uint8Array(length);
  const view = new DataView(output.buffer);
  let offset = 0;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.byteLength, true);
    offset += 4;
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function emptyCategories(): Record<NavigationGeometryCategory, number> {
  return {
    terrain: 0,
    road: 0,
    water: 0,
    "solid-carve": 0,
    dungeon: 0,
    other: 0,
  };
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, entry]) => [key, sortJson(entry)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("navigation fingerprint contains a non-finite number");
  }
  return value;
}

function validateMetadata(value: unknown): NavigationArtifactMetadata {
  if (!value || typeof value !== "object") throw new Error("navigation artifact metadata is not an object");
  const metadata = value as Partial<NavigationArtifactMetadata>;
  if (metadata.format !== NAVMESH_ARTIFACT_FORMAT || metadata.formatVersion !== NAVMESH_ARTIFACT_VERSION) {
    throw new Error("navigation artifact version is unsupported");
  }
  if (metadata.recastVersion !== RECAST_NAVIGATION_VERSION) {
    throw new Error("navigation artifact Recast version does not match runtime");
  }
  if (typeof metadata.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(metadata.fingerprint)) {
    throw new Error("navigation artifact fingerprint is invalid");
  }
  if (typeof metadata.navDataSha256 !== "string" || !/^[a-f0-9]{64}$/.test(metadata.navDataSha256)) {
    throw new Error("navigation artifact payload hash is invalid");
  }
  if (!metadata.settings || !metadata.categories) throw new Error("navigation artifact metadata is incomplete");
  if (!Number.isFinite(metadata.sourceMeshes) || !Number.isFinite(metadata.sourceTriangles)) {
    throw new Error("navigation artifact source counts are invalid");
  }
  if (!Number.isFinite(metadata.polyCount) || !Number.isFinite(metadata.tileCount)) {
    throw new Error("navigation artifact mesh counts are invalid");
  }
  return metadata as NavigationArtifactMetadata;
}
