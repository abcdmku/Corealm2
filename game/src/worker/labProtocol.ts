import { EQUIP_SLOTS, SKILL_IDS, type EquipSlot, type SemanticEntity, type SkillId, type Vec3 } from "../contracts.js";
import type { HabitatDef } from "../content/worldHabitats.js";
import type { RouteEdge, RouteNode } from "../systems/navigation.js";
import type { SolidVolume } from "../contracts.js";
import type { DungeonDoorBarrier } from "../world/dungeonDoors.js";
import type { DungeonSpec } from "../world/dungeonLayout.js";
import type { KnownLocation } from "../world/entities.js";
import type { ForestTreeDescriptor } from "../world/forestResources.js";
import type { TerrainSamplerData } from "../world/terrainSampler.js";
import type { AssetMeasure } from "../multiplayer/worldAssembly.js";
import type { LabRuntimeFixture } from "../featureLab/labSpec.js";

/**
 * The lab half of local play's debug channel: what `window.__featureLab` and the lab fixtures ask of
 * the world a lab worker holds.
 *
 * Two kinds of message cross here. `LabWorldData` is the description of the lab world: the page
 * builds the scene, so only it knows the drawn ground, the navmesh over the structure's triangles,
 * the collision of loaded models and where a fixture's entities stand on all of that. It is plain
 * data (typed arrays and JSON) and the big arrays are transferred, not copied. `LabOp` is an
 * operation on the running world, in the `lab.*` namespace of the debug channel: validated here,
 * applied between ticks, answered after the update that carries its effect.
 *
 * This module imports no content and nothing from the host, so both sides can load it first.
 */

/** A baked Detour mesh, as `Navigation.exportNavData` writes it. The same shape the server world pack carries. */
export interface LabNavigation { navData: Uint8Array; strategy: "solo" | "tiled"; sourceMeshes: number; sourceTriangles: number; polyCount: number }
export interface LabBounds { min: Vec3; max: Vec3 }

/** Everything about the lab world that comes from the scene. The worker builds its `HeadlessWorldPorts` from this and the spec. */
export interface LabWorldData {
  /** The drawn ground of the yard, exactly as `WorldScene.meshHeightAt` answers it. */
  terrain: TerrainSamplerData;
  /** The fairy realm's ground, when the lab has one. A point inside its extent is grounded there. */
  fairyTerrain: TerrainSamplerData | null;
  /** The cave whose floor is the height authority inside its region. */
  dungeon: DungeonSpec | null;
  nav: LabNavigation;
  routeNodes: RouteNode[];
  routeEdges: RouteEdge[];
  knownLocations: KnownLocation[];
  solids: SolidVolume[];
  /** Imported walk surfaces (floors, stairs, bridges) whose navmesh height survives terrain grounding. */
  surfaceBounds: LabBounds[];
  doorBarriers: DungeonDoorBarrier[];
  habitats: HabitatDef[];
  /** Every entity of the lab world except static scenery, which the page keeps to itself. */
  entities: SemanticEntity[];
  /** The forest fixture's trees, from the scatter callbacks. They become entities near a player, as in the authored world. */
  trees: ForestTreeDescriptor[];
  spawn: { position: Vec3; regionId: string; facingRad: number };
  /** Manifest measurements of every asset, so a fixture the worker hosts grounds a model the way the page would. */
  assets: Record<string, AssetMeasure>;
  /** What a fixture the worker hosts needs of the page's assembly, as JSON: the agility course's lanes and entities. */
  fixtureData: { agility?: unknown };
}

/** A change to the lab world while it runs: a new structure, an environment showcase. Absent fields stay as they are. */
export interface LabWorldPatch {
  nav?: LabNavigation;
  solids?: SolidVolume[];
  surfaceBounds?: LabBounds[];
  removeEntities?: string[];
  addEntities?: SemanticEntity[];
}

export type LabAction = "attack" | "cast" | "flee" | "reset-player" | "awaken-altar" | "open-bank" | "reset-bank";

