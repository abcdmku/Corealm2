import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { ApiDiagnostic, CollectionResponse, ContentOperation, ContentTransactionRequest, ContentTransactionResponse } from "../../shared/contracts.js";
import { collectionQuery } from "../api/client.js";
import type { ContentRow } from "./contracts.js";
import { contentRows, rowId, rowName } from "./rows.js";

/*
  One draft store for the whole editor. Record drafts live here keyed by `collection/id`, so a
  page can unmount and remount without losing edits, and one save bar in the shell can write every
  dirty record as a single transaction. Editors that are not one record (the world map's
  multi-collection draft, the schema form) register as contributors and are saved in the same
  transaction. Undo and redo are patches on this store, so they work the same on every page.
*/

export const draftKey = (collection: string, id: string): string => `${collection}/${id}`;

export interface RecordEntry {
  key: string;
  collection: string;
  id: string;
  /** Object-shaped collections (balance, audio) are one record saved under the id "$collection". */
  objectShaped: boolean;
  name: string;
  /** The record as last loaded or saved, and the collection revision it came from. */
  base?: ContentRow;
  revision?: string;
  /** The working copy. */
  draft?: ContentRow;
  dirty: boolean;
  saving: boolean;
  saveError: string;
  conflict: boolean;
  /** The current record on disk while `conflict` is set, for the Compare view. */
  server?: { record?: ContentRow; revision: string };
  diagnostics: ApiDiagnostic[];
}

export interface TransactionFailure { error?: string; diagnostics?: ApiDiagnostic[]; revisions?: Record<string, string> }

/** An editor whose draft is not a single record but still saves through the shared transaction. */
export interface Contributor {
  key: string;
  label: string;
  /** Workspace key for the sidebar badge, and the route the change chip navigates to. */
  workspace?: string;
  route?: readonly [target: string, id?: string];
  isDirty(): boolean;
  /** How many records the contributor would write; defaults to the operation count. */
  count?(): number;
  operations(): ContentOperation[] | Promise<ContentOperation[]>;
  revisions(): Record<string, string>;
  reset(): void;
  afterSave(response: ContentTransactionResponse): void;
  onError?(message: string, status: number | undefined, body: TransactionFailure | undefined): void;
}

export interface HistoryStep { key: string; before: ContentRow | undefined; after: ContentRow | undefined; label: string; at: number }

export interface DraftState {
  entries: ReadonlyMap<string, RecordEntry>;
  contributors: ReadonlyMap<string, Contributor>;
  undo: readonly HistoryStep[];
  redo: readonly HistoryStep[];
  saving: boolean;
  /** A save failure that is not attached to one record (contributor errors, network). */
  error: string;
  /** Bumped when a contributor reports a dirtiness change so subscribers re-read `isDirty()`. */
  version: number;
}

export interface Notifier { success(message: string): void; error(message: string): void; message(message: string): void }

export const HISTORY_LIMIT = 200;
export const COALESCE_MS = 800;
export const conflictMessage = (name: string): string => `${name} changed on disk after you opened it. Compare the two, then overwrite or reload.`;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";

/** The dotted path of the changed leaf, or of the deepest container when several leaves changed. */
export function changedPath(before: unknown, after: unknown, prefix: (string | number)[] = []): string {
  if (!isObject(before) || !isObject(after) || Array.isArray(before) !== Array.isArray(after)) return prefix.join(".");
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [...keys].filter(key => !same(before[key], after[key]));
  if (changed.length !== 1) return prefix.join(".");
  const key = changed[0]!;
  return changedPath(before[key], after[key], [...prefix, Array.isArray(before) ? Number(key) : key]);
}

interface AdoptInput { collection: string; id: string; objectShaped: boolean; idKey?: string; record: ContentRow | undefined; revision: string }

class DraftStore {
  private state: DraftState = { entries: new Map(), contributors: new Map(), undo: [], redo: [], saving: false, error: "", version: 0 };
  private listeners = new Set<() => void>();
  private queryClient: QueryClient | undefined;
  private notify: Notifier = { success() {}, error() {}, message() {} };
  private announced = new Map<string, string>();

  configure(options: { queryClient?: QueryClient; notify?: Notifier }): void {
    if (options.queryClient) this.queryClient = options.queryClient;
    if (options.notify) this.notify = options.notify;
  }

