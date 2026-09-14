import { useEffect, useId, useMemo, useState } from "react";
import { AlertCircle, ArrowUpRight, CheckCircle2, FileCode2, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "../api/client.js";
import type { ApiDiagnostic } from "../../shared/contracts.js";
import AssetCandidates from "./AssetCandidates.js";
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

function statusTone(status: string): "ok" | "warn" | "danger" | "info" | undefined {
  const code = status.trim();
  if (code.includes("A")) return "ok";
  if (code.includes("D")) return "danger";
  if (code.includes("R")) return "info";
  if (code.includes("M")) return "warn";
  return undefined;
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

function validationTone(response: ValidationResponse | undefined, pending: boolean, error: boolean): "ok" | "warn" | "danger" | undefined {
  if (pending) return undefined;
  if (error || !response) return "danger";
  return response.ok ? (diagnosticsOf(response).some(issue => issue.severity === "warning") ? "warn" : "ok") : "danger";
}

export default function ReviewPage({ navigate }: ReviewPageProps) {
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

  return <section className="review-page" aria-label="Review">
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

    <AssetCandidates showUpload={false} />
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
  return <section className="panel review-files" aria-labelledby={headingId}>
    <header className="panel-header"><FileCode2 size={14} /><h2 id={headingId}>Changed files</h2><span className="count-badge">{pending ? "…" : changes.length}</span></header>
    {pending ? <LoadingFiles /> : error ? <ReviewError message={error.message} retry={onRetry} label="Could not load file status" /> : changes.length ? <div className="review-file-list" role="listbox" aria-labelledby={headingId} aria-label="Reviewable changed files">
      {changes.map(change => <button
        type="button"
        role="option"
        aria-selected={change.path === selectedPath}
        className={`review-file-row${change.path === selectedPath ? " is-selected" : ""}`}
        key={`${change.status}:${change.path}`}
        onClick={() => onSelect(change.path)}
      >
        <span className="badge badge-mono" data-tone={statusTone(change.status)} title={statusLabel(change.status)}>{displayStatus(change.status)}</span>
        <span className="review-file-path"><code>{change.path}</code>{change.originalPath && <small>from {change.originalPath}</small>}</span>
        <ArrowUpRight className="review-file-arrow" size={13} />
      </button>)}
    </div> : <p className="empty-inline review-empty">No reviewable content changes.</p>}
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
  return <section className="panel review-diff-panel" aria-labelledby={headingId}>
    <header className="panel-header review-diff-heading"><h2 id={headingId} className="review-diff-title" title={change?.path}>{change?.path ?? "File diff"}</h2>{change && <div className="panel-header-actions"><span className="badge" data-tone={statusTone(change.status)}>{statusLabel(change.status)}</span></div>}</header>
    {!change ? <p className="empty-inline review-empty">Select a changed file to see its diff.</p> : pending ? <LoadingDiff /> : error ? <ReviewError message={error.message} retry={onRetry} label="Could not load this diff" /> : diff?.trim() ? <DiffText value={diff} /> : <p className="empty-inline review-empty">Git returned no text for this path.</p>}
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
  const label = validationLabel(query.data, query.isPending, query.isError);
  const tone = validationTone(query.data, query.isPending, query.isError);
  return <section className="panel review-validation" aria-labelledby={headingId}>
    <header className="panel-header">
      <ShieldCheck size={14} /><h2 id={headingId}>Validation</h2>
      <span className="badge" data-tone={tone} role="status" aria-live="polite">{query.data?.ok === true ? <CheckCircle2 size={11} /> : query.data?.ok === false ? <AlertCircle size={11} /> : null}{label}</span>
      <div className="panel-header-actions"><button type="button" className="button button-small" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={13} className={query.isFetching ? "review-spin" : undefined} />{query.isFetching ? "Validating…" : "Run again"}</button></div>
    </header>
    {query.isPending ? <LoadingValidation /> : query.isError ? <ReviewError message={query.error.message} retry={() => void query.refetch()} label="Could not run validation" /> : query.data ? <div className="panel-body review-validation-body">
      <dl className="stat-grid review-validation-stats" aria-label="Validation totals">
        <div className="stat"><dt>Collections</dt><dd>{query.data.collections}</dd></div>
        <div className="stat"><dt>Errors</dt><dd style={errors ? { color: "var(--danger)" } : undefined}>{errors}</dd></div>
        <div className="stat"><dt>Warnings</dt><dd style={warnings ? { color: "var(--warn)" } : undefined}>{warnings}</dd></div>
      </dl>
      {diagnostics.length ? <div className="review-diagnostics"><div className="section-heading"><h3>Diagnostics</h3><span>{diagnostics.length}</span></div><ol>{diagnostics.map((diagnostic, index) => <DiagnosticRow key={`${diagnostic.path}:${diagnostic.message}:${index}`} diagnostic={diagnostic} navigate={navigate} />)}</ol></div> : <p className="empty-inline review-no-diagnostics"><ShieldCheck size={13} /> No diagnostics.</p>}
    </div> : null}
  </section>;
}

function DiagnosticRow({ diagnostic, navigate }: { diagnostic: ApiDiagnostic; navigate: ReviewPageProps["navigate"] }) {
  const target = diagnosticTarget(diagnostic.path);
  return <li className={`review-diagnostic review-diagnostic-${diagnostic.severity}`}>
    <span className="badge" data-tone={diagnostic.severity === "error" ? "danger" : "warn"}>{diagnostic.severity}</span>
    <div className="review-diagnostic-body"><code>{diagnostic.path || "content"}</code><p>{diagnostic.message}</p></div>
    {target && <button type="button" className="button button-small button-ghost" onClick={() => navigate(target.collection, target.recordId)}>{collectionLabel(target.collection)} <code>{target.recordId}</code><ArrowUpRight size={12} /></button>}
  </li>;
}

function ReviewError({ message, retry, label }: { message: string; retry: () => void; label: string }) {
  return <div className="review-error" role="alert"><AlertCircle size={16} /><div><strong>{label}</strong><p>{message}</p><button type="button" className="button button-small" onClick={retry}><RefreshCw size={13} />Try again</button></div></div>;
}

function LoadingFiles() {
  return <div className="review-loading-files" role="status" aria-label="Loading changed files">{Array.from({ length: 6 }, (_, index) => <span className="skeleton" key={index} />)}</div>;
}

function LoadingDiff() {
  return <div className="review-loading-diff" role="status" aria-label="Loading diff">{Array.from({ length: 12 }, (_, index) => <span className="skeleton" key={index} />)}</div>;
}

function LoadingValidation() {
  return <div className="review-loading-validation" role="status" aria-label="Running validation"><LoaderCircle size={15} className="review-spin" /><span>Checking every content collection…</span></div>;
}
