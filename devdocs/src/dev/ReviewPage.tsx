import { useEffect, useId, useMemo, useState } from "react";
import { AlertCircle, ArrowUpRight, CheckCircle2, FileCode2, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "../api/client.js";
import type { ApiDiagnostic } from "../../shared/contracts.js";
import AssetCandidates from "./AssetCandidates.js";
import { Button, Badge } from "../components/ui/index.js";
import { toneVariant } from "../components/ui/badge.js";
import { cn } from "../lib/utils.js";
import { EMPTY, PANEL, PANEL_HEADER } from "../ui/layout.js";
import { LoadError, Skeleton, SPIN } from "./panelParts.js";

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

  return <section className="flex min-w-0 flex-col gap-3" aria-label="Review">
    <div className="grid grid-cols-[minmax(240px,.36fr)_minmax(0,1fr)] items-start gap-3 max-[980px]:grid-cols-1">
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
  return <section className={cn(PANEL, "min-w-0 overflow-hidden")} aria-labelledby={headingId}>
    <header className={PANEL_HEADER}><FileCode2 size={14} /><h2 id={headingId}>Changed files</h2><span className="font-mono text-[11px] text-muted-foreground">{pending ? "…" : changes.length}</span></header>
    {pending ? <LoadingFiles /> : error ? <LoadError className="p-3" message={error.message} retry={onRetry} label="Could not load file status" /> : changes.length ? <div className="max-h-[520px] overflow-y-auto p-1 [scrollbar-width:thin] max-[980px]:max-h-65" role="listbox" aria-labelledby={headingId} aria-label="Reviewable changed files">
      {changes.map(change => <button
        type="button"
        role="option"
        aria-selected={change.path === selectedPath}
        className="group/file grid min-h-8 w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_14px] items-center gap-2 rounded-md px-2 py-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 aria-selected:bg-selected"
        key={`${change.status}:${change.path}`}
        onClick={() => onSelect(change.path)}
      >
        <Badge variant={toneVariant(statusTone(change.status))} className="min-w-[30px] justify-center font-mono" title={statusLabel(change.status)}>{displayStatus(change.status)}</Badge>
        <span className="flex min-w-0 flex-col gap-px"><code className="truncate font-mono text-[11px] leading-snug text-foreground">{change.path}</code>{change.originalPath && <small className="truncate text-[11px] text-faint">from {change.originalPath}</small>}</span>
        <ArrowUpRight className="text-faint opacity-0 group-hover/file:text-primary group-hover/file:opacity-100 group-aria-selected/file:text-primary group-aria-selected/file:opacity-100" size={13} />
      </button>)}
    </div> : <p className={cn(EMPTY, "px-3 py-2.5")}>No reviewable content changes.</p>}
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
  return <section className={cn(PANEL, "min-w-0 overflow-hidden")} aria-labelledby={headingId}>
    <header className={cn(PANEL_HEADER, "min-w-0")}><h2 id={headingId} className={cn("min-w-0 truncate", change && "font-mono text-xs! font-medium!")} title={change?.path}>{change?.path ?? "File diff"}</h2>{change && <div className="ml-auto flex items-center gap-1"><Badge variant={toneVariant(statusTone(change.status))}>{statusLabel(change.status)}</Badge></div>}</header>
    {!change ? <p className={cn(EMPTY, "px-3 py-2.5")}>Select a changed file to see its diff.</p> : pending ? <LoadingDiff /> : error ? <LoadError className="p-3" message={error.message} retry={onRetry} label="Could not load this diff" /> : diff?.trim() ? <DiffText value={diff} /> : <p className={cn(EMPTY, "px-3 py-2.5")}>Git returned no text for this path.</p>}
  </section>;
}

const DIFF_LINE: Record<string, string> = {
  header: "text-foreground font-medium",
  hunk: "bg-info-soft text-info",
  addition: "bg-ok-soft text-foreground [&>span:first-child]:text-ok",
  deletion: "bg-destructive-soft text-foreground [&>span:first-child]:text-destructive",
  context: "",
};

function DiffText({ value }: { value: string }) {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  return <pre className="m-0 max-h-[640px] min-h-80 overflow-auto bg-background font-mono text-xs leading-[1.6] text-muted-foreground [scrollbar-width:thin] max-[980px]:min-h-60" aria-label="Read-only selected file diff">{lines.map((line, index) => {
    const kind = line.startsWith("+++") || line.startsWith("---") ? "header" : line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "addition" : line.startsWith("-") ? "deletion" : "context";
    return <span className={cn("flex min-h-[1.6em] min-w-max pr-5", DIFF_LINE[kind])} data-kind={kind} key={`${index}:${line}`}><span className="w-11 shrink-0 pl-2 text-right text-faint opacity-70 select-none" aria-hidden="true">{String(index + 1).padStart(4, " ")}</span><span className="pl-3 whitespace-pre">{line || " "}</span></span>;
  })}</pre>;
}

