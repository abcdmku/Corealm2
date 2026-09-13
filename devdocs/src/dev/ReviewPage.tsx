import { useEffect, useId, useMemo, useState } from "react";
import { AlertCircle, ArrowUpRight, CheckCircle2, FileCode2, GitBranch, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "../api/client.js";
import type { ApiDiagnostic } from "../../shared/contracts.js";
import "../styles/review.css";

/** The JSON shape returned by GET /__devdocs/git/status. */
interface GitStatusResponse {
  changes: GitStatusEntry[];
}

interface GitStatusEntry {
  status: string;
  path: string;
  tracked: boolean;
  originalPath?: string;
}

/** The JSON shape returned by POST /__devdocs/validate. */
interface ValidationResponse {
  ok: boolean;
  collections: number;
  diagnostics: ApiDiagnostic[];
}

export interface ReviewPageProps {
  navigate: (collection?: string, recordId?: string) => void;
}

const REVIEWABLE_PREFIXES = ["game/content/data/", "game/content/meta/", "devdocs/"] as const;
const NAVIGABLE_COLLECTIONS = new Set([
  "items", "recipes", "resources", "gatheringTiers", "campfireFuels", "equipmentSets", "craftingTiers",
  "shops", "npcs", "quests", "dialogue", "spells", "spellRunes", "elementalSpells",
]);

function isPrivatePath(value: string): boolean {
  return value.split("/").some(segment => {
    const lower = segment.toLowerCase();
    return lower.startsWith(".env")
      || /(?:^|[._-])credentials?(?:[._-]|$)/i.test(lower)
      || /(?:^|[._-])secrets?(?:[._-]|$)/i.test(lower)
      || /(?:^|[._-])passwords?(?:[._-]|$)/i.test(lower)
      || /(?:^|[._-])tokens?(?:[._-]|$)/i.test(lower)
      || /^(?:id_rsa|id_ed25519)(?:[._-]|$)/i.test(lower)
      || /\.(?:pem|key|p12|pfx)$/i.test(lower);
  });
}

/** Mirrors the server's diff scope so every selectable row can be opened safely. */
function isReviewablePath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0")) return false;
  const segments = value.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..") || isPrivatePath(value)) return false;
  return REVIEWABLE_PREFIXES.some(prefix => value.startsWith(prefix) && value.length > prefix.length);
}

function isGitStatusEntry(value: unknown): value is GitStatusEntry {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.status === "string"
    && isReviewablePath(row.path)
    && typeof row.tracked === "boolean"
    && (row.originalPath === undefined || isReviewablePath(row.originalPath));
}

function normalizeChanges(response: GitStatusResponse | undefined): GitStatusEntry[] {
  if (!Array.isArray(response?.changes)) return [];
  return response.changes
    .filter(isGitStatusEntry)
    .filter(change => change.tracked)
    .sort((a, b) => a.path.localeCompare(b.path));
}

function displayStatus(status: string): string {
  const code = status.trim();
  return code || "??";
}

function statusLabel(status: string): string {
  const code = status.trim();
  if (code.includes("R")) return "Renamed";
  if (code.includes("A")) return "Added";
  if (code.includes("D")) return "Deleted";
  if (code.includes("M")) return "Modified";
  return code === "??" ? "Untracked" : "Changed";
}

function statusClass(status: string): string {
  return displayStatus(status).replace(/[^a-z\d]+/gi, "-").toLowerCase();
}

