import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { DoorOpen, Flag, Footprints, Landmark, MapPin, type LucideIcon } from "lucide-react";
import { REF_KIND_SOURCES, type RefKind, type RefKindSource } from "../../../game/src/content/schema/core.js";
import type { CollectionResponse, CollectionSummary } from "../../shared/contracts.js";
import { collectionQuery, collectionsQuery } from "../api/client.js";
import type { ContentRow } from "./contracts.js";
import { contentRows, rowId, rowName } from "./rows.js";
import { iconForElement, iconForSkill, titleCase, type SummaryContext, type ThumbSpec } from "./summaries.js";

/**
 * Cross references between collections. Schema `ref` kinds and the field names used by compiled
 * catalogs both resolve here, so every id in the app can become a chip that opens its record and
 * every record can list what points at it.
 */
export const REF_COLLECTIONS: Readonly<Record<string, readonly string[]>> = {
  item: ["items", "compiled-items"],
  recipe: ["compiled-recipes", "recipes"],
  resource: ["resources", "compiled-resources"],
  resourceCluster: ["resourcePlacements"],
  enemy: ["creatureDefinitions", "compiled-enemies"],
  species: ["compiled-species", "creatureDefinitions"],
  lootTable: ["lootTables"],
  npc: ["npcs"],
  shop: ["shops"],
  quest: ["quests"],
  dialogue: ["dialogue"],
  spell: ["spells"],
  rune: ["spellRunes", "items"],
  set: ["equipmentSets"],
  asset: ["assets"],
  audio: ["audio"],
  region: ["worldRegions"],
  campfireFuel: ["campfireFuels"],
  material: ["materials"],
  equipmentFamily: ["equipmentFamilies"],
  recipeTemplate: ["recipeTemplates"],
  creatureProfile: ["creatureProfiles"],
  encounter: ["encounters"],
  placement: ["placements"],
};

/** Field names that carry a reference even where no schema metadata is available. */
const KEY_KINDS: Readonly<Record<string, string>> = {
  itemId: "item", rechargeItemId: "item", orbItemId: "item", logItemId: "item", burntItemId: "item", yieldItemId: "item",
  essence: "item", orb: "item", staff: "item", wand: "item", basicStaff: "item", basicWand: "item",
  assetId: "asset", heroAssetId: "asset", depletedAssetId: "asset", visualLogAssetId: "asset", availableAssetIds: "asset",
  regionId: "region", encounterId: "encounter", resourceId: "resource", lootTableId: "lootTable", tableId: "lootTable",
  creatureId: "enemy", baseId: "enemy", enemyId: "enemy", speciesId: "species", profileId: "creatureProfile",
  npcId: "npc", giverNpcId: "npc", questId: "quest", questIds: "quest", prerequisiteQuestIds: "quest",
  dialogueRootId: "dialogue", dialogueNodeId: "dialogue", next: "dialogue", recipeId: "recipe", templateId: "recipeTemplate",
  familyId: "equipmentFamily", campfireFuelId: "campfireFuel", spellId: "spell", shopId: "shop", setId: "set",
  resourceIds: "resource", placementId: "placement", firstActorUsesPlacementId: "placement",
};

const SKIP_KEYS = new Set(["catalog", "source", "sourceInputId", "legacyOverride", "derived", "registrationOrder", "labOrder", "fantasyTierOrder", "lineage", "history", "provenance", "migration", "__compiled", "id", "name", "description", "text", "summary", "hint", "objective", "lore", "role", "voice"]);

export function refKindForKey(key: string): string | undefined {
  return KEY_KINDS[key];
}

/** The collection a kind opens in, given the collections the server actually serves. */
export function refTargetCollection(kind: string, available: ReadonlySet<string> | readonly string[]): string | undefined {
  const names = available instanceof Set ? available : new Set(available);
  return REF_COLLECTIONS[kind]?.find(name => names.has(name));
}

export function refKindForCollection(collection: string): string | undefined {
  const base = collection.replace(/^compiled-/, "");
  for (const [kind, names] of Object.entries(REF_COLLECTIONS)) if (names.includes(collection) || names.includes(base)) return kind;
  return undefined;
}

