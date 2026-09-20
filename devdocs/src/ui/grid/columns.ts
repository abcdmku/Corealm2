import {
  ArraySchema, BooleanSchema, DiscriminatedSchema, EnumSchema, LiteralSchema, NumberSchema, ObjectSchema,
  RecordSchema, StringSchema, TupleSchema, UnionSchema, type Schema,
} from "../../../../game/src/content/schema/core.js";
import { fieldCore, fieldPath, recordLabelKey, serialFieldSpec, type SerialFieldSpec } from "../../model/fields.js";

/*
  Which schema fields become grid columns (docs/devdocs-inputs.md §3.7). Rows are records, columns
  are the scalar and reference fields of the record schema in schema order, with the display name
  first. An object one level down is flattened with a dotted header ("Equipment.Slot"); arrays,
  unions and maps are never columns, they get one count cell that opens the record.
*/

export type ColumnKind = "text" | "number" | "boolean" | "choice" | "ref" | "static" | "count";

export interface GridColumn {
  /** Dotted path; the persisted column id. */
  key: string;
  path: readonly string[];
  label: string;
  kind: ColumnKind;
  spec: SerialFieldSpec;
  /** Pixel width the column hugs. */
  width: number;
}

export const DEFAULT_VISIBLE = 8;

const WIDTH: Record<ColumnKind, number> = { text: 180, number: 88, boolean: 64, choice: 132, ref: 200, static: 120, count: 72 };

/** The object schema a collection's rows use; a top-level union or discriminated record takes its first variant. */
export function recordObject(schema: Schema): ObjectSchema<Record<string, Schema>> | undefined {
  let node = fieldCore(schema);
  if (node instanceof DiscriminatedSchema) { const first = (Object.values(node.members) as Schema[])[0]; if (first) node = fieldCore(first); }
  else if (node instanceof UnionSchema) { const first = (node.members as readonly Schema[])[0]; if (first) node = fieldCore(first); }
  return node instanceof ObjectSchema ? node as ObjectSchema<Record<string, Schema>> : undefined;
}

function classify(schema: Schema, spec: SerialFieldSpec): ColumnKind | "flatten" | undefined {
  const core = fieldCore(schema);
  if (spec.hidden || core instanceof LiteralSchema) return undefined;
  if (core instanceof ObjectSchema) return "flatten";
  if (core instanceof ArraySchema || core instanceof TupleSchema || core instanceof RecordSchema || core instanceof UnionSchema || core instanceof DiscriminatedSchema) return "count";
  if (spec.readOnly) return "static";
  if (core instanceof EnumSchema || spec.choices) return "choice";
  if (core instanceof StringSchema) return spec.ref ? "ref" : spec.multiline ? "static" : "text";
  if (core instanceof NumberSchema) return "number";
  if (core instanceof BooleanSchema) return "boolean";
  return "static";
}

function column(path: readonly string[], label: string, kind: ColumnKind, spec: SerialFieldSpec): GridColumn {
  return { key: path.join("."), path, label, kind, spec, width: WIDTH[kind] };
}

/** Every column the schema offers, display name first, then schema order. Nested objects flatten one level. */
export function defaultColumns(schema: Schema): GridColumn[] {
  const object = recordObject(schema);
  if (!object) return [];
  const out: GridColumn[] = [];
  for (const [key, field] of Object.entries(object.fields) as [string, Schema][]) {
    const spec = serialFieldSpec(field, key);
    const kind = classify(field, spec);
    if (!kind) continue;
    if (kind !== "flatten") { out.push(column([key], spec.label, kind, spec)); continue; }
    const inner = fieldCore(field) as ObjectSchema<Record<string, Schema>>;
    for (const [childKey, child] of Object.entries(inner.fields) as [string, Schema][]) {
      const childSpec = serialFieldSpec(child, childKey);
      const childKind = classify(child, childSpec);
      if (!childKind || childKind === "flatten") continue;
      out.push(column([key, childKey], `${spec.label}.${childSpec.label}`, childKind, { ...childSpec, optional: childSpec.optional || spec.optional }));
    }
  }
  const nameKey = recordLabelKey(schema);
  const nameIndex = nameKey ? out.findIndex(candidate => candidate.key === nameKey) : -1;
  if (nameIndex > 0) { const [name] = out.splice(nameIndex, 1); out.unshift({ ...name!, width: 220 }); }
  else if (nameIndex === 0) out[0] = { ...out[0]!, width: 220 };
  return out;
}

