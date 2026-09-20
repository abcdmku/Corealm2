import type { SolidVolume, Vec3 } from "../contracts.js";
import { Navigation, type NavStrategy } from "../systems/navigation.js";
import type { ForestTreeDescriptor } from "../world/forestResources.js";
import { TerrainSampler, type HeightGrid, type TerrainSamplerData } from "../world/terrainSampler.js";
import type { HeadlessWorldPorts } from "./headlessWorld.js";
import { sha256Hex } from "./worldPackHash.js";
import { assembleAuthoredWorld, assetMeasurements, buildAuthoredSemantic, type AssemblyTerrains, type AssetMeasure, type Bounds3, type CoastalSpawnSites } from "./worldAssembly.js";

/**
 * The server world pack: the authored world's geometry as plain data, in one file.
 *
 * The bake (`tools/build-server-world-pack.ts`) builds the terrain, reads the model triangles and
 * generates the navmesh once. The server loads the result and never touches a GLB or the renderer.
 * The pack holds geometry only. Entities, habitats and the spawn plan come from the live catalog at
 * every boot and at every publish, computed against the pack's terrain, solids and navmesh.
 *
 * Layout, little-endian:
 *
 *   0   8 bytes  magic "CRLMWPCK"
 *   8   u32      format version
 *   12  u32      header length in bytes
 *   16  32 bytes SHA-256 of every byte from 48 to the end
 *   48  header   UTF-8 JSON: revision, seeds, and one entry per section with name, type, offset, bytes
 *   ..  sections each at an absolute offset that is a multiple of 8
 *
 * `f32`, `f64` and `u8` sections are read in place as typed arrays. `json` sections hold the small
 * structured parts.
 */
export const SERVER_WORLD_PACK_FILE = "server-world.pack";
/** Where the bake writes the pack in a checkout, relative to the repo root. A packaged server embeds the same file. */
export const SERVER_WORLD_PACK_REPO_PATH = `game/public/generated/${SERVER_WORLD_PACK_FILE}`;
export const SERVER_WORLD_PACK_VERSION = 1;
const MAGIC = "CRLMWPCK";
const HEADER_OFFSET = 48;
const FORMAT = "corealm-server-world";

type SectionType = "json" | "f32" | "f64" | "u8";
interface SectionEntry { name: string; type: SectionType; offset: number; bytes: number }
interface PackHeader { format: typeof FORMAT; version: number; revision: string; seeds: number[]; sections: SectionEntry[] }

export interface PackedNavigation {
  navData: Uint8Array;
  strategy: Exclude<NavStrategy, "auto">;
  sourceMeshes: number;
  sourceTriangles: number;
  polyCount: number;
}

/**
 * One seed's world. The seed bends the roads, and roads are graded into the ground, so even the terrain
 * heights follow it. It also moves ore, creatures and coastal sites, and with them solids, navmesh and trees.
 */
export interface PackedSeedWorld {
  terrain: { main: TerrainSamplerData; fairy: TerrainSamplerData };
  /** Dry coastal sites the seed picked. They need the analytic biome field, which the server does not carry. */
  coastalSpawns: CoastalSpawnSites;
  /** Site dressing, mine cut faces and fairy dressing. Semantic and lava solids are rebuilt at boot. */
  solids: SolidVolume[];
  structureBounds: Bounds3[];
  /** Every scattered tree, before habitat clearances. Boot removes the ones in a creature's way. */
  trees: ForestTreeDescriptor[];
  nav: PackedNavigation;
}

export interface ServerWorldPack {
  formatVersion: number;
  /** The generation revision of the sources this pack was baked from. */
  revision: string;
  seeds: number[];
  /** Manifest measurements of every asset at bake time. */
  assets: Record<string, AssetMeasure>;
  worlds: Map<number, PackedSeedWorld>;
}

// ---------------------------------------------------------------- encode

