/**
 * The one way JSON reaches `game/content/`.
 *
 * Every writer (the migration export, the dev docs server, `content:format`, the promote tool) goes
 * through `formatContentJson` so a one-record edit produces a one-record diff: two-space indent,
 * LF line endings, a trailing newline, and keys in the order the record's schema declares them.
 * Key order is not enforced here by sorting, because schemas own the order; callers pass records
 * through their schema (`canonicalRecords`) before writing.
 */
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicReplaceFile } from "../lib/atomic-replace-file.js";
import { repoRoot, resolveInside } from "../lib/paths.js";
import { formatIssues, validateCollection, type Schema } from "../../game/src/content/schema/core.js";

export const contentRoot = path.join(repoRoot, "game", "content");
export const contentDataRoot = path.join(contentRoot, "data");
export const contentMetaRoot = path.join(contentRoot, "meta");

import { formatContentJson } from "../../game/src/content/compiler/canonical.js";
export { contentRevision, formatContentJson } from "../../game/src/content/compiler/canonical.js";

/**
 * Re-parses records through their schema so the written key order matches the schema and record
 * extras that the schema does not know are rejected rather than silently kept.
 */
export function canonicalRecords<T>(schema: Schema<T>, records: readonly unknown[], name: string, idKey = "id"): T[] {
  const result = validateCollection(schema, records, { name, idKey });
  const errors = result.issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) throw new Error(`Cannot format "${name}": records do not match their schema\n${formatIssues(errors)}`);
  return result.records;
}

/** Resolves a path under `game/content/`, refusing anything that escapes it. */
export function contentPath(relative: string): string {
  return resolveInside(contentRoot, path.join("game", "content", relative));
}

export async function readContentJson<T = unknown>(relative: string): Promise<T> {
  const text = await readFile(contentPath(relative), "utf8");
  return JSON.parse(text) as T;
}

/** Writes canonical JSON atomically; returns true when the bytes changed. */
export async function writeContentJson(relative: string, value: unknown): Promise<boolean> {
  const target = contentPath(relative);
  const next = formatContentJson(value);
  let current: string | undefined;
  try { current = await readFile(target, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (current === next) return false;
  await mkdir(path.dirname(target), { recursive: true });
  await atomicReplaceFile(target, next);
  return true;
}

