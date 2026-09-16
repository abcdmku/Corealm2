import type { ContentRow } from "../../model/contracts.js";
import type { ReferenceIndex } from "../../model/refs.js";
import { contentRows } from "../../model/rows.js";
import type { MapPoint } from "../../ui/PointsMap.js";
import { asRecord, list, num, text } from "./shared.js";

/*
  Where things are in the world, read out of the world file and the placement tables, so a quest,
  an NPC or a shop can put its places on a map:

    npc      the NPC's stand in its settlement (or its location when it has no stand)
    shop     the shop's stand
    location a route location, overworld or dungeon
    entity   a landmark, gate, obstacle or dungeon door
    gather   the resource placements that yield an item
    kill     the spawn placements whose encounter has a creature of a family

  Resolved once per reference index and cached on it.
*/

export interface Place { id: string; x: number; z: number; label: string; regionId: string; radius?: number; /** World map route for this place. */ target: string }

interface Places {
  npcs: Map<string, Place>;
  shops: Map<string, Place>;
  locations: Map<string, Place>;
  entities: Map<string, Place>;
  /** Item id → resource placements that yield it. */
  itemSources: Map<string, Place[]>;
  /** Creature family → spawn placements with a member of that family. */
  familySpawns: Map<string, Place[]>;
}

const cache = new WeakMap<ReferenceIndex, Places>();

const point = (value: unknown): { x: number; z: number } | undefined => {
  const pair = list(value);
  return typeof pair[0] === "number" && typeof pair[1] === "number" ? { x: pair[0], z: pair[1] } : undefined;
};

const rows = (index: ReferenceIndex, name: string): ContentRow[] => { const response = index.collections.get(name); return response ? contentRows(response) : []; };

function build(index: ReferenceIndex): Places {
  const places: Places = { npcs: new Map(), shops: new Map(), locations: new Map(), entities: new Map(), itemSources: new Map(), familySpawns: new Map() };
  const put = (map: Map<string, Place>, row: ContentRow, regionId: string, layer: string | undefined) => {
    const id = text(row.id), at = point(row.position);
    if (!id || !at || map.has(id)) return;
    const target = layer === "npcs" ? `npcs:${id}` : layer ? `${layer}:${regionId}/${id}` : `worldRegions:${regionId}`;
    map.set(id, { id, ...at, label: text(row.name) ?? id, regionId, target });
  };

  for (const region of rows(index, "worldRegions")) {
    const regionId = String(region.id);
    const dungeon = asRecord(region.dungeon);
    for (const location of list(region.locations).map(asRecord)) put(places.locations, location, regionId, "locations");
    for (const layer of ["landmarks", "gates", "obstacles"]) for (const entity of list(region[layer]).map(asRecord)) put(places.entities, entity, regionId, layer);
    // Dungeon places are not on the overworld map layers; they open their region.
    for (const location of list(dungeon.locations).map(asRecord)) put(places.locations, location, regionId, undefined);
    for (const entity of [...list(dungeon.doors), ...list(dungeon.obstacles)].map(asRecord)) put(places.entities, entity, regionId, undefined);
    const settlement = asRecord(region.settlement);
    for (const npc of list(settlement.npcs).map(asRecord)) put(places.npcs, npc, regionId, "npcs");
    for (const shop of list(settlement.shops).map(asRecord)) put(places.shops, shop, regionId, "shops");
  }
  // An NPC without a settlement stand (a fairy on a terrace) is where its location is.
  for (const npc of rows(index, "npcs")) {
    const id = text(npc.id), locationId = text(npc.locationId);
    const location = locationId ? places.locations.get(locationId) : undefined;
    if (id && location && !places.npcs.has(id)) places.npcs.set(id, { ...location, id, label: text(npc.name) ?? id });
  }

  const resources = new Map(rows(index, "resources").map(resource => [String(resource.id), resource]));
  for (const placement of rows(index, "resourcePlacements")) {
    const resource = resources.get(String(placement.resourceId));
    const itemId = text(resource?.itemId);
    const at = point(placement.centre);
    if (!itemId || !at) continue;
    const sources = places.itemSources.get(itemId) ?? [];
    sources.push({ id: String(placement.id), ...at, radius: num(placement.radius), label: text(placement.name) ?? text(resource?.name) ?? String(placement.id).replace(/_/g, " "), regionId: String(placement.regionId ?? ""), target: `resourcePlacements:${String(placement.id)}` });
    places.itemSources.set(itemId, sources);
  }

  // A variant takes its family from its base.
  const creatures = new Map(rows(index, "creatureDefinitions").map(row => [String(row.id), row]));
  const familyOf = (id: string, depth = 0): string | undefined => {
    const row = creatures.get(id);
    return row ? text(row.family) ?? (depth < 4 && text(row.baseId) ? familyOf(String(row.baseId), depth + 1) : undefined) : undefined;
  };
  const encounters = new Map(rows(index, "encounters").map(row => [String(row.id), row]));
  for (const placement of rows(index, "placements")) {
    const encounter = encounters.get(String(placement.encounterId));
    const at = point(placement.centre);
    if (!encounter || !at) continue;
    const families = new Set(list(encounter.members).map(member => familyOf(String(asRecord(member).creatureId))).filter((family): family is string => Boolean(family)));
    for (const family of families) {
      const spawns = places.familySpawns.get(family) ?? [];
      spawns.push({ id: String(placement.id), ...at, radius: num(placement.radius), label: text(encounter.name) ?? String(placement.id), regionId: String(placement.regionId ?? ""), target: `placements:${String(placement.id)}` });
      places.familySpawns.set(family, spawns);
    }
  }
  return places;
}

