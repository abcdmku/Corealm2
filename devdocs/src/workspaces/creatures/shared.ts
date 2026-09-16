import { useMemo } from "react";
import type { CreatureDefinition, CreatureProfile } from "../../../../game/src/content/schema/creatureDefinitions.js";
import type { LootTableRecord } from "../../../../game/src/content/schema/loot.js";
import type { ContentRow } from "../../model/contracts.js";
import { resolveInherited, type IdentityField } from "../../model/derive.js";
import type { Link, Resolved } from "../../model/origin.js";
import { summaryContext, useReferenceIndex, type ReferenceIndex } from "../../model/refs.js";
import { contentRows, rowId, rowName } from "../../model/rows.js";
import { summarize, type SummaryContext, type ThumbSpec } from "../../model/summaries.js";

/*
  The creature workspace's view of the content: definitions with their base resolved, the six
  role profiles, shared loot tables, and where each creature spawns (a placement whose encounter
  lists it). Everything comes from the reference index so it is cached across pages.
*/

export type Creature = CreatureDefinition & ContentRow;
export type Profile = CreatureProfile & ContentRow;
export type LootTable = LootTableRecord & ContentRow;
export interface Encounter extends ContentRow { id: string; name?: string; activity?: string; members?: { creatureId: string; weight?: number }[] }
export interface Placement extends ContentRow { id: string; encounterId: string; regionId?: string; centre?: [number, number]; count?: number; radius?: number }
export interface Region extends ContentRow { id: string; name: string; tier?: number }

export type Presentation = NonNullable<CreatureDefinition["presentation"]>;
export type Loot = NonNullable<CreatureDefinition["loot"]>;
export type Adjustments = NonNullable<CreatureDefinition["adjustments"]>;

/** A definition with its base folded in, the way the compiler sees it. */
export interface ResolvedCreature {
  id: string;
  definition: Creature;
  base?: Creature;
  row: Creature;
  profile?: Profile;
  level: number;
  name: string;
  family?: string;
  regionId?: string;
  availability: "world" | "lab";
  variant: boolean;
  /** The model to draw: the creature's own, or one borrowed from a variant when the base has none. */
  assetId?: string;
}

export interface Spawn { placement: Placement; encounter: Encounter; weight?: number }

export const CURVE_LEVELS = [1, 10, 30, 50, 70] as const;

/**
 * An identity field's chain with the link it beat. `resolveInherited` stops at the winning link,
 * so an own value over a base value would draw as plain "own" with nothing to revert to; adding
 * the base's link back gives the field its brass dot and its revert (docs/devdocs-inputs.md §3.1).
 */
export function identityChain<K extends IdentityField>(definition: Creature, base: Creature | undefined, key: K): Resolved<Creature[K]> {
  const resolved = resolveInherited(definition, base, key) as Resolved<Creature[K]>;
  const carried = base?.[key];
  if (resolved.chain[0]?.origin.kind !== "own" || !base || carried === undefined) return resolved;
  const beaten: Link<Creature[K]> = { origin: { kind: "inherited", from: { collection: "creatureDefinitions", id: base.id, label: base.name ?? base.id, path: key } }, value: carried };
  return { ...resolved, chain: [resolved.chain[0], beaten] };
}

/** The same chain seen through a projection: a loot block as its mode, a presentation as one of its keys. */
export function mapResolved<T, U>(resolved: Resolved<T>, project: (value: T) => U): Resolved<U> {
  return { ...resolved, value: project(resolved.value), chain: resolved.chain.map(link => ({ origin: link.origin, value: project(link.value) })) };
}

export type LootMode = "none" | "table" | "drops";
export const lootMode = (loot: Loot | undefined): LootMode => loot === undefined ? "none" : "tableId" in loot ? "table" : "drops";

export const titleCase = (value: string): string => value.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());

export function resolveCreature(definition: Creature, byId: ReadonlyMap<string, Creature>, profiles: ReadonlyMap<string, Profile>): ResolvedCreature {
  const base = definition.baseId ? byId.get(definition.baseId) : undefined;
  const row = { ...base, ...definition, adjustments: { ...base?.adjustments, ...definition.adjustments } } as Creature;
  const presentation = row.presentation;
  return {
    id: definition.id, definition, base, row,
    profile: row.profileId ? profiles.get(row.profileId) : undefined,
    level: row.level ?? 1,
    name: row.name ?? rowName(definition),
    family: row.family,
    regionId: presentation?.regionId,
    availability: row.availability,
    variant: Boolean(definition.baseId),
    assetId: presentation?.assetId,
  };
}

