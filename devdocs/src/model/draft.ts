import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ApiDiagnostic, CollectionResponse, ContentOperation, ContentTransactionRequest, ContentTransactionResponse } from "../../shared/contracts.js";
import { collectionQuery } from "../api/client.js";
import type { ContentRow } from "./contracts.js";
import { contentRows, rowId } from "./rows.js";

/*
  One draft model for every purpose-built editor. A draft is a local copy of a record; `set` and
  `setPath` mutate it immutably; `save` writes it with the revision the draft was opened against,
  so a concurrent edit turns into a conflict instead of a silent overwrite.
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

/** A draft of one record in an array-shaped collection. */
export function useRecordDraft<T extends ContentRow = ContentRow>(collection: string, recordId: string | undefined): RecordDraft<T> {
  const queryClient = useQueryClient();
  const query = useQuery({ ...collectionQuery(collection), enabled: Boolean(collection && recordId) });
  const idKey = query.data?.collection.idKey ?? "id";
  const objectShaped = query.data?.collection.shape === "object";
  const record = useMemo(() => {
    if (!query.data || recordId === undefined) return undefined;
    // Object-shaped collections (balance, audio) are one record saved under the id "$collection".
    if (objectShaped) return query.data.data as T;
    return contentRows(query.data).find(row => rowId(row, idKey) === recordId) as T | undefined;
  }, [query.data, recordId, idKey, objectShaped]);
  const [draft, setDraft] = useState<T | undefined>(undefined);
  const [baseRevision, setBaseRevision] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [diagnostics, setDiagnostics] = useState<ApiDiagnostic[]>([]);
  const dirtyRef = useRef(false);
  const dirty = draft !== undefined && record !== undefined && !same(draft, record);
  dirtyRef.current = dirty;

  // Adopt fresh server data unless the user has unsaved edits.
  useEffect(() => {
    if (!query.data) return;
    if (dirtyRef.current || conflict) return;
    setDraft(record ? structuredClone(record) : undefined);
    setBaseRevision(query.data.revision);
  }, [query.data, record, conflict]);

  const set = useCallback((update: T | ((draft: T) => T)) => {
    setDraft(previous => previous === undefined ? previous : typeof update === "function" ? (update as (draft: T) => T)(previous) : update);
    setSaveError(""); setDiagnostics([]);
  }, []);
  const setAt = useCallback((path: Path, value: unknown) => set(previous => setPath(previous, path, value)), [set]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!draft || !query.data || baseRevision === undefined || conflict) return false;
    setSaving(true); setSaveError(""); setDiagnostics([]);
    try {
      const target = objectShaped ? "$collection" : recordId ?? "";
      const response = await fetch(`/__devdocs/collections/${encodeURIComponent(collection)}/${encodeURIComponent(target)}`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: baseRevision, record: draft }),
      });
      const body = await response.json() as CollectionResponse & { error?: string; diagnostics?: ApiDiagnostic[] };
      if (!response.ok) {
        setDiagnostics(body.diagnostics ?? []);
        setConflict(response.status === 409);
        setSaveError(response.status === 409 ? CONFLICT_MESSAGE : body.error ?? `Save failed (${response.status}). Your draft is still here.`);
        return false;
      }
      queryClient.setQueryData(collectionQuery(collection).queryKey, body);
      setBaseRevision(body.revision);
      setDiagnostics(body.diagnostics ?? []);
      toast.success("Saved");
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The save could not be completed. Your draft is still here.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, query.data, baseRevision, conflict, collection, recordId, queryClient, objectShaped]);

  const reset = useCallback(() => {
    setConflict(false); setSaveError(""); setDiagnostics([]);
    dirtyRef.current = false;
    void queryClient.invalidateQueries({ queryKey: collectionQuery(collection).queryKey }).then(() => {
      const fresh = queryClient.getQueryData<CollectionResponse>(collectionQuery(collection).queryKey);
      if (!fresh) return;
      const row = (fresh.collection.shape === "object" ? fresh.data : contentRows(fresh).find(entry => rowId(entry, fresh.collection.idKey) === recordId)) as T | undefined;
      setDraft(row ? structuredClone(row) : undefined);
      setBaseRevision(fresh.revision);
    });
  }, [queryClient, collection, recordId]);

  return {
    loading: query.isPending, error: query.isError ? query.error.message : undefined,
    record, draft, dirty, saving, conflict, saveError, diagnostics, revision: baseRevision,
    editable: !__DEVDOCS_PLAYER__ && Boolean(query.data?.collection.editable),
    set, setPath: setAt, save, reset,
  };
}

/** Preview or save a multi-record change through the shared transaction endpoint. */
export async function runTransaction(operation: ContentTransactionRequest["operation"], revisions: Record<string, string>, changes: ContentOperation[]): Promise<ContentTransactionResponse> {
  const response = await fetch("/__devdocs/transaction", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, revisions, changes } satisfies ContentTransactionRequest) });
  const body = await response.json() as ContentTransactionResponse & { error?: string };
  if (!response.ok) throw new Error(response.status === 409 ? CONFLICT_MESSAGE : body.error ?? `Request failed (${response.status})`);
  return body;
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
