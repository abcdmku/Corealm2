import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, LoaderCircle, MessageSquare, RefreshCw, Send, X } from "lucide-react";
import type { MetaNote, MetaPatch, MetaRecord, MetaRequest, MetaResponse } from "../../shared/metaContracts.js";
import { Button, Badge, NativeSelect, Checkbox, Segmented, Input, Textarea, Kbd } from "../components/ui/index.js";
import { toneVariant } from "../components/ui/badge.js";
import { cn } from "../lib/utils.js";
import { EMPTY, PANEL } from "../ui/layout.js";
import { FormError, LoadError, Notice, PANEL_HEAD, Skeleton, SPIN } from "./panelParts.js";

export interface NotesPanelProps {
  collection: string;
  entityId: string;
}

const REQUEST_KINDS = ["art", "balance", "placement", "audio", "text"] as const;
const AUTHORED_STATUSES = ["draft", "candidate", "rejected"] as const;
type RequestKind = (typeof REQUEST_KINDS)[number];
type AuthoredStatus = (typeof AUTHORED_STATUSES)[number];
type MetaOperation = MetaPatch["operation"];
type MetaQueryKey = readonly ["meta", string, string];
type Tone = "accent" | "ok" | "warn" | "danger" | "info" | undefined;

export const metaQueryKey = (collection: string, entityId: string): MetaQueryKey => ["meta", collection, entityId];

export function metaPath(collection: string, entityId: string): string {
  return `/__devdocs/meta/${encodeURIComponent(collection)}/${encodeURIComponent(entityId)}`;
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

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => ({}));
  return isObject(value) ? value : {};
}

async function getMeta(path: string): Promise<MetaResponse> {
  const response = await fetch(path);
  const body = await responseBody(response);
  if (!response.ok) throw new MetaApiError(typeof body.error === "string" ? body.error : `Request failed (${response.status})`, response.status, typeof body.revision === "string" ? body.revision : undefined);
  return body as unknown as MetaResponse;
}

async function patchMeta(path: string, patch: MetaPatch): Promise<MetaResponse> {
  const response = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await responseBody(response);
  if (!response.ok) throw new MetaApiError(typeof body.error === "string" ? body.error : `Request failed (${response.status})`, response.status, typeof body.revision === "string" ? body.revision : undefined);
  return body as unknown as MetaResponse;
}

function nowIso(): string {
  return new Date().toISOString();
}

function optimisticResponse(current: MetaResponse, operation: MetaOperation): MetaResponse {
  const at = nowIso();
  const data: MetaRecord = {
    ...current.data,
    notes: [...current.data.notes],
    history: [...current.data.history],
  };
  if (operation.kind === "note") {
    const note: MetaNote = {
      at,
      by: "You",
      text: operation.text,
      ...(operation.label === undefined ? {} : { label: operation.label }),
    };
    data.notes.push(note);
  } else if (operation.kind === "request.open") {
    const request: MetaRequest = { id: operation.requestId, kind: operation.requestKind, state: "open" };
    data.notes.push({
      at,
      by: "You",
      text: operation.text,
      ...(operation.label === undefined ? {} : { label: operation.label }),
      request,
    });
  } else if (operation.kind === "status") {
    data.status = operation.status;
  } else if (operation.kind === "request.close") {
    data.notes = data.notes.map(note => note.request?.id === operation.requestId
      ? { ...note, request: { ...note.request, state: "closed", closedAt: at } }
      : note);
  }
  return { ...current, data };
}

