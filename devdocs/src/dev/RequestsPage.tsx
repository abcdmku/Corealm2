import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { apiGet } from "../api/client.js";
import type { MetaRequest, MetaNote } from "../../shared/metaContracts.js";
import "./requests.css";

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

function displayKind(kind: MetaRequest["kind"]): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function displayState(state: MetaRequest["state"]): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function displayCollection(collection: string): string {
  return collection
    .replace(/^balance\//, "Balance / ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, value => value.toUpperCase());
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

  const requests = query.data?.requests ?? [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return requests.filter(entry => {
      if (kind !== "all" && entry.request.kind !== kind) return false;
      if (state !== "all" && entry.request.state !== state) return false;
      return !needle || searchText(entry).includes(needle);
    });
  }, [kind, requests, search, state]);

  if (query.isPending) return <LoadingRequestsPage/>;
  if (query.isError) return <section className="requests-page" aria-labelledby="requests-title"><RequestsHeading count={undefined}/><div className="requests-error" role="alert"><CircleAlert size={19}/><div><strong>Could not load requests</strong><p>{query.error.message}</p><button className="requests-button requests-button-secondary" type="button" onClick={() => void query.refetch()}><RefreshCw size={14}/>Try again</button></div></div></section>;

  return <section className="requests-page" aria-labelledby="requests-title">
    <RequestsHeading count={filtered.length} refreshing={query.isFetching}/>
    <div className="requests-toolbar" role="group" aria-label="Request filters">
      <label className="requests-search"><Search size={15}/><span className="sr-only">Search requests</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search requests" aria-label="Search requests"/><kbd>/</kbd></label>
      <label className="requests-filter"><span>Kind</span><select value={kind} onChange={event => setKind(event.target.value as RequestKind | "all")} aria-label="Filter by request kind"><option value="all">All kinds</option>{REQUEST_KINDS.map(value => <option key={value} value={value}>{displayKind(value)}</option>)}</select></label>
      <label className="requests-filter"><span>State</span><select value={state} onChange={event => setState(event.target.value as StateFilter)} aria-label="Filter by request state"><option value="all">All states</option><option value="open">Open</option><option value="claimed">Claimed</option><option value="replied">Replied</option></select></label>
      <span className="requests-filter-count" aria-live="polite">{filtered.length === requests.length ? `${requests.length} ${requests.length === 1 ? "request" : "requests"}` : `${filtered.length} of ${requests.length}`}</span>
    </div>

    {!filtered.length ? <div className="requests-empty"><Search size={22}/><strong>{requests.length ? "No matching requests" : "No open requests"}</strong><p>{requests.length ? "Try a different search or filter." : "Open a request from a record to see it here."}</p></div> : <ol className="requests-list">{filtered.map((entry, index) => <RequestRow key={`${entry.collection}:${entry.entityId}:${entry.request.id}:${index}`} entry={entry} navigate={navigate}/>)}</ol>}
  </section>;
}

function RequestsHeading({ count, refreshing = false }: { count: number | undefined; refreshing?: boolean }) {
  return <header className="requests-header"><div><p className="requests-eyebrow">Review queue</p><h1 id="requests-title">Requests</h1><p className="requests-subtitle">Open work from the Corealm records.</p></div>{count !== undefined ? <div className="requests-heading-count"><strong>{count}</strong><span>{count === 1 ? "visible request" : "visible requests"}</span>{refreshing && <LoaderCircle size={14} className="requests-spin" aria-label="Refreshing requests"/>}</div> : <LoaderCircle size={17} className="requests-spin" aria-label="Loading requests"/>}</header>;
}

function RequestRow({ entry, navigate }: { entry: RequestEntry; navigate: RequestsPageProps["navigate"] }) {
  const { note, request } = entry;
  return <li className="request-row">
    <header className="request-row-header">
      <div className="request-row-source"><button type="button" className="request-record-link" onClick={() => navigate(entry.collection, entry.entityId)}><span>{displayCollection(entry.collection)}</span><code>{entry.entityId}</code></button><span className={`request-kind request-kind-${request.kind}`}>{displayKind(request.kind)}</span></div>
      <span className={`request-state request-state-${request.state}`}>{displayState(request.state)}</span>
    </header>
    <div className="request-row-content"><p className="request-row-text">{note.text}</p>{note.label && <span className="request-label">{note.label}</span>}</div>
    <div className="request-row-meta">
      <div className="request-meta-item"><span>Opened</span><time dateTime={note.at} title={note.at}>{timestampLabel(note.at)}</time><small>by {note.by}</small></div>
      <div className="request-meta-item"><span>Claim</span>{request.claimedBy ? <p>Claimed by <strong>{request.claimedBy}</strong>{request.claimedAt && <time dateTime={request.claimedAt}> on {timestampLabel(request.claimedAt)}</time>}</p> : <p className="request-meta-muted">Unclaimed</p>}</div>
      <div className="request-meta-item request-reply-item"><span>Reply</span>{request.reply !== undefined ? <p className="request-reply">{request.reply || "No reply text"}{request.repliedAt && <time dateTime={request.repliedAt}>{timestampLabel(request.repliedAt)}</time>}</p> : <p className="request-meta-muted">Waiting for a reply</p>}</div>
    </div>
    <footer className="request-row-footer"><code>{request.id}</code><span>{displayState(request.state)} request</span></footer>
  </li>;
}

function LoadingRequestsPage() {
  return <section className="requests-page" aria-labelledby="requests-title"><RequestsHeading count={undefined}/><div className="requests-toolbar requests-toolbar-loading" aria-hidden="true"><span/><span/><span/></div><div className="requests-loading" role="status" aria-label="Loading requests">{Array.from({ length: 4 }, (_, index) => <div className="requests-loading-row" key={index}><span/><span/><span/></div>)}</div></section>;
}
