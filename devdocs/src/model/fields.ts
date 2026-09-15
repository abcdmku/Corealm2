import {
  ArraySchema, DiscriminatedSchema, EnumSchema, LazySchema, LiteralSchema, NullableSchema,
  NumberSchema, ObjectSchema, OptionalSchema, RecordSchema, RefinedSchema, StringSchema,
  TupleSchema, UnionSchema, type FieldMeta, type Schema, type SchemaIssue, type SchemaKind,
} from "../../../game/src/content/schema/core.js";

export interface SerialFieldSpec extends FieldMeta {
  kind: SchemaKind;
  label: string;
  optional: boolean;
  nullable: boolean;
  min?: number;
  max?: number;
  exclusiveMin?: number;
  exclusiveMax?: number;
  integer?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  choices?: (string | number | boolean | null)[];
  discriminator?: string;
  variants?: { key: string; label: string }[];
  refinements: string[];
}

export function fieldTitle(name: string): string { return name.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, c => c.toUpperCase()).replace(/\bXp\b/g, "XP").replace(/\bId\b/g, "ID"); }

/** Unwrap only this level. Recursive lazy schemas are expanded by the form as values are visited. */
export function fieldCore(schema: Schema): Schema {
  let node = schema;
  const seen = new Set<Schema>();
  while (!seen.has(node)) {
    seen.add(node);
    if (node instanceof OptionalSchema || node instanceof NullableSchema || node instanceof RefinedSchema || node instanceof LazySchema) node = node.inner;
    else break;
  }
  return node;
}

/** No schema instances, predicates, regex objects or functions escape into this descriptor. */
export function serialFieldSpec(schema: Schema, name = ""): SerialFieldSpec {
  let node = schema;
  let optional = false;
  let nullable = false;
  const layers: FieldMeta[] = [];
  const refinements: string[] = [];
  const seen = new Set<Schema>();
  while (!seen.has(node)) {
    seen.add(node);
    layers.push(node.meta);
    if (node instanceof OptionalSchema) { optional = true; node = node.inner; }
    else if (node instanceof NullableSchema) { nullable = true; node = node.inner; }
    else if (node instanceof RefinedSchema) { refinements.push(node.message); node = node.inner; }
    else if (node instanceof LazySchema) node = node.inner;
    else break;
  }
  const meta: FieldMeta = Object.assign({}, ...layers.reverse());
  const spec: SerialFieldSpec = { ...meta, kind: node.kind, label: meta.label ?? fieldTitle(name), optional, nullable, refinements };
  if (meta.identity) spec.readOnly = true;
  if (node instanceof NumberSchema) { Object.assign(spec, node.options); spec.step = meta.step ?? (node.options.integer ? 1 : undefined); }
  if (node instanceof StringSchema) { spec.minLength = node.options.minLength ?? (node.options.nonEmpty ? 1 : undefined); spec.maxLength = node.options.maxLength; spec.pattern = node.options.pattern?.source; }
  if (node instanceof ArraySchema) Object.assign(spec, node.options);
  if (node instanceof EnumSchema) spec.choices = [...node.options];
  if (node instanceof LiteralSchema) spec.choices = [node.value];
  if (node instanceof DiscriminatedSchema) { spec.discriminator = node.tag; spec.variants = (Object.entries(node.members) as [string, Schema][]).map(([key, member]) => ({ key, label: member.meta.label ?? fieldTitle(key) })); }
  if (node instanceof UnionSchema) {
    const members = node.members as readonly Schema[];
    if (members.every(member => fieldCore(member) instanceof LiteralSchema)) spec.choices = members.map(member => (fieldCore(member) as LiteralSchema<string>).value);
    else spec.variants = members.map((member, index) => {
      const core = fieldCore(member);
      const tag = core instanceof ObjectSchema ? (Object.values(core.fields) as Schema[]).find(field => fieldCore(field) instanceof LiteralSchema) : undefined;
      // Untagged object variants are told apart by their leading fields ("Table ID" vs "Drops").
      const keys = core instanceof ObjectSchema ? Object.keys(core.fields).filter(key => !serialFieldSpec(core.fields[key] as Schema, key).optional).slice(0, 2).map(fieldTitle).join(" + ") : "";
      return { key: String(index), label: member.meta.label ?? (tag ? fieldTitle(String((fieldCore(tag) as LiteralSchema<string>).value)) : keys || fieldTitle(core.kind)) };
    });
  }
  return spec;
}

export function fieldIssues(schema: Schema, value: unknown, path = ""): SchemaIssue[] { const context = { issues: [] as SchemaIssue[] }; schema.parse(value, path, context); return context.issues; }

/** Unwrap one level and, for a union, descend into the member the value actually matches. */
function branch(schema: Schema, value: unknown): Schema {
  let node = fieldCore(schema);
  const seen = new Set<Schema>();
  while ((node instanceof DiscriminatedSchema || node instanceof UnionSchema) && !seen.has(node)) {
    seen.add(node);
    const key = unionVariant(node, value);
    const member = node instanceof DiscriminatedSchema ? (node.members as Record<string, Schema>)[key] : (node.members as readonly Schema[])[Number(key)];
    if (!member) return node;
    node = fieldCore(member);
  }
  return node;
}

