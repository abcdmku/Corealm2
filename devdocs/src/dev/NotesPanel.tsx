import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CircleAlert, LoaderCircle, MessageSquare, RefreshCw, Send, X } from "lucide-react";
import type { MetaNote, MetaPatch, MetaRecord, MetaRequest, MetaResponse } from "../../shared/metaContracts.js";
import "./notes.css";

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

function displayKind(kind: MetaRequest["kind"]): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function displayState(state: MetaRequest["state"]): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
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

function fieldError(id: string, message: string | undefined) {
  return message ? <p className="notes-field-error" id={id} role="alert">{message}</p> : null;
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
    return <section className="notes-panel" aria-labelledby="notes-panel-title"><NotesPanelHeading/><div className="notes-loading" role="status" aria-label="Loading notes"><span/><span/><span/></div></section>;
  }

  if (query.isError) {
    return <section className="notes-panel" aria-labelledby="notes-panel-title"><NotesPanelHeading/><div className="notes-error" role="alert"><CircleAlert size={17}/><div><strong>Could not load notes</strong><p>{query.error.message}</p><button className="notes-button notes-button-secondary" type="button" onClick={() => void query.refetch()}><RefreshCw size={14}/>Try again</button></div></div></section>;
  }

  if (!data) return null;
  const currentStatus = data.data.status;
  const editableStatus = AUTHORED_STATUSES.includes(currentStatus as AuthoredStatus);

  return <section className="notes-panel" aria-labelledby="notes-panel-title">
    <header className="notes-panel-header">
      <div>
        <p className="notes-eyebrow">Developer notes</p>
        <h2 id="notes-panel-title">Notes and requests</h2>
        <p className="notes-panel-subtitle">Keep review context beside this record.</p>
      </div>
      <div className="notes-status-summary">
        <span>Authored status</span>
        <strong className={`notes-status notes-status-${currentStatus}`}>{displayStatus(currentStatus)}</strong>
      </div>
    </header>

    {feedback && <div className={`notes-feedback${conflict ? " notes-feedback-conflict" : ""}`} role="alert"><CircleAlert size={15}/><span>{feedback}</span>{conflict && <button className="notes-button notes-button-secondary" type="button" onClick={reloadMetadata}><RefreshCw size={13}/>Reload metadata</button>}</div>}

    <div className="notes-layout">
      <div className="notes-column notes-history-column">
        <div className="notes-section-heading"><div><h3>Chronology</h3><p>{notes.length ? `${notes.length} ${notes.length === 1 ? "entry" : "entries"}` : "No entries yet"}</p></div>{query.isFetching && <LoaderCircle className="notes-spin" size={15} aria-label="Refreshing metadata"/>}</div>
        {notes.length ? <ol className="notes-list" aria-label="Notes chronology">{notes.map((note, index) => <li className="notes-entry" key={`${note.at}-${note.request?.id ?? "note"}-${index}`}>
          <div className="notes-entry-rail" aria-hidden="true"><span/></div>
          <article>
            <header className="notes-entry-meta"><span className={note.request ? "notes-kind notes-kind-request" : "notes-kind"}>{note.request ? `Request · ${displayKind(note.request.kind)}` : (note.label || "Note")}</span>{note.request && note.label && <span className="notes-entry-label">{note.label}</span>}<time dateTime={note.at} title={note.at}>{timestampLabel(note.at)}</time><span>by {note.by}</span></header>
            <p className="notes-entry-text">{note.text}</p>
            {note.request && <RequestDetails request={note.request} onClose={closeRequest} disabled={saveDisabled}/>}
          </article>
        </li>)}</ol> : <div className="notes-empty"><MessageSquare size={21}/><strong>No notes yet</strong><p>Add a short observation or open a request from the forms.</p></div>}
      </div>

      <div className="notes-column notes-forms-column">
        <div className="notes-section-heading"><div><h3>Authored status</h3><p>Record state only. Candidate approval stays in review.</p></div></div>
        {editableStatus ? <label className="notes-field"><span>Authored status</span><select value={currentStatus as AuthoredStatus} onChange={event => updateStatus(event.target.value as AuthoredStatus)} disabled={saveDisabled}><option value="draft">Draft</option><option value="candidate">Candidate</option><option value="rejected">Rejected</option></select></label> : <div className="notes-status-readonly"><span>Authored status</span><strong>{displayStatus(currentStatus)}</strong><small>This status is managed by review.</small></div>}

        <form className="notes-form" onSubmit={submitNote}>
          <div className="notes-form-heading"><div><h3>{flagAsRequest ? "Open a request" : "Add a note"}</h3><p>{flagAsRequest ? "Ask for a focused change and track its reply here." : "Capture a decision, observation, or follow-up."}</p></div>{flagAsRequest ? <CircleAlert size={16}/> : <MessageSquare size={16}/>}</div>
          <label className="notes-field"><span>{flagAsRequest ? "Request" : "Note"}</span><textarea value={noteText} onChange={event => { setNoteText(event.target.value); setFormError(undefined); }} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={flagAsRequest ? "Describe the change to make" : "What should the next reviewer know?"} rows={4} required aria-describedby="notes-note-help" disabled={saveDisabled}/><small id="notes-note-help">Ctrl or Cmd + Enter to save. A request ID is generated when you flag this note.</small></label>
          <label className="notes-field"><span>Label <em>Optional</em></span><input value={noteLabel} onChange={event => setNoteLabel(event.target.value)} placeholder="For example, balance" disabled={saveDisabled}/></label>
          <label className="notes-request-toggle"><input type="checkbox" checked={flagAsRequest} onChange={event => setFlagAsRequest(event.target.checked)} disabled={saveDisabled}/><span>Flag as request</span></label>
          {flagAsRequest && <label className="notes-field"><span>Request kind</span><select aria-label="Request kind" value={requestKind} onChange={event => setRequestKind(event.target.value as RequestKind)} disabled={saveDisabled}>{REQUEST_KINDS.map(kind => <option key={kind} value={kind}>{displayKind(kind)}</option>)}</select></label>}
          {fieldError("notes-form-error", formError)}
          <button className="notes-button notes-button-primary" type="submit" disabled={saveDisabled}><Send size={14}/>{mutation.isPending ? "Saving" : flagAsRequest ? "Open request" : "Add note"}</button>
        </form>
      </div>
    </div>
  </section>;
}

