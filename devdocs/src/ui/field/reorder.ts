import {
  DiscriminatedSchema, LiteralSchema, ObjectSchema, UnionSchema, type Schema,
} from "../../../../game/src/content/schema/core.js";
import { defaultFieldValue, fieldCore, serialFieldSpec } from "../../model/fields.js";
import { tidy } from "./model.js";

/*
  The list fields' logic without React: reordering, weight redistribution behind the lock toggles,
  probability clamping and what survives a union variant switch. `ListField`, `WeightedList` and
  `UnionField` call these; `tests/devdocs-list-field.test.ts` pins them.
*/

/** A copy with the item at `from` placed at `to`. Out-of-range or same-index moves return a copy. */
export function move<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items];
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item as T);
  return out;
}

/** Each weight as a share of the total, 0..1. All-zero weights share nothing. */
export function shares(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  return weights.map(weight => total > 0 ? Math.max(0, weight) / total : 0);
}

const round4 = (value: number): number => tidy(Math.round(value * 1e4) / 1e4);

/**
 * Set `weights[index]` to `next` while keeping the total: the other unlocked weights scale to
 * absorb the difference in proportion to what they were. Locked rows are never touched. The edit
 * is clamped to what the unlocked rows can give up, so nothing goes below zero. Editing a locked
 * row, or a row with no unlocked neighbour, is a no-op because the total could not be kept.
 */
export function redistribute(weights: readonly number[], index: number, next: number, locked: readonly boolean[] = []): number[] {
  const out = [...weights];
  if (index < 0 || index >= weights.length || locked[index]) return out;
  const free = weights.map((_, at) => at).filter(at => at !== index && !locked[at]);
  if (!free.length) return out;
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const lockedSum = weights.reduce((sum, weight, at) => sum + (at !== index && locked[at] ? weight : 0), 0);
  const available = Math.max(0, total - lockedSum);
  const target = Math.min(available, Math.max(0, next));
  const remainder = available - target;
  const freeSum = free.reduce((sum, at) => sum + (weights[at] ?? 0), 0);
  out[index] = round4(target);
  let given = 0;
  free.forEach((at, position) => {
    const last = position === free.length - 1;
    const share = freeSum > 0 ? (weights[at] ?? 0) / freeSum : 1 / free.length;
    const value = last ? remainder - given : round4(remainder * share);
    given += value;
    out[at] = round4(value);
  });
  return out;
}

/** A probability is 0..1, nothing else. Non-finite input reads as 0. */
export function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return tidy(Math.min(1, Math.max(0, value)));
}

/** The member schema for one variant key (`serialFieldSpec(...).variants[i].key`). */
export function variantSchema(source: Schema, key: string): Schema | undefined {
  const node = fieldCore(source);
  if (node instanceof DiscriminatedSchema) return (node.members as Record<string, Schema>)[key];
  if (node instanceof UnionSchema) return (node.members as readonly Schema[])[Number(key)];
  return undefined;
}

/** The tag key of a discriminated union, so the tag field is not rendered as an editable literal. */
export function variantTag(source: Schema): string | undefined {
  const node = fieldCore(source);
  return node instanceof DiscriminatedSchema ? node.tag : undefined;
}

export interface CarryOver {
  /** The value for the new variant: its defaults, with same-named fields copied across. */
  value: Record<string, unknown>;
  kept: string[];
  /** Fields of the old variant with a non-default value that the new variant has no place for. */
  dropped: { key: string; label: string; value: unknown }[];
}

const isLiteral = (schema: Schema): boolean => fieldCore(schema) instanceof LiteralSchema;
const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Switching a union member from one variant to another keeps the fields the two share by name
 * and kind. Anything else on the old value is dropped; it is reported only when it held something
 * other than its default, which is when the switch deserves a confirmation.
 */
export function carryOver(from: Schema, to: Schema, value: unknown): CarryOver {
  const fromCore = fieldCore(from);
  const toCore = fieldCore(to);
  const current = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const base = defaultFieldValue(to);
  const next: Record<string, unknown> = base !== null && typeof base === "object" && !Array.isArray(base) ? { ...base as Record<string, unknown> } : {};
  const kept: string[] = [];
  const dropped: CarryOver["dropped"] = [];
  const fromFields = fromCore instanceof ObjectSchema ? fromCore.fields as Record<string, Schema> : {};
  const toFields = toCore instanceof ObjectSchema ? toCore.fields as Record<string, Schema> : {};
  for (const [key, target] of Object.entries(toFields)) {
    if (isLiteral(target)) continue;
    const source = fromFields[key];
    if (!source || isLiteral(source) || current[key] === undefined) continue;
    if (serialFieldSpec(source, key).kind !== serialFieldSpec(target, key).kind) continue;
    next[key] = current[key];
    kept.push(key);
  }
  for (const [key, source] of Object.entries(fromFields)) {
    if (isLiteral(source) || kept.includes(key) || current[key] === undefined) continue;
    if (same(current[key], defaultFieldValue(source))) continue;
    dropped.push({ key, label: serialFieldSpec(source, key).label, value: current[key] });
  }
  return { value: next, kept, dropped };
}