/**
 * The spec for one field inside a record schema, addressed the way a draft addresses its value:
 * object keys as strings, array and tuple entries as numbers. Optional, nullable, refined and lazy
 * wrappers are stepped through. Pass `value` when the path crosses a union, so the walk can pick
 * the member the record is actually using.
 */
export function fieldPath(schema: Schema, path: readonly (string | number)[], value?: unknown): SerialFieldSpec | undefined {
  let node = schema;
  let current = value;
  let name = "";
  for (const key of path) {
    const core = branch(node, current);
    const next = typeof key === "number"
      ? core instanceof ArraySchema ? core.item : core instanceof TupleSchema ? (core.items as readonly Schema[])[key] : undefined
      : core instanceof ObjectSchema ? (core.fields as Record<string, Schema>)[key] : core instanceof RecordSchema ? core.value : undefined;
    if (!next) return undefined;
    current = current !== null && typeof current === "object" ? (current as Record<string | number, unknown>)[key] : undefined;
    node = next;
    // An index keeps the array's own name, so ["stock", 0] still reads "Stock".
    if (typeof key === "string") name = key;
  }
  return serialFieldSpec(node, name);
}

/**
 * The key holding a record's display name: whichever field the schema marks `display`, else a
 * field literally called `name`. Undefined when the record has neither and must show its id.
 */
export function recordLabelKey(schema: Schema): string | undefined {
  const node = branch(schema, undefined);
  if (!(node instanceof ObjectSchema)) return undefined;
  const entries = Object.entries(node.fields) as [string, Schema][];
  const marked = entries.find(([, field]) => serialFieldSpec(field).display);
  if (marked) return marked[0];
  return entries.some(([key]) => key === "name") ? "name" : undefined;
}

export function unionVariant(source: Schema, value: unknown): string {
  const schema = fieldCore(source);
  if (schema instanceof DiscriminatedSchema) {
    const tag = value && typeof value === "object" ? (value as Record<string, unknown>)[schema.tag] : undefined;
    return typeof tag === "string" && Object.hasOwn(schema.members, tag) ? tag : Object.keys(schema.members)[0] ?? "";
  }
  let best = 0;
  let fewest = Infinity;
  if (!(schema instanceof UnionSchema)) return "";
  (schema.members as readonly Schema[]).forEach((member, index) => { const count = fieldIssues(member, value).length; if (count < fewest) { fewest = count; best = index; } });
  return String(best);
}

export function defaultFieldValue(schema: Schema, depth = 0): unknown {
  const spec = serialFieldSpec(schema);
  const node = fieldCore(schema);
  if (spec.optional) return undefined;
  if (spec.nullable) return null;
  if (depth > 24) return null;
  if (node instanceof LiteralSchema) return node.value;
  if (node instanceof EnumSchema) return node.options[0] ?? "";
  if (node instanceof NumberSchema) {
    const step = node.options.integer ? 1 : .01;
    const min = node.options.min ?? (node.options.exclusiveMin !== undefined ? node.options.exclusiveMin + step : undefined);
    const max = node.options.max ?? (node.options.exclusiveMax !== undefined ? node.options.exclusiveMax - step : undefined);
    let value = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, 0));
    if (node.options.integer) value = Math.ceil(value);
    return value;
  }
  if (node instanceof StringSchema) return "";
  if (node.kind === "boolean") return false;
  if (node instanceof ObjectSchema) return Object.fromEntries(Object.entries(node.fields).filter(([, field]) => !serialFieldSpec(field as Schema).optional).map(([key, field]) => [key, defaultFieldValue(field as Schema, depth + 1)]));
  if (node instanceof ArraySchema) return Array.from({ length: node.options.minLength ?? 0 }, () => defaultFieldValue(node.item, depth + 1));
  if (node instanceof TupleSchema) return (node.items as readonly Schema[]).map(item => defaultFieldValue(item, depth + 1));
  if (node instanceof RecordSchema) return {};
  if (node instanceof UnionSchema) return node.members[0] ? defaultFieldValue(node.members[0], depth + 1) : null;
  if (node instanceof DiscriminatedSchema) { const member = (Object.values(node.members) as Schema[])[0]; return member ? defaultFieldValue(member, depth + 1) : null; }
  return null;
}

/** Structural controls cannot remove or reorder rows containing saved identity fields. */
export function containsIdentity(schema: Schema, seen = new Set<Schema>()): boolean {
  if (serialFieldSpec(schema).identity || serialFieldSpec(schema).readOnly) return true;
  const node = fieldCore(schema);
  if (seen.has(node)) return false;
  seen.add(node);
  if (node instanceof ObjectSchema) return Object.entries(node.fields).some(([name, field]) => ["count", "legacyCount"].includes(name) || containsIdentity(field as Schema, seen));
  if (node instanceof ArraySchema) return containsIdentity(node.item, seen);
  if (node instanceof TupleSchema) return (node.items as readonly Schema[]).some(item => containsIdentity(item, seen));
  if (node instanceof RecordSchema) return containsIdentity(node.value, seen);
  if (node instanceof UnionSchema) return (node.members as readonly Schema[]).some(item => containsIdentity(item, seen));
  if (node instanceof DiscriminatedSchema) return (Object.values(node.members) as Schema[]).some(item => containsIdentity(item, seen));
  return false;
}
