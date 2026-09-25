/**
 * Schema combinators for the JSON content store.
 *
 * Every table under `game/content/data/` is parsed through one of these schemas before a loader
 * exports it, so a typo in a JSON file fails at import time with a path instead of mid-session. The
 * same schema objects carry field metadata (`label`, `help`, `unit`, `readOnly`, `ref`) so the dev
 * docs app can build its edit forms from them without a second description of the shape.
 *
 * Hand-rolled on purpose: no zod in the game bundle, no reflection, no decorators. A schema is a
 * plain object with a `kind`, its `meta`, and a `parse` that collects issues rather than throwing,
 * so one run reports every problem in a file.
 *
 * Rules for this module: it never imports JSON, never reads Vite environment flags, and never
 * touches the DOM. It has to run identically under Vite (game and app), tsx (tools) and vitest.
 */

import { SKILL_IDS, SPELL_ELEMENTS } from "../../contracts.js";
import { COMPOSITION_IDS } from "../../render/compositionIds.js";

export type IssueSeverity = "error" | "warning";

export interface SchemaIssue {
  /** JSON-pointer-like path, e.g. `items[12].equip.bonuses.defence`. */
  path: string;
  message: string;
  severity: IssueSeverity;
}

/** Which table a string field points into. The app renders these as links and pickers. */
export type RefKind =
  | "item" | "recipe" | "resource" | "resourceCluster" | "enemy" | "species" | "lootTable"
  | "npc" | "shop" | "quest" | "dialogue" | "spell" | "rune" | "set"
  | "asset" | "audio" | "region" | "skill" | "station" | "element"
  | "entity" | "location" | "settlement" | "enemyFamily" | "campfireFuel"
  | "material" | "equipmentFamily" | "recipeTemplate" | "creatureProfile" | "encounter"
  | "composition";

export interface FieldMeta {
  /** Short form label. Defaults to the field name. */
  label?: string;
  /** One or two sentences shown next to the control. */
  help?: string;
  /** Display unit such as `m`, `ms`, `s`, `%`, `xp`. */
  unit?: string;
  /** Shown but never editable. Ids, counts and record order are read-only save identity. */
  readOnly?: boolean;
  /** Part of the identity diff `content:check` refuses to change without a flag. */
  identity?: boolean;
  /** The string is a foreign key into another collection. */
  ref?: RefKind;
  /** Long prose; render a textarea. */
  multiline?: boolean;
  /** Numeric bounds for the control (validation uses `min`/`max` on the number schema itself). */
  step?: number;
  /** Hide from forms entirely (internal plumbing). */
  hidden?: boolean;
  /**
   * Array order carries meaning: quest stages run in order, dialogue options list in order, an NPC
   * offers its quests in order. The editor shows reorder controls and never sorts such an array.
   */
  ordered?: boolean;
  /**
   * On an array: the member key holding a relative weight. Members compete for one roll and the
   * editor can show each as a share of the total (`"weight"` on encounter members).
   */
  weight?: string;
  /**
   * On an array: the member key holding an independent probability in 0..1. Unlike `weight` these
   * do not compete and do not sum to one (`"chance"` on loot drops and resource bonus rolls).
   */
  probability?: string;
  /**
   * Which small-number grid a scalar belongs to, so a page can lay out one `Fields` block per
   * group instead of naming every key: `"combat"`, `"bonuses"`, `"cost"`, `"presentation"`, ...
   */
  group?: string;
  /**
   * A short label for the relationship a reference expresses, read from the target's side:
   * `"Dropped by"` on a loot drop's item, `"Sold at"` on shop stock. "Referenced by" sections
   * group incoming references by this label instead of guessing one from the field path.
   */
  role?: string;
  /** This field is the record's display name. `recordLabelKey` looks for it before `name`. */
  display?: boolean;
}