type GridMeta = Omit<HeightGrid, "heights">;
interface TerrainMeta extends Omit<TerrainSamplerData, "lattice" | "coastGrid"> { lattice: GridMeta; coastGrid: GridMeta | null }
interface WorldJson { assets: Record<string, AssetMeasure> }
interface TreeTable { ids: string[]; resourceIds: string[]; regionIds: string[]; assetIds: string[]; resource: number[]; region: number[]; asset: number[] }
interface SeedJson { terrain: { main: TerrainMeta; fairy: TerrainMeta }; coastalSpawns: CoastalSpawnSites; solids: SolidVolume[]; structureBounds: Bounds3[]; trees: TreeTable; nav: Omit<PackedNavigation, "navData"> }
const TREE_COLUMNS = 6;

const gridMeta = ({ heights: _heights, ...meta }: HeightGrid): GridMeta => meta;
const terrainMeta = (data: TerrainSamplerData): TerrainMeta => ({ ...data, lattice: gridMeta(data.lattice), coastGrid: data.coastGrid ? gridMeta(data.coastGrid) : null });

function encodeTrees(trees: readonly ForestTreeDescriptor[]): { table: TreeTable; numbers: Float64Array } {
  const table: TreeTable = { ids: [], resourceIds: [], regionIds: [], assetIds: [], resource: [], region: [], asset: [] };
  const intern = (values: string[], value: string): number => { const at = values.indexOf(value); return at >= 0 ? at : values.push(value) - 1; };
  const numbers = new Float64Array(trees.length * TREE_COLUMNS);
  trees.forEach((tree, index) => {
    table.ids.push(tree.id);
    table.resource.push(intern(table.resourceIds, tree.resourceId));
    table.region.push(intern(table.regionIds, tree.regionId));
    table.asset.push(intern(table.assetIds, tree.assetId));
    numbers.set([tree.position[0], tree.position[1], tree.position[2], tree.scale, tree.rotationY, tree.trunkRadius], index * TREE_COLUMNS);
  });
  return { table, numbers };
}

/** Serialises a pack. The same contents always give the same bytes, so a tracked pack only changes when the world does. */
export function encodeServerWorldPack(pack: ServerWorldPack): Uint8Array {
  const text = new TextEncoder();
  const bytesOf = (array: Float32Array | Float64Array | Uint8Array) => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  const parts: { name: string; type: SectionType; data: Uint8Array }[] = [];
  const json = (name: string, value: unknown) => parts.push({ name, type: "json", data: text.encode(JSON.stringify(value)) });
  json("world", { assets: pack.assets } satisfies WorldJson);
  for (const seed of pack.seeds) {
    const world = pack.worlds.get(seed);
    if (!world) throw new Error(`World pack lists seed ${seed} without its world`);
    const trees = encodeTrees(world.trees), { navData, ...nav } = world.nav;
    for (const [map, data] of Object.entries(world.terrain) as ["main" | "fairy", TerrainSamplerData][]) {
      parts.push({ name: `seed/${seed}/terrain/${map}/lattice`, type: "f32", data: bytesOf(data.lattice.heights) });
      if (data.coastGrid) parts.push({ name: `seed/${seed}/terrain/${map}/coast`, type: "f32", data: bytesOf(data.coastGrid.heights) });
    }
    json(`seed/${seed}/world`, { terrain: { main: terrainMeta(world.terrain.main), fairy: terrainMeta(world.terrain.fairy) }, coastalSpawns: world.coastalSpawns, solids: world.solids, structureBounds: world.structureBounds, trees: trees.table, nav } satisfies SeedJson);
    parts.push({ name: `seed/${seed}/trees`, type: "f64", data: bytesOf(trees.numbers) }, { name: `seed/${seed}/navmesh`, type: "u8", data: navData });
  }
  const align = (value: number) => Math.ceil(value / 8) * 8;
  // Offsets depend on the header's length and the header holds the offsets, so settle the length first.
  let headerBytes = new Uint8Array(0), sections: SectionEntry[] = [];
  for (let headerLength = 0, settled = false; !settled;) {
    let offset = align(HEADER_OFFSET + headerLength);
    sections = parts.map(part => { const entry = { name: part.name, type: part.type, offset, bytes: part.data.byteLength }; offset = align(offset + part.data.byteLength); return entry; });
    headerBytes = text.encode(JSON.stringify({ format: FORMAT, version: pack.formatVersion, revision: pack.revision, seeds: pack.seeds, sections } satisfies PackHeader));
    settled = headerBytes.byteLength === headerLength;
    headerLength = headerBytes.byteLength;
  }
  const last = sections[sections.length - 1]!;
  const out = new Uint8Array(align(last.offset + last.bytes));
  const view = new DataView(out.buffer);
  out.set(text.encode(MAGIC), 0);
  view.setUint32(8, pack.formatVersion, true);
  view.setUint32(12, headerBytes.byteLength, true);
  out.set(headerBytes, HEADER_OFFSET);
  sections.forEach((section, index) => out.set(parts[index]!.data, section.offset));
  out.set(hexBytes(sha256Hex(out.subarray(HEADER_OFFSET))), 16);
  return out;
}

const hexBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g)!, pair => parseInt(pair, 16));

// ------------------------------------------------------------------ load

const fail = (message: string): never => { throw new Error(`Server world pack: ${message}`); };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Reads and checks only the header: enough to tell a stale or foreign pack without hashing it. */
export function readServerWorldPackHeader(bytes: Uint8Array): { version: number; revision: string; seeds: number[] } {
  const header = parseHeader(bytes);
  return { version: header.version, revision: header.revision, seeds: header.seeds };
}

function parseHeader(bytes: Uint8Array): PackHeader {
  if (bytes.byteLength < HEADER_OFFSET || new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC) fail("not a world pack (bad magic)");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(8, true), headerLength = view.getUint32(12, true);
  if (version !== SERVER_WORLD_PACK_VERSION) fail(`format version ${version}, but this server reads version ${SERVER_WORLD_PACK_VERSION}. Rebuild it with npm run world:build.`);
  if (HEADER_OFFSET + headerLength > bytes.byteLength) fail("header runs past the end of the file");
  let header: unknown;
  try { header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(HEADER_OFFSET, HEADER_OFFSET + headerLength))); }
  catch { fail("header is not valid JSON"); }
  if (!isRecord(header) || header.format !== FORMAT || header.version !== version || typeof header.revision !== "string"
    || !Array.isArray(header.seeds) || header.seeds.length === 0 || !header.seeds.every(Number.isSafeInteger) || !Array.isArray(header.sections)) return fail("header is malformed");
  const names = new Set<string>();
  for (const section of header.sections as unknown[]) {
    if (!isRecord(section) || typeof section.name !== "string" || !["json", "f32", "f64", "u8"].includes(section.type as string)
      || !Number.isSafeInteger(section.offset) || !Number.isSafeInteger(section.bytes)) return fail("section table is malformed");
    const { name, offset, bytes: length, type } = section as unknown as SectionEntry;
    if (names.has(name)) fail(`section ${name} appears twice`);
    names.add(name);
    if (offset < HEADER_OFFSET + headerLength || length < 0 || offset + length > bytes.byteLength || offset % 8 !== 0) fail(`section ${name} lies outside the file or is misaligned`);
    if (length % ({ json: 1, u8: 1, f32: 4, f64: 8 })[type] !== 0) fail(`section ${name} has a partial element`);
  }
  return header as unknown as PackHeader;
}

/**
 * Validates a pack and exposes its contents. Typed sections are views over `bytes`, so keep `bytes` unchanged
 * while the pack is in use. Throws with a plain message on a wrong version, a damaged file or a malformed section.
 */
