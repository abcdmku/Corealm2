import {
  ArraySchema, DiscriminatedSchema, ObjectSchema, RecordSchema, TupleSchema, UnionSchema,
  unwrap, type RefKind, type Schema, type SchemaIssue,
} from "../../game/src/content/schema/core.js";

export type ReferencePools = Partial<Record<RefKind, ReadonlySet<string>>>;

/** Unpromoted lab-only creature models remain visible warnings; shipped assets are required. */
export function collectionReferenceIssues(collection: string, schema: Schema, row: unknown, pools: ReferencePools, at: string): SchemaIssue[] {
  const staged = collection === 'creatures' && row !== null && typeof row === 'object'
    && (row as Record<string, unknown>).stage === 'labOnly';
  return checkReferences(schema, row, pools, at).map(message => {
    const separator = message.indexOf(': ');
    const path = message.slice(0, separator);
    return { path, message: message.slice(separator + 2),
      severity: staged && path === `${at}.assetId` ? 'warning' : 'error' };
  });
}

/** Follow schema metadata, including nested quest predicates and conditional dialogue branches. */
export function checkReferences(schema: Schema, value: unknown, pools: ReferencePools, at: string): string[] {
  if (value === undefined || value === null) return [];
  const errors: string[] = [];
  const concrete = unwrap(schema), kind = schema.meta.ref ?? concrete.meta.ref;
  if (kind && typeof value === "string" && pools[kind] && !pools[kind]!.has(value)) errors.push(`${at}: unknown ${kind} reference ${JSON.stringify(value)}`);
  if (concrete instanceof ObjectSchema && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, field] of Object.entries(concrete.fields as Record<string, Schema>)) errors.push(...checkReferences(field, (value as Record<string, unknown>)[key], pools, `${at}.${key}`));
  } else if (concrete instanceof ArraySchema && Array.isArray(value)) {
    value.forEach((entry, index) => errors.push(...checkReferences(concrete.item, entry, pools, `${at}[${index}]`)));
  } else if (concrete instanceof TupleSchema && Array.isArray(value)) {
    concrete.items.forEach((field: Schema, index: number) => errors.push(...checkReferences(field, value[index], pools, `${at}[${index}]`)));
  } else if (concrete instanceof RecordSchema && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (concrete.key) errors.push(...checkReferences(concrete.key, key, pools, `${at}.${key}`));
      errors.push(...checkReferences(concrete.value, entry, pools, `${at}.${key}`));
    }
  } else if (concrete instanceof DiscriminatedSchema && typeof value === "object") {
    const tag = (value as Record<string, unknown>)[concrete.tag];
    if (typeof tag === "string" && Object.hasOwn(concrete.members, tag)) errors.push(...checkReferences(concrete.members[tag]!, value, pools, at));
  } else if (concrete instanceof UnionSchema) {
    for (const member of concrete.members) {
      const ctx = { issues: [] };
      member.parse(value, at, ctx);
      if (ctx.issues.length === 0) { errors.push(...checkReferences(member, value, pools, at)); break; }
    }
  }
  return errors;
}