/**
 * Where a `RefKind`'s options come from, for the pickers the dev docs app builds.
 *
 * Data only: no imports of content, no functions. `collection` names a served table; `enum` is a
 * closed list that lives in the schema itself; `derive` names a set the app has to compute by
 * walking another table, because the values are nested inside rows rather than being rows.
 */
export type RefKindSource =
  | { collection: string }
  | { enum: readonly string[] }
  | { derive: "stations" | "locations" | "settlements" | "enemyFamilies" | "entities" };

/**
 * Every `RefKind` resolves here. The eight kinds with no collection of their own (`skill`,
 * `element`, `composition`, `station`, `entity`, `location`, `settlement`, `enemyFamily`) name an
 * enum or a derivation so they stop falling back to a raw text box.
 */
export const REF_KIND_SOURCES: Record<RefKind, RefKindSource> = {
  item: { collection: "items" },
  recipe: { collection: "recipes" },
  resource: { collection: "resources" },
  resourceCluster: { collection: "resourcePlacements" },
  enemy: { collection: "creatureDefinitions" },
  species: { collection: "creatureDefinitions" },
  lootTable: { collection: "lootTables" },
  npc: { collection: "npcs" },
  shop: { collection: "shops" },
  quest: { collection: "quests" },
  dialogue: { collection: "dialogue" },
  spell: { collection: "spells" },
  rune: { collection: "spellRunes" },
  set: { collection: "equipmentSets" },
  asset: { collection: "assets" },
  audio: { collection: "audio" },
  region: { collection: "worldRegions" },
  campfireFuel: { collection: "campfireFuels" },
  material: { collection: "materials" },
  equipmentFamily: { collection: "equipmentFamilies" },
  recipeTemplate: { collection: "recipeTemplates" },
  creatureProfile: { collection: "creatureProfiles" },
  encounter: { collection: "encounters" },
  /** The ten player skills. `SKILL_IDS` is the frozen runtime list. */
  skill: { enum: SKILL_IDS },
  /** The four attack elements. `SPELL_ELEMENTS` is the frozen runtime list. */
  element: { enum: SPELL_ELEMENTS },
  /** Set dressing the renderer can build around a landmark, gate, obstacle or dungeon mouth. `COMPOSITION_IDS` is the running build's list. */
  composition: { enum: COMPOSITION_IDS },
  /**
   * Production station categories. The closed list lives on `RecipeSchema.stations`, and every
   * recipe template repeats it, so the app reads the distinct values off `recipeTemplates`.
   */
  station: { derive: "stations" },
  /** Route-graph nodes: `worldRegions[].locations` plus each region's `dungeon.locations`. */
  location: { derive: "locations" },
  /** `worldRegions[].settlements[]`, including separate progression towns in one region. */
  settlement: { derive: "settlements" },
  /** The distinct `family` values authored on `creatureDefinitions`. */
  enemyFamily: { derive: "enemyFamilies" },
  /**
   * World entity ids a quest can name: landmarks, obstacles, gates, dungeon doors and altars,
   * collected from `worldRegions`. Not npcs or creatures, which have their own kinds.
   */
  entity: { derive: "entities" },
};

export type SchemaKind =
  | "string" | "number" | "boolean" | "literal" | "enum" | "array" | "tuple" | "object"
  | "record" | "union" | "optional" | "nullable" | "unknown" | "lazy";

export interface ParseContext {
  issues: SchemaIssue[];
}

/**
 * The common surface of every schema. `T` is a phantom type carried for inference only; `parse`
 * returns the parsed value even when it recorded issues, so callers must check `ctx.issues`.
 */
