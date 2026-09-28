import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Hand, LoaderCircle, Reply, Send, X } from "lucide-react";
import { apiGet } from "../api/client.js";
import { can } from "../api/backend.js";
import type { MetaPatch, MetaRequest, MetaNote, MetaResponse } from "../../shared/metaContracts.js";
import { isMetaConflict, writeMeta } from "../model/meta.js";
import { findRecord, refKindForCollection, summaryContext, useReferenceIndex } from "../model/refs.js";
import { RefChip } from "../ui/RefChip.js";
import { labelFor } from "../ui/library.js";
import { Badge, Button, SearchInput, ChoiceGroup, Textarea } from "../components/ui/index.js";
import { toneVariant } from "../components/ui/badge.js";
import { cn } from "../lib/utils.js";
import { COUNT, EMPTY, TOOLBAR } from "../ui/layout.js";
import { LoadingRows } from "../ui/States.js";
import { LoadError, SPIN } from "./panelParts.js";

export interface RequestsPageProps {
  navigate: (collection?: string, recordId?: string) => void;
}

/** The open request queue across collections, from `backend().get("requests")` in either mode. */
interface RequestsResponse {
  revisions: Record<string, string>;
  requests: RequestEntry[];
}

interface RequestEntry {
  collection: string;
  entityId: string;
  note: Omit<MetaNote, "request">;
  request: MetaRequest;
}

const REQUEST_KINDS = ["art", "balance", "placement", "audio", "text"] as const;
type RequestKind = (typeof REQUEST_KINDS)[number];
type StateFilter = "all" | MetaRequest["state"];
type Tone = "accent" | "ok" | "warn" | "danger" | "info" | undefined;
type RequestOperation = Extract<MetaPatch["operation"], { kind: "request.claim" | "request.reply" | "request.close" }>;
/** What a row's controls ask for. The page names the collection's revision and saves through `backend().patchMeta`. */
type RequestAction = (entry: RequestEntry, operation: RequestOperation) => Promise<unknown>;

const DONE: Record<RequestOperation["kind"], string> = { "request.claim": "Request claimed", "request.reply": "Reply sent", "request.close": "Request closed" };

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

function searchText(entry: RequestEntry): string {
  return [
    entry.collection,
    entry.entityId,
    entry.note.label,
    entry.note.text,
    entry.note.by,
    entry.request.id,
    entry.request.kind,
    entry.request.state,
    entry.request.claimedBy,
    entry.request.reply,
  ].filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
}

export default function RequestsPage({ navigate }: RequestsPageProps) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<RequestKind | "all">("all");
  const [state, setState] = useState<StateFilter>("all");
  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      const input = document.querySelector<HTMLInputElement>(".requests-search input");
      if (!input) return;
      event.preventDefault();
      event.stopPropagation();
      input.focus();
    }
    document.addEventListener("keydown", focusSearch, true);
    return () => document.removeEventListener("keydown", focusSearch, true);
  }, []);
  const query = useQuery<RequestsResponse, Error>({
    queryKey: ["requests"],
    queryFn: () => apiGet<RequestsResponse>("requests"),
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });
  const queryClient = useQueryClient();
  // Claim, reply and close are metadata writes: the checkout in repo mode, the server's store on a live server.
  const editable = can("meta");
  const mutation = useMutation<MetaResponse, Error, { entry: RequestEntry; operation: RequestOperation }>({
    mutationFn: async ({ entry, operation }) => {
      const revision = query.data?.revisions[entry.collection];
      if (!revision) throw new Error(`No metadata revision for ${entry.collection}. Reload the requests.`);
      return writeMeta(entry.collection, entry.entityId, { revision, operation });
    },
    onSuccess: (_response, { operation }) => { toast.success(DONE[operation.kind]); },
    onError: error => { toast.error(isMetaConflict(error) ? "Requests changed elsewhere. They are reloaded; try again." : error.message || "Could not update the request."); },
    // Either way the queue and the record's notes are re-read: a success moved the revision, a conflict means ours is old.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["requests"] });
      void queryClient.invalidateQueries({ queryKey: ["meta"] });
    },
  });
  const act: RequestAction | undefined = editable ? (entry, operation) => mutation.mutateAsync({ entry, operation }) : undefined;
  const { index, loading: indexLoading } = useReferenceIndex();
  const ctx = useMemo(() => summaryContext(index), [index]);

  const requests = query.data?.requests ?? [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return requests.filter(entry => {
      if (kind !== "all" && entry.request.kind !== kind) return false;
      if (state !== "all" && entry.request.state !== state) return false;
      return !needle || searchText(entry).includes(needle);
    });
  }, [kind, requests, search, state]);

  if (query.isPending) return <section className="min-w-0" aria-label="Requests"><LoadingRows /></section>;
  if (query.isError) return <section className="min-w-0" aria-label="Requests"><LoadError className="py-3" label="Could not load requests" message={query.error.message} retry={() => void query.refetch()} /></section>;

  return <section className="min-w-0" aria-label="Requests">
    <div className={cn(TOOLBAR, "mb-1.5 gap-1.5")} role="group" aria-label="Request filters">
      <SearchInput className="requests-search" label="Search requests" placeholder="Search requests…" value={search} onChange={setSearch} shortcut
        onEnter={() => { const first = filtered[0]; if (first) navigate(first.collection, first.entityId); }} />
      <ChoiceGroup<RequestKind | "all"> aria-label="Filter by request kind" value={kind} onValueChange={next => setKind(next ?? "all")} items={[{ value: "all", label: "All kinds" }, ...REQUEST_KINDS.map(value => ({ value, label: displayKind(value) }))]} />
      <ChoiceGroup<StateFilter> aria-label="Filter by request state" value={state} onValueChange={next => setState(next ?? "all")} items={[{ value: "all", label: "All states" }, { value: "open", label: "Open" }, { value: "claimed", label: "Claimed" }, { value: "replied", label: "Replied" }]} />
      <div className={cn(COUNT, "flex items-center gap-1")}>
        <span aria-live="polite">{filtered.length === requests.length ? `${requests.length} ${requests.length === 1 ? "request" : "requests"}` : `${filtered.length} of ${requests.length}`}</span>
        {query.isFetching && <LoaderCircle size={13} className={cn(SPIN, "text-muted-foreground")} aria-label="Refreshing requests" />}
      </div>
    </div>

    {!filtered.length
      ? <p className={EMPTY}>{requests.length ? "No requests match these filters." : "No open requests."}</p>
      : <ol className="flex flex-col gap-0.5">{filtered.map((entry, position) => <RequestRow key={`${entry.collection}:${entry.entityId}:${entry.request.id}:${position}`} entry={entry} navigate={navigate} ctx={ctx} lookup={(collection, id) => { const refKind = refKindForCollection(collection); return (refKind ? ctx.lookup(refKind, id) : undefined) ?? findRecord(index, collection, id); }} resolving={indexLoading} act={act} busy={mutation.isPending} />)}</ol>}
  </section>;
}