export type LabOp =
  /** The character a lab starts with. Run once, after the join. */
  | { op: "lab.init" }
  | { op: "lab.world"; patch: LabWorldPatch }
  /** Replace the lab's one target actor. The page built the entity, because its grounding needs asset measurements. */
  | { op: "lab.spawnTarget"; entity: SemanticEntity; replaces: string | null }
  | { op: "lab.setLevel"; skill: SkillId; level: number }
  | { op: "lab.equip"; slot: EquipSlot; itemId: string | null }
  | { op: "lab.resetPlayer"; position?: Vec3; facingRad?: number }
  | { op: "lab.resetBank" }
  | { op: "lab.awakenAltar" }
  /** Entities a render-side fixture places and removes: the creature gallery, the presentation and environment showcases. */
  | { op: "lab.entities"; remove: string[]; add: SemanticEntity[] }
  | { op: "lab.moveEntity"; entityId: string; position: Vec3; rotationY?: number }
  /** A fixture's switch on one entity: a dungeon door locked, sealed, closed, unbarred or open. */
  | { op: "lab.setEntityState"; entityId: string; state: string }
  /** One method of a fixture the worker hosts. Arguments and result are JSON. */
  | { op: "lab.call"; fixture: LabRuntimeFixture; method: string; args: unknown[] }
  /** What the page cannot see of the simulation: the target's AI runtime. */
  | { op: "lab.view"; targetId: string | null }
  /** Run `ticks` ticks of 100 ms and replicate once at the end. A lab that skips time needs no frames in between. */
  | { op: "lab.skipTicks"; ticks: number };

export type LabOpName = LabOp["op"];
export const isLabOp = (value: unknown): boolean => typeof value === "object" && value !== null && typeof (value as { op?: unknown }).op === "string" && (value as { op: string }).op.startsWith("lab.");

/** One call may not hold the world for longer than this many ticks: an hour of play. */
export const MAX_SKIP_TICKS = 36_000;
const MAX_COORDINATE = 100_000;
const MAX_ENTITIES = 8192;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const id = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= 256;
const vec3 = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every(n => finite(n) && Math.abs(n) <= MAX_COORDINATE);
const entity = (value: unknown): value is SemanticEntity => isRecord(value) && id(value.id) && typeof value.archetype === "string" && typeof value.name === "string"
  && id(value.regionId) && vec3(value.position) && typeof value.state === "string" && Array.isArray(value.interactions) && value.interactions.every(verb => typeof verb === "string");
const entities = (value: unknown): value is SemanticEntity[] => Array.isArray(value) && value.length <= MAX_ENTITIES && value.every(entity);
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.length <= MAX_ENTITIES && value.every(id);
const bounds = (value: unknown): value is LabBounds[] => Array.isArray(value) && value.every(box => isRecord(box) && vec3(box.min) && vec3(box.max));
const solids = (value: unknown): value is SolidVolume[] => Array.isArray(value) && value.every(solid => isRecord(solid) && id(solid.id) && vec3(solid.position)
  && (solid.kind === "box" ? Array.isArray(solid.size) && solid.size.length === 3 && solid.size.every(finite) && finite(solid.rotationY)
    : solid.kind === "cylinder" && finite(solid.radius) && finite(solid.height)));
const navigation = (value: unknown): value is LabNavigation => isRecord(value) && value.navData instanceof Uint8Array && value.navData.byteLength > 0
  && (value.strategy === "solo" || value.strategy === "tiled") && finite(value.sourceMeshes) && finite(value.sourceTriangles) && finite(value.polyCount);
const grid = (value: unknown): boolean => isRecord(value) && value.heights instanceof Float32Array && Number.isSafeInteger(value.cols) && Number.isSafeInteger(value.rows)
  && (value.cols as number) >= 2 && (value.rows as number) >= 2 && value.heights.length === (value.cols as number) * (value.rows as number)
  && [value.minX, value.minZ, value.stepX, value.stepZ].every(finite);
const rect = (value: unknown): boolean => isRecord(value) && [value.minX, value.maxX, value.minZ, value.maxZ].every(finite);
const terrain = (value: unknown): value is TerrainSamplerData => isRecord(value) && rect(value.bounds) && grid(value.lattice)
  && (value.coast === null ? value.coastGrid === null : isRecord(value.coast) && finite(value.coast.collar) && finite(value.coast.seaLevel) && grid(value.coastGrid))
  && Array.isArray(value.regions) && value.regions.length >= 1 && value.regions.every(region => isRecord(region) && id(region.regionId) && rect(region.rect))
  && Array.isArray(value.waterBodies) && Array.isArray(value.roads);

