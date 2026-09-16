import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { LayoutGrid, List, Search, Table2, X } from "lucide-react";
import { CONTENT_COLLECTIONS } from "../../../tools/content/collections.js";
import { apiGet, collectionQuery } from "../api/client.js";
import type { AppProps, ContentRow } from "../model/contracts.js";
import type { CollectionResponse } from "../../shared/contracts.js";
import type { MetaDigestResponse as MetaDigest } from "../../shared/metaContracts.js";
import { contentRows, rowId } from "../model/rows.js";
import { summaryContext, useReferenceIndex } from "../model/refs.js";
import { facetsFor, prefersGrid, summarize, titleCase, type RecordSummary } from "../model/summaries.js";
import { isGeneratedCollection, labelFor } from "../ui/library.js";
import { EmptyState, ErrorState, LoadingRows } from "../ui/States.js";
import { RecordTile } from "../ui/RecordTile.js";
import { RecordGrid, clearSelection, setSelection } from "../ui/grid/index.js";
import { EntityDetail } from "./EntityDetail.js";
import "../dev/bulkActions.css";

const BulkActionsPanel = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/BulkActionsPanel.js"));
const RecordActions = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/RecordActions.js"));
const noRows: ContentRow[] = [];
const PAGE = 240;
const isGeneratedRow = (row: ContentRow): boolean => row.__compiled === true;

interface Entry { id: string; row: ContentRow; summary: RecordSummary; generated: boolean }

type View = "grid" | "list" | "table";

function readView(collection: string): View {
  try { const saved = localStorage.getItem(`corealm-codex-view:${collection}`); if (saved === "grid" || saved === "list" || saved === "table") return saved; } catch { /* optional */ }
  return prefersGrid(collection) ? "grid" : "list";
}

export function CollectionPage({ collection, recordId, navigate }: AppProps & { collection: string }) {
  const query = useQuery(collectionQuery(collection));
  const compiledItemsQuery = useQuery({ ...collectionQuery("compiled-items"), enabled: collection === "items" });
  const authoredRows = useMemo(() => {
    if (!query.data) return noRows;
    const loaded = contentRows(query.data);
    return isGeneratedCollection(collection) ? loaded.map(row => ({ ...row, __compiled: true })) : loaded;
  }, [query.data, collection]);
  const rows = useMemo(() => {
    if (!query.data) return noRows;
    if (collection !== "items" || !compiledItemsQuery.data) return authoredRows;
    // Generated gear sits beside authored items so the catalog reads as the game sees it.
    const known = new Set(authoredRows.map(row => rowId(row, query.data!.collection.idKey)));
    const compiled = contentRows(compiledItemsQuery.data).filter(row => !known.has(rowId(row, compiledItemsQuery.data!.collection.idKey))).map(row => ({ ...row, __compiled: true }));
    return [...authoredRows, ...compiled];
  }, [query.data, collection, compiledItemsQuery.data, authoredRows]);
  const idKey = query.data?.collection.idKey ?? "id";
  if (query.isPending) return <div className="collection-page"><div className="page-heading"><h1>{labelFor(collection)}</h1></div><LoadingRows /></div>;
  if (query.isError) return <ErrorState message={query.error.message} retry={() => void query.refetch()} />;
  if (recordId !== undefined) {
    const record = query.data.collection.shape === "object" && recordId === "$collection"
      ? { ...(query.data.data as ContentRow), id: "$collection", name: labelFor(collection) }
      : rows.find(row => rowId(row, idKey) === recordId);
    return record
      ? <EntityDetail key={`${collection}:${recordId}`} collection={collection} record={record} recordId={recordId} editable={query.data.collection.editable && !isGeneratedRow(record)} collectionShape={query.data.collection.shape} navigate={navigate} />
      : <EmptyState title="Record not found">"{recordId}" is not in {labelFor(collection).toLowerCase()}. <button className="text-button" onClick={() => navigate(collection)}>Back to {labelFor(collection).toLowerCase()}</button></EmptyState>;
  }
  return <Browser key={collection} collection={collection} response={query.data} rows={rows} rawRows={authoredRows} idKey={idKey} editable={query.data.collection.editable && query.data.collection.shape === "array" && !isGeneratedCollection(collection)} navigate={navigate} />;
}