/*
  A request row is ListRow's box (ui/ListRow.tsx): the same padding, radius and hover. It is not a
  ListRow button because the record chip inside it is a button of its own.
*/
function RequestRow({ entry, navigate, ctx, lookup, resolving, act, busy }: { entry: RequestEntry; navigate: RequestsPageProps["navigate"]; ctx: ReturnType<typeof summaryContext>; lookup: (collection: string, id: string) => ReturnType<typeof findRecord>; resolving: boolean; act: RequestAction | undefined; busy: boolean }) {
  const { note, request } = entry;
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");
  const sendReply = () => {
    const text = replyText.trim();
    if (!text || !act) return;
    void act(entry, { kind: "request.reply", requestId: request.id, text }).then(() => { setReplying(false); setReplyText(""); }, () => undefined);
  };
  const record = lookup(entry.collection, entry.entityId);
  return <li className="flex w-full min-w-0 items-start gap-2 rounded-md border border-transparent px-1.5 py-[3px] hover:border-border hover:bg-secondary max-[820px]:flex-wrap">
    <div className="max-w-70 min-w-0 shrink-0 max-[820px]:max-w-full [&_.ref-chip]:max-w-full">
      <RefChip collection={entry.collection} record={record} id={entry.entityId} ctx={ctx} onOpen={(collection, id) => navigate(collection, id)} missing={!record && !resolving} detail={labelFor(entry.collection)} />
    </div>
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-[3px]">
      <span className="text-xs leading-snug whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]" title={note.text}>{note.text}</span>
      <span className="flex flex-wrap gap-x-1 text-[11px] leading-normal text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground [&_time]:font-mono [&_time]:text-faint">
        <span>Opened <time dateTime={note.at} title={note.at}>{timestampLabel(note.at)}</time> by {note.by}</span>
        {note.label && <span>· {note.label}</span>}
        <span>· {request.claimedBy ? <>Claimed by <strong>{request.claimedBy}</strong>{request.claimedAt && <time dateTime={request.claimedAt}> {timestampLabel(request.claimedAt)}</time>}</> : "Unclaimed"}</span>
        <span>· {request.reply !== undefined ? <>Reply: {request.reply || "no text"}{request.repliedAt && <time dateTime={request.repliedAt}> {timestampLabel(request.repliedAt)}</time>}</> : "No reply yet"}</span>
      </span>
      {act && replying && <form className="mt-1 flex flex-col gap-1" onSubmit={event => { event.preventDefault(); sendReply(); }}>
        <label className="block"><span className="sr-only">Reply to request {request.id}</span>
          <Textarea className="min-h-12 resize-y" rows={2} autoFocus value={replyText} onChange={event => setReplyText(event.target.value)} placeholder="What was done, or what is needed…" disabled={busy}
            onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); sendReply(); } else if (event.key === "Escape") setReplying(false); }} />
        </label>
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="xs" type="button" onClick={() => setReplying(false)} disabled={busy}>Cancel</Button>
          <Button variant="default" size="xs" type="submit" disabled={busy || !replyText.trim()}><Send size={12} />Send reply</Button>
        </div>
      </form>}
    </div>
    <div className="flex max-w-60 shrink-0 flex-wrap items-center justify-end gap-1 pt-1 max-[820px]:max-w-none max-[820px]:basis-full max-[820px]:justify-start">
      <Badge variant="accent">{displayKind(request.kind)}</Badge>
      <Badge variant={toneVariant(stateTone(request.state))}>{displayState(request.state)}</Badge>
      <code className="max-w-30 truncate font-mono text-[11px] text-faint" title={request.id}>{request.id}</code>
      {act && <span className="flex basis-full justify-end gap-0.5 max-[820px]:justify-start" role="group" aria-label={`Actions for request ${request.id}`}>
        {request.state === "open" && <Button variant="ghost" size="xs" disabled={busy} onClick={() => void act(entry, { kind: "request.claim", requestId: request.id }).catch(() => undefined)}><Hand size={12} />Claim</Button>}
        {!replying && <Button variant="ghost" size="xs" disabled={busy} onClick={() => setReplying(true)}><Reply size={12} />Reply</Button>}
        <Button variant="ghost" size="xs" disabled={busy} onClick={() => void act(entry, { kind: "request.close", requestId: request.id }).catch(() => undefined)}><X size={12} />Close</Button>
      </span>}
    </div>
  </li>;
}
