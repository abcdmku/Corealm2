import type { EncounterDefinition, ResourcePlacement, WorldPlacement } from "../../../../game/src/content/schema/encounters.js";
import type { WorldRegionGeometry } from "../../../../game/src/content/schema/worldRegions.js";
import { placementAnchors } from "../../../../game/src/content/worldCompiler.js";
import { WORLD_MAP_IMAGE_BOUNDS } from "../../../../game/src/generated/worldMapFingerprint.js";
import type { ContentRow } from "../../model/contracts.js";
import { setPath, type Path } from "../../model/draft.js";

/*
  The world draft and everything derived from it. Four editable collections travel together
  because one map edit (adding a spawn, detaching an encounter) touches more than one file.
  Coordinates are `[x, z]` metres; the map image is north-up with +z north, so the SVG draws
  y = -z. Region-owned things are addressed as `<collection>:<regionId>/<id>`.
*/

export type Point = [number, number];
export type Region = WorldRegionGeometry;
export type Settlement = Region["settlements"][number];
export type Location = Region["locations"][number];
export type Landmark = Region["landmarks"][number];
export type Gate = Region["gates"][number];
export type Obstacle = Region["obstacles"][number];
export type Station = Region["stations"][number];
export type Building = Settlement["buildings"][number];
export type Shop = Settlement["shops"][number];
export type Bank = Settlement["bank"];
export type NpcStand = Settlement["npcs"][number];

export interface Draft {
  worldRegions: Region[];
  placements: WorldPlacement[];
  encounters: EncounterDefinition[];
  resourcePlacements: ResourcePlacement[];
}
export const DRAFT_COLLECTIONS = ["worldRegions", "placements", "encounters", "resourcePlacements"] as const;
export type DraftCollection = typeof DRAFT_COLLECTIONS[number];

export const LAYERS = ["regions", "roads", "locations", "settlements", "npcs", "landmarks", "gates", "obstacles", "spawns", "resources"] as const;
export type Layer = typeof LAYERS[number];
export const LAYER_LABEL: Record<Layer, string> = { regions: "Regions", roads: "Roads", locations: "Locations", settlements: "Settlements", npcs: "NPCs", landmarks: "Landmarks", gates: "Gates", obstacles: "Obstacles", spawns: "Spawns", resources: "Resource nodes" };

export type Kind = "region" | "location" | "landmark" | "gate" | "obstacle" | "npc" | "building" | "station" | "shop" | "bank" | "placement" | "resource";
export interface Selection { kind: Kind; id: string; regionId?: string }

export const round = (value: number, places = 2): number => { const f = 10 ** places; return Math.round(value * f) / f; };
export const titleCase = (value: string): string => value.replace(/[_-]+/g, " ").replace(/^./, c => c.toUpperCase());

// ---------------------------------------------------------------- selection ids

const KIND_COLLECTION: Record<Kind, string> = { region: "worldRegions", location: "locations", landmark: "landmarks", gate: "gates", obstacle: "obstacles", npc: "npcs", building: "buildings", station: "stations", shop: "shops", bank: "bank", placement: "placements", resource: "resourcePlacements" };
const COLLECTION_KIND = new Map(Object.entries(KIND_COLLECTION).map(([kind, collection]) => [collection, kind as Kind]));

/** `placements:redsill_frogs`, `locations:fallowmarch/town_center`, `bank:coldbrace_bank`, `npcs:npc_warden_ilse`. */
export function selectionId(selection: Selection): string {
  const collection = KIND_COLLECTION[selection.kind];
  if (selection.kind === "bank") return `bank:${selection.id}`;
  return selection.regionId && selection.kind !== "region" && selection.kind !== "npc" && selection.kind !== "placement" && selection.kind !== "resource" ? `${collection}:${selection.regionId}/${selection.id}` : `${collection}:${selection.id}`;
}