/** The tile/header thumbnail: the rendered model when one exists anywhere in the family, else the summary glyph. */
export function thumbFor(row: ResolvedCreature, ctx: SummaryContext): ThumbSpec {
  const thumb = summarize("creatureDefinitions", row.row, ctx).thumb;
  if (thumb.kind === "glyph" && row.assetId) return { kind: "asset", assetId: row.assetId, icon: thumb.icon, hue: thumb.hue };
  return thumb;
}

export interface CreatureData {
  index: ReferenceIndex;
  ctx: SummaryContext;
  loading: boolean;
  creatures: Creature[];
  byId: Map<string, Creature>;
  resolved: ResolvedCreature[];
  resolvedById: Map<string, ResolvedCreature>;
  profiles: Profile[];
  profileById: Map<string, Profile>;
  lootTables: LootTable[];
  lootById: Map<string, LootTable>;
  regions: Region[];
  regionName: (id: string | undefined) => string;
  /** Placements that spawn a creature, through the encounter that lists it. */
  spawnsFor: (creatureId: string) => Spawn[];
  /** Definitions that inherit from a base. */
  variantsOf: (baseId: string) => ResolvedCreature[];
  /** Creatures whose resolved loot is a given shared table. */
  usersOfTable: (tableId: string) => ResolvedCreature[];
  revisionOf: (collection: string) => string | undefined;
}

function rowsOf<T extends ContentRow>(index: ReferenceIndex, collection: string): T[] {
  const response = index.collections.get(collection);
  return response ? contentRows(response) as T[] : [];
}

export function useCreatureData(): CreatureData {
  const { index, loading } = useReferenceIndex();
  return useMemo(() => {
    const ctx = summaryContext(index);
    const creatures = rowsOf<Creature>(index, "creatureDefinitions");
    const byId = new Map(creatures.map(row => [row.id, row]));
    const profiles = rowsOf<Profile>(index, "creatureProfiles");
    const profileById = new Map(profiles.map(row => [row.id, row]));
    const lootTables = rowsOf<LootTable>(index, "lootTables");
    const lootById = new Map(lootTables.map(row => [row.id, row]));
    const regions = rowsOf<Region>(index, "worldRegions");
    const regionById = new Map(regions.map(row => [row.id, row]));
    const resolved = creatures.map(row => resolveCreature(row, byId, profileById));
    const resolvedById = new Map(resolved.map(row => [row.id, row]));
    const encounters = new Map(rowsOf<Encounter>(index, "encounters").map(row => [row.id, row]));
    const placements = rowsOf<Placement>(index, "placements");
    const spawns = new Map<string, Spawn[]>();
    for (const placement of placements) {
      const encounter = encounters.get(placement.encounterId);
      if (!encounter) continue;
      for (const member of encounter.members ?? []) {
        let list = spawns.get(member.creatureId);
        if (!list) { list = []; spawns.set(member.creatureId, list); }
        list.push({ placement, encounter, weight: member.weight });
      }
    }
    const variants = new Map<string, ResolvedCreature[]>();
    for (const row of resolved) {
      if (!row.definition.baseId) continue;
      let list = variants.get(row.definition.baseId);
      if (!list) { list = []; variants.set(row.definition.baseId, list); }
      list.push(row);
    }
    for (const row of resolved) {
      if (row.assetId) continue;
      row.assetId = variants.get(row.id)?.find(variant => variant.assetId)?.assetId;
    }
    const tableUsers = new Map<string, ResolvedCreature[]>();
    for (const row of resolved) {
      const loot = row.row.loot;
      if (!loot || !("tableId" in loot)) continue;
      let list = tableUsers.get(loot.tableId);
      if (!list) { list = []; tableUsers.set(loot.tableId, list); }
      list.push(row);
    }
    return {
      index, ctx, loading, creatures, byId, resolved, resolvedById, profiles, profileById, lootTables, lootById, regions,
      regionName: id => id ? regionById.get(id)?.name ?? titleCase(id) : "No region",
      spawnsFor: id => spawns.get(id) ?? [],
      variantsOf: id => variants.get(id) ?? [],
      usersOfTable: id => tableUsers.get(id) ?? [],
      revisionOf: collection => index.collections.get(collection)?.revision,
    };
  }, [index, loading]);
}

export const creatureRowId = (row: ContentRow): string => rowId(row);
