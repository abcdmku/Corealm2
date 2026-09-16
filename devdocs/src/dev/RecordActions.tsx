import { useMemo, useState, type ReactNode } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Copy, Eye, GitBranch, LoaderCircle, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Menu } from "../ui/Menu.js";
import { CONTENT_COLLECTIONS, type ContentCollection } from "../../../tools/content/collections.js";
import { defaultFieldValue, fieldIssues } from "../model/fields.js";
import type { AppProps, ContentRow } from "../model/contracts.js";
import { collectionQuery, collectionsQuery } from "../api/client.js";
import { contentRows, rowId, rowName } from "../model/rows.js";
import type { ApiDiagnostic, CollectionResponse, ContentOperation, ContentTransactionRequest, ContentTransactionResponse } from "../../shared/contracts.js";
import { Button } from "../components/ui/index.js";

type ActionKind = "create" | "duplicate" | "variant" | "rename" | "delete";

export interface RecordActionsProps {
  collection: string;
  /** A record menu uses the supplied row. A collection menu uses the first row as its template. */
  record?: ContentRow;
  recordId?: string;
  mode?: "record" | "collection";
  templateRecord?: ContentRow;
  knownIds?: readonly string[];
  editable?: boolean;
  idKey?: string;
  navigate: AppProps["navigate"];
  /** Fold record actions into one menu button. */
  compact?: boolean;
}

interface TransactionResult extends ContentTransactionResponse {
  revisions?: Record<string, string>;
  error?: string;
}

interface TransactionPreview {
  changes: ContentOperation[];
  revisions: Record<string, string>;
  result: TransactionResult;
}

interface ConsumerReference {
  collection: string;
  recordId: string;
  recordName: string;
  field: string;
}

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const REFERENCE_KEYS = /(?:^|_)(?:id|ids)$|(?:item|recipe|resource|cluster|enemy|species|loot|npc|shop|quest|dialogue|spell|rune|set|asset|profile|family|template|encounter|placement)(?:id|ids)?$/i;
const STORAGE_FIELDS = new Set(["catalog", "source", "sourceInputId", "legacyOverride", "derived", "registrationOrder", "labOrder", "fantasyTierOrder", "lineage", "history", "provenance", "migration"]);

function objectRecord(value: unknown): ContentRow {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ContentRow : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cleanId(value: string): string {
  return value.trim().replace(/\s+/g, "-").replace(/[^A-Za-z0-9_-]/g, "");
}

function nextId(base: string, suffix: string, knownIds: readonly string[]): string {
  const used = new Set(knownIds);
  const stem = cleanId(base) || "new-record";
  let candidate = `${stem}-${suffix}`;
  let count = 2;
  while (used.has(candidate)) candidate = `${stem}-${suffix}-${count++}`;
  return candidate;
}

function displayCollection(collection: string): string {
  return collection.replace(/^balance\//, "Balance / ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, value => value.toUpperCase());
}

function actionLabel(action: ActionKind): string {
  return action === "create" ? "Create" : action === "duplicate" ? "Duplicate" : action === "variant" ? "Create variant" : action === "rename" ? "Rename" : "Delete";
}

function actionIcon(action: ActionKind): ReactNode {
  if (action === "create") return <Plus size={14} />;
  if (action === "duplicate") return <Copy size={14} />;
  if (action === "variant") return <GitBranch size={14} />;
  if (action === "rename") return <Pencil size={14} />;
  return <Trash2 size={14} />;
}

function isDiagnostic(value: unknown): value is ApiDiagnostic {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.path === "string" && typeof row.message === "string" && (row.severity === "error" || row.severity === "warning");
}

function diagnosticList(value: unknown): ApiDiagnostic[] {
  return Array.isArray(value) ? value.filter(isDiagnostic) : [];
}

function transactionBody(value: unknown): TransactionResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("The transaction response was not an object.");
  const row = value as Partial<TransactionResult>;
  return {
    revision: typeof row.revision === "string" ? row.revision : "",
    revisions: row.revisions && typeof row.revisions === "object" && !Array.isArray(row.revisions) ? row.revisions as Record<string, string> : undefined,
    collections: Array.isArray(row.collections) ? row.collections as CollectionResponse[] : [],
    affected: Array.isArray(row.affected) ? row.affected as { collection: string; id: string }[] : [],
    diagnostics: diagnosticList(row.diagnostics),
    compiled: row.compiled,
    error: typeof row.error === "string" ? row.error : undefined,
  };
}

async function postTransaction(request: ContentTransactionRequest): Promise<{ response: Response; body: TransactionResult }> {
  const response = await fetch("/__devdocs/transaction", { method: "POST", headers: { "content-type": "application/json", Accept: "application/json" }, body: JSON.stringify(request) });
  const text = await response.text();
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) as unknown : undefined; } catch { parsed = undefined; }
  const body = transactionBody(parsed);
  if (!response.ok && !body.error) body.error = `Transaction failed (${response.status})`;
  return { response, body };
}