/** Parse a route id. `encounters:<id>` resolves to the placement that uses it. Returns undefined for unknown ids. */
export function parseSelection(recordId: string | undefined, draft: Draft | undefined): Selection | undefined {
  if (!recordId) return undefined;
  const colon = recordId.indexOf(":");
  const collection = colon < 0 ? "placements" : recordId.slice(0, colon);
  const rest = colon < 0 ? recordId : recordId.slice(colon + 1);
  if (collection === "encounters") {
    const placement = draft?.placements.find(row => row.encounterId === rest);
    return placement ? { kind: "placement", id: placement.id } : undefined;
  }
  if (collection === "bank") {
    const owner = draft?.worldRegions.find(region => region.settlements.some(settlement => settlement.bank.id === rest));
    return owner ? { kind: "bank", id: rest, regionId: owner.id } : undefined;
  }
  const kind = COLLECTION_KIND.get(collection);
  if (!kind) return undefined;
  if (kind === "npc") {
    const owner = draft?.worldRegions.find(region => region.settlements.some(settlement => settlement.npcs.some(npc => npc.id === rest)));
    return { kind, id: rest, regionId: owner?.id };
  }
  const slash = rest.indexOf("/");
  if (slash < 0) {
    if (kind === "region" || kind === "placement" || kind === "resource") return { kind, id: rest };
    // Region-owned id without its region: find the owner.
    const owner = draft?.worldRegions.find(region => findOwned(region, kind, rest) !== undefined);
    return owner ? { kind, id: rest, regionId: owner.id } : undefined;
  }
  return { kind, id: rest.slice(slash + 1), regionId: rest.slice(0, slash) };
}

export const sameSelection = (a: Selection | undefined, b: Selection | undefined): boolean => a?.kind === b?.kind && a?.id === b?.id && (a?.regionId ?? "") === (b?.regionId ?? "");

// ---------------------------------------------------------------- lookups

export function regionById(draft: Draft, id: string | undefined): Region | undefined { return draft.worldRegions.find(region => region.id === id); }

export function findOwned(region: Region, kind: Kind, id: string): unknown {
  switch (kind) {
    case "location": return region.locations.find(row => row.id === id);
    case "landmark": return region.landmarks.find(row => row.id === id);
    case "gate": return region.gates.find(row => row.id === id);
    case "obstacle": return region.obstacles.find(row => row.id === id);
    case "station": return region.settlements.flatMap(settlement => settlement.stations).find(row => row.id === id) ?? region.stations.find(row => row.id === id);
    case "building": return region.settlements.flatMap(settlement => settlement.buildings).find(row => row.id === id);
    case "shop": return region.settlements.flatMap(settlement => settlement.shops).find(row => row.id === id);
    case "bank": return region.settlements.find(settlement => settlement.bank.id === id)?.bank;
    case "npc": return region.settlements.flatMap(settlement => settlement.npcs).find(row => row.id === id);
    default: return undefined;
  }
}

/** Path inside the region record to the owned row, so edits go through `setPath`. */
export function ownedPath(region: Region, kind: Kind, id: string): Path | undefined {
  const index = (rows: readonly { id: string }[] | undefined) => { const i = rows?.findIndex(row => row.id === id) ?? -1; return i < 0 ? undefined : i; };
  const settlementPath = <K extends "stations" | "buildings" | "shops" | "npcs">(key: K) => {
    const settlementIndex = region.settlements.findIndex(settlement => settlement[key].some(row => row.id === id));
    if (settlementIndex < 0) return undefined;
    const rowIndex = index(region.settlements[settlementIndex]![key]);
    return rowIndex === undefined ? undefined : ["settlements", settlementIndex, key, rowIndex] as Path;
  };
  switch (kind) {
    case "location": { const i = index(region.locations); return i === undefined ? undefined : ["locations", i]; }
    case "landmark": { const i = index(region.landmarks); return i === undefined ? undefined : ["landmarks", i]; }
    case "gate": { const i = index(region.gates); return i === undefined ? undefined : ["gates", i]; }
    case "obstacle": { const i = index(region.obstacles); return i === undefined ? undefined : ["obstacles", i]; }
    case "station": return settlementPath("stations") ?? (() => { const i = index(region.stations); return i === undefined ? undefined : ["stations", i]; })();
    case "building": return settlementPath("buildings");
    case "shop": return settlementPath("shops");
    case "bank": { const i = region.settlements.findIndex(settlement => settlement.bank.id === id); return i < 0 ? undefined : ["settlements", i, "bank"]; }
    case "npc": return settlementPath("npcs");
    default: return undefined;
  }
}