function Browser({ collection, response, rows, rawRows, idKey, editable, navigate }: { collection: string; response: CollectionResponse; rows: ContentRow[]; rawRows: ContentRow[]; idKey: string; editable: boolean; navigate: AppProps["navigate"] }) {
  const { index } = useReferenceIndex();
  const ctx = useMemo(() => summaryContext(index), [index]);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>(() => readView(collection));
  const schema = useMemo(() => CONTENT_COLLECTIONS.find(candidate => candidate.name === collection)?.schema, [collection]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const lastToggled = useRef<string | undefined>(undefined);
  const facets = useMemo(() => facetsFor(collection), [collection]);
  const meta = useQuery({ queryKey: ["meta-digest", collection], queryFn: () => apiGet<MetaDigest>(`meta/${collection.split("/").map(encodeURIComponent).join("/")}/$all`), enabled: !__DEVDOCS_PLAYER__ && !isGeneratedCollection(collection), staleTime: 15_000, refetchOnWindowFocus: false, retry: false });
  const entries = useMemo<Entry[]>(() => rows.map(row => {
    const id = rowId(row, idKey);
    const summary = summarize(collection, row, ctx);
    const digest = meta.data?.records[id];
    if (digest) {
      const badges = [...summary.badges];
      if (digest.status !== "draft") badges.unshift({ text: titleCase(digest.status), tone: digest.status === "live" || digest.status === "approved" ? "ok" : digest.status === "rejected" ? "danger" : "warn" });
      if (digest.openRequests) badges.unshift({ text: `${digest.openRequests} open`, tone: "warn", title: "Open requests" });
      return { id, row, summary: { ...summary, badges }, generated: isGeneratedRow(row) };
    }
    return { id, row, summary, generated: isGeneratedRow(row) };
  }), [rows, idKey, collection, ctx, meta.data]);
  const hasTier = useMemo(() => entries.some(entry => entry.summary.tier !== undefined), [entries]);
  const [group, setGroup] = useState<string>(() => hasTier && rows.length > 40 ? "tier" : "");
  useEffect(() => { if (!hasTier && group === "tier") setGroup(""); }, [hasTier, group]);
  useEffect(() => { try { localStorage.setItem(`corealm-codex-view:${collection}`, view); } catch { /* optional */ } }, [collection, view]);

  const facetValues = useMemo(() => facets.map(facet => {
    const counts = new Map<string, number>();
    for (const entry of entries) { const value = facet.value(entry.row, ctx); if (value) counts.set(value, (counts.get(value) ?? 0) + 1); }
    return { facet, values: [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })) };
  }).filter(item => item.values.length > 1), [facets, entries, ctx]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter(entry => {
      for (const [key, value] of Object.entries(filters)) {
        if (!value) continue;
        const facet = facets.find(candidate => candidate.key === key);
        if (facet && facet.value(entry.row, ctx) !== value) return false;
      }
      if (!needle) return true;
      const haystack = `${entry.summary.title} ${entry.id} ${entry.summary.subtitle ?? ""} ${entry.summary.badges.map(badge => badge.text).join(" ")}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [entries, filters, facets, ctx, search]);

  const sorted = useMemo(() => {
    const groupFacet = facets.find(facet => facet.key === group);
    const keyOf = (entry: Entry) => group === "tier" ? (entry.summary.tier !== undefined ? `Tier ${entry.summary.tier}` : "No tier") : groupFacet ? (groupFacet.value(entry.row, ctx) ?? "Unset") : "";
    return [...filtered].map(entry => ({ entry, key: keyOf(entry) })).sort((a, b) => {
      if (group === "tier") { const diff = (a.entry.summary.tier ?? Infinity) - (b.entry.summary.tier ?? Infinity); if (diff) return diff; }
      else if (group && a.key !== b.key) return a.key.localeCompare(b.key, undefined, { numeric: true });
      return a.entry.summary.title.localeCompare(b.entry.summary.title, undefined, { numeric: true });
    });
  }, [filtered, group, facets, ctx]);

  useEffect(() => { setLimit(PAGE); }, [search, filters, group, view]);
  useEffect(() => {
    const known = new Set(rawRows.map(row => rowId(row, idKey)));
    setSelected(previous => { const next = new Set([...previous].filter(id => known.has(id))); return next.size === previous.size ? previous : next; });
  }, [rawRows, idKey]);
  // The palette and the single-letter hotkeys act on this page's selection.
  useEffect(() => { setSelection(collection, selected); }, [collection, selected]);
  useEffect(() => () => clearSelection(collection), [collection]);

  const visibleIds = useMemo(() => sorted.flatMap(item => item.entry.generated ? [] : [item.entry.id]), [sorted]);
  const selectedRows = useMemo(() => rawRows.filter(row => selected.has(rowId(row, idKey))), [rawRows, selected, idKey]);
  function toggle(id: string, shiftKey: boolean) {
    setSelected(previous => {
      const next = new Set(previous);
      if (shiftKey && lastToggled.current) {
        const from = visibleIds.indexOf(lastToggled.current), to = visibleIds.indexOf(id);
        if (from >= 0 && to >= 0) { for (const candidate of visibleIds.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(candidate); lastToggled.current = id; return next; }
      }
      if (next.has(id)) next.delete(id); else next.add(id);
      lastToggled.current = id;
      return next;
    });
  }
  const open = (id: string) => navigate(collection, id);
  // Tier is offered from the summaries as well as from the facets; one entry per key.
  const groupOptions = [...(hasTier ? [{ key: "tier", label: "Tier" }] : []), ...facetValues.map(item => ({ key: item.facet.key, label: item.facet.label }))]
    .filter((option, index, all) => all.findIndex(other => other.key === option.key) === index);
  const activeFilters = Object.entries(filters).filter(([, value]) => value);

  return <div className="collection-page">
    <div className="page-heading">
      <h1 className="sr-only">{labelFor(collection)}</h1>
      <span className="count-badge">{filtered.length === rows.length ? `${rows.length} ${labelFor(collection).toLowerCase()}` : `${filtered.length} of ${rows.length} ${labelFor(collection).toLowerCase()}`}</span>
      <div className="page-heading-actions">
        {collection.startsWith("balance/") && !__DEVDOCS_PLAYER__ && <button className="button button-small" onClick={() => navigate(collection, "$collection")}>Open parameters</button>}
        {editable && RecordActions && <Suspense fallback={null}><RecordActions collection={collection} mode="collection" templateRecord={rawRows[0]} knownIds={rawRows.map(row => rowId(row, idKey))} editable={editable} idKey={idKey} navigate={navigate} compact /></Suspense>}
      </div>
    </div>
    <div className="browser-toolbar">
      <label className="search-field"><Search size={14} /><input aria-label={`Search ${labelFor(collection).toLowerCase()}`} placeholder="Search name, id, type…" value={search} onChange={event => setSearch(event.target.value)} />{search ? <button aria-label="Clear search" className="icon-button" onClick={() => setSearch("")}><X size={13} /></button> : <kbd>/</kbd>}</label>
      {groupOptions.length > 0 && <label className="select"><span className="sr-only">Group by</span><select value={group} aria-label="Group by" onChange={event => setGroup(event.target.value)}><option value="">No grouping</option>{groupOptions.map(option => <option value={option.key} key={option.key}>By {option.label.toLowerCase()}</option>)}</select></label>}
      {activeFilters.length > 0 && <button className="text-button" onClick={() => setFilters({})}>Clear filters</button>}
      <div className="toolbar-right">
        {editable && selected.size > 0 && <span className="result-count">{selected.size} selected</span>}
        <div className="segmented" role="group" aria-label="View">
          <button type="button" className={view === "grid" ? "is-active" : ""} aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid size={13} /> Grid</button>
          <button type="button" className={view === "list" ? "is-active" : ""} aria-pressed={view === "list"} onClick={() => setView("list")}><List size={13} /> List</button>
          {schema && <button type="button" className={view === "table" ? "is-active" : ""} aria-pressed={view === "table"} onClick={() => setView("table")}><Table2 size={13} /> Table</button>}
        </div>
      </div>
    </div>
    {facetValues.length > 0 && <div className="facets">{facetValues.map(({ facet, values }) => <div className="facet" key={facet.key}><span>{facet.label}</span>
      {values.length > 7
        ? <label className="select"><span className="sr-only">{facet.label}</span><select value={filters[facet.key] ?? ""} aria-label={`Filter by ${facet.label.toLowerCase()}`} onChange={event => setFilters(previous => ({ ...previous, [facet.key]: event.target.value }))}><option value="">Any ({values.length})</option>{values.map(([value, count]) => <option key={value} value={value}>{titleCase(value)} · {count}</option>)}</select></label>
        : values.map(([value, count]) => <button type="button" key={value} className={`filter-chip${filters[facet.key] === value ? " is-active" : ""}`} aria-pressed={filters[facet.key] === value} onClick={() => setFilters(previous => ({ ...previous, [facet.key]: previous[facet.key] === value ? "" : value }))}>{titleCase(value)}<small>{count}</small></button>)}
    </div>)}</div>}
    {editable && selected.size > 0 && BulkActionsPanel && <Suspense fallback={null}><BulkActionsPanel collection={collection} idKey={idKey} revision={response.revision} rows={selectedRows} selectedIds={[...selected]} onClearSelection={() => setSelected(new Set())} /></Suspense>}
    {!filtered.length ? <EmptyState title={rows.length ? undefined : "This collection is empty"} />
      : view === "table" && schema ? <RecordGrid collection={collection} rows={sorted.map(item => item.entry.row)} schema={schema} idKey={idKey} revision={response.revision} selected={selected} onSelect={setSelected} onOpen={open} readOnly={!editable} isRowReadOnly={isGeneratedRow} />
      : view === "grid" ? <GridView items={sorted} limit={limit} grouped={Boolean(group)} collection={collection} editable={editable} selected={selected} onToggle={toggle} onOpen={open} onMore={() => setLimit(value => value + PAGE)} />
      : <ListView items={sorted} grouped={Boolean(group)} collection={collection} editable={editable} selected={selected} onToggle={toggle} onOpen={open} />}
    {editable && selected.size > 0 && <div className="selection-bar"><strong>{selected.size}</strong><span>selected · Ctrl-click to add, Shift-click for a range</span><span className="spacer" /><button className="button button-small" onClick={() => setSelected(new Set(visibleIds))}>Select all {visibleIds.length}</button><button className="button button-small" onClick={() => setSelected(new Set())}>Clear</button></div>}
  </div>;
}

function GridView({ items, limit, grouped, collection, editable, selected, onToggle, onOpen, onMore }: { items: { entry: Entry; key: string }[]; limit: number; grouped: boolean; collection: string; editable: boolean; selected: Set<string>; onToggle: (id: string, shift: boolean) => void; onOpen: (id: string) => void; onMore: () => void }) {
  const shown = items.slice(0, limit);
  const nodes: React.ReactNode[] = [];
  let lastKey: string | undefined;
  for (const { entry, key } of shown) {
    if (grouped && key !== lastKey) { nodes.push(<div className="group-heading" key={`group:${key}`}>{key}<small>{items.filter(item => item.key === key).length}</small></div>); lastKey = key; }
    nodes.push(<RecordTile key={entry.id} collection={collection} id={entry.id} summary={entry.summary} mode="grid" selectable={editable && !entry.generated} selected={selected.has(entry.id)} onToggle={onToggle} onOpen={onOpen} generated={entry.generated} />);
  }
  return <>
    <div className="tile-grid">{nodes}</div>
    {items.length > limit && <div style={{ display: "flex", justifyContent: "center", padding: 16 }}><button className="button" onClick={onMore}>Show {Math.min(PAGE, items.length - limit)} more of {items.length - limit}</button></div>}
  </>;
}

function ListView({ items, grouped, collection, editable, selected, onToggle, onOpen }: { items: { entry: Entry; key: string }[]; grouped: boolean; collection: string; editable: boolean; selected: Set<string>; onToggle: (id: string, shift: boolean) => void; onOpen: (id: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  type Line = { kind: "group"; label: string; count: number } | { kind: "record"; entry: Entry };
  const lines = useMemo<Line[]>(() => {
    if (!grouped) return items.map(item => ({ kind: "record", entry: item.entry }));
    const out: Line[] = [];
    let last: string | undefined;
    for (const item of items) {
      if (item.key !== last) { out.push({ kind: "group", label: item.key, count: items.filter(other => other.key === item.key).length }); last = item.key; }
      out.push({ kind: "record", entry: item.entry });
    }
    return out;
  }, [items, grouped]);
  const virtualizer = useVirtualizer({ count: lines.length, getScrollElement: () => scrollRef.current, estimateSize: index => lines[index]?.kind === "group" ? 30 : 58, overscan: 8, getItemKey: index => { const line = lines[index]; return line?.kind === "record" ? line.entry.id : `group:${line?.label}`; } });
  return <div className="table-frame"><div className="table-scroll" ref={scrollRef} style={{ padding: 4 }}>
    <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>{virtualizer.getVirtualItems().map(item => {
      const line = lines[item.index]!;
      const style = { position: "absolute" as const, top: 0, left: 0, width: "100%", height: item.size, transform: `translateY(${item.start}px)` };
      if (line.kind === "group") return <div key={item.key} className="group-heading" style={{ ...style, margin: 0, padding: "6px 8px 0" }}>{line.label}<small>{line.count}</small></div>;
      const { entry } = line;
      return <div key={item.key} style={{ ...style, padding: "2px 0" }}><RecordTile collection={collection} id={entry.id} summary={entry.summary} mode="row" selectable={editable && !entry.generated} selected={selected.has(entry.id)} onToggle={onToggle} onOpen={onOpen} generated={entry.generated} hoverCard /></div>;
    })}</div>
  </div></div>;
}
