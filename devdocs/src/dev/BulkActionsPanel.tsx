import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, CircleAlert, Eye, LoaderCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { ApiDiagnostic, BulkAction, BulkRequest, BulkResponse } from "../../shared/contracts.js";
import { collectionQuery } from "../api/client.js";
import { metaQueryKey } from "./NotesPanel.js";
import type { ContentRow } from "../model/contracts.js";
import { rowId } from "../model/rows.js";
import { Button, Badge, Input, NativeSelect, Textarea } from "../components/ui/index.js";
import { cn } from "../lib/utils.js";
import { EMPTY, PANEL, PANEL_HEADER } from "../ui/layout.js";
import { FormError, SPIN } from "./panelParts.js";

type ActionKind = BulkAction["kind"];
type AuthoredStatus = Extract<BulkAction, { kind: "status" }>["status"];

export interface BulkActionsPanelProps {
  collection: string;
  idKey: string;
  revision: string;
  rows: ContentRow[];
  selectedIds: string[];
  onClearSelection: () => void;
}

interface PreviewState {
  signature: string;
  response: BulkResponse;
  stale: boolean;
}

interface PanelError {
  message: string;
  diagnostics: ApiDiagnostic[];
  conflict: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDiagnostic(value: unknown): value is ApiDiagnostic {
  if (!isObject(value)) return false;
  return typeof value.path === "string" && typeof value.message === "string" && (value.severity === "error" || value.severity === "warning");
}

function diagnosticsFrom(value: Record<string, unknown>): ApiDiagnostic[] {
  return Array.isArray(value.diagnostics) ? value.diagnostics.filter(isDiagnostic) : [];
}

function looksLikeBulkResponse(value: unknown): value is BulkResponse {
  if (!isObject(value)) return false;
  return typeof value.collection === "string" && Array.isArray(value.recordIds) && isObject(value.action) && isObject(value.revisions) && typeof value.revisions.content === "string" && Array.isArray(value.diffs);
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => ({}));
  return isObject(value) ? value : {};
}

function formatValue(value: unknown): string {
  if (value === undefined) return "Not set";
  if (value === null) return "Null";
  if (typeof value === "string") return value || "Empty";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try { return JSON.stringify(value); } catch { return String(value); }
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): Array<{ key: string; before: unknown; after: unknown }> {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => !sameValue(before[key], after[key]))
    .map(key => ({ key, before: before[key], after: after[key] }));
}

function ownNumericTier(row: ContentRow): boolean {
  return Object.hasOwn(row, "tier") && typeof row.tier === "number" && Number.isFinite(row.tier);
}

function DiffRecord({ diff }: { diff: BulkResponse["diffs"][number] }) {
  const changes = changedFields(diff.before, diff.after);
  const shown = changes.slice(0, 10);
  return <article className="grid grid-cols-[minmax(140px,14rem)_minmax(0,1fr)] gap-2.5 border-b border-border-subtle px-3 py-1.5 last:border-b-0 @max-[40rem]:grid-cols-1 max-md:gap-1">
    <div className="flex min-w-0 items-start gap-1.5"><code className="truncate font-mono text-xs leading-5 text-foreground" title={diff.recordId}>{diff.recordId}</code><Badge className="font-mono">{changes.length}</Badge></div>
    <div className="flex min-w-0 flex-col gap-0.5">
      {shown.map(change => <div className="grid min-w-0 grid-cols-[minmax(80px,10rem)_minmax(0,1fr)_12px_minmax(0,1fr)] items-start gap-1.5 font-mono text-[11px] leading-5 text-muted-foreground" key={change.key}>
        <code className="text-faint [overflow-wrap:anywhere]">{change.key}</code>
        <span className="min-w-0 line-through decoration-faint [overflow-wrap:anywhere]">{formatValue(change.before)}</span>
        <ArrowRight size={11} aria-hidden="true" className="mt-1 text-faint" />
        <span className="min-w-0 text-primary [overflow-wrap:anywhere]">{formatValue(change.after)}</span>
      </div>)}
      {changes.length > shown.length && <small className="text-[11px] text-faint">+{changes.length - shown.length} more</small>}
      {!changes.length && <span className="text-[11px] text-faint">No changed fields.</span>}
    </div>
  </article>;
}