export function regionContaining(draft: Draft, point: Point): Region | undefined {
  const inside = draft.worldRegions.find(region => point[0] >= region.bounds.min[0] && point[0] <= region.bounds.max[0] && point[1] >= region.bounds.min[1] && point[1] <= region.bounds.max[1]);
  if (inside) return inside;
  let best: Region | undefined; let bestDistance = Infinity;
  for (const region of draft.worldRegions) {
    const dx = Math.max(region.bounds.min[0] - point[0], 0, point[0] - region.bounds.max[0]);
    const dz = Math.max(region.bounds.min[1] - point[1], 0, point[1] - region.bounds.max[1]);
    const distance = Math.hypot(dx, dz);
    if (distance < bestDistance) { best = region; bestDistance = distance; }
  }
  return best;
}

export function nearestLocation(region: Region, point: Point): Location | undefined {
  let best: Location | undefined; let bestDistance = Infinity;
  for (const location of region.locations) {
    const distance = Math.hypot(location.position[0] - point[0], location.position[1] - point[1]);
    if (distance < bestDistance) { best = location; bestDistance = distance; }
  }
  return best;
}

export function uniqueId(base: string, taken: (id: string) => boolean): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^[^a-z]+/, "") || "new";
  for (let n = 1; n < 10_000; n++) { const id = `${clean}_${n}`; if (!taken(id)) return id; }
  return `${clean}_${Date.now()}`;
}

export function idTaken(draft: Draft, id: string): boolean {
  return draft.placements.some(row => row.id === id) || draft.encounters.some(row => row.id === id) || draft.resourcePlacements.some(row => row.id === id)
    || draft.worldRegions.some(region => region.locations.some(row => row.id === id) || region.landmarks.some(row => row.id === id));
}

/** Anchors as offsets from the centre, for switching a formation to authored. */
export function authoredOffsets(placement: WorldPlacement): { index: number; offset: Point }[] {
  return placementAnchors(placement).map((anchor, index) => ({ index, offset: [round(anchor[0] - placement.centre[0]), round(anchor[1] - placement.centre[1])] }));
}

export function safeAnchors(placement: WorldPlacement): Point[] {
  try { return placementAnchors(placement); } catch { return []; }
}

// ---------------------------------------------------------------- features (what the map and list draw)

export interface Feature {
  /** Selection id; also the DOM key. */
  key: string;
  selection: Selection;
  layer: Layer;
  x: number;
  z: number;
  name: string;
  /** One line for the list and tooltip: region, creature, resource. */
  fact: string;
  regionId: string;
  /** Sub-kind used to pick a glyph: location kind, activity, resource archetype, settlement piece. */
  glyph: string;
  radius?: number;
  rank?: string;
  rotation?: number;
  footprint?: readonly [number, number];
  /** Second point for obstacles (exit) and gates (target). */
  to?: Point;
  /** Region rectangle. */
  bounds?: { min: Point; max: Point };
  /** What this is an instance of (a creature, a resource): the list shows one entry per group with its places under it. */
  group?: { key: string; name: string };
  movable: boolean;
}

export interface Road { key: string; regionId: string; from: Point; to: Point }

export interface Lookups {
  creatureName: (id: string) => string;
  resource: (id: string) => ContentRow | undefined;
  npc: (id: string) => ContentRow | undefined;
}