export function loadServerWorldPack(bytes: Uint8Array): ServerWorldPack {
  const header = parseHeader(bytes);
  const stored = [...bytes.subarray(16, 48)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (sha256Hex(bytes.subarray(HEADER_OFFSET)) !== stored) fail("integrity hash does not match. The file is damaged or was cut short.");
  const sections = new Map(header.sections.map(section => [section.name, section]));
  const section = (name: string, type: SectionType): Uint8Array => {
    const found = sections.get(name);
    if (!found || found.type !== type) return fail(`section ${name} (${type}) is missing`);
    return bytes.subarray(found.offset, found.offset + found.bytes);
  };
  // A view needs the element size to divide its absolute address. A Buffer from a pool may not line up, so copy then.
  const floats = <T extends Float32Array | Float64Array>(name: string, type: "f32" | "f64", Array: { new(buffer: ArrayBufferLike, offset: number, length: number): T; BYTES_PER_ELEMENT: number }): T => {
    const raw = section(name, type), size = Array.BYTES_PER_ELEMENT;
    const aligned = raw.byteOffset % size === 0 ? raw : raw.slice();
    const values = new Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / size);
    for (let index = 0; index < values.length; index++) if (!Number.isFinite(values[index])) fail(`section ${name} holds a non-finite number`);
    return values;
  };
  const json = (name: string): unknown => { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(section(name, "json"))); } catch (error) { return fail(`section ${name} is not valid JSON (${String(error)})`); } };

  const world = json("world");
  if (!isRecord(world) || !isRecord(world.assets)) return fail("section world is malformed");
  const grid = (meta: unknown, name: string): HeightGrid => {
    if (!isRecord(meta) || ![meta.cols, meta.rows].every(value => Number.isSafeInteger(value) && (value as number) > 0)
      || ![meta.minX, meta.minZ, meta.stepX, meta.stepZ].every(finite) || !((meta.stepX as number) > 0) || !((meta.stepZ as number) > 0)) return fail(`grid ${name} is malformed`);
    const heights = floats(name, "f32", Float32Array);
    if (heights.length !== (meta.cols as number) * (meta.rows as number)) fail(`grid ${name} has ${heights.length} heights for ${meta.cols} x ${meta.rows}`);
    return { ...(meta as unknown as GridMeta), heights };
  };
  const terrain = (seed: number, maps: unknown, map: "main" | "fairy"): TerrainSamplerData => {
    const meta = isRecord(maps) ? maps[map] : null, name = `seed/${seed}/terrain/${map}`;
    if (!isRecord(meta) || !isRecord(meta.bounds) || !Array.isArray(meta.regions) || !Array.isArray(meta.waterBodies) || !Array.isArray(meta.roads)) return fail(`${name} is malformed`);
    const data = { ...(meta as unknown as TerrainMeta), lattice: grid(meta.lattice, `${name}/lattice`), coastGrid: meta.coastGrid ? grid(meta.coastGrid, `${name}/coast`) : null };
    try { new TerrainSampler(data); } catch (error) { fail(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
    return data;
  };
  for (const [id, measure] of Object.entries(world.assets)) if (!isRecord(measure) || !isRecord(measure.size) || ![measure.size.x, measure.size.y, measure.size.z].every(finite)) fail(`asset ${id} has no size`);

  const worlds = new Map<number, PackedSeedWorld>();
  for (const seed of header.seeds) {
    const data = json(`seed/${seed}/world`);
    if (!isRecord(data) || !Array.isArray(data.coastalSpawns) || !Array.isArray(data.solids) || !Array.isArray(data.structureBounds) || !isRecord(data.trees) || !isRecord(data.nav)) return fail(`seed ${seed} is malformed`);
    for (const solid of data.solids as unknown[]) if (!isRecord(solid) || typeof solid.id !== "string" || !["box", "cylinder"].includes(solid.kind as string) || !Array.isArray(solid.position) || !solid.position.every(finite)) fail(`seed ${seed} holds a malformed solid`);
    const table = data.trees as unknown as TreeTable, numbers = floats(`seed/${seed}/trees`, "f64", Float64Array);
    const columns = [table.ids, table.resource, table.region, table.asset], lookups = [table.resourceIds, table.regionIds, table.assetIds];
    if (![...columns, ...lookups].every(Array.isArray) || columns.some(column => column.length !== table.ids.length) || numbers.length !== table.ids.length * TREE_COLUMNS) fail(`seed ${seed} tree table is malformed`);
    const lookup = (values: string[], index: number): string => { const value = values[index]; return typeof value === "string" ? value : fail(`seed ${seed} tree table points outside its lookup`); };
    const trees = table.ids.map((id, index): ForestTreeDescriptor => {
      const at = index * TREE_COLUMNS;
      return { id, resourceId: lookup(table.resourceIds, table.resource[index]!), regionId: lookup(table.regionIds, table.region[index]!) as ForestTreeDescriptor["regionId"],
        position: [numbers[at]!, numbers[at + 1]!, numbers[at + 2]!] as Vec3, assetId: lookup(table.assetIds, table.asset[index]!),
        scale: numbers[at + 3]!, rotationY: numbers[at + 4]!, trunkRadius: numbers[at + 5]! };
    });
    const nav = data.nav as Record<string, unknown>;
    if (!["solo", "tiled"].includes(nav.strategy as string) || ![nav.sourceMeshes, nav.sourceTriangles, nav.polyCount].every(finite)) fail(`seed ${seed} navigation is malformed`);
    const navData = section(`seed/${seed}/navmesh`, "u8");
    if (navData.byteLength === 0) fail(`seed ${seed} has an empty navmesh`);
    worlds.set(seed, { terrain: { main: terrain(seed, data.terrain, "main"), fairy: terrain(seed, data.terrain, "fairy") }, coastalSpawns: data.coastalSpawns as CoastalSpawnSites, solids: data.solids as SolidVolume[], structureBounds: data.structureBounds as Bounds3[], trees,
      nav: { ...(nav as unknown as Omit<PackedNavigation, "navData">), navData } });
  }
  return { formatVersion: header.version, revision: header.revision, seeds: header.seeds,
    assets: world.assets as Record<string, AssetMeasure>, worlds };
}

// ------------------------------------------------------------------ boot

/**
 * Builds the authored world from a pack. Entities, habitats and creature placement are computed here
 * from the installed catalog and `seed`. A seed the pack was not baked for is refused: the seed shapes
 * the roads, the ground under them, and where solid things stand, and the navmesh was carved around all of it.
 */
export async function createPackedWorld(pack: ServerWorldPack, seed: number): Promise<HeadlessWorldPorts> {
  const world = pack.worlds.get(seed);
  if (!world) throw new Error(`Server world pack: no world for seed ${seed}. This pack holds seed${pack.seeds.length === 1 ? "" : "s"} ${pack.seeds.join(", ")}. `
    + `Set the world's seed to one of those, or bake the pack again with --seeds ${[...pack.seeds, seed].join(",")}.`);
  await Navigation.initLibrary();
  const fairy = new TerrainSampler(world.terrain.fairy);
  const terrains: AssemblyTerrains = { main: new TerrainSampler(world.terrain.main), fairy, fairyExtent: fairy.getExtent() };
  const measurements = assetMeasurements(id => Object.hasOwn(pack.assets, id) ? pack.assets[id] : undefined);
  const semantic = buildAuthoredSemantic(seed, terrains, measurements, world.coastalSpawns);
  const nav = new Navigation();
  nav.importNavData(world.nav.navData, world.nav);
  // Each world gets its own copies of what the simulation may hold on to. The pack stays as loaded, so several worlds can boot from it.
  return assembleAuthoredWorld(seed, terrains, measurements, semantic,
    { nav, solids: structuredClone(world.solids), structureBounds: world.structureBounds, trees: world.trees.map(tree => ({ ...tree, position: [...tree.position] as Vec3 })) });
}