export interface Schema<T = unknown> {
  readonly kind: SchemaKind;
  readonly meta: FieldMeta;
  /** Present and true only on `opt(...)`; object inference uses it to make the key optional. */
  readonly optional?: boolean;
  /** Phantom. Never set at runtime. */
  readonly __type?: T;
  parse(value: unknown, path: string, ctx: ParseContext): T;
  /** A copy of this schema with `meta` merged in. */
  describe(meta: FieldMeta): Schema<T>;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type OptionalKeys<F> = { [K in keyof F]: F[K] extends { readonly optional: true } ? K : never }[keyof F];
type RequiredKeys<F> = Exclude<keyof F, OptionalKeys<F>>;
export type InferObject<F extends Record<string, Schema>> = Simplify<
  { [K in RequiredKeys<F>]: Infer<F[K]> } & { [K in OptionalKeys<F>]?: Infer<F[K]> }
>;

// ---------------------------------------------------------------- helpers

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function fail(ctx: ParseContext, path: string, message: string): void {
  ctx.issues.push({ path, message, severity: "error" });
}

function child(path: string, key: string | number): string {
  return typeof key === "number" ? `${path}[${key}]` : path ? `${path}.${key}` : key;
}

abstract class Base<T> implements Schema<T> {
  abstract readonly kind: SchemaKind;
  readonly meta: FieldMeta;
  declare readonly __type?: T;
  constructor(meta: FieldMeta = {}) { this.meta = meta; }
  abstract parse(value: unknown, path: string, ctx: ParseContext): T;
  abstract clone(meta: FieldMeta): Schema<T>;
  describe(meta: FieldMeta): Schema<T> { return this.clone({ ...this.meta, ...meta }); }
}

// ---------------------------------------------------------------- primitives

export interface StringOptions { minLength?: number; maxLength?: number; pattern?: RegExp; nonEmpty?: boolean }

export class StringSchema extends Base<string> {
  readonly kind = "string" as const;
  constructor(readonly options: StringOptions = {}, meta: FieldMeta = {}) { super(meta); }
  override parse(value: unknown, path: string, ctx: ParseContext): string {
    if (typeof value !== "string") { fail(ctx, path, `expected string, got ${typeName(value)}`); return value as string; }
    const { minLength, maxLength, pattern, nonEmpty } = this.options;
    if (nonEmpty && value.length === 0) fail(ctx, path, "must not be empty");
    if (minLength !== undefined && value.length < minLength) fail(ctx, path, `must be at least ${minLength} characters`);
    if (maxLength !== undefined && value.length > maxLength) fail(ctx, path, `must be at most ${maxLength} characters`);
    if (pattern && !pattern.test(value)) fail(ctx, path, `must match ${pattern}`);
    return value;
  }
  override clone(meta: FieldMeta): StringSchema { return new StringSchema(this.options, meta); }
}

export interface NumberOptions { integer?: boolean; min?: number; max?: number; exclusiveMin?: number; exclusiveMax?: number }

export class NumberSchema extends Base<number> {
  readonly kind = "number" as const;
  constructor(readonly options: NumberOptions = {}, meta: FieldMeta = {}) { super(meta); }
  override parse(value: unknown, path: string, ctx: ParseContext): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      fail(ctx, path, `expected finite number, got ${typeName(value) === "number" ? String(value) : typeName(value)}`);
      return value as number;
    }
    const { integer, min, max, exclusiveMin, exclusiveMax } = this.options;
    if (integer && !Number.isInteger(value)) fail(ctx, path, `expected integer, got ${value}`);
    if (min !== undefined && value < min) fail(ctx, path, `must be >= ${min}, got ${value}`);
    if (max !== undefined && value > max) fail(ctx, path, `must be <= ${max}, got ${value}`);
    if (exclusiveMin !== undefined && value <= exclusiveMin) fail(ctx, path, `must be > ${exclusiveMin}, got ${value}`);
    if (exclusiveMax !== undefined && value >= exclusiveMax) fail(ctx, path, `must be < ${exclusiveMax}, got ${value}`);
    return value;
  }
  override clone(meta: FieldMeta): NumberSchema { return new NumberSchema(this.options, meta); }
}