  // ------------------------------------------------------------------ subscription

  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = (): DraftState => this.state;
  private set(patch: Partial<DraftState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private put(entry: RecordEntry): void {
    const entries = new Map(this.state.entries);
    entries.set(entry.key, { ...entry, dirty: entry.draft !== undefined && entry.base !== undefined && !same(entry.draft, entry.base) });
    this.set({ entries });
  }

  entry(key: string | undefined): RecordEntry | undefined { return key === undefined ? undefined : this.state.entries.get(key); }
  dirtyEntries(): RecordEntry[] { return [...this.state.entries.values()].filter(entry => entry.dirty || entry.conflict); }
  dirtyContributors(): Contributor[] { return [...this.state.contributors.values()].filter(contributor => contributor.isDirty()); }
  isDirty(): boolean { return this.dirtyEntries().length > 0 || this.dirtyContributors().length > 0; }

  // ------------------------------------------------------------------ server data

  /** Take fresh server data for one record. Keeps the draft when it is dirty or conflicted. */
  adopt(input: AdoptInput): void {
    const key = draftKey(input.collection, input.id);
    const existing = this.state.entries.get(key);
    const name = input.record ? rowName(input.record, input.idKey) : input.id;
    if (!existing) {
      this.put({ key, collection: input.collection, id: input.id, objectShaped: input.objectShaped, name, base: clone(input.record), revision: input.revision, draft: clone(input.record), dirty: false, saving: false, saveError: "", conflict: false, diagnostics: [] });
      return;
    }
    if (existing.revision === input.revision && same(existing.base, input.record)) return;
    if (existing.dirty || existing.conflict || existing.saving) {
      // Remember what disk holds so a later 409 can compare without another round trip.
      if (existing.revision !== input.revision) this.put({ ...existing, server: { record: clone(input.record), revision: input.revision } });
      return;
    }
    const changedOnDisk = existing.revision !== undefined && existing.revision !== input.revision && !same(existing.base, input.record);
    this.put({ ...existing, name, base: clone(input.record), draft: clone(input.record), revision: input.revision, server: undefined, saveError: "", diagnostics: [] });
    if (changedOnDisk && this.announced.get(key) !== input.revision) {
      this.announced.set(key, input.revision);
      this.notify.message(`${name} updated on disk`);
    }
  }

  // ------------------------------------------------------------------ edits and history

  /** Replace the draft of one record and record one undo step. Consecutive commits with the same label within `COALESCE_MS` merge. */
  commit(key: string, next: ContentRow, label?: string): void {
    const entry = this.state.entries.get(key);
    if (!entry || entry.draft === undefined || same(entry.draft, next)) return;
    const stepLabel = label ?? (changedPath(entry.draft, next) || entry.name);
    const at = Date.now();
    const last = this.state.undo[this.state.undo.length - 1];
    const undo = last && last.key === key && last.label === stepLabel && at - last.at < COALESCE_MS
      ? [...this.state.undo.slice(0, -1), { ...last, after: next, at }]
      : [...this.state.undo, { key, before: entry.draft, after: next, label: stepLabel, at }].slice(-HISTORY_LIMIT);
    this.set({ undo, redo: [], error: "" });
    this.put({ ...entry, draft: next, saveError: "", diagnostics: [] });
  }

  private step(from: "undo" | "redo"): HistoryStep | undefined {
    const stack = this.state[from];
    const step = stack[stack.length - 1];
    if (!step) return undefined;
    const to = from === "undo" ? "redo" : "undo";
    this.set({ [from]: stack.slice(0, -1), [to]: [...this.state[to], step] } as Partial<DraftState>);
    const entry = this.state.entries.get(step.key);
    if (entry) this.put({ ...entry, draft: clone(from === "undo" ? step.before : step.after), saveError: "", diagnostics: [] });
    return step;
  }
  undo(): HistoryStep | undefined { return this.step("undo"); }
  redo(): HistoryStep | undefined { return this.step("redo"); }
  undoLabel(): string | undefined { return this.state.undo[this.state.undo.length - 1]?.label; }
  redoLabel(): string | undefined { return this.state.redo[this.state.redo.length - 1]?.label; }

  /** Drop the draft of one record. A conflicted record takes the disk version. Undoable. */
  reset(key: string): void {
    const entry = this.state.entries.get(key);
    if (!entry) return;
    const target = entry.conflict && entry.server ? entry.server : { record: entry.base, revision: entry.revision };
    const history = entry.draft !== undefined && !same(entry.draft, target.record);
    if (history) this.set({ undo: [...this.state.undo, { key, before: entry.draft, after: clone(target.record), label: entry.conflict ? "Reload" : "Discard", at: Date.now() }].slice(-HISTORY_LIMIT), redo: [] });
    this.put({ ...entry, base: clone(target.record), draft: clone(target.record), revision: target.revision, conflict: false, server: undefined, saveError: "", diagnostics: [] });
    void this.queryClient?.invalidateQueries({ queryKey: collectionQuery(entry.collection).queryKey });
  }
  resetAll(): void {
    for (const entry of this.dirtyEntries()) this.reset(entry.key);
    for (const contributor of this.dirtyContributors()) contributor.reset();
    this.set({ error: "" });
  }

  // ------------------------------------------------------------------ contributors

  registerContributor(contributor: Contributor): () => void {
    const contributors = new Map(this.state.contributors);
    contributors.set(contributor.key, contributor);
    this.set({ contributors });
    return () => {
      const remaining = new Map(this.state.contributors);
      if (remaining.get(contributor.key) !== contributor) return;
      remaining.delete(contributor.key);
      this.set({ contributors: remaining });
    };
  }
  /** Contributors call this when their dirtiness changed. */
  touch(): void { this.set({ version: this.state.version + 1 }); }

  // ------------------------------------------------------------------ saving

  /** Save the given records (default: every dirty record and every dirty contributor) as one transaction. */
  async saveAll(keys?: readonly string[]): Promise<boolean> {
    if (this.state.saving) return false;
    const entries = keys
      ? keys.map(key => this.state.entries.get(key)).filter((entry): entry is RecordEntry => Boolean(entry?.dirty && !entry.conflict))
      : this.dirtyEntries().filter(entry => !entry.conflict);
    const contributors = keys ? [] : this.dirtyContributors();
    if (!entries.length && !contributors.length) return false;
    const revisions: Record<string, string> = {};
    const changes: ContentOperation[] = [];
    for (const entry of entries) {
      if (entry.revision === undefined || entry.draft === undefined) continue;
      revisions[entry.collection] ??= entry.revision;
      changes.push({ kind: "put", collection: entry.collection, id: entry.objectShaped ? "$collection" : entry.id, record: entry.draft });
    }
    let count = changes.length;
    try {
      for (const contributor of contributors) {
        const operations = await contributor.operations();
        Object.assign(revisions, contributor.revisions());
        changes.push(...operations);
        count += contributor.count?.() ?? operations.length;
      }
    } catch (error) {
      this.set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    }
    if (!changes.length) return false;
    this.set({ saving: true, error: "" });
    for (const entry of entries) this.put({ ...entry, saving: true, saveError: "", diagnostics: [] });
    try {
      const response = await fetch("/__devdocs/transaction", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "save", revisions, changes } satisfies ContentTransactionRequest) });
      const body = await response.json() as ContentTransactionResponse & TransactionFailure;
      if (!response.ok) {
        this.fail(entries, contributors, revisions, response.status, body);
        return false;
      }
      for (const collection of body.collections) this.adoptCollection(collection, new Set(entries.map(entry => entry.key)));
      for (const entry of entries) {
        const current = this.state.entries.get(entry.key);
        if (current?.saving) this.put({ ...current, saving: false, diagnostics: body.diagnostics?.filter(diagnostic => matchesEntry(diagnostic, current)) ?? [] });
      }
      for (const contributor of contributors) contributor.afterSave(body);
      this.notify.success(`Saved ${count} ${count === 1 ? "record" : "records"}`);
      void this.queryClient?.invalidateQueries({ queryKey: ["collection"] });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The save could not be completed. Your draft is still here.";
      for (const entry of entries) { const current = this.state.entries.get(entry.key); if (current) this.put({ ...current, saving: false, saveError: message }); }
      for (const contributor of contributors) contributor.onError?.(message, undefined, undefined);
      this.set({ error: contributors.length ? message : "" });
      return false;
    } finally {
      this.set({ saving: false });
    }
  }
  save(key: string): Promise<boolean> { return this.saveAll([key]); }

  private fail(entries: RecordEntry[], contributors: Contributor[], sent: Record<string, string>, status: number, body: TransactionFailure): void {
    const message = body.error ?? `Save failed (${status}). Your draft is still here.`;
    const stale = new Set(Object.keys(sent).filter(collection => !body.revisions || body.revisions[collection] !== sent[collection]));
    for (const entry of entries) {
      const current = this.state.entries.get(entry.key);
      if (!current) continue;
      if (status === 409 && stale.has(current.collection)) {
        this.put({ ...current, saving: false, conflict: true, saveError: conflictMessage(current.name), server: current.server ?? (body.revisions?.[current.collection] ? { revision: body.revisions[current.collection]! } : undefined) });
        void this.loadServer(current.key);
      } else if (status === 422) {
        const diagnostics = (body.diagnostics ?? []).filter(diagnostic => matchesEntry(diagnostic, current));
        this.put({ ...current, saving: false, saveError: diagnostics.length ? "" : message, diagnostics });
      } else this.put({ ...current, saving: false, saveError: message });
    }
    for (const contributor of contributors) contributor.onError?.(message, status, body);
    this.set({ error: contributors.length || !entries.length ? message : "" });
  }

  /** Fetch the collection a conflicted record belongs to and remember the disk record for Compare. */
  private async loadServer(key: string): Promise<void> {
    const entry = this.state.entries.get(key);
    if (!entry) return;
    try {
      const response = this.queryClient
        ? await this.queryClient.fetchQuery({ ...collectionQuery(entry.collection), staleTime: 0 })
        : await fetch(`/__devdocs/collections/${encodeURIComponent(entry.collection)}`).then(result => result.json() as Promise<CollectionResponse>);
      this.adoptCollection(response, new Set());
    } catch { /* The conflict is still shown; Compare just has no disk copy until the next fetch. */ }
  }

  /** Apply a collection response to every entry of that collection: clean ones adopt it, dirty ones remember it as `server`. */
  private adoptCollection(response: CollectionResponse, saved: ReadonlySet<string>): void {
    this.queryClient?.setQueryData(collectionQuery(response.collection.name).queryKey, response);
    const rows = response.collection.shape === "object" ? undefined : contentRows(response);
    for (const entry of this.state.entries.values()) {
      if (entry.collection !== response.collection.name) continue;
      const record = rows ? rows.find(row => rowId(row, response.collection.idKey) === entry.id) : response.data as ContentRow;
      if (saved.has(entry.key) || (!entry.dirty && !entry.conflict)) {
        this.put({ ...entry, base: clone(record), draft: clone(record), revision: response.revision, conflict: false, server: undefined, saveError: "", name: record ? rowName(record, response.collection.idKey) : entry.name });
      } else if (entry.dirty && !entry.conflict && !entry.saving) {
        // Another record of this collection was saved: rebase so the next save carries the live revision.
        this.put({ ...entry, base: clone(record), revision: response.revision, server: undefined });
      } else this.put({ ...entry, server: { record: clone(record), revision: response.revision } });
    }
  }

  /** Overwrite: re-save the draft against the disk revision. Reload: drop the draft and take the disk record. */
  async resolveConflict(key: string, action: "overwrite" | "reload"): Promise<boolean> {
    const entry = this.state.entries.get(key);
    if (!entry?.conflict) return false;
    if (action === "reload") { this.reset(key); return true; }
    const revision = entry.server?.revision;
    if (!revision) { void this.loadServer(key); return false; }
    this.put({ ...entry, conflict: false, saveError: "", revision, base: entry.server?.record ?? entry.base, server: undefined });
    return this.saveAll([key]);
  }
}