export function deriveFeatures(draft: Draft, lookups: Lookups): { features: Feature[]; roads: Road[]; byKey: Map<string, Feature>; counts: Record<Layer, number>; encounterUses: Map<string, number> } {
  const features: Feature[] = [];
  const roads: Road[] = [];
  const encounters = new Map(draft.encounters.map(row => [row.id, row]));
  const encounterUses = new Map<string, number>();
  for (const placement of draft.placements) encounterUses.set(placement.encounterId, (encounterUses.get(placement.encounterId) ?? 0) + 1);
  const regionName = (id: string) => draft.worldRegions.find(region => region.id === id)?.name ?? id;
  const point = (p: readonly number[]): Point => [p[0] ?? 0, p[1] ?? 0];

  for (const region of draft.worldRegions) {
    const rid = region.id;
    features.push({ key: `worldRegions:${rid}`, selection: { kind: "region", id: rid }, layer: "regions", x: (region.bounds.min[0] + region.bounds.max[0]) / 2, z: (region.bounds.min[1] + region.bounds.max[1]) / 2, name: region.name, fact: `Tier ${region.tier} · ${region.locations.length} locations`, regionId: rid, glyph: "region", bounds: { min: point(region.bounds.min), max: point(region.bounds.max) }, movable: false });
    const locations = new Map(region.locations.map(row => [row.id, row]));
    for (const location of region.locations) {
      features.push({ key: `locations:${rid}/${location.id}`, selection: { kind: "location", id: location.id, regionId: rid }, layer: "locations", x: location.position[0], z: location.position[1], name: location.name, fact: `${titleCase(location.kind)} · ${region.name}`, regionId: rid, glyph: location.kind, movable: true });
    }
    for (const [index, road] of region.roads.entries()) {
      const from = locations.get(road.from); const to = locations.get(road.to);
      if (from && to) roads.push({ key: `${rid}/${index}`, regionId: rid, from: point(from.position), to: point(to.position) });
    }
    for (const landmark of region.landmarks) {
      features.push({ key: `landmarks:${rid}/${landmark.id}`, selection: { kind: "landmark", id: landmark.id, regionId: rid }, layer: "landmarks", x: landmark.position[0], z: landmark.position[1], name: landmark.name, fact: `${landmark.assetId} · ${region.name}`, regionId: rid, glyph: "landmark", rotation: landmark.rotationY, movable: true });
    }
    for (const gate of region.gates) {
      const target = draft.worldRegions.find(row => row.id === gate.toRegionId);
      const targetLocation = target?.locations.find(row => row.id === gate.toLocationId);
      features.push({ key: `gates:${rid}/${gate.id}`, selection: { kind: "gate", id: gate.id, regionId: rid }, layer: "gates", x: gate.position[0], z: gate.position[1], name: gate.name, fact: `To ${target?.name ?? gate.toRegionId} · ${region.name}`, regionId: rid, glyph: "gate", rotation: gate.rotationY, to: targetLocation ? point(targetLocation.position) : undefined, movable: true });
    }
    for (const obstacle of region.obstacles) {
      features.push({ key: `obstacles:${rid}/${obstacle.id}`, selection: { kind: "obstacle", id: obstacle.id, regionId: rid }, layer: "obstacles", x: obstacle.position[0], z: obstacle.position[1], name: obstacle.name, fact: `${titleCase(obstacle.interaction)} · level ${obstacle.reqLevel} · ${region.name}`, regionId: rid, glyph: obstacle.interaction, to: point(obstacle.exitPosition), rotation: obstacle.rotationY, movable: true });
    }
    for (const station of region.stations) {
      features.push({ key: `stations:${rid}/${station.id}`, selection: { kind: "station", id: station.id, regionId: rid }, layer: "settlements", x: station.position[0], z: station.position[1], name: station.name, fact: `${titleCase(station.kind)} · ${station.skill} · ${region.name}`, regionId: rid, glyph: "station", rotation: station.rotationY, movable: true });
    }
    for (const settlement of region.settlements) {
      for (const building of settlement.buildings) {
        features.push({ key: `buildings:${rid}/${building.id}`, selection: { kind: "building", id: building.id, regionId: rid }, layer: "settlements", x: building.position[0], z: building.position[1], name: building.name, fact: `${titleCase(building.prefab)} · ${settlement.name}`, regionId: rid, glyph: "building", rotation: building.rotationY, footprint: building.footprint, movable: true });
      }
      for (const station of settlement.stations) {
        features.push({ key: `stations:${rid}/${station.id}`, selection: { kind: "station", id: station.id, regionId: rid }, layer: "settlements", x: station.position[0], z: station.position[1], name: station.name, fact: `${titleCase(station.kind)} · ${station.skill} · ${settlement.name}`, regionId: rid, glyph: "station", rotation: station.rotationY, movable: true });
      }
      for (const shop of settlement.shops) {
        features.push({ key: `shops:${rid}/${shop.id}`, selection: { kind: "shop", id: shop.id, regionId: rid }, layer: "settlements", x: shop.position[0], z: shop.position[1], name: shop.name, fact: `${titleCase(shop.shopKind)} shop · ${settlement.name}`, regionId: rid, glyph: "shop", rotation: shop.rotationY, movable: true });
      }
      features.push({ key: `bank:${settlement.bank.id}`, selection: { kind: "bank", id: settlement.bank.id, regionId: rid }, layer: "settlements", x: settlement.bank.position[0], z: settlement.bank.position[1], name: settlement.bank.name, fact: `Bank · ${settlement.name}`, regionId: rid, glyph: "bank", rotation: settlement.bank.rotationY, movable: true });
      for (const stand of settlement.npcs) {
        const npc = lookups.npc(stand.id);
        const role = typeof npc?.role === "string" ? npc.role : "";
        features.push({ key: `npcs:${stand.id}`, selection: { kind: "npc", id: stand.id, regionId: rid }, layer: "npcs", x: stand.position[0], z: stand.position[1], name: String(npc?.name ?? stand.name), fact: role ? role.split(". ")[0]!.slice(0, 60) : settlement.name, regionId: rid, glyph: "npc", rotation: stand.facingRad, movable: true });
      }
    }
  }
  for (const placement of draft.placements) {
    const encounter = encounters.get(placement.encounterId);
    // A creature definition without a name falls back to the encounter's name, which is the only human label it has.
    const creatures = encounter ? encounter.members.map(member => { const label = lookups.creatureName(member.creatureId); return label === member.creatureId && encounter.name ? encounter.name : label; }).join(", ") : placement.encounterId;
    features.push({ key: `placements:${placement.id}`, selection: { kind: "placement", id: placement.id }, layer: "spawns", x: placement.centre[0], z: placement.centre[1], name: encounter?.name ?? titleCase(placement.id), fact: `${creatures} ×${placement.count} · ${regionName(placement.regionId)}`, regionId: placement.regionId, glyph: encounter?.activity ?? "patrol", radius: placement.radius, rank: placement.rank, group: { key: encounter ? encounter.members.map(member => member.creatureId).join("+") : placement.encounterId, name: creatures }, movable: true });
  }
  for (const node of draft.resourcePlacements) {
    const resource = lookups.resource(node.resourceId);
    const archetype = typeof resource?.archetype === "string" ? resource.archetype : "ore";
    features.push({ key: `resourcePlacements:${node.id}`, selection: { kind: "resource", id: node.id }, layer: "resources", x: node.centre[0], z: node.centre[1], name: String(resource?.name ?? titleCase(node.resourceId)), fact: `${titleCase(archetype)} ×${node.count} · ${regionName(node.regionId)}`, regionId: node.regionId, glyph: archetype, radius: node.radius, group: { key: node.resourceId, name: String(resource?.name ?? titleCase(node.resourceId)) }, movable: true });
  }
  const byKey = new Map(features.map(feature => [feature.key, feature]));
  const counts = Object.fromEntries(LAYERS.map(layer => [layer, 0])) as Record<Layer, number>;
  for (const feature of features) counts[feature.layer]++;
  counts.roads = roads.length;
  return { features, roads, byKey, counts, encounterUses };
}