export class BooleanSchema extends Base<boolean> {
  readonly kind = "boolean" as const;
  override parse(value: unknown, path: string, ctx: ParseContext): boolean {
    if (typeof value !== "boolean") fail(ctx, path, `expected boolean, got ${typeName(value)}`);
    return value as boolean;
  }
  override clone(meta: FieldMeta): BooleanSchema { return new BooleanSchema(meta); }
}

export type Primitive = string | number | boolean | null;

export class LiteralSchema<V extends Primitive> extends Base<V> {
  readonly kind = "literal" as const;
  constructor(readonly value: V, meta: FieldMeta = {}) { super(meta); }
  override parse(value: unknown, path: string, ctx: ParseContext): V {
    if (value !== this.value) fail(ctx, path, `expected ${JSON.stringify(this.value)}, got ${JSON.stringify(value)}`);
    return value as V;
  }
  override clone(meta: FieldMeta): LiteralSchema<V> { return new LiteralSchema(this.value, meta); }
}

export class EnumSchema<V extends string> extends Base<V> {
  readonly kind = "enum" as const;
  private readonly set: ReadonlySet<string>;
  constructor(readonly options: readonly V[], meta: FieldMeta = {}) { super(meta); this.set = new Set(options); }
  override parse(value: unknown, path: string, ctx: ParseContext): V {
    if (typeof value !== "string" || !this.set.has(value)) {
      fail(ctx, path, `expected one of ${this.options.map((option) => JSON.stringify(option)).join(", ")}, got ${JSON.stringify(value)}`);
    }
    return value as V;
  }
  override clone(meta: FieldMeta): EnumSchema<V> { return new EnumSchema(this.options, meta); }
}

export class UnknownSchema extends Base<unknown> {
  readonly kind = "unknown" as const;
  override parse(value: unknown): unknown { return value; }
  override clone(meta: FieldMeta): UnknownSchema { return new UnknownSchema(meta); }
}

// ---------------------------------------------------------------- containers

export interface ArrayOptions { minLength?: number; maxLength?: number }

export class ArraySchema<T> extends Base<T[]> {
  readonly kind = "array" as const;
  constructor(readonly item: Schema<T>, readonly options: ArrayOptions = {}, meta: FieldMeta = {}) { super(meta); }
  override parse(value: unknown, path: string, ctx: ParseContext): T[] {
    if (!Array.isArray(value)) { fail(ctx, path, `expected array, got ${typeName(value)}`); return value as T[]; }
    const { minLength, maxLength } = this.options;
    if (minLength !== undefined && value.length < minLength) fail(ctx, path, `must have at least ${minLength} entries`);
    if (maxLength !== undefined && value.length > maxLength) fail(ctx, path, `must have at most ${maxLength} entries`);
    return value.map((entry, index) => this.item.parse(entry, child(path, index), ctx));
  }
  override clone(meta: FieldMeta): ArraySchema<T> { return new ArraySchema(this.item, this.options, meta); }
}

type TupleInfer<S extends readonly Schema[]> = { [K in keyof S]: Infer<S[K]> };

export class TupleSchema<S extends readonly Schema[]> extends Base<TupleInfer<S>> {
  readonly kind = "tuple" as const;
  constructor(readonly items: S, meta: FieldMeta = {}) { super(meta); }
  override parse(value: unknown, path: string, ctx: ParseContext): TupleInfer<S> {
    if (!Array.isArray(value)) { fail(ctx, path, `expected tuple of ${this.items.length}, got ${typeName(value)}`); return value as TupleInfer<S>; }
    if (value.length !== this.items.length) { fail(ctx, path, `expected ${this.items.length} entries, got ${value.length}`); return value as TupleInfer<S>; }
    return this.items.map((item, index) => item.parse(value[index], child(path, index), ctx)) as unknown as TupleInfer<S>;
  }
  override clone(meta: FieldMeta): TupleSchema<S> { return new TupleSchema(this.items, meta); }
}