/** Shape only. Throws with the reason, which refuses the worker start or rejects the operation. */
export function labWorldData(value: unknown): LabWorldData {
  const bad = (message: string): never => { throw new Error(`Invalid lab world data: ${message}`); };
  if (!isRecord(value)) return bad("the world data is an object");
  if (!terrain(value.terrain)) bad("terrain must be terrain sampler data with a height lattice");
  if (value.fairyTerrain !== null && !terrain(value.fairyTerrain)) bad("fairyTerrain must be terrain sampler data or null");
  if (value.dungeon !== null && !(isRecord(value.dungeon) && id(value.dungeon.regionId) && Array.isArray(value.dungeon.chambers) && Array.isArray(value.dungeon.corridors))) bad("dungeon must be a dungeon spec or null");
  if (!navigation(value.nav)) bad("nav must be {navData: Uint8Array, strategy, sourceMeshes, sourceTriangles, polyCount}");
  if (!Array.isArray(value.routeNodes) || !value.routeNodes.every(node => isRecord(node) && id(node.id) && vec3(node.position))) bad("routeNodes must be route nodes");
  if (!Array.isArray(value.routeEdges) || !value.routeEdges.every(edge => isRecord(edge) && id(edge.from) && id(edge.to))) bad("routeEdges must be route edges");
  if (!Array.isArray(value.knownLocations) || !value.knownLocations.every(place => isRecord(place) && id(place.id) && vec3(place.position))) bad("knownLocations must be known locations");
  if (!solids(value.solids)) bad("solids must be box or cylinder volumes");
  if (!bounds(value.surfaceBounds)) bad("surfaceBounds must be {min, max} boxes");
  if (!Array.isArray(value.doorBarriers) || !value.doorBarriers.every(door => isRecord(door) && id(door.id) && vec3(door.position) && Array.isArray(door.size) && finite(door.rotationY))) bad("doorBarriers must be door barriers");
  if (!Array.isArray(value.habitats) || !value.habitats.every(habitat => isRecord(habitat) && id(habitat.groupId))) bad("habitats must name their spawn group");
  if (!entities(value.entities)) bad("entities must be semantic entities with id, archetype, name, regionId, position, state and interactions");
  if (!Array.isArray(value.trees) || !value.trees.every(tree => isRecord(tree) && id(tree.id) && id(tree.resourceId) && vec3(tree.position) && finite(tree.trunkRadius))) bad("trees must be forest tree descriptors");
  if (!isRecord(value.spawn) || !vec3(value.spawn.position) || !id(value.spawn.regionId) || !finite(value.spawn.facingRad)) bad("spawn must be {position, regionId, facingRad}");
  if (!isRecord(value.fixtureData)) bad("fixtureData must be an object");
  if (!isRecord(value.assets) || !Object.values(value.assets).every(entry => isRecord(entry) && isRecord(entry.size) && finite(entry.size.x) && finite(entry.size.y) && finite(entry.size.z))) bad("assets must map asset ids to their measured size");
  return value as unknown as LabWorldData;
}

function labWorldPatch(value: unknown, bad: (message: string) => never): LabWorldPatch {
  if (!isRecord(value)) return bad("patch must be an object");
  if (value.nav !== undefined && !navigation(value.nav)) bad("patch.nav must be a baked navmesh");
  if (value.solids !== undefined && !solids(value.solids)) bad("patch.solids must be box or cylinder volumes");
  if (value.surfaceBounds !== undefined && !bounds(value.surfaceBounds)) bad("patch.surfaceBounds must be {min, max} boxes");
  if (value.removeEntities !== undefined && !ids(value.removeEntities)) bad("patch.removeEntities must be entity ids");
  if (value.addEntities !== undefined && !entities(value.addEntities)) bad("patch.addEntities must be semantic entities");
  return value as LabWorldPatch;
}

const ACTIONS: readonly string[] = ["attack", "cast", "flee", "reset-player", "awaken-altar", "open-bank", "reset-bank"];
export const isLabAction = (value: unknown): value is LabAction => typeof value === "string" && ACTIONS.includes(value);
const FIXTURES: readonly string[] = ["agility", "doors", "progression", "gameplay", "regionalTier", "creatureLoot", "hunt"];