function recordReferences(value: unknown, targetId: string, path: string, out: string[] = [], allowLoose = false): string[] {
  if (typeof value === "string") {
    if (value === targetId && (allowLoose || REFERENCE_KEYS.test(path.split(".").at(-1) ?? ""))) out.push(path || "record");
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => recordReferences(entry, targetId, `${path}[${index}]`, out, allowLoose));
    return out;
  }
  if (value === null || typeof value !== "object") return out;
  Object.entries(value).forEach(([key, entry]) => {
    if (STORAGE_FIELDS.has(key)) return;
    const next = path ? `${path}.${key}` : key;
    const keyLooksLikeReference = REFERENCE_KEYS.test(key);
    recordReferences(entry, targetId, next, out, allowLoose || keyLooksLikeReference);
  });
  return out;
}

function referenceRows(response: CollectionResponse, targetId: string, currentCollection: string): ConsumerReference[] {
  const rows = contentRows(response);
  return rows.flatMap(row => {
    const id = rowId(row, response.collection.idKey);
    if (!id || (response.collection.name === currentCollection && id === targetId)) return [];
    // A matching collection identity is not a dependency. Only references from the row's
    // authored fields should block a delete (campfire fuels and rune rows use a non-id key).
    const paths = recordReferences(row, targetId, "").filter(path => path !== response.collection.idKey);
    return paths.slice(0, 3).map(field => ({ collection: response.collection.name, recordId: id, recordName: rowName(row, response.collection.idKey), field }));
  });
}

function responseRevisionMap(result: TransactionResult, fallback: Record<string, string>): Record<string, string> {
  const revisions = { ...fallback, ...(result.revisions ?? {}) };
  for (const collection of result.collections) if (collection?.collection?.name && typeof collection.revision === "string") revisions[collection.collection.name] = collection.revision;
  return revisions;
}