function clone<T>(value: T): T { return value === undefined ? value : structuredClone(value); }

/** Diagnostics come back as `collection[id].field` or `collection.field`; attach the ones for this record. */
function matchesEntry(diagnostic: ApiDiagnostic, entry: RecordEntry): boolean {
  const path = diagnostic.path;
  if (path.startsWith(`${entry.collection}[${entry.id}]`) || path.startsWith(`${entry.collection}/${entry.id}`)) return true;
  if (entry.objectShaped && (path === entry.collection || path.startsWith(`${entry.collection}.`))) return true;
  // A collection-level diagnostic without an id belongs to every record of the collection being saved.
  return path === entry.collection;
}

export const draftStore = new DraftStore();
/** A fresh, unshared store, for tests. */
export const createDraftStore = (): DraftStore => new DraftStore();
export type { DraftStore };

export function useDraftState(): DraftState { return useSyncExternalStore(draftStore.subscribe, draftStore.getSnapshot, draftStore.getSnapshot); }
export function useDraftEntry(key: string | undefined): RecordEntry | undefined {
  const state = useDraftState();
  return key === undefined ? undefined : state.entries.get(key);
}

// ------------------------------------------------------------------ diff

export type DiffLine = { kind: "same" | "add" | "del"; text: string };

/** A small line diff of two texts (LCS), for the Compare view. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n"), b = after.split("\n");
  if (a.length * b.length > 250_000) return [...a.map(text => ({ kind: "del" as const, text })), ...b.map(text => ({ kind: "add" as const, text }))];
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ kind: "same", text: a[i]! }); i++; j++; }
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) out.push({ kind: "del", text: a[i++]! });
    else out.push({ kind: "add", text: b[j++]! });
  }
  while (i < a.length) out.push({ kind: "del", text: a[i++]! });
  while (j < b.length) out.push({ kind: "add", text: b[j++]! });
  return out;
}

export const canonical = (value: unknown): string => JSON.stringify(value ?? null, null, 2);
