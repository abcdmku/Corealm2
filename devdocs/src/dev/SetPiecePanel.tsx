import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, ExternalLink, LoaderCircle, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import type { MetaPatch, MetaRecord, MetaResponse } from "../../shared/metaContracts.js";
import type { CollectionResponse } from "../../shared/contracts.js";
import { collectionQuery } from "../api/client.js";
import { contentRows, rowName } from "../model/rows.js";
import { ItemIcon } from "../ui/ItemIcon.js";
import { metaPath, metaQueryKey } from "./NotesPanel.js";
import "./setPiece.css";

export interface SetPiecePanelProps {
  collection: string;
  recordId: string;
}

const PIECE_SLOTS = ["head", "body", "legs", "hands", "feet"] as const;
const AUTHORED_STATUSES = ["draft", "candidate", "rejected"] as const;
type PieceSlot = (typeof PIECE_SLOTS)[number];
type AuthoredStatus = (typeof AUTHORED_STATUSES)[number];
type PieceOperation = Extract<MetaPatch["operation"], { kind: "piece" }>;
type ContentRow = Record<string, unknown>;
type MetaPiece = NonNullable<MetaRecord["pieces"]>[string];

interface PieceDraft {
  note: string;
  status: AuthoredStatus;
}

interface SaveVariables {
  revision: string;
  operation: PieceOperation;
}

interface SaveContext {
  previous?: MetaResponse;
}

class MetaApiError extends Error {
  readonly status: number;
  readonly revision?: string;