export default function RecordActions({ collection, record, recordId, mode = "record", templateRecord, knownIds = [], editable, idKey, navigate, compact = false }: RecordActionsProps) {
  const queryClient = useQueryClient();
  const collectionQueryResult = useQuery({ ...collectionQuery(collection), enabled: mode === "collection" || Boolean(record) });
  const summaries = useQuery({ ...collectionsQuery(), enabled: false });
  const [action, setAction] = useState<ActionKind>();
  const [draftId, setDraftId] = useState("");
  const [draftName, setDraftName] = useState("");
  const [preview, setPreview] = useState<TransactionPreview>();
  const [busy, setBusy] = useState<"preview" | "save" | undefined>();
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState<ApiDiagnostic[]>([]);

  const sourceRows = useMemo(() => collectionQueryResult.data ? contentRows(collectionQueryResult.data) : [], [collectionQueryResult.data]);
  const collectionIdKey = idKey ?? collectionQueryResult.data?.collection.idKey ?? "id";
  const known = useMemo(() => [...new Set([...knownIds, ...sourceRows.map(row => rowId(row, collectionIdKey))])], [collectionIdKey, knownIds, sourceRows]);
  const currentId = recordId ?? (record ? rowId(record, collectionIdKey) : "");
  const sourceRecord = record ?? templateRecord ?? sourceRows[0];
  const isEditable = editable ?? collectionQueryResult.data?.collection.editable ?? false;
  const canCreate = mode === "collection" && isEditable && collectionQueryResult.data?.collection.shape === "array";
  const canRecordAction = mode === "record" && isEditable && Boolean(record && currentId);
  const canOpen = canCreate || canRecordAction;
  const spec = CONTENT_COLLECTIONS.find(candidate => candidate.name === collection);

  const consumerSummaries = useMemo(() => summaries.data?.filter(candidate => candidate.name !== collection) ?? [], [collection, summaries.data]);
  const consumerQueries = useQueries({ queries: consumerSummaries.map(candidate => ({ ...collectionQuery(candidate.name), enabled: action === "delete" })) });
  const consumers = useMemo(() => consumerQueries.flatMap(query => query.data ? referenceRows(query.data, currentId, collection) : []), [collection, consumerQueries, currentId]);
  const consumerLoading = action === "delete" && (summaries.isFetching || consumerQueries.some(query => query.isPending));
  const consumerError = action === "delete" && (summaries.error || consumerQueries.find(query => query.isError)?.error);

  function openAction(next: ActionKind) {
    setError("");
    setDiagnostics([]);
    setPreview(undefined);
    setAction(next);
    if (next === "rename") setDraftId(currentId);
    else if (next === "create") setDraftId(nextId("new", "record", known));
    else if (next === "duplicate") setDraftId(nextId(currentId, "copy", known));
    else if (next === "variant") setDraftId(nextId(currentId, "variant", known));
    const name = asString(sourceRecord?.name) || asString(sourceRecord?.title) || currentId;
    setDraftName(next === "variant" ? `${name} variant` : next === "duplicate" ? `${name} copy` : name);
    if (next === "delete") void summaries.refetch();
  }

  function closeAction() {
    if (busy) return;
    setAction(undefined);
    setPreview(undefined);
    setError("");
    setDiagnostics([]);
  }

  function draftValue(): ContentRow {
    const fallback = spec ? defaultFieldValue(spec.schema) : {};
    const source = sourceRecord ? structuredClone(sourceRecord) : fallback;
    const value = objectRecord(source);
    if (collectionIdKey === "tier") value[collectionIdKey] = Number(draftId);
    else value[collectionIdKey] = draftId;
    if (Object.hasOwn(value, "name") && draftName.trim()) value.name = draftName.trim();
    else if (Object.hasOwn(value, "title") && draftName.trim()) value.title = draftName.trim();
    if (action === "variant" && collection === "creatureDefinitions") value.baseId = currentId;
    return value;
  }

  function requestedChanges(): ContentOperation[] | undefined {
    if (!action) return undefined;
    if (action === "delete") return [{ kind: "delete", collection, id: currentId }];
    if (action === "rename") return [{ kind: "rename", collection, id: currentId, nextId: cleanId(draftId) }];
    return [{ kind: "put", collection, id: cleanId(draftId), record: draftValue(), create: true }];
  }

  async function revisionsFor(changes: readonly ContentOperation[]): Promise<Record<string, string>> {
    const names = [...new Set(changes.map(change => change.collection))];
    const pairs = await Promise.all(names.map(async name => {
      const value = await queryClient.ensureQueryData({ ...collectionQuery(name), staleTime: 0 });
      return [name, value.revision] as const;
    }));
    return Object.fromEntries(pairs);
  }

  async function previewTransaction() {
    const changes = requestedChanges();
    if (!changes || busy) return;
    if (action === "delete" && (consumerLoading || consumerError || consumers.length > 0)) return;
    if (action !== "delete" && (!ID_PATTERN.test(cleanId(draftId)) || (action === "rename" && cleanId(draftId) === currentId))) {
      setError("Use a unique ID beginning with a letter. IDs may contain letters, numbers, underscores, and hyphens.");
      return;
    }
    if (action !== "delete" && action !== "rename" && known.includes(cleanId(draftId))) {
      setError(`The ID "${cleanId(draftId)}" already exists in ${displayCollection(collection)}.`);
      return;
    }
    const localIssues = action !== "delete" && spec ? fieldIssues(spec.schema, draftValue()).filter(issue => issue.severity === "error") : [];
    if (localIssues.length) {
      setDiagnostics(localIssues);
      setError("Review the record fields before previewing this transaction.");
      return;
    }
    setBusy("preview");
    setError("");
    setDiagnostics([]);
    try {
      const revisions = await revisionsFor(changes);
      let attempt = await postTransaction({ operation: "preview", revisions, changes });
      // A rename can touch references in several collections. The server returns the missing
      // revisions so the preview can be retried against the same draft without losing input.
      if (attempt.response.status === 409 && attempt.body.revisions) {
        const expanded = { ...revisions, ...attempt.body.revisions };
        attempt = await postTransaction({ operation: "preview", revisions: expanded, changes });
      }
      if (!attempt.response.ok) {
        setError(attempt.body.error ?? `Preview failed (${attempt.response.status}). Your draft is still here.`);
        setDiagnostics(attempt.body.diagnostics);
        return;
      }
      setPreview({ changes, revisions: responseRevisionMap(attempt.body, revisions), result: attempt.body });
      setDiagnostics(attempt.body.diagnostics);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The transaction preview could not be loaded. Your draft is still here.");
    } finally {
      setBusy(undefined);
    }
  }

  async function saveTransaction() {
    if (!preview || busy) return;
    setBusy("save");
    setError("");
    try {
      const attempt = await postTransaction({ operation: "save", revisions: preview.revisions, changes: preview.changes });
      if (!attempt.response.ok) {
        setError(attempt.body.error ?? `Save failed (${attempt.response.status}). Your draft is still here. Preview again after refreshing the changed content.`);
        setDiagnostics(attempt.body.diagnostics);
        setPreview(undefined);
        return;
      }
      for (const response of attempt.body.collections) if (response?.collection?.name) queryClient.setQueryData(collectionQuery(response.collection.name).queryKey, response);
      await queryClient.invalidateQueries({ queryKey: ["collections"] });
      await queryClient.invalidateQueries({ queryKey: ["git-status"] });
      toastSaved();
      const savedChange = preview.changes[0];
      closeAction();
      if (savedChange?.kind === "delete") navigate(collection);
      else if (savedChange?.kind === "rename") navigate(collection, savedChange.nextId);
      else if (savedChange?.kind === "put") navigate(collection, savedChange.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The transaction could not be saved. Your draft is still here.");
    } finally {
      setBusy(undefined);
    }
  }

  function toastSaved() {
    // Keep this component usable in player and test renders where a toaster is not mounted.
    // The visible dialog state closes immediately, while the normal dev app also announces it.
    try { window.dispatchEvent(new CustomEvent("corealm:content-saved")); } catch { /* DOM events can be unavailable in unit renders. */ }
    toast.success("Changes saved");
  }

  if (!canOpen) return null;
  return <>
    <div className="editor-actions" aria-label={`${displayCollection(collection)} record actions`}>
      {canCreate && <Button variant={compact ? "default" : "secondary"} size="sm" data-record-action="create" aria-label={`Create ${displayCollection(collection)} record`} onClick={() => openAction("create")}><Plus size={14} />Create</Button>}
      {canRecordAction && compact && <Menu trigger={<Button variant="secondary" size="sm" aria-label="Record actions"><MoreHorizontal size={14} />Actions</Button>} items={[
        { label: "Duplicate", icon: <Copy size={14} />, onSelect: () => openAction("duplicate") },
        { label: "Create variant", icon: <GitBranch size={14} />, onSelect: () => openAction("variant") },
        { label: "Rename", icon: <Pencil size={14} />, onSelect: () => openAction("rename") },
        { label: "Delete", icon: <Trash2 size={14} />, tone: "danger", separator: true, onSelect: () => openAction("delete") },
      ]} />}
      {canRecordAction && !compact && <><Button variant="secondary" size="sm" onClick={() => openAction("duplicate")}><Copy size={14} />Duplicate</Button><Button variant="secondary" size="sm" onClick={() => openAction("variant")}><GitBranch size={14} />Create variant</Button><Button variant="secondary" size="sm" onClick={() => openAction("rename")}><Pencil size={14} />Rename</Button><Button variant="secondary" size="sm" onClick={() => openAction("delete")}><Trash2 size={14} />Delete</Button></>}
    </div>
    {action && <ActionDialog
      action={action}
      collection={collection}
      currentId={currentId}
      draftId={draftId}
      draftName={draftName}
      preview={preview}
      busy={busy}
      error={error}
      diagnostics={diagnostics}
      consumers={consumers}
      consumerLoading={consumerLoading}
      consumerError={consumerError}
      onDraftId={setDraftId}
      onDraftName={setDraftName}
      onPreview={() => void previewTransaction()}
      onSave={() => void saveTransaction()}
      onClose={closeAction}
      onNavigate={navigate}
    />}
  </>;
}

function ActionDialog({ action, collection, currentId, draftId, draftName, preview, busy, error, diagnostics, consumers, consumerLoading, consumerError, onDraftId, onDraftName, onPreview, onSave, onClose, onNavigate }: {
  action: ActionKind;
  collection: string;
  currentId: string;
  draftId: string;
  draftName: string;
  preview: TransactionPreview | undefined;
  busy: "preview" | "save" | undefined;
  error: string;
  diagnostics: readonly ApiDiagnostic[];
  consumers: readonly ConsumerReference[];
  consumerLoading: boolean;
  consumerError: Error | false | null | undefined;
  onDraftId: (value: string) => void;
  onDraftName: (value: string) => void;
  onPreview: () => void;
  onSave: () => void;
  onClose: () => void;
  onNavigate: AppProps["navigate"];
}) {
  const title = actionLabel(action);
  const isDelete = action === "delete";
  const hasErrors = diagnostics.some(diagnostic => diagnostic.severity === "error");
  return <div className="dialog-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="command-dialog" role="dialog" aria-modal="true" aria-labelledby="record-action-title" style={{ top: "min(12dvh, 110px)", maxHeight: "76dvh", overflow: "auto" }}>
      <header className="command-input-wrap"><div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}><span style={{ color: "var(--accent)" }}>{actionIcon(action)}</span><h2 id="record-action-title" style={{ fontSize: 14, fontWeight: 550 }}>{title} {currentId && <code style={{ marginLeft: 5, color: "var(--muted)", fontSize: 10 }}>{currentId}</code>}</h2></div><Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}><X size={18} /></Button></header>
      <div style={{ padding: 18, display: "grid", gap: 15 }}>
        {!isDelete && !preview && <div style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6, fontSize: 11, color: "var(--muted)" }}>New ID<input autoFocus value={draftId} onChange={event => onDraftId(event.target.value)} aria-label="New ID" placeholder="letters, numbers, hyphens" /></label>
          <label style={{ display: "grid", gap: 6, fontSize: 11, color: "var(--muted)" }}>Display name<input value={draftName} onChange={event => onDraftName(event.target.value)} aria-label="Display name" placeholder="Optional" /></label>
          <p className="editor-help">The new record starts from the current definition. Preview validates the complete transaction before anything is written.</p>
        </div>}
        {isDelete && !preview && <DeleteConsumers collection={collection} consumers={consumers} loading={consumerLoading} error={consumerError} onNavigate={onNavigate} />}
        {error && <div className="editor-error-summary" role="alert"><AlertCircle size={17} /><p>{error}</p></div>}
        {diagnostics.length > 0 && <div className="editor-diagnostics" aria-label="Transaction diagnostics"><h3>Review this transaction</h3><ul>{diagnostics.map((diagnostic, index) => <li key={`${diagnostic.path}:${index}`}><span className="mono">{diagnostic.path || "record"}</span> {diagnostic.message}</li>)}</ul></div>}
        {preview && <TransactionPreview preview={preview} />}
      </div>
      <footer style={{ display: "flex", justifyContent: "flex-end", gap: 9, padding: "12px 18px", borderTop: "1px solid var(--border)" }}>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={Boolean(busy)}>Cancel</Button>
        {!preview && <Button variant="secondary" size="sm" className="editor-save" onClick={onPreview} disabled={Boolean(busy) || (isDelete && (consumerLoading || Boolean(consumerError) || consumers.length > 0)) || hasErrors}>{busy === "preview" ? <><LoaderCircle size={14} />Previewing…</> : <><Eye size={14} />Preview transaction</>}</Button>}
        {preview && <Button variant="secondary" size="sm" className="editor-save" onClick={onSave} disabled={Boolean(busy) || hasErrors}>{busy === "save" ? <><LoaderCircle size={14} />Saving…</> : <><Check size={14} />Save transaction</>}</Button>}
      </footer>
    </section>
  </div>;
}

