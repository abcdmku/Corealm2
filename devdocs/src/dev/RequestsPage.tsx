import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, LoaderCircle, RefreshCw, Search, X } from "lucide-react";
import { apiGet } from "../api/client.js";
import type { MetaRequest, MetaNote } from "../../shared/metaContracts.js";
import { findRecord, refKindForCollection, summaryContext, useReferenceIndex } from "../model/refs.js";
import { RefChip } from "../ui/RefChip.js";
import { labelFor } from "../ui/library.js";
import "./requests.css";
import { Button, Badge, NativeSelect, InputGroup, InputGroupAddon, InputGroupInput } from "../components/ui/index.js";
import { toneVariant } from "../components/ui/badge.js";

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

  if (query.isPending) return <LoadingRequestsPage />;
  if (query.isError) return <section className="requests-page" aria-label="Requests"><div className="requests-error" role="alert"><CircleAlert size={16} /><div><strong>Could not load requests</strong><p>{query.error.message}</p><Button variant="secondary" size="sm" onClick={() => void query.refetch()}><RefreshCw size={13} />Try again</Button></div></div></section>;

  return <section className="requests-page" aria-label="Requests">
    <div className="browser-toolbar" role="group" aria-label="Request filters">
      <InputGroup className="w-60 requests-search"><InputGroupAddon align="start"><Search /></InputGroupAddon><InputGroupInput value={search} onChange={event => setSearch(event.target.value)} placeholder="Search requests…" aria-label="Search requests" />{search ? <Button variant="ghost" size="icon-sm" aria-label="Clear search" onClick={() => setSearch("")}><X size={13} /></Button> : <kbd>/</kbd>}</InputGroup>
      <NativeSelect value={kind} onChange={event => setKind(event.target.value as RequestKind | "all")} aria-label="Filter by request kind"><option value="all">All kinds</option>{REQUEST_KINDS.map(value => <option key={value} value={value}>{displayKind(value)}</option>)}</NativeSelect>
      <NativeSelect value={state} onChange={event => setState(event.target.value as StateFilter)} aria-label="Filter by request state"><option value="all">All states</option><option value="open">Open</option><option value="claimed">Claimed</option><option value="replied">Replied</option></NativeSelect>
      <div className="toolbar-right">
        <span className="result-count" aria-live="polite">{filtered.length === requests.length ? `${requests.length} ${requests.length === 1 ? "request" : "requests"}` : `${filtered.length} of ${requests.length}`}</span>
        {query.isFetching && <LoaderCircle size={13} className="requests-spin" aria-label="Refreshing requests" />}
      </div>
    </div>

    {!filtered.length
      ? <p className="empty-inline">{requests.length ? "No requests match these filters." : "No open requests."}</p>
      : <ol className="ref-rows requests-list">{filtered.map((entry, position) => <RequestRow key={`${entry.collection}:${entry.entityId}:${entry.request.id}:${position}`} entry={entry} navigate={navigate} ctx={ctx} lookup={(collection, id) => { const refKind = refKindForCollection(collection); return (refKind ? ctx.lookup(refKind, id) : undefined) ?? findRecord(index, collection, id); }} resolving={indexLoading} />)}</ol>}
  </section>;
}

function RequestRow({ entry, navigate, ctx, lookup, resolving }: { entry: RequestEntry; navigate: RequestsPageProps["navigate"]; ctx: ReturnType<typeof summaryContext>; lookup: (collection: string, id: string) => ReturnType<typeof findRecord>; resolving: boolean }) {
  const { note, request } = entry;
  const record = lookup(entry.collection, entry.entityId);
  return <li className="ref-row request-row">
    <div className="request-row-target">
      <RefChip collection={entry.collection} record={record} id={entry.entityId} ctx={ctx} onOpen={(collection, id) => navigate(collection, id)} missing={!record && !resolving} detail={labelFor(entry.collection)} />
    </div>
    <div className="ref-row-body request-row-body">
      <span className="request-row-text" title={note.text}>{note.text}</span>
      <span className="ref-row-sub request-row-lines">
        <span>Opened <time dateTime={note.at} title={note.at}>{timestampLabel(note.at)}</time> by {note.by}</span>
        {note.label && <span>· {note.label}</span>}
        <span>· {request.claimedBy ? <>Claimed by <strong>{request.claimedBy}</strong>{request.claimedAt && <time dateTime={request.claimedAt}> {timestampLabel(request.claimedAt)}</time>}</> : "Unclaimed"}</span>
        <span>· {request.reply !== undefined ? <>Reply: {request.reply || "no text"}{request.repliedAt && <time dateTime={request.repliedAt}> {timestampLabel(request.repliedAt)}</time>}</> : "No reply yet"}</span>
      </span>
    </div>
    <div className="ref-row-meta request-row-meta">
      <Badge variant="accent">{displayKind(request.kind)}</Badge>
      <Badge variant={toneVariant(stateTone(request.state))}>{displayState(request.state)}</Badge>
      <code className="request-row-id" title={request.id}>{request.id}</code>
    </div>
  </li>;
}

function LoadingRequestsPage() {
  return <section className="requests-page" aria-label="Requests"><div className="requests-loading" role="status" aria-label="Loading requests">{Array.from({ length: 4 }, (_, index) => <div className="skeleton-row" key={index}><span className="skeleton skeleton-icon" /><span className="skeleton skeleton-name" /><span className="skeleton skeleton-value" /></div>)}</div></section>;
}
