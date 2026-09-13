/** Save identity changes are explicit even when a record's schema remains valid. */
import { ArraySchema, ObjectSchema, DiscriminatedSchema, unwrap, type Schema } from "../../game/src/content/schema/core.js";
export interface IdentityIssue { path: string; message: string }

function nestedIdentity(schema: Schema, value: unknown, at = ""): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  const concrete = unwrap(schema);
  if (schema.meta.identity || concrete.meta.identity) return { [at]: value };
  const fields: Record<string, unknown> = {};
  if (concrete instanceof ObjectSchema && typeof value === "object") {
    for (const [key, field] of Object.entries(concrete.fields as Record<string, Schema>)) Object.assign(fields, nestedIdentity(field, (value as Record<string, unknown>)[key], `${at}.${key}`));
  } else if (concrete instanceof ArraySchema && Array.isArray(value)) {
    value.forEach((row, index) => Object.assign(fields, nestedIdentity(concrete.item, row, `${at}[${index}]`)));
  } else if (concrete instanceof DiscriminatedSchema && typeof value === "object") {
    const tag = (value as Record<string, unknown>)[concrete.tag];
    if (typeof tag === "string" && Object.hasOwn(concrete.members, tag)) Object.assign(fields, nestedIdentity(concrete.members[tag]!, value, at));
  }
  return fields;
}

export function checkIdentity(before: unknown, after: unknown, name: string, idKey = "id", ordered = false, schema?: Schema): IdentityIssue[] {
  const issues: IdentityIssue[] = [];
  if (!Array.isArray(before) || !Array.isArray(after)) return issues;
  const rowId = (row: unknown): unknown => row && typeof row === "object" ? (row as Record<string, unknown>)[idKey] : undefined;
  const previous = before.map(rowId), current = after.map(rowId);
  const previousSet = new Set(previous), currentSet = new Set(current);
  for (const id of previousSet) if (!currentSet.has(id)) issues.push({ path: name, message: `removed save identity ${String(id)}` });
  for (const id of currentSet) if (!previousSet.has(id)) issues.push({ path: name, message: `added save identity ${String(id)}` });
  if (ordered && JSON.stringify(previous) !== JSON.stringify(current)) issues.push({ path: name, message: "spawn record order changed" });
  const oldRows = new Map(before.map(row => [rowId(row), row as Record<string, unknown>]));
  for (const row of after as Record<string, unknown>[]) {
    const id = rowId(row), old = oldRows.get(id);
    if (!old) continue;
    for (const field of ["count", "legacyCount"] as const) {
      if (JSON.stringify(old[field]) !== JSON.stringify(row[field])) issues.push({ path: `${name}.${String(id)}.${field}`, message: "save identity value changed" });
    }
    if (schema) {
      const oldIdentity = nestedIdentity(schema, old), newIdentity = nestedIdentity(schema, row);
      for (const field of new Set([...Object.keys(oldIdentity), ...Object.keys(newIdentity)])) {
        if (JSON.stringify(oldIdentity[field]) !== JSON.stringify(newIdentity[field])) issues.push({ path: `${name}.${String(id)}${field}`, message: "nested save identity changed" });
      }
    }
  }
  return issues;
}