export function worldPlaces(index: ReferenceIndex): Places {
  let places = cache.get(index);
  if (!places) { places = build(index); cache.set(index, places); }
  return places;
}

/** A spread of sources is narrowed to the quest's region when any are there. */
const near = (candidates: readonly Place[] | undefined, regionId: string | undefined): Place[] => {
  if (!candidates?.length) return [];
  const local = regionId ? candidates.filter(place => place.regionId === regionId) : [];
  return (local.length ? local : candidates).slice(0, 12);
};

/** Where a stage's completion rule sends the player. Nested `all` rules contribute every part. */
export function predicatePlaces(predicate: unknown, index: ReferenceIndex, regionId?: string): Place[] {
  const node = asRecord(predicate);
  const places = worldPlaces(index);
  const radius = num(node.radius);
  const withRadius = (place: Place | undefined): Place[] => place ? [radius ? { ...place, radius } : place] : [];
  switch (text(node.kind)) {
    case "all": return list(node.of).flatMap(child => predicatePlaces(child, index, regionId));
    case "talk": return withRadius(places.npcs.get(text(node.npcId) ?? ""));
    case "reach": case "visit": return withRadius(places.locations.get(text(node.locationId) ?? ""));
    case "nearEntity": case "entityState": return withRadius(places.entities.get(text(node.entityId) ?? ""));
    case "traverse": return withRadius(places.entities.get(text(node.obstacleId) ?? ""));
    case "gather": case "deplete": return near(places.itemSources.get(text(node.itemId) ?? ""), regionId);
    case "kill": return near(places.familySpawns.get(text(node.enemyFamily) ?? ""), regionId);
    default: return [];
  }
}

/** Objective refs that name a place (a location or an entity). */
export function refPlaces(refs: unknown, index: ReferenceIndex): Place[] {
  const places = worldPlaces(index);
  return list(refs).map(asRecord).flatMap(ref => {
    const id = text(ref.id) ?? "";
    const place = text(ref.kind) === "location" ? places.locations.get(id) : text(ref.kind) === "entity" ? places.entities.get(id) : undefined;
    return place ? [place] : [];
  });
}

/** Places as map pins, each once. `prefix` numbers them by stage ("2 · Copper Pit"). */
export function pins(places: readonly Place[], prefix?: string): MapPoint[] {
  const seen = new Set<string>();
  return places.filter(place => !seen.has(place.id) && seen.add(place.id)).map(place => ({ id: `${prefix ?? ""}${place.id}`, x: place.x, z: place.z, radius: place.radius, label: prefix ? `${prefix} · ${place.label}` : place.label, target: place.target, mark: prefix && /^\d+$/.test(prefix) ? prefix : undefined }));
}