export interface ObjectOptions {
  /** Reject keys the schema does not name. Default true: a misspelt key is a silent bug. */
  strict?: boolean;
}

export class ObjectSchema<F extends Record<string, Schema>> extends Base<InferObject<F>> {
  readonly kind = "object" as const;
  readonly keys: readonly (keyof F & string)[];
  constructor(readonly fields: F, readonly options: ObjectOptions = {}, meta: FieldMeta = {}) {
    super(meta);
    this.keys = Object.keys(fields);
  }
  override parse(value: unknown, path: string, ctx: ParseContext): InferObject<F> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      fail(ctx, path, `expected object, got ${typeName(value)}`);
      return value as InferObject<F>;
    }
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of this.keys) {
      const field = this.fields[key]!;
      const present = Object.prototype.hasOwnProperty.call(input, key);
      if (!present) {
        if (!field.optional) fail(ctx, child(path, key), "missing required field");
        continue;
      }
      const parsed = field.parse(input[key], child(path, key), ctx);
      // JSON never holds undefined, but a hand-built record might; keep key sets canonical.
      if (parsed !== undefined) output[key] = parsed;
    }
    if (this.options.strict !== false) {
      for (const key of Object.keys(input)) {
        if (!Object.hasOwn(this.fields, key)) fail(ctx, child(path, key), "unknown field");
      }
    } else {
      for (const key of Object.keys(input)) if (!Object.hasOwn(this.fields, key)) Object.defineProperty(output, key, { value: input[key], enumerable: true, writable: true, configurable: true });
    }
    return output as InferObject<F>;
  }
  override clone(meta: FieldMeta): ObjectSchema<F> { return new ObjectSchema(this.fields, this.options, meta); }
  /** A new object schema with more fields; used to layer record extras over a row schema. */
  extend<G extends Record<string, Schema>>(fields: G): ObjectSchema<F & G> {
    return new ObjectSchema({ ...this.fields, ...fields } as F & G, this.options, this.meta);
  }
  /** A new object schema without the named fields. */
  omit<K extends keyof F & string>(...keys: K[]): ObjectSchema<Omit<F, K>> {
    const fields = { ...this.fields } as Record<string, Schema>;
    for (const key of keys) delete fields[key];
    return new ObjectSchema(fields as Omit<F, K>, this.options, this.meta);
  }
}

export class RecordSchema<K extends string, V> extends Base<Record<K, V>> {
  readonly kind = "record" as const;
  constructor(readonly value: Schema<V>, readonly key: Schema<K> | undefined, meta: FieldMeta = {}) { super(meta); }
  override parse(value: unknown, path: string, ctx: ParseContext): Record<K, V> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      fail(ctx, path, `expected object, got ${typeName(value)}`);
      return value as Record<K, V>;
    }
    const output: Record<string, V> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (this.key) this.key.parse(key, child(path, key), ctx);
      Object.defineProperty(output, key, { value: this.value.parse(entry, child(path, key), ctx), enumerable: true, writable: true, configurable: true });
    }
    return output as Record<K, V>;
  }
  override clone(meta: FieldMeta): RecordSchema<K, V> { return new RecordSchema(this.value, this.key, meta); }
}

export class OptionalSchema<T> extends Base<T | undefined> {
  readonly kind = "optional" as const;
  readonly optional = true as const;
  constructor(readonly inner: Schema<T>, meta: FieldMeta = {}) { super(meta); }
  override parse(value: unknown, path: string, ctx: ParseContext): T | undefined {
    return value === undefined ? undefined : this.inner.parse(value, path, ctx);
  }
  override clone(meta: FieldMeta): OptionalSchema<T> { return new OptionalSchema(this.inner, meta); }
}

