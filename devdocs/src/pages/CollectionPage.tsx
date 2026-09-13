import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper, createSortedRowModel, rowSortingFeature, sortFn_alphanumeric, tableFeatures, useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Layers2, Search, X } from "lucide-react";
import { collectionQuery } from "../api/client.js";
import type { AppProps, ContentRow } from "../model/contracts.js";
import { contentRows, rowId, rowName } from "../model/rows.js";
import { descriptions, labelFor } from "../ui/library.js";
import { EmptyState, ErrorState, LoadingRows } from "../ui/States.js";
import { ItemIcon } from "../ui/ItemIcon.js";
import { compactValue, EntityDetail, fieldLabel } from "./EntityDetail.js";

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns: { alphanumeric: sortFn_alphanumeric } });
const helper = createColumnHelper<typeof features, ContentRow>();
const noRows: ContentRow[] = [];

export function CollectionPage({ collection, recordId, navigate }: AppProps & { collection: string }) {
  const query = useQuery(collectionQuery(collection));
  const rows = useMemo(() => query.data ? contentRows(query.data) : noRows, [query.data]);
  const idKey = query.data?.collection.idKey ?? "id";
  if (query.isPending) return <div className="collection-page"><header className="page-heading"><h1>{labelFor(collection)}</h1><p>Loading records…</p></header><LoadingRows/></div>;
  if (query.isError) return <ErrorState message={query.error.message} retry={() => void query.refetch()}/>;
  if (recordId !== undefined) {
    const record = query.data.collection.shape === "object" && recordId === "$collection"
      ? { ...(query.data.data as ContentRow), id: "$collection", name: labelFor(collection) }
      : rows.find(r => rowId(r, idKey) === recordId);
    return record ? <EntityDetail key={`${collection}:${recordId}`} collection={collection} record={record} recordId={recordId} editable={query.data.collection.editable} collectionShape={query.data.collection.shape} navigate={navigate}/> : <EmptyState title="Record not found">The record "{recordId}" is not in {labelFor(collection).toLowerCase()}. <button className="text-button" onClick={() => navigate(collection)}>Return to the collection</button></EmptyState>;
  }
  return <CollectionTable key={collection} collection={collection} rows={rows} idKey={idKey} navigate={navigate}/>;
}