/** Shape only, at the worker boundary. Whether the skill, item or entity exists is the host's to answer. */
export function labOp(value: unknown): LabOp {
  const bad = (message: string): never => { throw new Error(`Invalid lab operation: ${message}`); };
  if (!isRecord(value) || typeof value.op !== "string") return bad("an operation is an object with an op name");
  const input = value as Record<string, unknown> & { op: string };
  switch (input.op) {
    case "lab.init": case "lab.resetBank": case "lab.awakenAltar": return { op: input.op };
    case "lab.world": return { op: "lab.world", patch: labWorldPatch(input.patch, bad) };
    case "lab.spawnTarget":
      if (!entity(input.entity)) bad("entity must be a semantic entity");
      if (input.replaces !== null && !id(input.replaces)) bad("replaces must be an entity id or null");
      return { op: "lab.spawnTarget", entity: input.entity as SemanticEntity, replaces: input.replaces as string | null };
    case "lab.setLevel":
      if (!(SKILL_IDS as readonly unknown[]).includes(input.skill)) bad(`skill must be one of ${SKILL_IDS.join(", ")}`);
      if (!finite(input.level)) bad("level must be a number");
      return { op: "lab.setLevel", skill: input.skill as SkillId, level: Math.max(1, Math.min(99, Math.floor(input.level as number))) };
    case "lab.equip":
      if (!(EQUIP_SLOTS as readonly unknown[]).includes(input.slot)) bad(`slot must be one of ${EQUIP_SLOTS.join(", ")}`);
      if (input.itemId !== null && !id(input.itemId)) bad("itemId must be an item id or null");
      return { op: "lab.equip", slot: input.slot as EquipSlot, itemId: input.itemId as string | null };
    case "lab.resetPlayer":
      if (input.position !== undefined && !vec3(input.position)) bad("position must be [x, y, z] in metres");
      if (input.facingRad !== undefined && !finite(input.facingRad)) bad("facingRad must be a number");
      return { op: "lab.resetPlayer", ...(input.position === undefined ? {} : { position: input.position as Vec3 }), ...(input.facingRad === undefined ? {} : { facingRad: input.facingRad as number }) };
    case "lab.entities":
      if (!ids(input.remove)) bad("remove must be entity ids");
      if (!entities(input.add)) bad("add must be semantic entities");
      return { op: "lab.entities", remove: input.remove as string[], add: input.add as SemanticEntity[] };
    case "lab.moveEntity":
      if (!id(input.entityId)) bad("entityId must be an entity id");
      if (!vec3(input.position)) bad("position must be [x, y, z] in metres");
      if (input.rotationY !== undefined && !finite(input.rotationY)) bad("rotationY must be a number");
      return { op: "lab.moveEntity", entityId: input.entityId as string, position: input.position as Vec3, ...(input.rotationY === undefined ? {} : { rotationY: input.rotationY as number }) };
    case "lab.setEntityState":
      if (!id(input.entityId)) bad("entityId must be an entity id");
      if (typeof input.state !== "string" || !/^[a-z][a-z_-]{0,31}$/.test(input.state)) bad("state must be a state name");
      return { op: "lab.setEntityState", entityId: input.entityId as string, state: input.state as string };
    case "lab.call":
      if (typeof input.fixture !== "string" || !FIXTURES.includes(input.fixture)) bad(`fixture must be one of ${FIXTURES.join(", ")}`);
      if (typeof input.method !== "string" || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(input.method)) bad("method must be a method name");
      if (!Array.isArray(input.args) || input.args.length > 8) bad("args must be a list of at most 8 values");
      return { op: "lab.call", fixture: input.fixture as LabRuntimeFixture, method: input.method as string, args: input.args as unknown[] };
    case "lab.view":
      if (input.targetId !== null && !id(input.targetId)) bad("targetId must be an entity id or null");
      return { op: "lab.view", targetId: input.targetId as string | null };
    case "lab.skipTicks":
      if (!Number.isSafeInteger(input.ticks) || (input.ticks as number) < 1 || (input.ticks as number) > MAX_SKIP_TICKS) bad(`ticks must be an integer from 1 to ${MAX_SKIP_TICKS}`);
      return { op: "lab.skipTicks", ticks: input.ticks as number };
    default: return bad(`unknown op ${JSON.stringify(input.op.slice(0, 64))}`);
  }
}

/** The big arrays of a world description, so a caller can hand them over instead of copying them. */
export function labTransferables(data: { terrain?: TerrainSamplerData; fairyTerrain?: TerrainSamplerData | null; nav?: LabNavigation }): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const add = (view: { buffer: ArrayBufferLike } | null | undefined): void => { if (view && view.buffer instanceof ArrayBuffer) buffers.add(view.buffer); };
  for (const sampler of [data.terrain, data.fairyTerrain]) { add(sampler?.lattice.heights); add(sampler?.coastGrid?.heights); }
  add(data.nav?.navData);
  return [...buffers];
}