export class NullableSchema<T> extends Base<T | null> {
  readonly kind = "nullable" as const;
  constructor(readonly inner: Schema<T>, meta: FieldMeta = {}) { super(meta); }
  override parse(value: unknown, path: string, ctx: ParseContext): T | null {
    return value === null ? null : this.inner.parse(value, path, ctx);
  }
  override clone(meta: FieldMeta): NullableSchema<T> { return new NullableSchema(this.inner, meta); }
}

/**
 * Untagged union: the first member that parses cleanly wins. When none does, the member that came
 * closest (fewest issues) reports its issues so the message names the actual problem rather than
 * "no member matched". Prefer `discriminated` when the members share a tag field.
 */
export class UnionSchema<S extends readonly Schema[]> extends Base<Infer<S[number]>> {
  readonly kind = "union" as const;
  constructor(readonly members: S, meta: FieldMeta = {}) { super(meta); }
  override parse(value: unknown, path: string, ctx: ParseContext): Infer<S[number]> {
    let best: { issues: SchemaIssue[]; result: unknown } | undefined;
    for (const member of this.members) {
      const local: ParseContext = { issues: [] };
      const result = member.parse(value, path, local);
      if (local.issues.length === 0) return result as Infer<S[number]>;
      if (!best || local.issues.length < best.issues.length) best = { issues: local.issues, result };
    }
    if (best) ctx.issues.push(...best.issues);
    else fail(ctx, path, "union has no members");
    return (best?.result ?? value) as Infer<S[number]>;
  }
  override clone(meta: FieldMeta): UnionSchema<S> { return new UnionSchema(this.members, meta); }
}

/** Tagged union keyed on one string field, for exact diagnostics and form switching. */
export class DiscriminatedSchema<K extends string, M extends Record<string, Schema>> extends Base<Infer<M[keyof M]>> {
  readonly kind = "union" as const;
  constructor(readonly tag: K, readonly members: M, meta: FieldMeta = {}) { super(meta); }
  override parse(value: unknown, path: string, ctx: ParseContext): Infer<M[keyof M]> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      fail(ctx, path, `expected object, got ${typeName(value)}`);
      return value as Infer<M[keyof M]>;
    }
    const tag = (value as Record<string, unknown>)[this.tag];
    const member = typeof tag === "string" && Object.hasOwn(this.members, tag) ? this.members[tag] : undefined;
    if (!member) {
      fail(ctx, child(path, this.tag), `expected one of ${Object.keys(this.members).map((key) => JSON.stringify(key)).join(", ")}, got ${JSON.stringify(tag)}`);
      return value as Infer<M[keyof M]>;
    }
    return member.parse(value, path, ctx) as Infer<M[keyof M]>;
  }
  override clone(meta: FieldMeta): DiscriminatedSchema<K, M> { return new DiscriminatedSchema(this.tag, this.members, meta); }
}

/** Defers construction so recursive shapes (dialogue trees) can reference themselves. */
export class LazySchema<T> extends Base<T> {
  readonly kind = "lazy" as const;
  private resolved: Schema<T> | undefined;
  constructor(readonly factory: () => Schema<T>, meta: FieldMeta = {}) { super(meta); }
  get inner(): Schema<T> { return (this.resolved ??= this.factory()); }
  override parse(value: unknown, path: string, ctx: ParseContext): T { return this.inner.parse(value, path, ctx); }
  override clone(meta: FieldMeta): LazySchema<T> { return new LazySchema(this.factory, meta); }
}

/** Adds a predicate on top of any schema; the message names the rule that failed. */
export class RefinedSchema<T> extends Base<T> {
  readonly kind: SchemaKind;
  constructor(readonly inner: Schema<T>, readonly predicate: (value: T) => boolean, readonly message: string, meta: FieldMeta = {}) {
    super(meta);
    this.kind = inner.kind;
  }
  override parse(value: unknown, path: string, ctx: ParseContext): T {
    const before = ctx.issues.length;
    const parsed = this.inner.parse(value, path, ctx);
    if (ctx.issues.length === before && !this.predicate(parsed)) fail(ctx, path, this.message);
    return parsed;
  }
  override clone(meta: FieldMeta): RefinedSchema<T> { return new RefinedSchema(this.inner, this.predicate, this.message, meta); }
}

