import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateCollection, type ParseContext } from '../../../game/src/content/schema/core.js';
import { CONTENT_COLLECTIONS, type ContentCollection } from '../../../tools/content/collections.js';
import { compileContent } from '../../../tools/content/compile.js';
import type { ApiDiagnostic } from '../../shared/contracts.js';
import type { ReferencePools } from '../../../tools/content/references.js';
export interface CollectionSnapshot { data: unknown; text: string; revision?: string }
export type CollectionSnapshots = ReadonlyMap<string, CollectionSnapshot>;
export function collectionFile(root: string, spec: ContentCollection): string {
  const file = path.resolve(root, spec.file), relative = path.relative(path.resolve(root), file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Collection path leaves root');
  return file;
}
export function parseAuthoredCollection(spec: ContentCollection, raw: unknown): {data: unknown; diagnostics: ApiDiagnostic[]} {
  if (spec.shape === 'array') { const result = validateCollection(spec.schema, raw, {name: spec.name, idKey: spec.idKey}); return {data: result.records, diagnostics: result.issues}; }
  const context: ParseContext = {issues: []}; const data = spec.schema.parse(raw, spec.name, context);
  return {data, diagnostics: context.issues};
}
export async function loadCollectionSnapshots(root: string): Promise<Map<string, CollectionSnapshot>> {
  return new Map(await Promise.all(CONTENT_COLLECTIONS.map(async spec => { const text = await readFile(collectionFile(root, spec), 'utf8'); return [spec.name, {text, data: JSON.parse(text)}] as const; })));
}
export function validateCollectionOverlay(snapshots: CollectionSnapshots, spec: ContentCollection, proposed: unknown, _recordId: string | readonly string[], external: ReferencePools = {}) {
  const values = new Map([...snapshots].map(([name, entry]) => [name, entry.data])); values.set(spec.name, proposed);
  const result = compileContent(values, external); return {data: proposed, diagnostics: result.diagnostics};
}