function CollectionTable({ collection, rows, idKey, navigate }: { collection: string; rows: ContentRow[]; idKey: string; navigate: AppProps["navigate"] }) {
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState(collection === "items" ? "tier" : "");
  const [active, setActive] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fields = useMemo(() => {
    const preferred = ["tier", "category", "type", "skill", "level", "requiredLevel", "style", "value", "station", "catalog"];
    const present = preferred.filter(key => rows.some(row => row[key] !== undefined));
    return (present.length ? present.slice(0, 3) : ["value"]).filter(key => key !== idKey);
  }, [rows, idKey]);
  const groupFields = useMemo(() => ["tier", "category", "type", "region", "skill", "style", "catalog"].filter(key => rows.some(row => row[key] !== undefined)), [rows]);
  const filtered = useMemo(() => {
    const needle = search.toLowerCase().trim();
    return needle ? rows.filter(row => Object.values(row).some(value => typeof value !== "object" && String(value).toLowerCase().includes(needle))) : rows;
  }, [rows, search]);
  const columns = useMemo(() => helper.columns([
    helper.accessor(row => rowName(row, idKey), { id: "name", header: "Name", sortFn: "alphanumeric" }),
    ...fields.map(field => helper.accessor(row => row[field], { id: field, header: fieldLabel(field), sortFn: "alphanumeric" })),
  ]), [fields, idKey]);
  const table = useTable({ features, columns, data: filtered, getRowId: row => rowId(row, idKey), initialState: { sorting: [{ id: "name", desc: false }] }, enableSortingRemoval: false });
  const sorted = table.getRowModel().rows;
  type DisplayRow = { kind: "group"; label: string; count: number } | { kind: "record"; record: ContentRow };
  const display: DisplayRow[] = useMemo(() => {
    if (!group) return sorted.map(r => ({ kind: "record", record: r.original }));
    const buckets = new Map<string, ContentRow[]>();
    for (const r of sorted) { const key = compactValue(r.original[group]); const bucket = buckets.get(key) ?? []; bucket.push(r.original); buckets.set(key, bucket); }
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).flatMap(([label, records]): DisplayRow[] => [{ kind: "group", label: `${fieldLabel(group)} ${label}`, count: records.length }, ...records.map(record => ({ kind: "record" as const, record }))]);
  }, [sorted, group]);
  const virtualizer = useVirtualizer({ count: display.length, getScrollElement: () => scrollRef.current, estimateSize: index => display[index]?.kind === "group" ? 37 : 64, overscan: 7, getItemKey: index => { const row = display[index]; return row?.kind === "record" ? rowId(row.record, idKey) : `group:${row?.label}`; } });
  useEffect(() => { setActive(-1); scrollRef.current?.scrollTo({ top: 0 }); }, [search, group]);
  function move(key: string) {
    if (key === "Enter" && active >= 0) { const selected = display[active]; if (selected?.kind === "record") navigate(collection, rowId(selected.record, idKey)); return; }
    const step = key === "ArrowUp" || key === "End" ? -1 : 1;
    let next = key === "Home" ? 0 : key === "End" ? display.length - 1 : active < 0 ? (step > 0 ? 0 : display.length - 1) : active + step;
    while (next >= 0 && next < display.length && display[next]?.kind === "group") next += step;
    if (next >= 0 && next < display.length) { setActive(next); virtualizer.scrollToIndex(next, { align: "auto" }); }
  }
  const gridColumns = `minmax(230px, 1fr) ${fields.map(() => "minmax(90px, 0.35fr)").join(" ")} 28px`;
  return <div className="collection-page"><header className="page-heading"><div className="heading-title"><h1>{labelFor(collection)}</h1><span className="count-badge">{rows.length}</span></div><p>{descriptions[collection] ?? (collection.startsWith("balance/") ? "The parameters used by Corealm's balance formulas." : "Browse records and inspect their details.")}</p>{collection.startsWith("balance/") && !__DEVDOCS_PLAYER__ && <button className="button" onClick={() => navigate(collection, "$collection")}>Open formula and parameters</button>}</header><div className="collection-toolbar"><label className="search-field"><Search size={17}/><input aria-label={`Search ${labelFor(collection).toLowerCase()}`} placeholder="Search names, IDs, types…" value={search} onChange={e => setSearch(e.target.value)}/>{search ? <button aria-label="Clear search" className="icon-button" onClick={() => setSearch("")}><X size={15}/></button> : <kbd>/</kbd>}</label>{groupFields.length > 0 && <label className="group-select"><Layers2 size={16}/><span className="sr-only">Group by</span><select value={group} aria-label="Group by" onChange={e => setGroup(e.target.value)}><option value="">No grouping</option>{groupFields.map(key => <option value={key} key={key}>Group by {fieldLabel(key).toLowerCase()}</option>)}</select></label>}<span className="result-count" aria-live="polite">{filtered.length === rows.length ? `${rows.length} records` : `${filtered.length} of ${rows.length}`}</span></div>{!filtered.length ? <EmptyState title={rows.length ? undefined : "This collection is empty"}/> : <div className="table-frame"><div className="table-scroll" ref={scrollRef} role="grid" aria-label={labelFor(collection)} aria-rowcount={display.length + 1} aria-colcount={fields.length + 1} tabIndex={0} aria-activedescendant={active >= 0 ? `content-row-${active}` : undefined} onKeyDown={event => { if (event.target !== event.currentTarget) return; if (["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(event.key)) { event.preventDefault(); move(event.key); } }}><div className="table-header" role="row" style={{ gridTemplateColumns: gridColumns }}>{table.getHeaderGroups()[0]?.headers.map(header => <div role="columnheader" aria-sort={header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : "none"} key={header.id}><button onClick={header.column.getToggleSortingHandler()}>{String(header.column.columnDef.header)}{header.column.getIsSorted() === "asc" ? <ArrowUp size={13}/> : header.column.getIsSorted() === "desc" ? <ArrowDown size={13}/> : <ArrowUpDown size={12}/>}</button></div>)}<span/></div><div className="virtual-body" style={{ height: virtualizer.getTotalSize() }}>{virtualizer.getVirtualItems().map(item => {
    const row = display[item.index]!;
    if (row.kind === "group") return <div key={item.key} role="row" className="table-group" style={{ height: item.size, transform: `translateY(${item.start}px)` }}><span role="gridcell">{row.label}</span><span className="group-count">{row.count}</span></div>;
    const id = rowId(row.record, idKey);
    return <div id={`content-row-${item.index}`} key={item.key} role="row" aria-rowindex={item.index + 2} aria-selected={active === item.index} className={`table-row${active === item.index ? " is-active" : ""}`} style={{ height: item.size, gridTemplateColumns: gridColumns, transform: `translateY(${item.start}px)` }} onClick={() => navigate(collection, id)}><div role="gridcell" className="name-cell">{collection === "items" && <ItemIcon id={id}/>}<button tabIndex={-1} className="row-name"><strong>{rowName(row.record, idKey)}</strong><code>{id}</code></button></div>{fields.map(field => <div role="gridcell" key={field} className={typeof row.record[field] === "number" ? "numeric-cell" : "text-cell"}>{field === "tier" && row.record[field] !== undefined ? <span className="tier-tag">{String(row.record[field])}</span> : compactValue(row.record[field])}</div>)}<ChevronRight className="row-chevron" size={15}/></div>;
  })}</div></div><footer className="table-footer"><span>{group ? `Grouped by ${fieldLabel(group).toLowerCase()}` : "All records"}</span><span><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>↵</kbd> open</span></footer></div>}</div>;
}