function RequestDetails({ request, onClose, disabled }: { request: MetaRequest; onClose: (requestId: string) => void; disabled: boolean }) {
  const canClose = request.state === "open" || request.state === "claimed" || request.state === "replied";
  return <div className="notes-request-details">
    <div className="notes-request-state"><span className={`notes-state notes-state-${request.state}`}>{displayState(request.state)}</span><code>{request.id}</code>{canClose && <button className="notes-close-button" type="button" onClick={() => onClose(request.id)} disabled={disabled}><X size={13}/>Close request</button>}{request.state === "closed" && <Check size={14} aria-label="Closed"/>}</div>
    {request.claimedBy && <p><strong>Claimed by</strong> {request.claimedBy}{request.claimedAt && <time dateTime={request.claimedAt}> on {timestampLabel(request.claimedAt)}</time>}</p>}
    {request.reply !== undefined && <div className="notes-request-reply"><strong>Reply</strong><p>{request.reply || "No reply text"}</p>{request.repliedAt && <time dateTime={request.repliedAt}>{timestampLabel(request.repliedAt)}</time>}</div>}
    {request.closedAt && <p className="notes-closed-at">Closed {timestampLabel(request.closedAt)}</p>}
  </div>;
}

function NotesPanelHeading() {
  return <header className="notes-panel-header"><div><p className="notes-eyebrow">Developer notes</p><h2 id="notes-panel-title">Notes and requests</h2><p className="notes-panel-subtitle">Keep review context beside this record.</p></div><span className="notes-loading-mark"><LoaderCircle size={17} className="notes-spin"/></span></header>;
}