function errorMessage(value: unknown, fallback: string): string {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const error = (value as Record<string, unknown>).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

async function readDiff(path: string): Promise<string> {
  const response = await fetch(`/__devdocs/git/diff?path=${encodeURIComponent(path)}`);
  const body = await response.text();
  let parsed: unknown;
  try { parsed = body ? JSON.parse(body) as unknown : undefined; } catch { parsed = undefined; }
  if (!response.ok) throw new Error(errorMessage(parsed, `Could not load the diff (${response.status})`));
  return body;
}

async function validateContent(): Promise<ValidationResponse> {
  const response = await fetch("/__devdocs/validate", { method: "POST", headers: { Accept: "application/json" } });
  const body = await response.text();
  let parsed: unknown;
  try { parsed = body ? JSON.parse(body) as unknown : undefined; } catch { parsed = undefined; }
  if (!response.ok) throw new Error(errorMessage(parsed, `Validation failed (${response.status})`));
  return parsed as ValidationResponse;
}

function isDiagnostic(value: unknown): value is ApiDiagnostic {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.path === "string" && typeof row.message === "string" && (row.severity === "error" || row.severity === "warning");
}

function diagnosticsOf(response: ValidationResponse | undefined): ApiDiagnostic[] {
  return Array.isArray(response?.diagnostics) ? response.diagnostics.filter(isDiagnostic) : [];
}

interface DiagnosticTarget {
  collection: string;
  recordId: string;
}

/** Parse only server path formats that carry an unambiguous saved record identity. */
function diagnosticTarget(path: string): DiagnosticTarget | undefined {
  const indexed = /^([A-Za-z][A-Za-z\d]*)\[(\d+):([A-Za-z\d][A-Za-z\d_-]*)\](?:\.|$)/.exec(path);
  if (indexed && NAVIGABLE_COLLECTIONS.has(indexed[1]!)) return { collection: indexed[1]!, recordId: indexed[3]! };
  const direct = /^([A-Za-z][A-Za-z\d]*)\.([A-Za-z\d][A-Za-z\d_-]*)(?:\.|$)/.exec(path);
  if (direct && NAVIGABLE_COLLECTIONS.has(direct[1]!)) return { collection: direct[1]!, recordId: direct[2]! };
  return undefined;
}

function collectionLabel(collection: string): string {
  return collection.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, value => value.toUpperCase());
}

function validationLabel(response: ValidationResponse | undefined, pending: boolean, error: boolean): string {
  if (pending) return "Checking";
  if (error || !response) return "Unavailable";
  return response.ok ? (diagnosticsOf(response).some(issue => issue.severity === "warning") ? "Passes with warnings" : "Passed") : "Needs attention";
}