export default function BulkActionsPanel({ collection, idKey, revision, rows, selectedIds, onClearSelection }: BulkActionsPanelProps) {
  const queryClient = useQueryClient();
  const [actionKind, setActionKind] = useState<ActionKind>("status");
  const [status, setStatus] = useState<AuthoredStatus>("candidate");
  const [noteText, setNoteText] = useState("");
  const [noteLabel, setNoteLabel] = useState("");
  const [retierTierText, setRetierTierText] = useState("");
  const [preview, setPreview] = useState<PreviewState>();
  const [busy, setBusy] = useState<"preview" | "apply">();
  const [error, setError] = useState<PanelError>();
  const requestKeyRef = useRef("");

  const rowsById = useMemo(() => new Map(rows.map(row => [rowId(row, idKey), row])), [rows, idKey]);
  const selectedRows = useMemo(() => selectedIds.map(id => rowsById.get(id)), [selectedIds, rowsById]);
  const missingRowsCount = selectedRows.filter(row => row === undefined).length;
  const withoutNumericTierCount = missingRowsCount + selectedRows.filter((row): row is ContentRow => row !== undefined && !ownNumericTier(row)).length;
  const canRetier = selectedIds.length > 0 && withoutNumericTierCount === 0;
  const parsedTier = Number(retierTierText);
  const tierValid = Number.isInteger(parsedTier) && parsedTier > 0;
  const action = useMemo<BulkAction>(() => {
    if (actionKind === "status") return { kind: "status", status };
    if (actionKind === "note") return { kind: "note", text: noteText.trim(), ...(noteLabel.trim() ? { label: noteLabel.trim() } : {}) };
    return { kind: "retier", tier: tierValid ? parsedTier : 1 };
  }, [actionKind, status, noteText, noteLabel, tierValid, parsedTier]);
  const requestKey = useMemo(() => JSON.stringify({ collection, revision, ids: [...selectedIds].sort(), actionKind, status, noteText, noteLabel, retierTierText }), [collection, revision, selectedIds, actionKind, status, noteText, noteLabel, retierTierText]);
  requestKeyRef.current = requestKey;
  const currentPreview = preview?.signature === requestKey ? preview : undefined;
  const validationMessage = actionKind === "note" && !noteText.trim()
    ? "Write a note before previewing."
    : actionKind === "retier" && !tierValid
      ? "Enter a positive whole number for the new tier."
      : actionKind === "retier" && !canRetier
        ? `Retier is unavailable because ${withoutNumericTierCount} selected ${withoutNumericTierCount === 1 ? "record does not own" : "records do not own"} a numeric tier.`
        : undefined;
  const canPreview = selectedIds.length > 0 && !busy && !validationMessage;
  const canApply = Boolean(currentPreview && !currentPreview.stale && currentPreview.response.diffs.length && !busy);

  useEffect(() => {
    setPreview(previous => previous?.signature === requestKey ? previous : undefined);
    setError(undefined);
  }, [requestKey]);

  async function request(operation: "preview" | "apply") {
    const signature = requestKey;
    const previewAtStart = currentPreview;
    const selectedIdsAtStart = [...selectedIds];
    if (busy || (operation === "preview" && (validationMessage || !selectedIdsAtStart.length)) || (operation === "apply" && (!previewAtStart || previewAtStart.stale || !previewAtStart.response.diffs.length))) return;
    const actionAtStart = action;
    const body: BulkRequest = {
      operation,
      collection,
      recordIds: selectedIdsAtStart,
      action: actionAtStart,
      ...(operation === "apply" ? { revisions: previewAtStart!.response.revisions } : {}),
    };
    setBusy(operation);
    setError(undefined);
    try {
      const response = await fetch("/__devdocs/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const raw = await responseBody(response);
      if (requestKeyRef.current !== signature) return;
      if (!response.ok) {
        const diagnostics = diagnosticsFrom(raw);
        const message = typeof raw.error === "string" ? raw.error : `Bulk ${operation} failed (${response.status}).`;
        if (response.status === 409) {
          setPreview(previous => previous?.signature === signature ? { ...previous, stale: true } : previous);
          setError({ message: "The content or metadata changed after this preview. Preview again before applying.", diagnostics, conflict: true });
        } else {
          setPreview(previous => operation === "apply" && previous?.signature === signature ? { ...previous, stale: true } : previous);
          setError({ message, diagnostics, conflict: false });
        }
        return;
      }
      if (!looksLikeBulkResponse(raw)) throw new Error("The server returned an incomplete bulk response. Preview again before applying.");
      const result = raw as unknown as BulkResponse;
      if (operation === "preview") {
        setPreview({ signature, response: result, stale: false });
        setError(undefined);
        return;
      }
      const changedCount = result.recordIds.length || selectedIdsAtStart.length;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: collectionQuery(collection).queryKey }),
        ...selectedIdsAtStart.map(id => queryClient.invalidateQueries({ queryKey: metaQueryKey(collection, id) })),
        queryClient.invalidateQueries({ queryKey: ["requests"] }),
      ]).catch(() => undefined);
      toast.success(`Updated ${changedCount} record${changedCount === 1 ? "" : "s"}`);
      setPreview(undefined);
      setError(undefined);
      onClearSelection();
    } catch (failure) {
      if (requestKeyRef.current !== signature) return;
      setPreview(previous => operation === "apply" && previous?.signature === signature ? { ...previous, stale: true } : previous);
      setError({ message: failure instanceof Error ? failure.message : `The bulk ${operation} request failed.`, diagnostics: [], conflict: false });
    } finally {
      setBusy(undefined);
    }
  }

  const diffCount = currentPreview?.response.diffs.length ?? 0;

  return <section className={cn(PANEL, "bulk-actions mb-3 overflow-hidden")} aria-labelledby="bulk-actions-title">
    <header className={PANEL_HEADER}>
      <h2 id="bulk-actions-title">Bulk actions</h2>
      <Badge variant="accent" aria-label="Selection details">{selectedIds.length} selected</Badge>
      {withoutNumericTierCount > 0 && <Badge variant="warn" title="Retier needs an owned numeric tier">{withoutNumericTierCount} without tier</Badge>}
      {busy === "preview" && <LoaderCircle className={cn(SPIN, "text-primary")} size={13} aria-label="Calculating preview" />}
    </header>
    <form className="flex flex-col gap-2 px-2.5 py-2" onSubmit={event => { event.preventDefault(); void request("preview"); }} noValidate>
      <div className="flex flex-wrap items-center gap-1.5">
        <NativeSelect aria-label="Bulk action" value={actionKind} onChange={event => setActionKind(event.target.value as ActionKind)} disabled={Boolean(busy)}><option value="status">Set status</option><option value="note">Add note</option><option value="retier" disabled={!canRetier}>Retier records{canRetier ? "" : " (numeric tier required)"}</option></NativeSelect>
        {actionKind === "status" && <NativeSelect aria-label="New status" value={status} onChange={event => setStatus(event.target.value as AuthoredStatus)} disabled={Boolean(busy)}><option value="draft">Draft</option><option value="candidate">Candidate</option><option value="rejected">Rejected</option></NativeSelect>}
        {actionKind === "note" && <>
          <label className="flex min-w-0 flex-[1_1_260px]"><span className="sr-only">Note text</span><Textarea aria-label="Note text" className="h-7 max-h-30 min-h-7 resize-y py-[5px] leading-snug" value={noteText} onChange={event => setNoteText(event.target.value)} placeholder="Note added to each selected record" rows={1} disabled={Boolean(busy)} aria-describedby="bulk-note-help" /></label>
          <label className="flex w-44 max-md:w-full"><span className="sr-only">Note label</span><Input aria-label="Note label" value={noteLabel} onChange={event => setNoteLabel(event.target.value)} placeholder="Label (optional)" disabled={Boolean(busy)} /></label>
          <span id="bulk-note-help" className="sr-only">The note is added to each selected record.</span>
        </>}
        {actionKind === "retier" && <>
          <label className="flex w-22"><span className="sr-only">New tier</span><Input aria-label="New tier" className="font-mono" type="number" min={1} step={1} inputMode="numeric" value={retierTierText} onChange={event => setRetierTierText(event.target.value)} placeholder="Tier" disabled={Boolean(busy)} aria-describedby="bulk-retier-help" /></label>
          <small id="bulk-retier-help" className="text-[11px] text-faint">Generated values recalculate at the new tier; explicit adjustments stay.</small>
        </>}
        <Button variant="default" size="sm" type="submit" className="ml-auto" disabled={!canPreview}><Eye size={13} />{busy === "preview" ? "Previewing…" : currentPreview ? "Refresh preview" : "Preview"}</Button>
      </div>
      {validationMessage && <FormError className="text-warn">{validationMessage}</FormError>}
      {error && <div className={cn("flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs [&>svg]:mt-0.5 [&>svg]:shrink-0", error.conflict ? "border-warn bg-warn-soft [&>svg]:text-warn" : "border-destructive bg-destructive-soft [&>svg]:text-destructive")} role="alert">
        <CircleAlert size={13} />
        <div className="min-w-0">
          <strong className="font-medium">{error.message}</strong>
          {error.diagnostics.length > 0 && <ul className="mt-1.5 grid gap-0.5 text-muted-foreground">{error.diagnostics.map((diagnostic, index) => <li className="grid grid-cols-[minmax(90px,.35fr)_minmax(0,1fr)] gap-2" key={`${diagnostic.path}:${index}`}><code className="font-mono text-[11px] text-faint [overflow-wrap:anywhere]">{diagnostic.path || "content"}</code><span>{diagnostic.message}</span></li>)}</ul>}
        </div>
      </div>}
    </form>
    {(currentPreview || (!error && selectedIds.length > 0)) && <section className="border-t border-border-subtle" aria-labelledby="bulk-preview-title">
      <header className="flex min-h-8 items-center gap-2 px-3 py-1 [&_h3]:text-xs [&_h3]:font-semibold">
        <h3 id="bulk-preview-title">Preview</h3>
        {currentPreview ? <span className="font-mono text-[11px] text-muted-foreground">{diffCount} {diffCount === 1 ? "row" : "rows"} change</span> : <span className="font-mono text-[11px] text-muted-foreground">none yet</span>}
        {currentPreview?.stale && <Badge variant="warn" role="status"><RefreshCw size={11} />Out of date</Badge>}
        {currentPreview && diffCount > 0 && <div className="ml-auto flex items-center gap-1"><Button variant="default" size="sm" disabled={!canApply} onClick={() => void request("apply")}>{busy === "apply" ? "Applying…" : `Apply to ${diffCount}`}</Button></div>}
      </header>
      {currentPreview && !diffCount && <p className={cn(EMPTY, "inline-flex items-center gap-1.5 px-3 pb-2.5 text-ok")} role="status"><Check size={13} />No selected rows would change.</p>}
      {currentPreview && diffCount > 0 && <>
        <div className="max-h-80 overflow-auto border-t border-border-subtle [scrollbar-width:thin]">{currentPreview.response.diffs.slice(0, 40).map(diff => <DiffRecord key={diff.recordId} diff={diff} />)}</div>
        {diffCount > 40 && <p className={cn(EMPTY, "px-3 py-1.5")}>Showing 40 of {diffCount}. Apply covers the full preview.</p>}
      </>}
    </section>}
  </section>;
}
