import { useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, FileUp, GitCompareArrows, LoaderCircle, RefreshCw, ShieldCheck, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";

import type { MetaResponse } from "../../shared/metaContracts.js";
import type { MetaCandidate } from "../../../tools/content/meta.js";
import { AssetViewer } from "../viewer/AssetViewer.js";
import { metaPath, metaQueryKey } from "./NotesPanel.js";
import type { AssetActionResponse, AssetCandidateView, AssetCandidatesResponse } from "../../server/handlers/assets.js";
import { Button, Badge, Input, NativeSelect, Textarea } from "../components/ui/index.js";
import { buttonVariants } from "../components/ui/index.js";
import { cn } from "../lib/utils.js";
import { toneVariant } from "../components/ui/badge.js";
import { EMPTY, PANEL, PANEL_BODY, PANEL_HEADER } from "../ui/layout.js";
import { FormError, LoadError, SPIN } from "./panelParts.js";

const BODY_VALUES = ["male", "female", "creature"] as const;
type CandidateBody = (typeof BODY_VALUES)[number];
type CandidateStatus = MetaCandidate["status"];
type Tone = "accent" | "ok" | "warn" | "danger" | "info" | undefined;

export interface AssetCandidatesProps {
  /** When omitted, this is the review queue and shows candidates across all targets. */
  collection?: string;
  entityId?: string;
  /** The armour or attachment slot associated with a target candidate. */
  slot?: string;
  /** Current manifest id used to render the side-by-side comparison. */
  currentAssetId?: string;
  targetLabel?: string;
  /** Upload is shown only for a concrete target by default. */
  showUpload?: boolean;
  compact?: boolean;
}

interface UploadResponse extends AssetActionResponse {
  candidate: AssetCandidateView;
}

interface ActionVariables {
  candidateId: string;
  revision: string;
  action: "approve" | "reject" | "promote";
  body?: CandidateBody;
  reason?: string;
}

interface UploadVariables {
  revision: string;
  file: File;
  body?: CandidateBody;
  provenance?: { source?: string };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function candidateStatus(value: unknown): CandidateStatus {
  return value === "approved" || value === "live" || value === "rejected" || value === "draft" ? value : "candidate";
}

function isCandidateView(value: unknown): value is AssetCandidateView {
  if (!isObject(value)) return false;
  return typeof value.candidateId === "string"
    && (value.kind === "glb" || value.kind === "icon")
    && typeof value.sha256 === "string"
    && typeof value.file === "string"
    && typeof value.bytes === "number"
    && typeof value.status === "string"
    && typeof value.uploadedAt === "string"
    && typeof value.collection === "string"
    && typeof value.entityId === "string"
    && typeof value.revision === "string"
    && typeof value.fileUrl === "string";
}

function normalizeResponse(value: unknown): AssetCandidatesResponse {
  if (!isObject(value) || !Array.isArray(value.candidates)) return { candidates: [] };
  return { candidates: value.candidates.filter(isCandidateView).map(candidate => ({ ...candidate, status: candidateStatus(candidate.status) })) };
}

async function readCandidates(url: string): Promise<AssetCandidatesResponse> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const value = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(isObject(value) && typeof value.error === "string" ? value.error : `Could not load candidates (${response.status})`);
  return normalizeResponse(value);
}

async function readTargetMeta(collection: string, entityId: string): Promise<MetaResponse> {
  const response = await fetch(metaPath(collection, entityId), { headers: { Accept: "application/json" } });
  const value = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(isObject(value) && typeof value.error === "string" ? value.error : `Could not load asset metadata (${response.status})`);
  return value as MetaResponse;
}

async function sendAction(variables: ActionVariables): Promise<AssetActionResponse> {
  const response = await fetch(`/__devdocs/assets/${encodeURIComponent(variables.candidateId)}/${variables.action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ revision: variables.revision, ...(variables.body ? { body: variables.body } : {}), ...(variables.reason ? { reason: variables.reason } : {}) }),
  });
  const value = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(isObject(value) && typeof value.error === "string" ? value.error : `Could not ${variables.action} candidate (${response.status})`);
  return value as AssetActionResponse;
}

function base64(bytes: Uint8Array): string {
  let result = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  }
  return btoa(result);
}

async function uploadFile(collection: string, entityId: string, slot: string | undefined, variables: UploadVariables): Promise<UploadResponse> {
  const bytes = new Uint8Array(await variables.file.arrayBuffer());
  const response = await fetch("/__devdocs/assets/upload", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ collection, entityId, revision: variables.revision, fileName: variables.file.name, fileBase64: base64(bytes), ...(slot ? { slot } : {}), ...(variables.body ? { body: variables.body } : {}), ...(variables.provenance ? { provenance: variables.provenance } : {}) }),
  });
  const value = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(isObject(value) && typeof value.error === "string" ? value.error : `Could not upload candidate (${response.status})`);
  return value as UploadResponse;
}

function timestamp(value: string): string {
  const date = Date.parse(value);
  return Number.isFinite(date) ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date) : "Unknown time";
}

function bytesLabel(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "Unknown size";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function statusLabel(value: CandidateStatus): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function statusTone(value: CandidateStatus): Tone {
  return value === "candidate" ? "info" : value === "approved" ? "accent" : value === "live" ? "ok" : value === "rejected" ? "danger" : undefined;
}

function targetLabelFor(candidate: AssetCandidateView): string {
  return `${candidate.collection} / ${candidate.entityId}${candidate.slot ? ` / ${candidate.slot}` : ""}`;
}

function approvalValues(candidate: AssetCandidateView): { male: boolean; female: boolean } {
  return { male: candidate.approvals?.male === true, female: candidate.approvals?.female === true };
}

/**
 * Upload and review controls for the one local asset workflow. It deliberately renders the
 * existing production AssetViewer for comparisons, so candidate previews use the same camera,
 * materials, animation, and bounds controls as the live asset.
 */
export default function AssetCandidates({ collection, entityId, slot, currentAssetId, targetLabel, showUpload = Boolean(collection && entityId), compact = false }: AssetCandidatesProps) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const target = Boolean(collection && entityId);
  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (collection) params.set("collection", collection);
    if (entityId) params.set("entityId", entityId);
    const query = params.toString();
    return `/__devdocs/assets/candidates${query ? `?${query}` : ""}`;
  }, [collection, entityId]);
  const candidatesQuery = useQuery<AssetCandidatesResponse, Error>({ queryKey: ["asset-candidates", collection ?? "*", entityId ?? "*"], queryFn: () => readCandidates(queryUrl), staleTime: 2_000, refetchOnWindowFocus: false, retry: false });
  const metaQuery = useQuery<MetaResponse, Error>({ queryKey: target ? metaQueryKey(collection!, entityId!) : ["asset-meta", "none"], queryFn: () => readTargetMeta(collection!, entityId!), enabled: target, staleTime: 2_000, refetchOnWindowFocus: false, retry: false });
  const [file, setFile] = useState<File>();
  const [uploadBody, setUploadBody] = useState<CandidateBody | "">(slot ? "male" : "");
  const [source, setSource] = useState("");
  const [formError, setFormError] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [rejecting, setRejecting] = useState<string>();
  const [rejectReason, setRejectReason] = useState("");
  const [approvalBody, setApprovalBody] = useState<Partial<Record<string, CandidateBody>>>({});

  const refresh = () => {
    void candidatesQuery.refetch();
    if (target) void metaQuery.refetch();
  };
  const actionMutation = useMutation<AssetActionResponse, Error, ActionVariables>({
    mutationFn: sendAction,
    onSuccess: response => {
      queryClient.setQueryData(["asset-candidates", collection ?? "*", entityId ?? "*"], (current: AssetCandidatesResponse | undefined) => current ? { candidates: current.candidates.map(candidate => candidate.candidateId === response.candidate.candidateId ? response.candidate : candidate) } : current);
      void queryClient.invalidateQueries({ queryKey: ["asset-candidates"] });
      if (target) void queryClient.invalidateQueries({ queryKey: metaQueryKey(collection!, entityId!) });
      setRejecting(undefined); setRejectReason(""); setFeedback(response.pendingApproval ? "Sign-off saved. The other body still needs review." : undefined);
      toast.success(response.pendingApproval ? "Body sign-off saved" : "Candidate review saved");
    },
    onError: error => { setFeedback(error.message || "Could not save candidate review"); toast.error(error.message || "Could not save candidate review"); void candidatesQuery.refetch(); },
  });
  const uploadMutation = useMutation<UploadResponse, Error, UploadVariables>({
    mutationFn: variables => uploadFile(collection!, entityId!, slot, variables),
    onSuccess: response => {
      queryClient.setQueryData(["asset-candidates", collection ?? "*", entityId ?? "*"], (current: AssetCandidatesResponse | undefined) => ({ candidates: [...(current?.candidates ?? []), response.candidate] }));
      void queryClient.invalidateQueries({ queryKey: ["asset-candidates"] });
      if (target) void queryClient.invalidateQueries({ queryKey: metaQueryKey(collection!, entityId!) });
      setFile(undefined); setSource(""); setFormError(undefined); setFeedback(undefined);
      if (fileInput.current) fileInput.current.value = "";
      toast.success("Candidate uploaded");
    },
    onError: error => { setFormError(error.message || "Could not upload candidate"); toast.error(error.message || "Could not upload candidate"); },
  });

  const candidates = useMemo(() => {
    const rows = candidatesQuery.data?.candidates ?? [];
    return slot ? rows.filter(candidate => candidate.slot === slot) : rows;
  }, [candidatesQuery.data?.candidates, slot]);
  const title = target ? targetLabel ?? `Asset candidates for ${collection} / ${entityId}` : "Asset candidates";

  function selectFile(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    setFile(selected);
    setFormError(undefined);
    if (selected && !selected.name.toLowerCase().endsWith(".glb")) setFormError("Choose a GLB file.");
  }

  function submitUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !target || !metaQuery.data) { setFormError(!file ? "Choose a GLB file before uploading." : "Asset metadata is still loading."); return; }
    if (!file.name.toLowerCase().endsWith(".glb")) { setFormError("Choose a GLB file."); return; }
    uploadMutation.mutate({ revision: metaQuery.data.revision, file, ...(uploadBody ? { body: uploadBody } : {}), ...(source.trim() ? { provenance: { source: source.trim() } } : {}) });
  }

  function approve(candidate: AssetCandidateView) {
    const body = approvalBody[candidate.candidateId] ?? (candidate.body === "male" || candidate.body === "female" ? candidate.body : undefined);
    actionMutation.mutate({ candidateId: candidate.candidateId, revision: candidate.revision, action: "approve", ...(body ? { body } : {}) });
  }

  function reject(candidate: AssetCandidateView) {
    const reason = rejectReason.trim();
    if (!reason) { setFeedback("Write a reason before rejecting this candidate."); return; }
    actionMutation.mutate({ candidateId: candidate.candidateId, revision: candidate.revision, action: "reject", reason });
  }

  function promote(candidate: AssetCandidateView) {
    actionMutation.mutate({ candidateId: candidate.candidateId, revision: candidate.revision, action: "promote" });
  }

  return <section className={cn("min-w-0", compact ? "flex flex-col gap-2" : PANEL)} aria-labelledby={titleId}>
    <header className={compact ? "flex min-h-7 items-center gap-2 [&_h3]:text-xs [&_h3]:font-semibold" : PANEL_HEADER}>
      <GitCompareArrows size={14} className="shrink-0 text-muted-foreground" />
      <h3 id={titleId} className="min-w-0 truncate" title={title}>{title}</h3>
      <span className="font-mono text-[11px] text-muted-foreground">{candidatesQuery.isPending ? "…" : candidates.length}</span>
      <div className="ml-auto flex items-center gap-1"><Button variant="ghost" size="icon-sm" aria-label="Refresh asset candidates" onClick={refresh} disabled={candidatesQuery.isFetching}><RefreshCw size={13} className={candidatesQuery.isFetching ? SPIN : undefined} /></Button></div>
    </header>

    <div className={cn("flex flex-col gap-2.5", !compact && PANEL_BODY)}>
      {feedback && <div className="flex items-center gap-2 rounded-md border border-ok bg-ok-soft py-1 pr-1 pl-2.5 text-xs" role="status"><ShieldCheck size={13} className="shrink-0 text-ok" /><span className="flex-1">{feedback}</span><Button variant="ghost" size="icon-sm" aria-label="Dismiss asset feedback" onClick={() => setFeedback(undefined)}><X size={13} /></Button></div>}

      {showUpload && target && <form className="flex flex-wrap items-center gap-1.5" onSubmit={submitUpload}>
        <label className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "relative max-w-60 overflow-hidden max-md:max-w-none max-md:flex-[1_1_100%]")}><FileUp size={13} /><span className="truncate">{file?.name ?? "Choose GLB…"}</span><input ref={fileInput} className="absolute inset-0 size-full cursor-pointer opacity-0" type="file" accept=".glb,model/gltf-binary" onChange={selectFile} aria-label="Candidate GLB file" /></label>
        <NativeSelect aria-label="Body" value={uploadBody} onChange={event => setUploadBody(event.target.value as CandidateBody | "")}><option value="">Any body</option>{BODY_VALUES.map(value => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}</NativeSelect>
        <label className="flex min-w-0 flex-[1_1_160px] max-md:flex-[1_1_100%]"><span className="sr-only">Source</span><Input aria-label="Source" value={source} onChange={event => setSource(event.target.value)} placeholder="Source (pack, URL…)" /></label>
        <Button variant="default" size="sm" type="submit" disabled={uploadMutation.isPending || !metaQuery.data}><UploadCloud size={13} />{uploadMutation.isPending ? "Inspecting…" : "Upload"}</Button>
        {formError && <FormError>{formError}</FormError>}
      </form>}

      {!target && showUpload && <p className={EMPTY}>Open a record to upload a new file.</p>}

      {candidatesQuery.isPending ? <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground" role="status"><LoaderCircle size={14} className={SPIN} /><span>Loading candidates…</span></div>
        : candidatesQuery.isError ? <LoadError label="Could not load candidates" message={candidatesQuery.error.message} retry={refresh} />
        : candidates.length ? <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-1.5", compact ? "[&_.viewer-viewport]:h-50!" : "[&_.viewer-viewport]:h-60!")}>{candidates.map(candidate => <CandidateCard key={candidate.candidateId} candidate={candidate} currentAssetId={currentAssetId} approving={actionMutation.isPending && actionMutation.variables?.candidateId === candidate.candidateId} approvalBody={approvalBody[candidate.candidateId]} onApprovalBody={value => setApprovalBody(previous => ({ ...previous, [candidate.candidateId]: value }))} rejecting={rejecting === candidate.candidateId} reason={rejectReason} onReason={setRejectReason} onStartReject={() => { setRejecting(candidate.candidateId); setRejectReason(""); setFeedback(undefined); }} onCancelReject={() => { setRejecting(undefined); setRejectReason(""); }} onApprove={() => approve(candidate)} onReject={() => reject(candidate)} onPromote={() => promote(candidate)} />)}</div>
        : <p className={EMPTY}>{target ? "No candidates for this target." : "No candidates waiting."}</p>}
    </div>
  </section>;
}

function CandidateCard({ candidate, currentAssetId, approving, approvalBody, onApprovalBody, rejecting, reason, onReason, onStartReject, onCancelReject, onApprove, onReject, onPromote }: {
  candidate: AssetCandidateView;
  currentAssetId?: string;
  approving: boolean;
  approvalBody?: CandidateBody;
  onApprovalBody: (value: CandidateBody) => void;
  rejecting: boolean;
  reason: string;
  onReason: (value: string) => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  onApprove: () => void;
  onReject: () => void;
  onPromote: () => void;
}) {
  const approvals = approvalValues(candidate);
  const setCandidate = candidate.collection === "equipmentSets" && candidate.kind === "glb";
  const canApprove = candidate.status === "candidate" || candidate.status === "draft";
  const isActionBusy = approving;
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const approvalChoice = approvalBody ?? (candidate.body === "female" ? "female" : "male");
  return <article className="flex min-w-0 flex-col gap-2 overflow-hidden rounded-md border border-border bg-card p-2.5" data-status={candidate.status}>
    <header className="flex flex-wrap items-center gap-1">
      <Badge variant={toneVariant(statusTone(candidate.status))}>{candidate.status === "approved" ? <Check size={11} /> : null}{statusLabel(candidate.status)}</Badge>
      <Badge className="font-mono">{candidate.kind}</Badge>
      <code className="ml-auto font-mono text-[11px] text-faint" title={`${candidate.candidateId} · ${candidate.sha256}`}>{candidate.sha256.slice(0, 10)}</code>
    </header>
    <div className="flex min-w-0 flex-col gap-0.5">
      <strong className="truncate text-xs font-medium" title={candidate.candidateId}>{targetLabelFor(candidate)}</strong>
      <span className={META}>{bytesLabel(candidate.bytes)} · {timestamp(candidate.uploadedAt)}{candidate.uploadedBy ? ` · ${candidate.uploadedBy}` : ""}</span>
      <span className={META}>Slot {candidate.slot ?? "any"} · Body {candidate.body ?? "any"} · {candidate.materials?.length ?? 0} materials · {candidate.animations?.length ?? 0} clips</span>
      {candidate.reasons?.length ? <span className="truncate text-[11px] text-warn" title={candidate.reasons.join(" · ")}>{candidate.reasons.join(" · ")}</span> : null}
    </div>
    {setCandidate && <div className="flex gap-1" aria-label="Set sign-off"><Badge variant={toneVariant(approvals.male ? "ok" : undefined)}>{approvals.male && <Check size={10} />}Male</Badge><Badge variant={toneVariant(approvals.female ? "ok" : undefined)}>{approvals.female && <Check size={10} />}Female</Badge></div>}
    <div className="mt-auto flex flex-wrap items-center gap-1.5">
      {canApprove && <>{setCandidate && <NativeSelect className="h-6 text-[11px]" aria-label={`Sign off body for ${candidate.candidateId}`} value={approvalChoice} onChange={event => onApprovalBody(event.target.value as CandidateBody)}><option value="male">Male</option><option value="female">Female</option></NativeSelect>}<Button variant="default" size="sm" onClick={onApprove} disabled={isActionBusy}><ShieldCheck size={12} />{isActionBusy ? "Saving…" : setCandidate ? "Sign off" : "Approve"}</Button></>}
      {candidate.status === "approved" && candidate.kind === "glb" && <Button variant="secondary" size="sm" onClick={onPromote} disabled={isActionBusy}><ArrowRight size={12} />{isActionBusy ? "Promoting…" : "Promote to live"}</Button>}
      {candidate.status !== "live" && candidate.status !== "rejected" && !rejecting && <Button variant="destructive" size="sm" onClick={onStartReject} disabled={isActionBusy}>Reject</Button>}
      {candidate.status === "live" && <Badge variant="ok"><Check size={11} /> Live in manifest</Badge>}
    </div>
    {rejecting && <div className="flex flex-col gap-1.5"><label htmlFor={`${candidate.candidateId}-reason`} className="sr-only">Reason</label><Textarea id={`${candidate.candidateId}-reason`} className="min-h-12 resize-y" rows={2} value={reason} onChange={event => onReason(event.target.value)} placeholder="Reason for rejecting…" /><div className="flex gap-1.5"><Button variant="destructive" size="sm" onClick={onReject} disabled={isActionBusy}>Save rejection</Button><Button variant="ghost" size="sm" onClick={onCancelReject}>Cancel</Button></div></div>}
    {candidate.kind === "glb"
      ? <details className="-mx-2.5 -mb-2.5 border-t border-border-subtle" open={comparisonOpen} onToggle={event => setComparisonOpen(event.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 text-xs text-primary hover:bg-accent [&::-webkit-details-marker]:hidden"><GitCompareArrows size={12} /> Compare{currentAssetId ? " with live asset" : " preview"}</summary>
        {comparisonOpen && <div className={cn("grid grid-cols-1 gap-2 px-2 pb-2 [&_.asset-viewer]:m-0 [&_.asset-viewer]:min-w-0 [&_.asset-viewer]:p-1.5", currentAssetId && "md:grid-cols-2")}>{currentAssetId && <AssetViewer source={{ mode: "asset", assetId: currentAssetId }} label="Live asset" />}<AssetViewer source={{ mode: "glb", url: candidate.fileUrl }} label="Candidate asset" /></div>}
      </details>
      : <a className={cn(buttonVariants({ variant: "link", size: "inline" }), "self-start text-xs")} href={candidate.fileUrl} target="_blank" rel="noreferrer">Open icon candidate</a>}
  </article>;
}

const META = "text-[11px] leading-snug text-muted-foreground";