export default function ReviewPage({ navigate }: ReviewPageProps) {
  const titleId = useId();
  const filesHeadingId = useId();
  const diffHeadingId = useId();
  const validationHeadingId = useId();
  const [selectedPath, setSelectedPath] = useState<string>();

  const statusQuery = useQuery<GitStatusResponse, Error>({
    queryKey: ["git-status"],
    queryFn: () => apiGet<GitStatusResponse>("git/status"),
    staleTime: 2_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const changes = useMemo(() => normalizeChanges(statusQuery.data), [statusQuery.data]);
  const selectedChange = changes.find(change => change.path === selectedPath);

  useEffect(() => {
    if (!changes.some(change => change.path === selectedPath)) setSelectedPath(changes[0]?.path);
  }, [changes, selectedPath]);

  const diffQuery = useQuery<string, Error>({
    queryKey: ["git-diff", selectedChange?.path],
    queryFn: () => readDiff(selectedChange!.path),
    enabled: Boolean(selectedChange),
    staleTime: 2_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const validationQuery = useQuery<ValidationResponse, Error>({
    queryKey: ["validation"],
    queryFn: validateContent,
    staleTime: 2_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const validationDiagnostics = diagnosticsOf(validationQuery.data);
  const validationErrors = validationDiagnostics.filter(issue => issue.severity === "error").length;
  const validationWarnings = validationDiagnostics.filter(issue => issue.severity === "warning").length;

  return <section className="review-page" aria-labelledby={titleId}>
    <header className="review-header">
      <div className="review-header-copy">
        <span className="review-eyebrow"><GitBranch size={14}/> Change review</span>
        <h1 id={titleId}>Review</h1>
        <p>Inspect the local content diff and run the validator before accepting a change.</p>
      </div>
      <div className="review-header-actions">
        <dl className="review-summary" aria-label="Review summary">
          <div><dt>Changed files</dt><dd>{statusQuery.isSuccess ? changes.length : "—"}</dd></div>
          <div><dt>Validation</dt><dd>{validationLabel(validationQuery.data, validationQuery.isPending, validationQuery.isError)}</dd></div>
        </dl>
        <button type="button" className="review-requests-link" onClick={() => navigate("requests")}><span>Open Requests</span><ArrowUpRight size={15}/></button>
      </div>
    </header>

    <div className="review-layout">
      <FilesPanel
        headingId={filesHeadingId}
        changes={changes}
        selectedPath={selectedPath}
        pending={statusQuery.isPending}
        error={statusQuery.isError ? statusQuery.error : undefined}
        onRetry={() => void statusQuery.refetch()}
        onSelect={setSelectedPath}
      />
      <DiffPanel
        headingId={diffHeadingId}
        change={selectedChange}
        pending={diffQuery.isPending}
        error={diffQuery.isError ? diffQuery.error : undefined}
        diff={diffQuery.data}
        onRetry={() => void diffQuery.refetch()}
      />
    </div>

    <ValidationPanel
      headingId={validationHeadingId}
      query={validationQuery}
      diagnostics={validationDiagnostics}
      errors={validationErrors}
      warnings={validationWarnings}
      navigate={navigate}
    />
  </section>;
}

function FilesPanel({
  headingId,
  changes,
  selectedPath,
  pending,
  error,
  onRetry,
  onSelect,
}: {
  headingId: string;
  changes: readonly GitStatusEntry[];
  selectedPath: string | undefined;
  pending: boolean;
  error: Error | undefined;
  onRetry: () => void;
  onSelect: (path: string) => void;
}) {
  return <section className="review-panel review-files" aria-labelledby={headingId}>
    <header className="review-panel-heading"><div><span className="review-section-kicker">Git status</span><h2 id={headingId}>Changed files</h2></div><span className="review-panel-count">{pending ? "…" : changes.length}</span></header>
    {pending ? <LoadingFiles/> : error ? <ReviewError message={error.message} retry={onRetry} label="Could not load file status"/> : changes.length ? <div className="review-file-list" role="listbox" aria-labelledby={headingId} aria-label="Reviewable changed files">
      {changes.map(change => <button
        type="button"
        role="option"
        aria-selected={change.path === selectedPath}
        className={`review-file-row${change.path === selectedPath ? " is-selected" : ""}`}
        key={`${change.status}:${change.path}`}
        onClick={() => onSelect(change.path)}
      >
        <span className={`review-status review-status-${statusClass(change.status)}`} title={statusLabel(change.status)}>{displayStatus(change.status)}</span>
        <span className="review-file-path"><code>{change.path}</code>{change.originalPath && <small>from {change.originalPath}</small>}</span>
        <ArrowUpRight className="review-file-arrow" size={14}/>
      </button>)}
    </div> : <div className="review-empty review-empty-files"><FileCode2 size={22}/><strong>No reviewable content changes</strong><p>Only tracked files under content data, metadata, or devdocs can be opened here.</p></div>}
  </section>;
}

function DiffPanel({
  headingId,
  change,
  pending,
  error,
  diff,
  onRetry,
}: {
  headingId: string;
  change: GitStatusEntry | undefined;
  pending: boolean;
  error: Error | undefined;
  diff: string | undefined;
  onRetry: () => void;
}) {
  return <section className="review-panel review-diff-panel" aria-labelledby={headingId}>
    <header className="review-panel-heading review-diff-heading"><div><span className="review-section-kicker">Read only</span><h2 id={headingId}>{change?.path ?? "File diff"}</h2></div>{change && <span className={`review-status review-status-${statusClass(change.status)}`}>{statusLabel(change.status)}</span>}</header>
    {!change ? <div className="review-empty"><FileCode2 size={22}/><strong>Select a changed file</strong><p>Choose a tracked content path to inspect its diff.</p></div> : pending ? <LoadingDiff/> : error ? <ReviewError message={error.message} retry={onRetry} label="Could not load this diff"/> : diff?.trim() ? <DiffText value={diff}/> : <div className="review-empty"><FileCode2 size={22}/><strong>No textual diff</strong><p>Git returned no text for this selected path.</p></div>}
  </section>;
}

function DiffText({ value }: { value: string }) {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  return <pre className="review-diff" aria-label="Read-only selected file diff">{lines.map((line, index) => {
    const kind = line.startsWith("+++") || line.startsWith("---") ? "header" : line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "addition" : line.startsWith("-") ? "deletion" : "context";
    return <span className={`review-diff-line review-diff-${kind}`} key={`${index}:${line}`}><span className="review-line-number" aria-hidden="true">{String(index + 1).padStart(4, " ")}</span><span className="review-line-text">{line || " "}</span></span>;
  })}</pre>;
}

function ValidationPanel({
  headingId,
  query,
  diagnostics,
  errors,
  warnings,
  navigate,
}: {
  headingId: string;
  query: ReturnType<typeof useQuery<ValidationResponse, Error>>;
  diagnostics: readonly ApiDiagnostic[];
  errors: number;
  warnings: number;
  navigate: ReviewPageProps["navigate"];
}) {
  return <section className="review-panel review-validation" aria-labelledby={headingId}>
    <header className="review-panel-heading"><div><span className="review-section-kicker">Content gate</span><h2 id={headingId}>Validation</h2></div><button type="button" className="review-action" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={14} className={query.isFetching ? "review-spin" : undefined}/>{query.isFetching ? "Validating…" : "Run again"}</button></header>
    {query.isPending ? <LoadingValidation/> : query.isError ? <ReviewError message={query.error.message} retry={() => void query.refetch()} label="Could not run validation"/> : query.data ? <div className="review-validation-body">
      <div className={`review-validation-result${query.data.ok ? " is-ok" : " is-failed"}`} role="status" aria-live="polite">
        {query.data.ok ? <CheckCircle2 size={21}/> : <AlertCircle size={21}/>}<div><strong>{query.data.ok ? (warnings ? "Content passes with warnings" : "Content is valid") : "Content needs attention"}</strong><p>{query.data.ok ? "The current disk snapshot passed the blocking checks." : "Resolve the diagnostics before accepting the current content snapshot."}</p></div>
      </div>
      <dl className="review-validation-stats" aria-label="Validation totals"><div><dt>Collections</dt><dd>{query.data.collections}</dd></div><div><dt>Errors</dt><dd>{errors}</dd></div><div><dt>Warnings</dt><dd>{warnings}</dd></div></dl>
      {diagnostics.length ? <div className="review-diagnostics"><div className="review-diagnostics-heading"><h3>Diagnostics</h3><span>{diagnostics.length}</span></div><ol>{diagnostics.map((diagnostic, index) => <DiagnosticRow key={`${diagnostic.path}:${diagnostic.message}:${index}`} diagnostic={diagnostic} navigate={navigate}/>)}</ol></div> : <div className="review-no-diagnostics"><ShieldCheck size={18}/><p>No diagnostics returned by the content validator.</p></div>}
    </div> : null}
  </section>;
}

function DiagnosticRow({ diagnostic, navigate }: { diagnostic: ApiDiagnostic; navigate: ReviewPageProps["navigate"] }) {
  const target = diagnosticTarget(diagnostic.path);
  return <li className={`review-diagnostic review-diagnostic-${diagnostic.severity}`}><div className="review-diagnostic-meta"><span className="review-severity">{diagnostic.severity}</span><code>{diagnostic.path || "content"}</code></div><p>{diagnostic.message}</p>{target && <button type="button" className="review-diagnostic-link" onClick={() => navigate(target.collection, target.recordId)}>Open {collectionLabel(target.collection)} <code>{target.recordId}</code><ArrowUpRight size={13}/></button>}</li>;
}

function ReviewError({ message, retry, label }: { message: string; retry: () => void; label: string }) {
  return <div className="review-error" role="alert"><AlertCircle size={19}/><div><strong>{label}</strong><p>{message}</p><button type="button" className="review-action review-action-secondary" onClick={retry}><RefreshCw size={14}/>Try again</button></div></div>;
}

function LoadingFiles() {
  return <div className="review-loading-files" role="status" aria-label="Loading changed files">{Array.from({ length: 7 }, (_, index) => <span key={index}/>)}</div>;
}

function LoadingDiff() {
  return <div className="review-loading-diff" role="status" aria-label="Loading diff">{Array.from({ length: 14 }, (_, index) => <span key={index}/>)}</div>;
}

function LoadingValidation() {
  return <div className="review-loading-validation" role="status" aria-label="Running validation"><LoaderCircle size={18} className="review-spin"/><p>Checking every registered content collection…</p></div>;
}