export interface Reference {
  kind: string;
  targetId: string;
  path: string;
  /** A short human label for what the reference means, derived from the field path. */
  role: string;
}

export interface IncomingReference extends Reference {
  collection: string;
  recordId: string;
  recordName: string;
  record: ContentRow;
}

/** A relationship label guessed from the field path. Prefer the schema `role` meta when the path resolves to one. */
export function roleLabel(path: string): string {
  const parts = path.replace(/\[\d+\]/g, "").split(".").filter(Boolean);
  const key = parts.at(-1) ?? "";
  const parent = parts.at(-2) ?? "";
  const label = (value: string) => value.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/Ids?$/, "").trim().toLowerCase();
  if (key === "itemId" && parent) return label(parent);
  if (parent === "members" || parent === "materials") return `${label(parent)} · ${key}`;
  if (key === "materials") return "material";
  return label(key) || "reference";
}

/** Walk a record and list every id it points at. Record values under `materials`-style maps count too. */
export function outgoingReferences(record: ContentRow): Reference[] {
  const out: Reference[] = [];
  const visit = (value: unknown, path: string, keyKind: string | undefined) => {
    if (typeof value === "string") {
      if (keyKind && value.trim()) out.push({ kind: keyKind, targetId: value, path, role: roleLabel(path) });
      return;
    }
    if (Array.isArray(value)) { value.forEach((entry, index) => visit(entry, `${path}[${index}]`, keyKind)); return; }
    if (value === null || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (SKIP_KEYS.has(key)) continue;
      const next = path ? `${path}.${key}` : key;
      const keyed = key === "materials" || (key === "members" && !Array.isArray(entry));
      if (keyed && entry && typeof entry === "object") {
        for (const [slot, id] of Object.entries(entry as Record<string, unknown>)) if (typeof id === "string") out.push({ kind: key === "materials" ? "material" : "item", targetId: id, path: `${next}.${slot}`, role: `${key === "materials" ? "material" : "set member"} · ${slot}` });
        continue;
      }
      visit(entry, next, KEY_KINDS[key]);
    }
  };
  visit(record, "", undefined);
  return out;
}

export interface ReferenceIndex {
  /** kind → targetId → references. */
  incoming: Map<string, Map<string, IncomingReference[]>>;
  collections: Map<string, CollectionResponse>;
  available: Set<string>;
}

/** Compiled tables whose rows are projections of an authored collection with a different name. */
const COMPILED_SOURCE: Readonly<Record<string, string>> = { "compiled-enemies": "creatureDefinitions", "compiled-species": "creatureDefinitions" };

export function buildReferenceIndex(responses: readonly CollectionResponse[]): ReferenceIndex {
  const incoming = new Map<string, Map<string, IncomingReference[]>>();
  const collections = new Map<string, CollectionResponse>();
  for (const response of responses) {
    collections.set(response.collection.name, response);
    // Compiled catalogs duplicate their authored rows; index only authored sources plus the
    // compiled tables that have no authored counterpart loaded.
    const authoredName = COMPILED_SOURCE[response.collection.name] ?? response.collection.name.replace(/^compiled-/, "");
    if (response.collection.name.startsWith("compiled-") && responses.some(other => other.collection.name === authoredName && contentRows(other).length > 0)) continue;
    const idKey = response.collection.idKey;
    for (const record of contentRows(response)) {
      const recordId = rowId(record, idKey);
      const recordName = rowName(record, idKey);
      for (const reference of outgoingReferences(record)) {
        let byId = incoming.get(reference.kind);
        if (!byId) { byId = new Map(); incoming.set(reference.kind, byId); }
        let list = byId.get(reference.targetId);
        if (!list) { list = []; byId.set(reference.targetId, list); }
        list.push({ ...reference, collection: response.collection.name, recordId, recordName, record });
      }
    }
  }
  return { incoming, collections, available: new Set(collections.keys()) };
}