function displayStatus(status: MetaRecord["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusTone(status: MetaRecord["status"]): Tone {
  return status === "candidate" ? "info" : status === "approved" || status === "live" ? "ok" : status === "rejected" ? "danger" : undefined;
}

function displayKind(kind: MetaRequest["kind"]): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function displayState(state: MetaRequest["state"]): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function stateTone(state: MetaRequest["state"]): Tone {
  return state === "open" ? "warn" : state === "claimed" ? "info" : state === "replied" ? "ok" : undefined;
}

function timestampLabel(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(timestamp);
}

function chronologicalNotes(notes: readonly MetaNote[]): MetaNote[] {
  return notes.map((note, index) => ({ note, index })).sort((left, right) => {
    const a = Date.parse(left.note.at);
    const b = Date.parse(right.note.at);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return a - b;
    if (Number.isFinite(a) !== Number.isFinite(b)) return Number.isFinite(a) ? -1 : 1;
    return left.index - right.index;
  }).map(entry => entry.note);
}

interface SaveContext {
  previous?: MetaResponse;
}

export default function NotesPanel({ collection, entityId }: NotesPanelProps) {
  const queryClient = useQueryClient();
  const key = useMemo(() => metaQueryKey(collection, entityId), [collection, entityId]);
  const path = useMemo(() => metaPath(collection, entityId), [collection, entityId]);
  const [noteText, setNoteText] = useState("");
  const [noteLabel, setNoteLabel] = useState("");
  const [flagAsRequest, setFlagAsRequest] = useState(false);
  const [requestKind, setRequestKind] = useState<RequestKind>("text");
  const [formError, setFormError] = useState<string | undefined>();
  const [feedback, setFeedback] = useState<string | undefined>();
  const [conflict, setConflict] = useState(false);

  const query = useQuery<MetaResponse, Error>({
    queryKey: key,
    queryFn: () => getMeta(path),
    enabled: Boolean(collection && entityId),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    setFormError(undefined);
    setFeedback(undefined);
    setConflict(false);
    setNoteText("");
    setNoteLabel("");
    setFlagAsRequest(false);
    setRequestKind("text");
  }, [collection, entityId]);

  const mutation = useMutation<MetaResponse, Error, { revision: string; operation: MetaOperation }, SaveContext>({
    mutationFn: ({ revision, operation }) => patchMeta(path, { revision, operation }),
    onMutate: async ({ operation }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<MetaResponse>(key);
      if (previous) queryClient.setQueryData(key, optimisticResponse(previous, operation));
      setFormError(undefined);
      setFeedback(undefined);
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      if (error instanceof MetaApiError && error.status === 409) {
        setConflict(true);
        setFeedback("This metadata changed elsewhere. Reload it before saving again.");
        toast.error("Metadata changed elsewhere. Reload before saving.");
      } else {
        setFeedback(error.message || "Could not save this change.");
        toast.error(error.message || "Could not save this change.");
      }
    },
    onSuccess: (response, variables) => {
      queryClient.setQueryData(key, response);
      void queryClient.invalidateQueries({ queryKey: ["requests"] });
      setConflict(false);
      setFeedback(undefined);
      if (variables.operation.kind === "note") {
        setNoteText("");
        setNoteLabel("");
        toast.success("Note added");
      } else if (variables.operation.kind === "request.open") {
        setNoteText("");
        setNoteLabel("");
        setFlagAsRequest(false);
        toast.success("Request opened");
      } else if (variables.operation.kind === "request.close") {
        toast.success("Request closed");
      } else {
        toast.success("Authored status updated");
      }
    },
  });

  const data = query.data;
  const notes = useMemo(() => chronologicalNotes(data?.data.notes ?? []), [data?.data.notes]);
  const saveDisabled = mutation.isPending || conflict || !data;

  function submitNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = noteText.trim();
    if (!text) {
      setFormError("Write a note before saving.");
      return;
    }
    if (!data) return;
    const label = noteLabel.trim();
    if (flagAsRequest) {
      const requestId = globalThis.crypto?.randomUUID?.() ?? `request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      mutation.mutate({
        revision: data.revision,
        operation: { kind: "request.open", requestId, requestKind, text, ...(label ? { label } : {}) },
      });
      return;
    }
    mutation.mutate({ revision: data.revision, operation: { kind: "note", text, ...(label ? { label } : {}) } });
  }

  function updateStatus(status: AuthoredStatus) {
    if (!data || status === data.data.status) return;
    mutation.mutate({ revision: data.revision, operation: { kind: "status", status } });
  }

  function closeRequest(requestId: string) {
    if (!data) return;
    mutation.mutate({ revision: data.revision, operation: { kind: "request.close", requestId } });
  }

  function reloadMetadata() {
    setFeedback(undefined);
    void query.refetch().then(result => {
      if (result.error) {
        setFeedback(result.error.message || "Could not reload metadata.");
        return;
      }
      setConflict(false);
      toast.success("Metadata reloaded");
    });
  }

  if (query.isPending) {
    return <section className={ROOT} aria-labelledby="notes-panel-title"><NotesPanelHeading loading /><div className="grid gap-2 py-1" role="status" aria-label="Loading notes"><Skeleton /><Skeleton className="w-[84%]" /><Skeleton className="w-[66%]" /></div></section>;
  }

  if (query.isError) {
    return <section className={ROOT} aria-labelledby="notes-panel-title"><NotesPanelHeading /><LoadError label="Could not load notes" message={query.error.message} retry={() => void query.refetch()} /></section>;
  }

  if (!data) return null;
  const currentStatus = data.data.status;
  const editableStatus = AUTHORED_STATUSES.includes(currentStatus as AuthoredStatus);

  return <section className={ROOT} aria-labelledby="notes-panel-title">
    <NotesPanelHeading count={notes.length} refreshing={query.isFetching}>
      {editableStatus
        ? <Segmented aria-label="Authored status">{AUTHORED_STATUSES.map(status => <Button variant="segment" size="xs" key={status} aria-pressed={currentStatus === status} disabled={saveDisabled} onClick={() => updateStatus(status)}>{displayStatus(status)}</Button>)}</Segmented>
        : <Badge variant={toneVariant(statusTone(currentStatus))} title="This status is managed by review">{displayStatus(currentStatus)}</Badge>}
    </NotesPanelHeading>

    {feedback && <Notice conflict={conflict} action={conflict && <Button variant="secondary" size="sm" onClick={reloadMetadata}><RefreshCw size={12} />Reload</Button>}>{feedback}</Notice>}

    <form className={cn(PANEL, "flex flex-col gap-2 p-2")} onSubmit={submitNote}>
      <label className="block">
        <span className="sr-only">{flagAsRequest ? "Request" : "Note"}</span>
        <Textarea className="min-h-16 resize-y" value={noteText} onChange={event => { setNoteText(event.target.value); setFormError(undefined); }} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={flagAsRequest ? "Describe the change to make…" : "Add a note for the next reviewer…"} rows={3} required aria-describedby="notes-note-help" disabled={saveDisabled} />
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="flex w-44 max-[520px]:w-full"><span className="sr-only">Label</span><Input value={noteLabel} onChange={event => setNoteLabel(event.target.value)} placeholder="Label (optional)" disabled={saveDisabled} /></label>
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs"><Checkbox checked={flagAsRequest} onCheckedChange={checked => setFlagAsRequest(checked === true)} disabled={saveDisabled} /><span>Flag as request</span></label>
        {flagAsRequest && <NativeSelect aria-label="Request kind" value={requestKind} onChange={event => setRequestKind(event.target.value as RequestKind)} disabled={saveDisabled}>{REQUEST_KINDS.map(kind => <option key={kind} value={kind}>{displayKind(kind)}</option>)}</NativeSelect>}
        <small id="notes-note-help" className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-faint"><Kbd>Ctrl</Kbd><Kbd>↵</Kbd></small>
        <Button variant="default" size="sm" type="submit" disabled={saveDisabled}><Send size={13} />{mutation.isPending ? "Saving" : flagAsRequest ? "Open request" : "Add note"}</Button>
      </div>
      {formError && <FormError id="notes-form-error">{formError}</FormError>}
    </form>

    {notes.length ? <ol className="pt-1" aria-label="Notes chronology">{notes.map((note, index) => <li className="group/note grid grid-cols-[14px_minmax(0,1fr)] gap-2.5 py-2" key={`${note.at}-${note.request?.id ?? "note"}-${index}`}>
      <div className="relative flex justify-center" aria-hidden="true">
        <span className="h-[calc(100%+16px)] w-px bg-border group-last/note:h-3" />
        <span className="absolute top-[5px] size-[7px] rounded-full border border-primary bg-background" />
      </div>
      <article className="flex min-w-0 flex-col gap-1">
        <header className="flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
          {note.request ? <Badge variant="accent">Request · {displayKind(note.request.kind)}</Badge> : <Badge>{note.label || "Note"}</Badge>}
          {note.request && note.label && <Badge>{note.label}</Badge>}
          <time className="font-mono" dateTime={note.at} title={note.at}>{timestampLabel(note.at)}</time>
          <span>{note.by}</span>
        </header>
        <p className="text-xs leading-normal whitespace-pre-wrap [overflow-wrap:anywhere]">{note.text}</p>
        {note.request && <RequestDetails request={note.request} onClose={closeRequest} disabled={saveDisabled} />}
      </article>
    </li>)}</ol> : <p className={cn(EMPTY, "inline-flex items-center gap-1.5")}><MessageSquare size={13} /> No notes yet.</p>}
  </section>;
}

const ROOT = "flex min-w-0 max-w-[820px] flex-col gap-2.5 text-foreground";
const TIME = "font-mono text-[11px] text-faint";

function RequestDetails({ request, onClose, disabled }: { request: MetaRequest; onClose: (requestId: string) => void; disabled: boolean }) {
  const canClose = request.state === "open" || request.state === "claimed" || request.state === "replied";
  return <div className="mt-0.5 flex flex-col gap-1 rounded-r-md border-l-2 border-primary bg-card px-2 py-1.5 text-xs leading-normal text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant={toneVariant(stateTone(request.state))}>{displayState(request.state)}</Badge>
      <code className="max-w-56 min-w-0 truncate font-mono text-[11px] text-faint" title={request.id}>{request.id}</code>
      {request.state === "closed" && <Check size={13} aria-label="Closed" className="text-ok" />}
      {canClose && <Button variant="ghost" size="sm" className="ml-auto max-[520px]:ml-0" onClick={() => onClose(request.id)} disabled={disabled}><X size={12} />Close request</Button>}
    </div>
    {request.claimedBy && <p><strong>Claimed by</strong> {request.claimedBy}{request.claimedAt && <time className={TIME} dateTime={request.claimedAt}> {timestampLabel(request.claimedAt)}</time>}</p>}
    {request.reply !== undefined && <div className="flex flex-col gap-0.5 border-t border-border-subtle pt-1"><strong>Reply</strong><p className="whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">{request.reply || "No reply text"}</p>{request.repliedAt && <time className={TIME} dateTime={request.repliedAt}>{timestampLabel(request.repliedAt)}</time>}</div>}
    {request.closedAt && <p className="text-faint">Closed {timestampLabel(request.closedAt)}</p>}
  </div>;
}

function NotesPanelHeading({ count, refreshing = false, loading = false, children }: { count?: number; refreshing?: boolean; loading?: boolean; children?: React.ReactNode }) {
  return <header className={PANEL_HEAD}>
    <h2 id="notes-panel-title">Notes</h2>
    {count !== undefined && <span className="font-mono text-[11px] text-muted-foreground">{count}</span>}
    {(refreshing || loading) && <LoaderCircle size={13} className={cn(SPIN, "text-muted-foreground")} aria-label={loading ? "Loading notes" : "Refreshing metadata"} />}
    <div className="ml-auto flex items-center gap-1.5">{children}</div>
  </header>;
}
