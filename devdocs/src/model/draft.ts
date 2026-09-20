import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiDiagnostic, ContentOperation, ContentTransactionRequest, ContentTransactionResponse } from "../../shared/contracts.js";
import { backend, can } from "../api/backend.js";
import { collectionQuery } from "../api/client.js";
import type { ContentRow } from "./contracts.js";
import { contentRows, rowId } from "./rows.js";
import { draftKey, draftStore, useDraftEntry } from "./store.js";

/*
  One draft model for every purpose-built editor. A draft is a local copy of a record held in the
  shared store (`store.ts`); `set` and `setPath` commit immutable updates there (each one an undo
  step); `save` writes it with the revision the draft was opened against, so a concurrent edit turns
  into a conflict instead of a silent overwrite.
*/

export const CONFLICT_MESSAGE = "This file changed after you opened it. Your draft is still here. Reset the draft to load the current file before saving again.";

export type Path = readonly (string | number)[];

export function getPath(value: unknown, path: Path): unknown {
  let cursor: unknown = value;
  for (const key of path) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string | number, unknown>)[key];
  }
  return cursor;
}

/** Immutable set. `undefined` deletes the key. Creates objects or arrays along the way as needed. */
export function setPath<T>(value: T, path: Path, next: unknown): T {
  if (path.length === 0) return next as T;
  const [head, ...rest] = path;
  const container: unknown = value !== null && typeof value === "object" ? value : typeof head === "number" ? [] : {};
  if (Array.isArray(container)) {
    const copy = [...container];
    if (rest.length === 0 && next === undefined) copy.splice(head as number, 1);
    else copy[head as number] = setPath(copy[head as number], rest, next);
    return copy as T;
  }
  const copy: Record<string, unknown> = { ...(container as Record<string, unknown>) };
  if (rest.length === 0 && next === undefined) delete copy[String(head)];
  else copy[String(head)] = setPath(copy[String(head)], rest, next);
  return copy as T;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export interface RecordDraft<T extends ContentRow = ContentRow> {
  loading: boolean;
  error?: string;
  /** The record as last loaded or saved. */
  record?: T;
  /** The working copy. */
  draft?: T;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  saveError: string;
  diagnostics: ApiDiagnostic[];
  revision?: string;
  editable: boolean;
  set: (update: T | ((draft: T) => T)) => void;
  setPath: (path: Path, value: unknown) => void;
  save: () => Promise<boolean>;
  reset: () => void;
}

/** A draft of one record. The draft lives in the shared store, so it survives navigation and saves with everything else. */
export function useRecordDraft<T extends ContentRow = ContentRow>(collection: string, recordId: string | undefined): RecordDraft<T> {
  const queryClient = useQueryClient();
  const query = useQuery({ ...collectionQuery(collection), enabled: Boolean(collection && recordId) });
  const idKey = query.data?.collection.idKey ?? "id";
  const objectShaped = query.data?.collection.shape === "object";
  const serverRecord = useMemo(() => {
    if (!query.data || recordId === undefined) return undefined;
    // Object-shaped collections (balance, audio) are one record saved under the id "$collection".
    if (objectShaped) return query.data.data as T;
    return contentRows(query.data).find(row => rowId(row, idKey) === recordId) as T | undefined;
  }, [query.data, recordId, idKey, objectShaped]);
  const key = recordId === undefined ? undefined : draftKey(collection, recordId);

  useEffect(() => { draftStore.configure({ queryClient }); }, [queryClient]);
  // Adopt fresh server data; the store keeps the draft when it has unsaved edits.
  useEffect(() => {
    if (!query.data || recordId === undefined) return;
    draftStore.adopt({ collection, id: recordId, objectShaped, idKey, record: serverRecord, revision: query.data.revision });
  }, [query.data, collection, recordId, objectShaped, idKey, serverRecord]);

  const entry = useDraftEntry(key);
  const set = useCallback((update: T | ((draft: T) => T)) => {
    if (key === undefined) return;
    const current = draftStore.entry(key)?.draft as T | undefined;
    if (current === undefined) return;
    draftStore.commit(key, typeof update === "function" ? (update as (draft: T) => T)(current) : update);
  }, [key]);
  const setAt = useCallback((path: Path, value: unknown) => {
    if (key === undefined) return;
    const current = draftStore.entry(key)?.draft as T | undefined;
    if (current === undefined) return;
    draftStore.commit(key, setPath(current, path, value), path.join("."));
  }, [key]);
  const save = useCallback(() => key === undefined ? Promise.resolve(false) : draftStore.save(key), [key]);
  const reset = useCallback(() => { if (key !== undefined) draftStore.reset(key); }, [key]);

  return {
    loading: query.isPending, error: query.isError ? query.error.message : undefined,
    record: (entry?.base ?? serverRecord) as T | undefined, draft: entry?.draft as T | undefined,
    dirty: entry?.dirty ?? false, saving: entry?.saving ?? false, conflict: entry?.conflict ?? false,
    saveError: entry?.saveError ?? "", diagnostics: entry?.diagnostics ?? NO_DIAGNOSTICS, revision: entry?.revision,
    editable: can("write") && Boolean(query.data?.collection.editable),
    set, setPath: setAt, save, reset,
  };
}

const NO_DIAGNOSTICS: ApiDiagnostic[] = [];

/** Preview or save a multi-record change through whichever backend is installed. */
export async function runTransaction(operation: ContentTransactionRequest["operation"], revisions: Record<string, string>, changes: ContentOperation[]): Promise<ContentTransactionResponse> {
  const result = await backend().transact({ operation, revisions, changes });
  if (!result.ok) throw new Error(result.status === 409 ? CONFLICT_MESSAGE : result.body.error ?? `Request failed (${result.status})`);
  return result.body;
}

/** Diff two arrays of records into put/delete operations for `runTransaction`. */
export function recordOperations(collection: string, before: readonly ContentRow[], after: readonly ContentRow[], idKey = "id"): ContentOperation[] {
  const previous = new Map(before.map(row => [rowId(row, idKey), row]));
  const next = new Map(after.map(row => [rowId(row, idKey), row]));
  const operations: ContentOperation[] = [];
  for (const [id, row] of next) {
    const old = previous.get(id);
    if (!old) operations.push({ kind: "put", collection, id, record: row, create: true });
    else if (!same(old, row)) operations.push({ kind: "put", collection, id, record: row });
  }
  for (const id of previous.keys()) if (!next.has(id)) operations.push({ kind: "delete", collection, id });
  return operations;
}
