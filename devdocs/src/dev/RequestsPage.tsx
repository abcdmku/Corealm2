import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { apiGet } from "../api/client.js";
import type { MetaRequest, MetaNote } from "../../shared/metaContracts.js";
import { findRecord, refKindForCollection, summaryContext, useReferenceIndex } from "../model/refs.js";
import { RefChip } from "../ui/RefChip.js";
import { labelFor } from "../ui/library.js";
import { Badge, NativeSelect, SearchInput } from "../components/ui/index.js";
import { toneVariant } from "../components/ui/badge.js";
import { cn } from "../lib/utils.js";
import { COUNT, EMPTY, TOOLBAR } from "../ui/layout.js";
import { LoadingRows } from "../ui/States.js";
import { LoadError, SPIN } from "./panelParts.js";

export interface RequestsPageProps {
  navigate: (collection?: string, recordId?: string) => void;
}

/** JSON shape returned by the read-only /__devdocs/requests handler. */
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
      <NativeSelect value={kind} onChange={event => setKind(event.target.value as RequestKind | "all")} aria-label="Filter by request kind"><option value="all">All kinds</option>{REQUEST_KINDS.map(value => <option key={value} value={value}>{displayKind(value)}</option>)}</NativeSelect>
      <NativeSelect value={state} onChange={event => setState(event.target.value as StateFilter)} aria-label="Filter by request state"><option value="all">All states</option><option value="open">Open</option><option value="claimed">Claimed</option><option value="replied">Replied</option></NativeSelect>
      <div className={cn(COUNT, "flex items-center gap-1")}>
        <span aria-live="polite">{filtered.length === requests.length ? `${requests.length} ${requests.length === 1 ? "request" : "requests"}` : `${filtered.length} of ${requests.length}`}</span>
        {query.isFetching && <LoaderCircle size={13} className={cn(SPIN, "text-muted-foreground")} aria-label="Refreshing requests" />}
      </div>
    </div>

    {!filtered.length
      ? <p className={EMPTY}>{requests.length ? "No requests match these filters." : "No open requests."}</p>
      : <ol className="flex flex-col gap-0.5">{filtered.map((entry, position) => <RequestRow key={`${entry.collection}:${entry.entityId}:${entry.request.id}:${position}`} entry={entry} navigate={navigate} ctx={ctx} lookup={(collection, id) => { const refKind = refKindForCollection(collection); return (refKind ? ctx.lookup(refKind, id) : undefined) ?? findRecord(index, collection, id); }} resolving={indexLoading} />)}</ol>}
  </section>;
}

/*
  A request row is ListRow's box (ui/ListRow.tsx): the same padding, radius and hover. It is not a
  ListRow button because the record chip inside it is a button of its own.
*/
function RequestRow({ entry, navigate, ctx, lookup, resolving }: { entry: RequestEntry; navigate: RequestsPageProps["navigate"]; ctx: ReturnType<typeof summaryContext>; lookup: (collection: string, id: string) => ReturnType<typeof findRecord>; resolving: boolean }) {
  const { note, request } = entry;
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
    </div>
    <div className="flex max-w-60 shrink-0 flex-wrap items-center justify-end gap-1 pt-1 max-[820px]:max-w-none max-[820px]:basis-full max-[820px]:justify-start">
      <Badge variant="accent">{displayKind(request.kind)}</Badge>
      <Badge variant={toneVariant(stateTone(request.state))}>{displayState(request.state)}</Badge>
      <code className="max-w-30 truncate font-mono text-[11px] text-faint" title={request.id}>{request.id}</code>
    </div>
  </li>;
}