// ---------------------------------------------------------------- draft edits

export function patchPlacement(draft: Draft, id: string, patch: Partial<WorldPlacement>): Draft {
  return { ...draft, placements: draft.placements.map(row => row.id === id ? { ...row, ...patch } : row) };
}
export function patchEncounter(draft: Draft, id: string, patch: Partial<EncounterDefinition>): Draft {
  return { ...draft, encounters: draft.encounters.map(row => row.id === id ? { ...row, ...patch } : row) };
}
export function patchResource(draft: Draft, id: string, patch: Partial<ResourcePlacement>): Draft {
  return { ...draft, resourcePlacements: draft.resourcePlacements.map(row => row.id === id ? { ...row, ...patch } : row) };
}
export function patchRegion(draft: Draft, regionId: string, path: Path, value: unknown): Draft {
  return { ...draft, worldRegions: draft.worldRegions.map(row => row.id === regionId ? setPath(row, path, value) : row) };
}
export function patchOwned(draft: Draft, selection: Selection, path: Path, value: unknown): Draft {
  const region = regionById(draft, selection.regionId);
  const base = region && ownedPath(region, selection.kind, selection.id);
  return region && base ? patchRegion(draft, region.id, [...base, ...path], value) : draft;
}

/** Move whatever is selected to a new point. */
export function moveSelection(draft: Draft, selection: Selection, point: Point): Draft {
  const p: Point = [round(point[0]), round(point[1])];
  switch (selection.kind) {
    case "placement": return patchPlacement(draft, selection.id, { centre: p });
    case "resource": return patchResource(draft, selection.id, { centre: p });
    case "region": return draft;
    case "obstacle": {
      const region = regionById(draft, selection.regionId);
      const obstacle = region?.obstacles.find(row => row.id === selection.id);
      if (!obstacle) return draft;
      const shift: Point = [round(obstacle.exitPosition[0] + p[0] - obstacle.position[0]), round(obstacle.exitPosition[1] + p[1] - obstacle.position[1])];
      return patchOwned(patchOwned(draft, selection, ["position"], p), selection, ["exitPosition"], shift);
    }
    default: return patchOwned(draft, selection, ["position"], p);
  }
}

