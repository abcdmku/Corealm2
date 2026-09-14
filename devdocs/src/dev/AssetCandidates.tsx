import { useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, CircleAlert, FileUp, GitCompareArrows, LoaderCircle, RefreshCw, ShieldCheck, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";

import type { MetaResponse } from "../../shared/metaContracts.js";
import type { MetaCandidate } from "../../../tools/content/meta.js";
import { AssetViewer } from "../viewer/AssetViewer.js";
import { metaPath, metaQueryKey } from "./NotesPanel.js";
import type { AssetActionResponse, AssetCandidateView, AssetCandidatesResponse } from "../../server/handlers/assets.js";
import "./assetCandidates.css";

const BODY_VALUES = ["male", "female", "creature"] as const;
type CandidateBody = (typeof BODY_VALUES)[number];
type CandidateStatus = MetaCandidate["status"];

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
  const title = target ? targetLabel ?? `Asset candidates for ${collection} / ${entityId}` : "Asset candidate review";

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

  return <section className={`asset-candidates${compact ? " asset-candidates-compact" : ""}`} aria-labelledby={titleId}>
    <header className="asset-candidates-header">
      <div>
        <p className="asset-candidates-eyebrow"><GitCompareArrows size={14}/> Asset workflow</p>
        <h3 id={titleId}>{title}</h3>
        <p className="asset-candidates-subtitle">Upload, compare, review, and promote one inspected candidate at a time.</p>
      </div>
      <div className="asset-candidates-header-actions"><span className="asset-candidates-count">{candidatesQuery.isPending ? "…" : `${candidates.length} ${candidates.length === 1 ? "candidate" : "candidates"}`}</span><button type="button" className="asset-candidates-icon-button" aria-label="Refresh asset candidates" onClick={refresh} disabled={candidatesQuery.isFetching}><RefreshCw size={14} className={candidatesQuery.isFetching ? "asset-candidates-spin" : undefined}/></button></div>
    </header>

    {feedback && <div className="asset-candidates-feedback" role="status"><ShieldCheck size={15}/><span>{feedback}</span><button type="button" aria-label="Dismiss asset feedback" onClick={() => setFeedback(undefined)}><X size={14}/></button></div>}

    {showUpload && target && <form className="asset-upload-form" onSubmit={submitUpload}>
      <div className="asset-upload-copy"><UploadCloud size={18}/><div><strong>Upload a candidate</strong><p>GLB files are inspected and kept under the local candidate archive until review.</p></div></div>
      <label className="asset-upload-file"><FileUp size={15}/><span>{file?.name ?? "Choose a GLB file"}</span><input ref={fileInput} type="file" accept=".glb,model/gltf-binary" onChange={selectFile}/></label>
      <label className="asset-upload-field"><span>Body <em>Optional</em></span><select value={uploadBody} onChange={event => setUploadBody(event.target.value as CandidateBody | "")}><option value="">Any</option>{BODY_VALUES.map(value => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}</select></label>
      <label className="asset-upload-field asset-upload-source"><span>Source <em>Optional</em></span><input value={source} onChange={event => setSource(event.target.value)} placeholder="Pack, URL, or local source"/></label>
      <button type="submit" className="asset-candidates-button asset-upload-submit" disabled={uploadMutation.isPending || !metaQuery.data}><UploadCloud size={14}/>{uploadMutation.isPending ? "Inspecting…" : "Upload candidate"}</button>
      {formError && <p className="asset-candidates-form-error" role="alert"><CircleAlert size={14}/>{formError}</p>}
    </form>}

    {!target && showUpload && <p className="asset-candidates-queue-note">Open a record to upload a new file. The queue below can still compare, approve, reject, and promote existing candidates.</p>}

    {candidatesQuery.isPending ? <div className="asset-candidates-loading" role="status"><LoaderCircle size={17} className="asset-candidates-spin"/><span>Loading candidates…</span></div>
      : candidatesQuery.isError ? <div className="asset-candidates-error" role="alert"><CircleAlert size={17}/><div><strong>Could not load candidates</strong><p>{candidatesQuery.error.message}</p><button type="button" className="asset-candidates-button" onClick={refresh}>Try again</button></div></div>
      : candidates.length ? <div className="asset-candidate-list">{candidates.map(candidate => <CandidateCard key={candidate.candidateId} candidate={candidate} currentAssetId={currentAssetId} approving={actionMutation.isPending && actionMutation.variables?.candidateId === candidate.candidateId} approvalBody={approvalBody[candidate.candidateId]} onApprovalBody={value => setApprovalBody(previous => ({ ...previous, [candidate.candidateId]: value }))} rejecting={rejecting === candidate.candidateId} reason={rejectReason} onReason={setRejectReason} onStartReject={() => { setRejecting(candidate.candidateId); setRejectReason(""); setFeedback(undefined); }} onCancelReject={() => { setRejecting(undefined); setRejectReason(""); }} onApprove={() => approve(candidate)} onReject={() => reject(candidate)} onPromote={() => promote(candidate)}/>)}</div>
      : <div className="asset-candidates-empty"><GitCompareArrows size={19}/><strong>No candidates for this target</strong><p>Upload a GLB to start the review path.</p></div>}
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
    return <article className={`asset-candidate-card asset-candidate-status-${candidate.status}`}>
    <header className="asset-candidate-card-header"><div><div className="asset-candidate-meta"><span className={`asset-candidate-status asset-candidate-status-chip-${candidate.status}`}>{candidate.status === "approved" ? <Check size={12}/> : null}{statusLabel(candidate.status)}</span><code>{candidate.candidateId}</code></div><strong>{targetLabelFor(candidate)}</strong><p>{bytesLabel(candidate.bytes)} · uploaded {timestamp(candidate.uploadedAt)}{candidate.uploadedBy ? ` by ${candidate.uploadedBy}` : ""}</p></div><span className="asset-candidate-hash" title={candidate.sha256}>{candidate.sha256.slice(0, 12)}…</span></header>
    <div className="asset-candidate-details"><dl><div><dt>Slot</dt><dd>{candidate.slot ?? "Any"}</dd></div><div><dt>Body</dt><dd>{candidate.body ?? "Any"}</dd></div><div><dt>Materials</dt><dd>{candidate.materials?.length ?? 0}</dd></div><div><dt>Animations</dt><dd>{candidate.animations?.length ?? 0}</dd></div></dl>{candidate.reasons?.length ? <p className="asset-candidate-reason"><strong>Review reasons</strong>{candidate.reasons.join(" · ")}</p> : null}</div>
    {setCandidate && <div className="asset-candidate-approvals"><span>Set sign-off</span><span className={approvals.male ? "is-approved" : ""}><span className="asset-candidate-dot"/>Male</span><span className={approvals.female ? "is-approved" : ""}><span className="asset-candidate-dot"/>Female</span></div>}
    <div className="asset-candidate-actions">
      {canApprove && <>{setCandidate && <label className="asset-candidate-body-select"><span>Sign off</span><select aria-label={`Sign off body for ${candidate.candidateId}`} value={approvalChoice} onChange={event => onApprovalBody(event.target.value as CandidateBody)}><option value="male">Male</option><option value="female">Female</option></select></label>}<button type="button" className="asset-candidates-button asset-candidate-approve" onClick={onApprove} disabled={isActionBusy}><ShieldCheck size={14}/>{isActionBusy ? "Saving…" : setCandidate ? "Save sign-off" : "Approve"}</button></>}
      {candidate.status === "approved" && candidate.kind === "glb" && <button type="button" className="asset-candidates-button asset-candidate-promote" onClick={onPromote} disabled={isActionBusy}><ArrowRight size={14}/>{isActionBusy ? "Promoting…" : "Promote to live"}</button>}
      {candidate.status !== "live" && candidate.status !== "rejected" && !rejecting && <button type="button" className="asset-candidates-button asset-candidate-reject" onClick={onStartReject} disabled={isActionBusy}>Reject</button>}
      {candidate.status === "live" && <span className="asset-candidate-live"><Check size={13}/> Live in manifest</span>}
    </div>
    {rejecting && <div className="asset-candidate-reject-form"><label htmlFor={`${candidate.candidateId}-reason`}>Reason</label><textarea id={`${candidate.candidateId}-reason`} rows={2} value={reason} onChange={event => onReason(event.target.value)} placeholder="Explain what needs to change"/><div><button type="button" className="asset-candidates-button asset-candidate-reject" onClick={onReject} disabled={isActionBusy}>Save rejection</button><button type="button" className="asset-candidates-button" onClick={onCancelReject}>Cancel</button></div></div>}
    {candidate.kind === "glb"
      ? <details className="asset-candidate-compare" open={comparisonOpen} onToggle={event => setComparisonOpen(event.currentTarget.open)}><summary><GitCompareArrows size={14}/> Compare candidate{currentAssetId ? " with live asset" : " preview"}</summary>{comparisonOpen && <div className={`asset-candidate-viewers${currentAssetId ? " has-live" : ""}`}>{currentAssetId && <AssetViewer source={{ mode: "asset", assetId: currentAssetId }} label="Live asset"/>}<AssetViewer source={{ mode: "glb", url: candidate.fileUrl }} label="Candidate asset"/></div>}</details>
      : <a className="asset-candidate-file-link" href={candidate.fileUrl} target="_blank" rel="noreferrer">Open icon candidate</a>}
  </article>;
}