// ---------------------------------------------------------------- factories

export function str(options: StringOptions = {}, meta: FieldMeta = {}): StringSchema { return new StringSchema(options, meta); }
export function num(options: NumberOptions = {}, meta: FieldMeta = {}): NumberSchema { return new NumberSchema(options, meta); }
export function int(options: Omit<NumberOptions, "integer"> = {}, meta: FieldMeta = {}): NumberSchema { return new NumberSchema({ ...options, integer: true }, meta); }
export function bool(meta: FieldMeta = {}): BooleanSchema { return new BooleanSchema(meta); }
export function lit<V extends Primitive>(value: V, meta: FieldMeta = {}): LiteralSchema<V> { return new LiteralSchema(value, meta); }
export function enumOf<V extends string>(options: readonly V[], meta: FieldMeta = {}): EnumSchema<V> { return new EnumSchema(options, meta); }
export function unknown(meta: FieldMeta = {}): UnknownSchema { return new UnknownSchema(meta); }
export function arr<T>(item: Schema<T>, options: ArrayOptions = {}, meta: FieldMeta = {}): ArraySchema<T> { return new ArraySchema(item, options, meta); }
export function tuple<S extends readonly Schema[]>(items: S, meta: FieldMeta = {}): TupleSchema<S> { return new TupleSchema(items, meta); }
export function obj<F extends Record<string, Schema>>(fields: F, options: ObjectOptions = {}, meta: FieldMeta = {}): ObjectSchema<F> { return new ObjectSchema(fields, options, meta); }
export function rec<V>(value: Schema<V>, meta?: FieldMeta): RecordSchema<string, V>;
export function rec<K extends string, V>(value: Schema<V>, key: Schema<K>, meta?: FieldMeta): RecordSchema<K, V>;
export function rec<K extends string, V>(value: Schema<V>, keyOrMeta?: Schema<K> | FieldMeta, meta: FieldMeta = {}): RecordSchema<K, V> {
  const isSchema = keyOrMeta !== undefined && typeof (keyOrMeta as Schema).parse === "function";
  return new RecordSchema<K, V>(value, isSchema ? (keyOrMeta as Schema<K>) : undefined, isSchema ? meta : ((keyOrMeta as FieldMeta | undefined) ?? {}));
}
export function opt<T>(inner: Schema<T>, meta: FieldMeta = {}): OptionalSchema<T> { return new OptionalSchema(inner, meta); }
export function nullable<T>(inner: Schema<T>, meta: FieldMeta = {}): NullableSchema<T> { return new NullableSchema(inner, meta); }
export function union<S extends readonly Schema[]>(members: S, meta: FieldMeta = {}): UnionSchema<S> { return new UnionSchema(members, meta); }
export function discriminated<K extends string, M extends Record<string, Schema>>(tag: K, members: M, meta: FieldMeta = {}): DiscriminatedSchema<K, M> {
  return new DiscriminatedSchema(tag, members, meta);
}
export function lazy<T>(factory: () => Schema<T>, meta: FieldMeta = {}): LazySchema<T> { return new LazySchema(factory, meta); }
export function refine<T>(inner: Schema<T>, predicate: (value: T) => boolean, message: string): RefinedSchema<T> { return new RefinedSchema(inner, predicate, message); }

/** A string that names a row in another collection. */
export function ref(kind: RefKind, meta: FieldMeta = {}): StringSchema { return new StringSchema({ nonEmpty: true }, { ref: kind, ...meta }); }
/** A record id: non-empty, read-only save identity. */
export function id(meta: FieldMeta = {}): StringSchema { return new StringSchema({ nonEmpty: true }, { readOnly: true, identity: true, label: "Id", ...meta }); }