export function selectionPoint(draft: Draft, selection: Selection): Point | undefined {
  switch (selection.kind) {
    case "placement": { const row = draft.placements.find(r => r.id === selection.id); return row ? [row.centre[0], row.centre[1]] : undefined; }
    case "resource": { const row = draft.resourcePlacements.find(r => r.id === selection.id); return row ? [row.centre[0], row.centre[1]] : undefined; }
    case "region": { const row = regionById(draft, selection.id); return row ? [(row.bounds.min[0] + row.bounds.max[0]) / 2, (row.bounds.min[1] + row.bounds.max[1]) / 2] : undefined; }
    default: {
      const region = regionById(draft, selection.regionId);
      const owned = region && findOwned(region, selection.kind, selection.id) as { position?: readonly number[] } | undefined;
      return owned?.position ? [owned.position[0] ?? 0, owned.position[1] ?? 0] : undefined;
    }
  }
}

export function removeSelection(draft: Draft, selection: Selection): Draft {
  switch (selection.kind) {
    case "placement": {
      const placement = draft.placements.find(row => row.id === selection.id);
      if (!placement) return draft;
      const placements = draft.placements.filter(row => row.id !== selection.id);
      const stillUsed = placements.some(row => row.encounterId === placement.encounterId);
      return { ...draft, placements, encounters: stillUsed ? draft.encounters : draft.encounters.filter(row => row.id !== placement.encounterId) };
    }
    case "resource": return { ...draft, resourcePlacements: draft.resourcePlacements.filter(row => row.id !== selection.id) };
    case "location": case "landmark": case "gate": case "obstacle": {
      const region = regionById(draft, selection.regionId);
      const path = region && ownedPath(region, selection.kind, selection.id);
      return region && path ? patchRegion(draft, region.id, path, undefined) : draft;
    }
    default: return draft;
  }
}