/** Everything that points at a record. Kinds that alias one another (rune/item, enemy/species) are merged. */
export function incomingReferences(index: ReferenceIndex, collection: string, id: string): IncomingReference[] {
  const kind = refKindForCollection(collection);
  if (!kind) return [];
  const kinds = new Set([kind, ...(kind === "item" ? ["rune"] : kind === "rune" ? ["item"] : kind === "enemy" ? ["species"] : kind === "species" ? ["enemy"] : [])]);
  const seen = new Set<string>();
  const out: IncomingReference[] = [];
  for (const candidate of kinds) {
    for (const reference of index.incoming.get(candidate)?.get(id) ?? []) {
      const key = `${reference.collection}:${reference.recordId}:${reference.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(reference);
    }
  }
  return out;
}

export function findRecord(index: Pick<ReferenceIndex, "collections">, collection: string, id: string): ContentRow | undefined {
  const response = index.collections.get(collection);
  if (!response) return undefined;
  const idKey = response.collection.idKey;
  return contentRows(response).find(row => rowId(row, idKey) === id);
}

/** Resolve a reference to the first served collection that actually contains the id. */
export function resolveReference(index: Pick<ReferenceIndex, "collections" | "available">, kind: string, id: string): { collection: string; record: ContentRow } | undefined {
  for (const name of REF_COLLECTIONS[kind] ?? []) {
    if (!index.available.has(name)) continue;
    const record = findRecord(index, name, id);
    if (record) return { collection: name, record };
  }
  return undefined;
}

const rowMaps = new WeakMap<CollectionResponse, Map<string, ContentRow>>();
function rowMap(response: CollectionResponse): Map<string, ContentRow> {
  let map = rowMaps.get(response);
  if (!map) {
    map = new Map(contentRows(response).map(row => [rowId(row, response.collection.idKey), row]));
    rowMaps.set(response, map);
  }
  return map;
}

/** A summary context backed by the loaded collections. `enemy-stats` resolves compiled combat rows. */
export function summaryContext(index: Pick<ReferenceIndex, "collections">): SummaryContext {
  return {
    lookup(kind, id) {
      const names = kind === "enemy-stats" ? ["compiled-enemies"] : REF_COLLECTIONS[kind] ?? [kind];
      for (const name of names) {
        const response = index.collections.get(name);
        if (!response) continue;
        const row = rowMap(response).get(id);
        if (row) return row;
      }
      return undefined;
    },
  };
}

const EMPTY: CollectionResponse[] = [];

/** Load every served collection. Cached per collection, so navigating between records stays cheap. */
export function useAllCollections(enabled = true): { responses: CollectionResponse[]; summaries: CollectionSummary[]; loading: boolean; errors: Error[]; refetch: () => void } {
  const summaries = useQuery({ ...collectionsQuery(), enabled });
  const names = useMemo(() => (summaries.data ?? []).map(summary => summary.name), [summaries.data]);
  const queries = useQueries({ queries: names.map(name => ({ ...collectionQuery(name), enabled, staleTime: 60_000 })) });
  const responses = useMemo(() => queries.flatMap(query => query.data ? [query.data] : []), [queries]);
  const loading = summaries.isPending || queries.some(query => query.isPending);
  const errors = queries.flatMap(query => query.error ? [query.error] : []);
  return { responses: responses.length ? responses : EMPTY, summaries: summaries.data ?? [], loading, errors, refetch: () => { queries.forEach(query => void query.refetch()); } };
}

export function useReferenceIndex(enabled = true): { index: ReferenceIndex; loading: boolean } {
  const all = useAllCollections(enabled);
  const index = useMemo(() => buildReferenceIndex(all.responses), [all.responses]);
  return { index, loading: all.loading };
}

/* ---------- Option sources for kinds without a collection ---------- */

export interface RefOption { value: string; label: string; thumb?: ThumbSpec }

const rowsOf = (index: Pick<ReferenceIndex, "collections">, name: string): ContentRow[] => { const response = index.collections.get(name); return response ? contentRows(response) : []; };
const asRows = (value: unknown): ContentRow[] => Array.isArray(value) ? value.filter((entry): entry is ContentRow => entry !== null && typeof entry === "object") : [];
const nameOf = (row: ContentRow, fallback: string): string => typeof row.name === "string" && row.name ? row.name : fallback;
const positionThumb = (row: ContentRow, icon: LucideIcon): ThumbSpec | undefined => {
  const position = row.position;
  return Array.isArray(position) && typeof position[0] === "number" && typeof position[1] === "number" ? { kind: "map", x: position[0], z: position[1], span: 60, icon } : undefined;
};

function derivedOptions(derive: Extract<RefKindSource, { derive: string }>["derive"], index: Pick<ReferenceIndex, "collections">): RefOption[] {
  const regions = rowsOf(index, "worldRegions");
  const seen = new Set<string>();
  const out: RefOption[] = [];
  const push = (option: RefOption) => { if (option.value && !seen.has(option.value)) { seen.add(option.value); out.push(option); } };
  switch (derive) {
    case "stations":
      for (const template of rowsOf(index, "recipeTemplates")) for (const station of Array.isArray(template.stations) ? template.stations : []) if (typeof station === "string") push({ value: station, label: titleCase(station) });
      return out;
    case "locations":
      for (const region of regions) {
        const regionName = nameOf(region, String(region.id ?? ""));
        const dungeon = region.dungeon !== null && typeof region.dungeon === "object" ? region.dungeon as ContentRow : undefined;
        for (const location of [...asRows(region.locations), ...asRows(dungeon?.locations)]) {
          const id = String(location.id ?? "");
          push({ value: id, label: `${nameOf(location, id)} · ${regionName}`, thumb: positionThumb(location, MapPin) });
        }
      }
      return out;
    case "settlements":
      for (const region of regions) {
        const settlement = region.settlement !== null && typeof region.settlement === "object" ? region.settlement as ContentRow : undefined;
        if (!settlement) continue;
        const id = String(settlement.id ?? "");
        const centre = settlement.centre;
        push({ value: id, label: `${nameOf(settlement, id)} · ${nameOf(region, String(region.id ?? ""))}`, thumb: Array.isArray(centre) && typeof centre[0] === "number" && typeof centre[1] === "number" ? { kind: "map", x: centre[0], z: centre[1], span: 120, icon: Landmark } : undefined });
      }
      return out;
    case "enemyFamilies":
      for (const creature of rowsOf(index, "creatureDefinitions")) if (typeof creature.family === "string") push({ value: creature.family, label: titleCase(creature.family) });
      return out.sort((a, b) => a.label.localeCompare(b.label));
    case "entities":
      for (const region of regions) {
        const regionName = nameOf(region, String(region.id ?? ""));
        const dungeon = region.dungeon !== null && typeof region.dungeon === "object" ? region.dungeon as ContentRow : undefined;
        const groups: [ContentRow[], LucideIcon][] = [
          [asRows(region.landmarks), Landmark], [asRows(region.obstacles), Footprints], [asRows(region.gates), Flag],
          [asRows(dungeon?.doors), DoorOpen], [asRows(dungeon?.obstacles), Footprints],
        ];
        for (const [rows, icon] of groups) for (const entity of rows) { const id = String(entity.id ?? ""); push({ value: id, label: `${nameOf(entity, id)} · ${regionName}`, thumb: positionThumb(entity, icon) }); }
      }
      return out;
  }
}

/**
 * The choices for a ref kind that has no collection of its own (`skill`, `element`, `station`,
 * `location`, `settlement`, `enemyFamily`, `entity`), driven by `REF_KIND_SOURCES`. Kinds backed
 * by a collection, and unknown kinds, return `undefined`: the picker searches the collection instead.
 */
export function optionsFor(kind: string, index: Pick<ReferenceIndex, "collections">): RefOption[] | undefined {
  const source = (REF_KIND_SOURCES as Record<string, RefKindSource | undefined>)[kind];
  if (!source || "collection" in source) return undefined;
  if ("enum" in source) {
    const icon = kind === "skill" ? iconForSkill : kind === "element" ? iconForElement : undefined;
    return source.enum.map(value => ({ value, label: titleCase(value), ...(icon ? { thumb: { kind: "glyph", icon: icon(value) } as ThumbSpec } : {}) }));
  }
  return derivedOptions(source.derive, index);
}

/** Whether a kind picks from a fixed option list rather than a collection. */
export const isOptionKind = (kind: string): kind is RefKind => { const source = (REF_KIND_SOURCES as Record<string, RefKindSource | undefined>)[kind]; return Boolean(source && !("collection" in source)); };