/** The first few columns, so a table never opens with every field showing. */
export const defaultVisible = (columns: readonly GridColumn[]): string[] => columns.slice(0, DEFAULT_VISIBLE).map(column => column.key);

/** A field the palette can set across a selection. `value` is typed in; the other two are chosen. */
export interface SettableField {
  key: string;
  path: readonly string[];
  label: string;
  kind: "choice" | "ref" | "value";
  spec: SerialFieldSpec;
}

/**
 * The enum and reference fields of a record schema, for "Set <field>…" on a selection. The grid's
 * own columns cover the flat cases; `extraPaths` (the hotkey table) adds the ones the grid shows as
 * a count instead, such as a leaf inside a union (`presentation.regionId`). A named
 * extra path is always offered even when its value is typed rather than chosen (`items.tier`).
 */
export function settableFields(schema: Schema, extraPaths: readonly (readonly string[])[] = []): SettableField[] {
  const out: SettableField[] = [];
  const seen = new Set<string>();
  const push = (path: readonly string[], label: string, spec: SerialFieldSpec, always = false) => {
    const key = path.join(".");
    const listed = Boolean(spec.choices || spec.ref);
    if (seen.has(key) || spec.readOnly || (!listed && !always)) return;
    seen.add(key);
    out.push({ key, path, label, kind: spec.ref ? "ref" : spec.choices ? "choice" : "value", spec });
  };
  for (const column of defaultColumns(schema)) if (column.kind === "choice" || column.kind === "ref") push(column.path, column.label, column.spec);
  for (const path of extraPaths) {
    const spec = fieldPath(schema, path);
    if (!spec) continue;
    const parent = path.length > 1 ? fieldPath(schema, path.slice(0, -1)) : undefined;
    push(path, parent ? `${parent.label}.${spec.label}` : spec.label, spec, true);
  }
  return out;
}

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Whether the records disagree at a path (a multi-selection shows "Mixed" there). */
export function isMixed(values: readonly unknown[]): boolean {
  if (values.length < 2) return false;
  const [first, ...rest] = values;
  return rest.some(value => !same(value, first));
}

/** What a count cell reads for an array, map or union value. */
export function countText(value: unknown, spec: SerialFieldSpec): string {
  if (value === undefined || value === null) return "—";
  if (Array.isArray(value)) return String(value.length);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (spec.variants) {
      if (spec.discriminator && typeof record[spec.discriminator] === "string") return spec.variants.find(variant => variant.key === record[spec.discriminator!])?.label ?? String(record[spec.discriminator]);
      // Untagged object variants are named by their leading key ("Table ID", "Drops").
      const keys = Object.keys(record);
      return spec.variants.find(variant => keys.some(key => variant.label.toLowerCase().startsWith(key.slice(0, 4).toLowerCase())))?.label ?? `${keys.length} keys`;
    }
    return `${Object.keys(record).length} keys`;
  }
  return String(value);
}

/** Stable client-side sort on one column. Numbers numerically, everything else as text; empties last. */
export function sortRows<T>(rows: readonly T[], read: (row: T) => unknown, direction: "asc" | "desc"): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return rows.map((row, index) => ({ row, index, value: read(row) })).sort((a, b) => {
    const av = a.value, bv = b.value;
    const aEmpty = av === undefined || av === null || av === "", bEmpty = bv === undefined || bv === null || bv === "";
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    let order = 0;
    if (typeof av === "number" && typeof bv === "number") order = av - bv;
    else if (typeof av === "boolean" && typeof bv === "boolean") order = Number(av) - Number(bv);
    else order = String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true, sensitivity: "base" });
    return order ? order * sign : a.index - b.index;
  }).map(entry => entry.row);
}