function DeleteConsumers({ collection, consumers, loading, error, onNavigate }: { collection: string; consumers: readonly ConsumerReference[]; loading: boolean; error: Error | false | null | undefined; onNavigate: AppProps["navigate"] }) {
  if (loading) return <p className="editor-message" role="status"><LoaderCircle size={14} /> Checking records that use this ID…</p>;
  if (error) return <div className="editor-error-summary" role="alert"><AlertCircle size={17} /><p>References could not be checked. Reload the list before deleting this record.</p></div>;
  if (consumers.length > 0) return <div className="editor-diagnostics" role="alert"><h3>Resolve references before deleting</h3><p className="editor-help">{consumers.length} record{consumers.length === 1 ? " uses" : "s use"} this {displayCollection(collection)} ID.</p><ul>{consumers.map((consumer, index) => <li key={`${consumer.collection}:${consumer.recordId}:${consumer.field}:${index}`}><button className="reference-link" type="button" onClick={() => onNavigate(consumer.collection, consumer.recordId)}>{consumer.recordName} <code>{consumer.recordId}</code></button><span className="muted">{displayCollection(consumer.collection)} · {consumer.field}</span></li>)}</ul></div>;
  return <p className="editor-help" role="status">No loaded content records reference this ID. Preview will run the full cross collection check before saving.</p>;
}

function TransactionPreview({ preview }: { preview: TransactionPreview }) {
  const warnings = preview.result.diagnostics.filter(diagnostic => diagnostic.severity === "warning");
  return <section className="editor-diagnostics" aria-label="Transaction preview" style={{ margin: 0 }}><h3>Ready to save</h3><p className="editor-help">{preview.result.affected.length || preview.changes.length} affected record{(preview.result.affected.length || preview.changes.length) === 1 ? "" : "s"}. The server validated this draft without writing it.</p>{warnings.length > 0 && <ul>{warnings.map((warning, index) => <li key={`${warning.path}:${index}`}><span className="mono">{warning.path || "content"}</span> {warning.message}</li>)}</ul>}{preview.result.compiled !== undefined && <p className="editor-help"><RefreshCw size={12} /> Compiled preview available for the affected runtime records.</p>}</section>;
}