  constructor(message: string, status: number, revision?: string) {
    super(message);
    this.name = "MetaApiError";
    this.status = status;
    this.revision = revision;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function responseRows(response: CollectionResponse | undefined): ContentRow[] {
  if (!response) return [];
  if (response.collection.shape === "array" && !Array.isArray(response.data)) return [];
  if (response.collection.shape === "object" && !isObject(response.data)) return [];
  return contentRows(response);
}

function findRow(response: CollectionResponse | undefined, id: string): ContentRow | undefined {
  if (!response || response.collection.shape !== "array") return undefined;
  return responseRows(response).find(row => String(row[response.collection.idKey]) === id);
}

function authoredStatus(value: unknown): AuthoredStatus | undefined {
  return AUTHORED_STATUSES.includes(value as AuthoredStatus) ? value as AuthoredStatus : undefined;
}

function displayStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusClass(status: string): string {
  return status.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function slotLabel(slot: PieceSlot): string {
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

function itemLabel(row: ContentRow | undefined, id: string): string {
  return text(row?.name) ?? text(row?.title) ?? id;
}

function pieceMeta(response: MetaResponse | undefined, slot: PieceSlot): MetaPiece | undefined {
  return response?.data.pieces?.[slot];
}

function draftFromMeta(value: MetaPiece | undefined): PieceDraft {
  return {
    note: value?.note ?? "",
    status: authoredStatus(value?.status) ?? "draft",
  };
}

function itemPath(id: string): string {
  return `#/items/${encodeURIComponent(id)}`;
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => ({}));
  return isObject(value) ? value : {};
}

async function getMeta(path: string): Promise<MetaResponse> {
  const response = await fetch(path);
  const body = await responseBody(response);
  if (!response.ok) {
    throw new MetaApiError(
      typeof body.error === "string" ? body.error : `Request failed (${response.status})`,
      response.status,
      typeof body.revision === "string" ? body.revision : undefined,
    );
  }
  return body as unknown as MetaResponse;
}

async function patchMeta(path: string, patch: MetaPatch): Promise<MetaResponse> {
  const response = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await responseBody(response);
  if (!response.ok) {
    throw new MetaApiError(
      typeof body.error === "string" ? body.error : `Request failed (${response.status})`,
      response.status,
      typeof body.revision === "string" ? body.revision : undefined,
    );
  }
  return body as unknown as MetaResponse;
}

function optimisticResponse(current: MetaResponse, operation: PieceOperation): MetaResponse {
  const currentPieces = current.data.pieces ?? {};
  const currentPiece = currentPieces[operation.slot] ?? {};
  return {
    ...current,
    data: {
      ...current.data,
      notes: [...current.data.notes],
      history: [...current.data.history],
      pieces: {
        ...currentPieces,
        [operation.slot]: {
          ...currentPiece,
          ...(operation.note === undefined ? {} : { note: operation.note }),
          ...(operation.status === undefined ? {} : { status: operation.status }),
        },
      },
    },
  };
}

/** Per-piece review is available only on equipment-set records. */
export default function SetPiecePanel(props: SetPiecePanelProps) {
  if (props.collection !== "equipmentSets") return null;
  return <SetPiecePanelContent key={`${props.collection}:${props.recordId}`} {...props}/>;
}

function SetPiecePanelContent({ collection, recordId }: SetPiecePanelProps) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const setQuery = useQuery(collectionQuery("equipmentSets"));
  const itemsQuery = useQuery(collectionQuery("items"));
  const metaKey = useMemo(() => metaQueryKey(collection, recordId), [collection, recordId]);
  const path = useMemo(() => metaPath(collection, recordId), [collection, recordId]);
  const metaQuery = useQuery<MetaResponse, Error>({
    queryKey: metaKey,
    queryFn: () => getMeta(path),
    enabled: Boolean(recordId),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
  const [drafts, setDrafts] = useState<Partial<Record<PieceSlot, PieceDraft>>>({});
  const [feedback, setFeedback] = useState<string>();
  const [conflict, setConflict] = useState(false);

  const setRow = useMemo(() => findRow(setQuery.data, recordId), [setQuery.data, recordId]);
  const itemRows = useMemo(() => responseRows(itemsQuery.data), [itemsQuery.data]);
  const itemsById = useMemo(() => new Map(itemRows.flatMap(row => {
    const id = text(row.id);
    return id ? [[id, row] as const] : [];
  })), [itemRows]);
  const pieces = useMemo(() => {
    const members = isObject(setRow?.members) ? setRow.members : undefined;
    if (!members) return [] as Array<{ slot: PieceSlot; itemId: string }>;
    return PIECE_SLOTS.flatMap(slot => {
      const itemId = text(members[slot]);
      return itemId ? [{ slot, itemId }] : [];
    });
  }, [setRow]);

  const mutation = useMutation<MetaResponse, Error, SaveVariables, SaveContext>({
    mutationFn: ({ revision, operation }) => patchMeta(path, { revision, operation }),
    onMutate: async ({ operation }) => {
      await queryClient.cancelQueries({ queryKey: metaKey });
      const previous = queryClient.getQueryData<MetaResponse>(metaKey);
      if (previous) queryClient.setQueryData(metaKey, optimisticResponse(previous, operation));
      setFeedback(undefined);
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(metaKey, context.previous);
      if (error instanceof MetaApiError && error.status === 409) {
        setConflict(true);
        setFeedback("This metadata changed elsewhere. Reload it before saving again.");
        toast.error("Metadata changed elsewhere. Reload before saving.");
        return;
      }
      setFeedback(error.message || "Could not save this piece review.");
      toast.error(error.message || "Could not save this piece review.");
    },
    onSuccess: (response, variables) => {
      queryClient.setQueryData(metaKey, response);
      void queryClient.invalidateQueries({ queryKey: ["meta"] });
      setDrafts(previous => {
        if (!(variables.operation.slot in previous)) return previous;
        const next = { ...previous };
        delete next[variables.operation.slot];
        return next;
      });
      setConflict(false);
      setFeedback(undefined);
      toast.success(`${slotLabel(variables.operation.slot)} review saved`);
    },
  });

  function currentDraft(slot: PieceSlot): PieceDraft {
    return drafts[slot] ?? draftFromMeta(pieceMeta(metaQuery.data, slot));
  }

  function updateDraft(slot: PieceSlot, update: Partial<PieceDraft>) {
    setDrafts(previous => ({
      ...previous,
      [slot]: { ...currentDraft(slot), ...update },
    }));
  }

  function isDirty(slot: PieceSlot): boolean {
    const current = currentDraft(slot);
    const saved = draftFromMeta(pieceMeta(metaQuery.data, slot));
    return current.note.trim() !== saved.note || current.status !== saved.status;
  }

  function savePiece(slot: PieceSlot) {
    const current = currentDraft(slot);
    const saved = pieceMeta(metaQuery.data, slot);
    const savedNote = saved?.note ?? "";
    const savedStatus = authoredStatus(saved?.status) ?? "draft";
    const operation: PieceOperation = { kind: "piece", slot };
    const note = current.note.trim();
    if (note !== savedNote) operation.note = note;
    if (current.status !== savedStatus) operation.status = current.status;
    if (!metaQuery.data || (operation.note === undefined && operation.status === undefined)) return;
    mutation.mutate({ revision: metaQuery.data.revision, operation });
  }

  function reloadMetadata() {
    setFeedback(undefined);
    void metaQuery.refetch().then(result => {
      if (result.error) {
        setFeedback(result.error.message || "Could not reload metadata.");
        return;
      }
      setConflict(false);
      toast.success("Metadata reloaded");
    });
  }

  if (setQuery.isPending || itemsQuery.isPending || metaQuery.isPending) {
    return <LoadingPanel titleId={titleId}/>;
  }

  const queryError = setQuery.error ?? itemsQuery.error ?? metaQuery.error;
  if (queryError) {
    return <section className="set-piece-panel" aria-labelledby={titleId}>
      <PanelHeading titleId={titleId} setName={recordId}/>
      <div className="set-piece-error" role="alert">
        <CircleAlert size={17}/>
        <div>
          <strong>Could not load piece review</strong>
          <p>{queryError.message}</p>
          <button className="button set-piece-button" type="button" onClick={() => { void setQuery.refetch(); void itemsQuery.refetch(); void metaQuery.refetch(); }}><RefreshCw size={14}/>Try again</button>
        </div>
      </div>
    </section>;
  }

  if (!setRow) {
    return <section className="set-piece-panel" aria-labelledby={titleId}>
      <PanelHeading titleId={titleId} setName={recordId}/>
      <div className="set-piece-error" role="alert">
        <CircleAlert size={17}/>
        <div><strong>Armor set not found</strong><p>The saved set could not be matched to this record.</p></div>
      </div>
    </section>;
  }

  const setName = rowName(setRow, "id");
  const setStatus = metaQuery.data?.data.status ?? "draft";
  const saveDisabled = mutation.isPending || conflict || !metaQuery.data;

  return <section className="set-piece-panel" aria-labelledby={titleId}>
    <header className="set-piece-header">
      <div>
        <p className="set-piece-eyebrow"><ShieldCheck size={14}/> Set review</p>
        <h2 id={titleId}>Armor pieces</h2>
        <p className="set-piece-subtitle">Review the saved members of {setName} one piece at a time.</p>
      </div>
      <div className="set-piece-status-summary">
        <span>Set status</span>
        <strong className={`set-piece-status set-piece-status-${statusClass(setStatus)}`}>{displayStatus(setStatus)}</strong>
      </div>
    </header>

    {feedback && <div className={`set-piece-feedback${conflict ? " set-piece-feedback-conflict" : ""}`} role="alert"><CircleAlert size={15}/><span>{feedback}</span>{conflict && <button className="button set-piece-button set-piece-reload" type="button" onClick={reloadMetadata}><RefreshCw size={13}/>Reload metadata</button>}</div>}

    <div className="set-piece-section-heading">
      <div><h3>Member review</h3><p>{pieces.length} {pieces.length === 1 ? "piece" : "pieces"} linked to this set. Notes are saved with the set metadata.</p></div>
      {metaQuery.isFetching && <LoaderCircle className="set-piece-spin" size={15} aria-label="Refreshing metadata"/>}
    </div>

    {pieces.length ? <ol className="set-piece-list" aria-label={`${setName} armor pieces`}>
      {pieces.map(({ slot, itemId }) => {
        const item = itemsById.get(itemId);
        const name = itemLabel(item, itemId);
        const draft = currentDraft(slot);
        const dirty = isDirty(slot);
        const statusId = `${titleId}-${slot}-status`;
        const noteId = `${titleId}-${slot}-note`;
        return <li className={`set-piece-row${dirty ? " set-piece-row-dirty" : ""}`} key={slot}>
          <a className="set-piece-item-link" href={itemPath(itemId)} aria-label={`Open ${name} item detail`}>
            <ItemIcon id={itemId} name={name}/>
            <span className="set-piece-item-copy"><span className="set-piece-slot">{slotLabel(slot)}</span><strong>{name}</strong><code>{itemId}</code></span>
            <ExternalLink size={14} aria-hidden="true"/>
          </a>
          <div className="set-piece-fields">
            <label className="set-piece-field" htmlFor={statusId}><span>Status</span><select id={statusId} value={draft.status} onChange={event => updateDraft(slot, { status: event.target.value as AuthoredStatus })} disabled={saveDisabled}><option value="draft">Draft</option><option value="candidate">Candidate</option><option value="rejected">Rejected</option></select></label>
            <label className="set-piece-field set-piece-note-field" htmlFor={noteId}><span>Note <em>Optional</em></span><textarea id={noteId} rows={2} value={draft.note} onChange={event => updateDraft(slot, { note: event.target.value })} placeholder="Add a piece-specific note" disabled={saveDisabled}/></label>
            <div className="set-piece-actions"><span className={`set-piece-dirty${dirty ? " is-dirty" : ""}`} aria-live="polite">{dirty ? "Unsaved changes" : "Saved"}</span><button className="button set-piece-button set-piece-save" type="button" onClick={() => savePiece(slot)} disabled={saveDisabled || !dirty}><Save size={13}/>{mutation.isPending ? "Saving..." : "Save piece"}</button></div>
          </div>
        </li>;
      })}
    </ol> : <div className="set-piece-empty"><strong>No armor members are saved</strong><p>This set does not have any linked pieces to review.</p></div>}
  </section>;
}

function PanelHeading({ titleId, setName }: { titleId: string; setName: string }) {
  return <header className="set-piece-header"><div><p className="set-piece-eyebrow"><ShieldCheck size={14}/> Set review</p><h2 id={titleId}>Armor pieces</h2><p className="set-piece-subtitle">Loading the saved members of {setName}.</p></div><LoaderCircle className="set-piece-spin" size={17} aria-label="Loading piece review"/></header>;
}

function LoadingPanel({ titleId }: { titleId: string }) {
  return <section className="set-piece-panel" aria-labelledby={titleId} aria-busy="true"><PanelHeading titleId={titleId} setName="this set"/><div className="set-piece-loading" role="status" aria-label="Loading armor pieces"><span/><span/><span/><span/></div></section>;
}
