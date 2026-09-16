import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Images, LoaderCircle, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import type { MetaPatch, MetaRecord, MetaResponse } from "../../shared/metaContracts.js";
import type { CollectionResponse } from "../../shared/contracts.js";
import { collectionQuery } from "../api/client.js";
import { contentRows, rowName } from "../model/rows.js";
import { Thumb } from "../ui/Thumb.js";
import AssetCandidates from "./AssetCandidates.js";
import { metaPath, metaQueryKey } from "./NotesPanel.js";
import { Button, Badge, Textarea, ChoiceGroup } from "../components/ui/index.js";
import { toneVariant } from "../components/ui/badge.js";
import { cn } from "../lib/utils.js";
import { EMPTY } from "../ui/layout.js";
import { LoadError, Notice, PANEL_HEAD, Skeleton, SPIN } from "./panelParts.js";

/** Hooks kept on the panel, rows, links and save buttons: tools/devdocs-piece-smoke.ts selects them. */
const ROOT = "set-piece-panel flex min-w-0 flex-col gap-2.5 text-foreground";
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-1.5";

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
type Tone = "accent" | "ok" | "warn" | "danger" | "info" | undefined;

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

function statusTone(status: string): Tone {
  return status === "candidate" ? "info" : status === "approved" || status === "live" ? "ok" : status === "rejected" ? "danger" : undefined;
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
  return <SetPiecePanelContent key={`${props.collection}:${props.recordId}`} {...props} />;
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
  const [activeSlot, setActiveSlot] = useState<PieceSlot>();

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
    return <LoadingPanel titleId={titleId} />;
  }

  const queryError = setQuery.error ?? itemsQuery.error ?? metaQuery.error;
  if (queryError) {
    return <section className={ROOT} aria-labelledby={titleId}>
      <PanelHeading titleId={titleId} />
      <LoadError label="Could not load piece review" message={queryError.message} retry={() => { void setQuery.refetch(); void itemsQuery.refetch(); void metaQuery.refetch(); }} />
    </section>;
  }

  if (!setRow) {
    return <section className={ROOT} aria-labelledby={titleId}>
      <PanelHeading titleId={titleId} />
      <Notice>Armor set not found. The saved set could not be matched to this record.</Notice>
    </section>;
  }

  const setName = rowName(setRow, "id");
  const setStatus = metaQuery.data?.data.status ?? "draft";
  const saveDisabled = mutation.isPending || conflict || !metaQuery.data;
  const candidates = metaQuery.data?.data.candidates ?? [];
  const shownSlot = activeSlot && pieces.some(piece => piece.slot === activeSlot) ? activeSlot : pieces[0]?.slot;
  const shownPiece = pieces.find(piece => piece.slot === shownSlot);

  return <section className={ROOT} aria-labelledby={titleId}>
    <PanelHeading titleId={titleId} count={pieces.length} refreshing={metaQuery.isFetching}>
      <Badge variant={toneVariant(statusTone(setStatus))} title="Set status">{displayStatus(setStatus)}</Badge>
    </PanelHeading>

    {feedback && <Notice conflict={conflict} action={conflict && <Button variant="secondary" size="sm" onClick={reloadMetadata}><RefreshCw size={12} />Reload</Button>}>{feedback}</Notice>}

    {pieces.length ? <ol className={GRID} aria-label={`${setName} armor pieces`}>
      {pieces.map(({ slot, itemId }) => {
        const item = itemsById.get(itemId);
        const name = itemLabel(item, itemId);
        const draft = currentDraft(slot);
        const dirty = isDirty(slot);
        const statusId = `${titleId}-${slot}-status`;
        const noteId = `${titleId}-${slot}-note`;
        const candidateCount = candidates.filter(candidate => candidate.slot === slot).length;
        const active = shownSlot === slot;
        return <li className={cn("set-piece-row flex min-w-0 flex-col gap-2 rounded-md border border-border bg-card p-2", active && "border-primary", dirty && "border-warn")} key={slot} data-active={active || undefined} data-dirty={dirty || undefined}>
          <a className="set-piece-item-link group/link grid min-w-0 grid-cols-[auto_minmax(0,1fr)_12px] items-center gap-2 rounded-md text-foreground no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring/40" href={itemPath(itemId)} aria-label={`Open ${name} item detail`} title={`${name} · ${itemId}`}>
            <Thumb spec={{ kind: "item", id: itemId }} size="l" />
            <span className="flex min-w-0 flex-col gap-0.5"><small className="text-[11px] tracking-[.04em] text-faint uppercase">{slotLabel(slot)}</small><strong className="truncate text-xs font-medium group-hover/link:text-primary">{name}</strong></span>
            <ExternalLink size={12} aria-hidden="true" className="text-faint" />
          </a>
          <div className="flex flex-col gap-1.5">
            <ChoiceGroup<AuthoredStatus> id={statusId} aria-label={`${slotLabel(slot)} status`} value={draft.status} onValueChange={next => { if (next) updateDraft(slot, { status: next }); }} disabled={saveDisabled}
              items={[{ value: "draft", label: "Draft" }, { value: "candidate", label: "Candidate" }, { value: "rejected", label: "Rejected" }]} />
            <label className="block" htmlFor={noteId}><span className="sr-only">Note</span><Textarea id={noteId} rows={2} className="min-h-12 resize-y" value={draft.note} onChange={event => updateDraft(slot, { note: event.target.value })} placeholder="Note (optional)" disabled={saveDisabled} /></label>
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-1.5">
            <Button variant="chip" size="xs" aria-pressed={active} onClick={() => setActiveSlot(slot)} title="Show asset candidates for this piece"><Images size={11} />{candidateCount}</Button>
            <Badge variant={dirty ? "warn" : "default"} aria-live="polite">{dirty ? "Unsaved" : "Saved"}</Badge>
            <Button variant="default" size="sm" className="set-piece-save basis-full" onClick={() => savePiece(slot)} disabled={saveDisabled || !dirty}><Save size={12} />{mutation.isPending ? "Saving…" : "Save"}</Button>
          </div>
        </li>;
      })}
    </ol> : <p className={EMPTY}>No armor members are saved on this set.</p>}

    {shownPiece && <div className="min-w-0">
      <AssetCandidates key={shownPiece.slot} collection={collection} entityId={recordId} slot={shownPiece.slot} targetLabel={`${setName} / ${slotLabel(shownPiece.slot)} / ${itemLabel(itemsById.get(shownPiece.itemId), shownPiece.itemId)}`} compact />
    </div>}
  </section>;
}

function PanelHeading({ titleId, count, refreshing = false, loading = false, children }: { titleId: string; count?: number; refreshing?: boolean; loading?: boolean; children?: React.ReactNode }) {
  return <header className={PANEL_HEAD}>
    <h2 id={titleId}>Pieces</h2>
    {count !== undefined && <span className="font-mono text-[11px] text-muted-foreground">{count}</span>}
    {(refreshing || loading) && <LoaderCircle className={cn(SPIN, "text-muted-foreground")} size={13} aria-label={loading ? "Loading piece review" : "Refreshing metadata"} />}
    <div className="ml-auto flex items-center gap-1.5">{children}</div>
  </header>;
}

function LoadingPanel({ titleId }: { titleId: string }) {
  return <section className={ROOT} aria-labelledby={titleId} aria-busy="true"><PanelHeading titleId={titleId} loading /><div className={GRID} role="status" aria-label="Loading armor pieces">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-44 rounded-md" />)}</div></section>;
}
