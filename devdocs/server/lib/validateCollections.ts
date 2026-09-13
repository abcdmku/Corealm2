import { validateSourceLootLinks } from '../../../game/src/content/schema/sourceLootLinks.js';
import { validateEnemyFormulaLinks } from '../../../game/src/content/schema/enemyFormulaLinks.js';
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SKILL_IDS, SPELL_ELEMENTS } from "../../../game/src/contracts.js";
import { derivationDiffs, sameValue, type DerivationDiff } from "../../../game/src/content/balance/derivations.js";
import {
  ArraySchema, DiscriminatedSchema, ObjectSchema, RecordSchema, TupleSchema, UnionSchema,
  unwrap, validateCollection, type ParseContext, type Schema,
} from "../../../game/src/content/schema/core.js";
import { CONTENT_COLLECTIONS, type ContentCollection } from "../../../tools/content/collections.js";
import { checkIdentity } from "../../../tools/content/identity.js";
import { collectionReferenceIssues, type ReferencePools } from "../../../tools/content/references.js";
import type { ApiDiagnostic } from "../../shared/contracts.js";
import { creatureCollectionPools, validateCreatureCollections } from '../../../game/src/content/schema/creatureLinks.js';

export interface CollectionSnapshot { data: unknown; text: string }
export type CollectionSnapshots = ReadonlyMap<string, CollectionSnapshot>;

export function collectionFile(root: string, spec: ContentCollection): string {
  const file = path.resolve(root, spec.file), relative = path.relative(path.resolve(root), file);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Registered collection path leaves root");
  return file;
}

export function parseAuthoredCollection(spec: ContentCollection, raw: unknown): { data: unknown; diagnostics: ApiDiagnostic[] } {
  if (spec.shape === "array") {
    const result = validateCollection(spec.schema, raw, { name: spec.name, idKey: spec.idKey });
    return { data: result.records, diagnostics: result.issues };
  }
  const context: ParseContext = { issues: [] };
  const data = spec.schema.parse(raw, spec.name, context);
  return { data, diagnostics: context.issues };
}

/** No runtime loaders: every mutable reference and balance input comes from this disk snapshot. */
export async function loadCollectionSnapshots(root: string): Promise<Map<string, CollectionSnapshot>> {
  return new Map(await Promise.all(CONTENT_COLLECTIONS.map(async spec => {
    const text = await readFile(collectionFile(root, spec), "utf8");
    return [spec.name, { text, data: JSON.parse(text) as unknown }] as const;
  })));
}

function protectedValues(schema: Schema, value: unknown, at: string, result: Map<string, unknown>, omitDerivation: boolean): void {
  if (value === undefined || value === null) return;
  const concrete = unwrap(schema);
  if (schema.meta.readOnly || concrete.meta.readOnly || schema.meta.identity || concrete.meta.identity) {
    result.set(at, value);
    return;
  }
  if (concrete instanceof ObjectSchema && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, field] of Object.entries(concrete.fields as Record<string, Schema>)) {
      if (key === "derivation" && omitDerivation) continue;
      const fieldValue = (value as Record<string, unknown>)[key];
      // Catalogs reconstruct source exports. Counts participate in saved population identity.
      if (["count", "legacyCount", "catalog"].includes(key)) result.set(`${at}.${key}`, fieldValue);
      else protectedValues(field, fieldValue, `${at}.${key}`, result, omitDerivation);
    }
  } else if (concrete instanceof ArraySchema && Array.isArray(value)) {
    value.forEach((row, index) => protectedValues(concrete.item, row, `${at}[${index}]`, result, omitDerivation));
  } else if (concrete instanceof TupleSchema && Array.isArray(value)) {
    concrete.items.forEach((field: Schema, index: number) => protectedValues(field, value[index], `${at}[${index}]`, result, omitDerivation));
  } else if (concrete instanceof RecordSchema && typeof value === "object") {
    for (const [key, row] of Object.entries(value)) {
      if (concrete.key) protectedValues(concrete.key, key, `${at}.${key}#key`, result, omitDerivation);
      protectedValues(concrete.value, row, `${at}.${key}`, result, omitDerivation);
    }
  } else if (concrete instanceof DiscriminatedSchema && typeof value === "object") {
    const tag = (value as Record<string, unknown>)[concrete.tag];
    if (typeof tag === "string" && Object.hasOwn(concrete.members, tag)) protectedValues(concrete.members[tag]!, value, at, result, omitDerivation);
  } else if (concrete instanceof UnionSchema) {
    for (const member of concrete.members) {
      const context: ParseContext = { issues: [] };
      member.parse(value, at, context);
      if (!context.issues.length) { protectedValues(member, value, at, result, omitDerivation); break; }
    }
  }
}

export function collectionIdentityDiagnostics(spec: ContentCollection, before: unknown, after: unknown): ApiDiagnostic[] {
  const issues: ApiDiagnostic[] = checkIdentity(before, after, spec.name, spec.idKey, true, spec.schema)
    .map(issue => ({ ...issue, severity: "error" }));
  const compare = (oldRow: unknown, newRow: unknown, at: string) => {
    const removedDerivation = typeof newRow === "object" && newRow !== null && !Object.hasOwn(newRow, "derivation");
    const oldFields = new Map<string, unknown>(), newFields = new Map<string, unknown>();
    protectedValues(spec.schema, oldRow, at, oldFields, removedDerivation);
    protectedValues(spec.schema, newRow, at, newFields, removedDerivation);
    for (const field of new Set([...oldFields.keys(), ...newFields.keys()])) {
      if (!sameValue(oldFields.get(field), newFields.get(field))) issues.push({ path: field, message: "Read-only or save identity field cannot change", severity: "error" });
    }
  };
  if (spec.shape === "array") {
    const oldRows = before as Record<string, unknown>[], newRows = after as Record<string, unknown>[];
    oldRows.forEach((oldRow, index) => compare(oldRow, newRows[index], `${spec.name}[${index}]`));
  } else compare(before, after, spec.name);
  return issues;
}