/** `[x, y, z]` in world metres. */
export const vec3 = tuple([num(), num(), num()] as const, { unit: "m" });
/** `[min, max]` inclusive integer range. */
export const intRange = refine(tuple([int(), int()] as const), ([min, max]) => min <= max, "min must be <= max");

// ---------------------------------------------------------------- collections

export interface CollectionOptions {
  /** Which field is the unique key. Default `id`. */
  idKey?: string;
  /** Collection name used as the root of every issue path. */
  name: string;
}

export interface CollectionResult<T> {
  records: T[];
  issues: SchemaIssue[];
}

export function formatIssues(issues: readonly SchemaIssue[], limit = 40): string {
  const lines = issues.slice(0, limit).map((issue) => `  [${issue.severity}] ${issue.path}: ${issue.message}`);
  if (issues.length > limit) lines.push(`  ... ${issues.length - limit} more`);
  return lines.join("\n");
}

/**
 * Validates an array of rows without throwing. Duplicate ids are errors: a duplicate silently
 * shadows a row in every by-id map the registry builds.
 */
export function validateCollection<T>(schema: Schema<T>, raw: unknown, options: CollectionOptions): CollectionResult<T> {
  const ctx: ParseContext = { issues: [] };
  const idKey = options.idKey ?? "id";
  if (!Array.isArray(raw)) {
    fail(ctx, options.name, `expected an array of records, got ${typeName(raw)}`);
    return { records: [], issues: ctx.issues };
  }
  const seen = new Map<string | number, number>();
  const records = raw.map((row, index) => {
    const rowId = row !== null && typeof row === "object" ? (row as Record<string, unknown>)[idKey] : undefined;
    const hasId = typeof rowId === "string" || typeof rowId === "number";
    const path = hasId ? `${options.name}[${index}:${rowId}]` : `${options.name}[${index}]`;
    if (hasId) {
      const first = seen.get(rowId);
      if (first !== undefined) fail(ctx, path, `duplicate ${idKey} "${rowId}" (first at index ${first})`);
      else seen.set(rowId, index);
    }
    return schema.parse(row, path, ctx);
  });
  return { records, issues: ctx.issues };
}

/** Parses a collection or throws with every issue listed. Loaders call this at import time. */
export function parseCollection<T>(schema: Schema<T>, raw: unknown, options: CollectionOptions): T[] {
  const { records, issues } = validateCollection(schema, raw, options);
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new Error(`Content collection "${options.name}" failed validation (${errors.length} error${errors.length === 1 ? "" : "s"}):\n${formatIssues(errors)}`);
  }
  return records;
}

/** Parses one value (a keyed table, a settings object) or throws with every issue listed. */
export function parseValue<T>(schema: Schema<T>, raw: unknown, name: string): T {
  const ctx: ParseContext = { issues: [] };
  const parsed = schema.parse(raw, name, ctx);
  const errors = ctx.issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new Error(`Content "${name}" failed validation (${errors.length} error${errors.length === 1 ? "" : "s"}):\n${formatIssues(errors)}`);
  }
  return parsed;
}

/**
 * Removes record extras that ship in the JSON but are not part of the runtime row (`catalog`,
 * `derivation`, `ladder`, ...). Loaders call this so exported tables equal the old literals exactly.
 */
export function stripExtras<T extends object, K extends keyof T>(record: T, keys: readonly K[]): Omit<T, K> {
  const copy = { ...record } as T;
  for (const key of keys) delete copy[key];
  return copy;
}

/** Walks a schema to its non-wrapper core, for form builders that need the concrete kind. */
export function unwrap(schema: Schema): Schema {
  let current = schema;
  for (;;) {
    if (current instanceof OptionalSchema || current instanceof NullableSchema || current instanceof RefinedSchema) current = current.inner;
    else if (current instanceof LazySchema) current = current.inner;
    else return current;
  }
}