/** Give this placement its own copy of a shared encounter. */
export function detachEncounter(draft: Draft, placementId: string): Draft {
  const placement = draft.placements.find(row => row.id === placementId);
  const encounter = placement && draft.encounters.find(row => row.id === placement.encounterId);
  if (!placement || !encounter) return draft;
  const id = uniqueId(`${encounter.id}`, candidate => idTaken(draft, candidate));
  return patchPlacement({ ...draft, encounters: [...draft.encounters, { ...structuredClone(encounter), id }] }, placementId, { encounterId: id });
}

export function addSpawn(draft: Draft, point: Point, creatureId: string, creatureName: string): { draft: Draft; selection: Selection } | undefined {
  const region = regionContaining(draft, point);
  if (!region) return undefined;
  const id = uniqueId(`${creatureId}_${region.id}`, candidate => idTaken(draft, candidate));
  const centre: Point = [round(point[0]), round(point[1])];
  const seed: WorldPlacement = { id, encounterId: id, regionId: region.id, centre, count: 3, radius: 8, formation: { kind: "grid", spacing: 3, rotation: 0 }, dressing: [] };
  const placement: WorldPlacement = { ...seed, formation: { kind: "authored", spacing: 3, rotation: 0 }, anchorAdjustments: authoredOffsets(seed) };
  const encounter: EncounterDefinition = { id, name: creatureName, activity: "patrol", members: [{ creatureId, weight: 1 }] };
  return { draft: { ...draft, placements: [...draft.placements, placement], encounters: [...draft.encounters, encounter] }, selection: { kind: "placement", id } };
}

export function addResourceNode(draft: Draft, point: Point, resourceId: string): { draft: Draft; selection: Selection } | undefined {
  const region = regionContaining(draft, point);
  if (!region) return undefined;
  const id = uniqueId(`${resourceId}_${region.id}`, candidate => idTaken(draft, candidate));
  const location = nearestLocation(region, point);
  const node: ResourcePlacement = { id, resourceId, count: 4, centre: [round(point[0]), round(point[1])], radius: 6, locationId: location?.id ?? "", regionId: region.id };
  return { draft: { ...draft, resourcePlacements: [...draft.resourcePlacements, node] }, selection: { kind: "resource", id } };
}

export function addLocation(draft: Draft, point: Point): { draft: Draft; selection: Selection } | undefined {
  const region = regionContaining(draft, point);
  if (!region) return undefined;
  const id = uniqueId(`${region.id}_place`, candidate => idTaken(draft, candidate));
  const location: Location = { id, name: "New location", position: [round(point[0]), round(point[1])], kind: "junction", routeNode: true };
  return { draft: patchRegion(draft, region.id, ["locations", region.locations.length], location), selection: { kind: "location", id, regionId: region.id } };
}

export function addLandmark(draft: Draft, point: Point, assetId: string): { draft: Draft; selection: Selection } | undefined {
  const region = regionContaining(draft, point);
  if (!region) return undefined;
  const id = uniqueId(`${region.id}_${assetId}`, candidate => idTaken(draft, candidate));
  const landmark: Landmark = { id, name: titleCase(assetId), position: [round(point[0]), round(point[1])], assetId, scale: 1, rotationY: 0, blurb: "" };
  return { draft: patchRegion(draft, region.id, ["landmarks", region.landmarks.length], landmark), selection: { kind: "landmark", id, regionId: region.id } };
}

// ---------------------------------------------------------------- bounds

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

/** Everything, including the regions that sit outside the rendered image. */
export function worldBounds(draft: Draft | undefined): Bounds {
  const bounds: Bounds = { ...WORLD_MAP_IMAGE_BOUNDS };
  for (const region of draft?.worldRegions ?? []) {
    bounds.minX = Math.min(bounds.minX, region.bounds.min[0]); bounds.maxX = Math.max(bounds.maxX, region.bounds.max[0]);
    bounds.minZ = Math.min(bounds.minZ, region.bounds.min[1]); bounds.maxZ = Math.max(bounds.maxZ, region.bounds.max[1]);
  }
  return bounds;
}

export function regionBounds(region: Region): Bounds { return { minX: region.bounds.min[0], maxX: region.bounds.max[0], minZ: region.bounds.min[1], maxZ: region.bounds.max[1] }; }