function livePools(values: ReadonlyMap<string, unknown>, external: ReferencePools): ReferencePools {
  const ids = (collection: string, key = "id"): Set<string> => new Set((values.get(collection) as Record<string, unknown>[] ?? []).map(row => String(row[key])));
  const audio = values.get("audio") as { cues?: object; loops?: object } | undefined;
  const pools: ReferencePools = {
    ...external, item: ids("items"), recipe: ids("recipes"), resource: ids("resources"),
    npc: ids("npcs"), shop: ids("shops"), quest: ids("quests"), dialogue: ids("dialogue"),
    spell: ids("spells"), rune: ids("spellRunes", "itemId"), set: ids("equipmentSets"),
    skill: new Set(SKILL_IDS), element: new Set(SPELL_ELEMENTS),
    audio: new Set([...Object.keys(audio?.cues ?? {}), ...Object.keys(audio?.loops ?? {})]),
  };
  if (values.has("campfireFuels")) pools.campfireFuel = ids("campfireFuels", "logItemId");
  Object.assign(pools, creatureCollectionPools(values));
  return pools;
}

function driftDiagnostics(values: ReadonlyMap<string, unknown>, target: { collection: string; recordId: string }): ApiDiagnostic[] {
  const diagnostics: ApiDiagnostic[] = [];
  const severity = (collection: string, recordId: string) => !target.collection.startsWith("balance/") && collection === target.collection && recordId === target.recordId ? "error" as const : "warning" as const;
  const append = (diff: DerivationDiff) => diagnostics.push({ path: `${diff.collection}.${diff.recordId}`, severity: severity(diff.collection, diff.recordId),
    message: `Drifted from ${diff.kind}; recompute locked fields or remove derivation to hand-tune` });
  try { derivationDiffs(values).forEach(append); }
  catch {
    // A missing parameter for one existing row must not prevent editing an unrelated record.
    // Suppress other tags, not their source rows: food formulas still need the raw fish item.
    const isolated = new Map([...values].map(([name, value]) => [name, Array.isArray(value)
      ? value.map(({ derivation: _tag, ...row }) => row) : value]));
    for (const [collection, rows] of values) {
      if (!Array.isArray(rows)) continue;
      const inputs = isolated.get(collection) as Record<string, unknown>[];
      for (const [index, row] of (rows as Record<string, unknown>[]).entries()) {
        if (!row.derivation) continue;
        const selected = [...inputs]; selected[index] = row;
        isolated.set(collection, selected);
        try { derivationDiffs(isolated).forEach(append); }
        catch { diagnostics.push({ path: `${collection}.${String(row.id)}`, severity: severity(collection, String(row.id)), message: "Cannot derive this tagged record from current balance parameters" }); }
        isolated.set(collection, inputs);
      }
    }
  }
  return diagnostics;
}

/** Schema + references validate the whole proposed world of JSON, not cached runtime modules. */
export function validateCollectionOverlay(snapshots: CollectionSnapshots, spec: ContentCollection, proposed: unknown, recordId: string, external: ReferencePools = {}): { data: unknown; diagnostics: ApiDiagnostic[] } {
  const values = new Map<string, unknown>();
  const diagnostics: ApiDiagnostic[] = [];
  for (const collection of CONTENT_COLLECTIONS) {
    const parsed = parseAuthoredCollection(collection, collection.name === spec.name ? proposed : snapshots.get(collection.name)?.data);
    diagnostics.push(...parsed.diagnostics);
    values.set(collection.name, parsed.data);
  }
  const data = values.get(spec.name);
  if (diagnostics.some(issue => issue.severity === "error")) return { data, diagnostics };
  diagnostics.push(...collectionIdentityDiagnostics(spec, snapshots.get(spec.name)!.data, data));
  diagnostics.push(...validateCreatureCollections(values));
  diagnostics.push(...validateEnemyFormulaLinks(values), ...validateSourceLootLinks(values));
  const pools = livePools(values, external);
  for (const collection of CONTENT_COLLECTIONS) {
    const rows = collection.shape === "array" ? values.get(collection.name) as unknown[] : [values.get(collection.name)];
    rows.forEach((row, index) => {
      const at = collection.shape === "array" ? `${collection.name}[${index}]` : collection.name;
      diagnostics.push(...collectionReferenceIssues(collection.name, collection.schema, row, pools, at));
    });
  }
  // Option ids are global saved identities, while their containing node schema only checks local shape.
  const optionIds = new Set<string>();
  for (const node of values.get("dialogue") as { id: string; options: { id: string }[] }[]) {
    for (const option of node.options) {
      if (optionIds.has(option.id)) diagnostics.push({ path: `dialogue.${node.id}.options`, message: `Duplicate dialogue option id ${option.id}`, severity: "error" });
      optionIds.add(option.id);
    }
  }
  diagnostics.push(...driftDiagnostics(values, { collection: spec.name, recordId }));
  return { data, diagnostics };
}