const STAT = "flex min-w-0 flex-col gap-px rounded-md bg-secondary px-2 py-[5px] [&_dt]:truncate [&_dt]:text-[11px] [&_dt]:text-faint [&_dd]:m-0 [&_dd]:font-mono [&_dd]:text-xs [&_dd]:font-medium [&_dd]:text-foreground";

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
  return <section className={PANEL} aria-labelledby={headingId}>
    <header className={PANEL_HEADER}>
      <ShieldCheck size={14} /><h2 id={headingId}>Validation</h2>
      <Badge variant={toneVariant(tone)} role="status" aria-live="polite">{query.data?.ok === true ? <CheckCircle2 size={11} /> : query.data?.ok === false ? <AlertCircle size={11} /> : null}{label}</Badge>
      <div className="ml-auto flex items-center gap-1"><Button variant="secondary" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={13} className={query.isFetching ? SPIN : undefined} />{query.isFetching ? "Validating…" : "Run again"}</Button></div>
    </header>
    {query.isPending ? <LoadingValidation /> : query.isError ? <LoadError className="p-3" message={query.error.message} retry={() => void query.refetch()} label="Could not run validation" /> : query.data ? <div className="flex flex-col gap-3 px-2.5 py-2">
      <dl className="grid max-w-[420px] grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-1" aria-label="Validation totals">
        <div className={STAT}><dt>Collections</dt><dd>{query.data.collections}</dd></div>
        <div className={STAT}><dt>Errors</dt><dd className={cn(errors > 0 && "text-destructive!")}>{errors}</dd></div>
        <div className={STAT}><dt>Warnings</dt><dd className={cn(warnings > 0 && "text-warn!")}>{warnings}</dd></div>
      </dl>
      {diagnostics.length ? <div><div className="mb-1.5 flex items-center justify-between gap-2.5"><h3 className="text-xs font-semibold">Diagnostics</h3><span className="font-mono text-[11px] text-faint">{diagnostics.length}</span></div><ol className="flex flex-col gap-1">{diagnostics.map((diagnostic, index) => <DiagnosticRow key={`${diagnostic.path}:${diagnostic.message}:${index}`} diagnostic={diagnostic} navigate={navigate} />)}</ol></div> : <p className={cn(EMPTY, "inline-flex items-center gap-1.5 p-0 text-ok")}><ShieldCheck size={13} /> No diagnostics.</p>}
    </div> : null}
  </section>;
}

function DiagnosticRow({ diagnostic, navigate }: { diagnostic: ApiDiagnostic; navigate: ReviewPageProps["navigate"] }) {
  const target = diagnosticTarget(diagnostic.path);
  return <li className="flex items-start gap-2 rounded-md border border-border-subtle bg-card px-2 py-1.5" data-severity={diagnostic.severity}>
    <Badge className="mt-px capitalize" variant={toneVariant(diagnostic.severity === "error" ? "danger" : "warn")}>{diagnostic.severity}</Badge>
    <div className="flex min-w-0 flex-1 flex-col gap-0.5"><code className="truncate font-mono text-[11px] text-faint">{diagnostic.path || "content"}</code><p className="text-xs leading-normal text-foreground [overflow-wrap:anywhere]">{diagnostic.message}</p></div>
    {target && <Button variant="ghost" size="sm" onClick={() => navigate(target.collection, target.recordId)}>{collectionLabel(target.collection)} <code className="font-mono text-[11px] text-faint">{target.recordId}</code><ArrowUpRight size={12} /></Button>}
  </li>;
}

function LoadingFiles() {
  return <div className="grid gap-1.5 p-2" role="status" aria-label="Loading changed files">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-6" />)}</div>;
}

const DIFF_SKELETON = ["w-[84%]", "w-[84%]", "w-[64%]", "w-[92%]", "w-[84%]", "w-[64%]", "w-[84%]", "w-[92%]", "w-[64%]", "w-[84%]", "w-[84%]", "w-[92%]"];

function LoadingDiff() {
  return <div className="grid min-h-80 content-start gap-2 bg-background p-4" role="status" aria-label="Loading diff">{DIFF_SKELETON.map((width, index) => <Skeleton key={index} className={cn("h-[9px]", width)} />)}</div>;
}

function LoadingValidation() {
  return <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground" role="status" aria-label="Running validation"><LoaderCircle size={15} className={SPIN} /><span>Checking every content collection…</span></div>;
}
