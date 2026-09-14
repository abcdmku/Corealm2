import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper, createSortedRowModel, rowSortingFeature, sortFn_alphanumeric, tableFeatures, useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Layers2, Search, X } from "lucide-react";
import { collectionQuery } from "../api/client.js";
import type { AppProps, ContentRow } from "../model/contracts.js";
import type { CollectionResponse } from "../../shared/contracts.js";
import { contentRows, displayRows, rowId, rowName } from "../model/rows.js";
import { descriptions, labelFor } from "../ui/library.js";
import { EmptyState, ErrorState, LoadingRows } from "../ui/States.js";
import { ItemIcon } from "../ui/ItemIcon.js";
import { FORMULA_STATUS_LABELS } from "../model/formulaStatus.js";
import type { FormulaStatusesResult } from "../dev/useFormulaStatuses.js";
import { compactValue, EntityDetail, fieldLabel } from "./EntityDetail.js";
import "../dev/bulkActions.css";

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns: { alphanumeric: sortFn_alphanumeric } });
const helper = createColumnHelper<typeof features, ContentRow>();
const noRows: ContentRow[] = [];
const FormulaStatusObserver = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/FormulaStatusObserver.js"));
const BulkActionsPanel = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/BulkActionsPanel.js"));
const RecordActions = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/RecordActions.js"));
const isGeneratedRow = (row: ContentRow): boolean => row.__compiled === true;

export function CollectionPage({ collection, recordId, navigate }: AppProps & { collection: string }) {
  const query = useQuery(collectionQuery(collection));
  const enemyQuery = useQuery({ ...collectionQuery("enemies"), enabled: collection === "creatures" || collection === "enemyAliases" });
  const compiledItemsQuery = useQuery({ ...collectionQuery("compiled-items"), enabled: collection === "items" });
  const authoredRows = useMemo(() => {
    if (!query.data) return noRows;
    const loaded = contentRows(query.data);
    return collection.startsWith("compiled-") ? loaded.map(row => ({ ...row, __compiled: true })) : loaded;
  }, [query.data, collection]);
  const rows = useMemo(() => {
    if (!query.data) return noRows;
    if (collection !== "items" || !compiledItemsQuery.data) {
      const response = collection.startsWith("compiled-") ? { ...query.data, data: authoredRows } as CollectionResponse : query.data;
      return displayRows(response, enemyQuery.data);
    }
    const known = new Set(authoredRows.map(row => rowId(row, query.data!.collection.idKey)));
    const compiledRows = contentRows(compiledItemsQuery.data)
      .filter(row => !known.has(rowId(row, compiledItemsQuery.data!.collection.idKey)))
      .map(row => ({ ...row, __compiled: true }));
    const response = { ...query.data, data: [...authoredRows, ...compiledRows] } as CollectionResponse;
    return displayRows(response, enemyQuery.data);
  }, [query.data, enemyQuery.data, collection, compiledItemsQuery.data, authoredRows]);
  const idKey = query.data?.collection.idKey ?? "id";
  if (query.isPending) return <div className="collection-page"><header className="page-heading"><h1>{labelFor(collection)}</h1><p>Loading records...</p></header><LoadingRows /></div>;
  if (query.isError) return <ErrorState message={query.error.message} retry={() => void query.refetch()} />;
  if (recordId !== undefined) {
    const record = query.data.collection.shape === "object" && recordId === "$collection"
      ? { ...(query.data.data as ContentRow), id: "$collection", name: labelFor(collection) }
      : rows.find(row => rowId(row, idKey) === recordId);
    const generated = record ? isGeneratedRow(record) : false;
    return record
      ? <EntityDetail key={`${collection}:${recordId}`} collection={collection} record={record} displayRecord={rows.find(row => rowId(row, idKey) === recordId)} recordId={recordId} editable={query.data.collection.editable && !generated} collectionShape={query.data.collection.shape} navigate={navigate} />
      : <EmptyState title="Record not found">The record "{recordId}" is not in {labelFor(collection).toLowerCase()}. <button className="text-button" onClick={() => navigate(collection)}>Return to the collection</button></EmptyState>;
  }
  return <CollectionTable key={collection} collection={collection} rows={rows} rawRows={authoredRows} idKey={idKey} revision={query.data.revision} editable={query.data.collection.editable && query.data.collection.shape === "array"} navigate={navigate} />;
}

function CollectionTable({ collection, rows, rawRows, idKey, revision, editable, navigate }: {
  collection: string;
  rows: ContentRow[];
  rawRows: ContentRow[];
  idKey: string;
  revision: string;
  editable: boolean;
  navigate: AppProps["navigate"];
}) {
  const [formulaStatuses, setFormulaStatuses] = useState<FormulaStatusesResult>();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState(collection === "items" || collection === "compiled-items" ? "tier" : "");
  const [active, setActive] = useState(-1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectionHeaderRef = useRef<HTMLInputElement>(null);
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
    if (!group) return sorted.map(row => ({ kind: "record", record: row.original }));
    const buckets = new Map<string, ContentRow[]>();
    for (const row of sorted) {
      const key = compactValue(row.original[group]);
      const bucket = buckets.get(key) ?? [];
      bucket.push(row.original);
      buckets.set(key, bucket);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .flatMap(([label, records]): DisplayRow[] => [{ kind: "group", label: `${fieldLabel(group)} ${label}`, count: records.length }, ...records.map(record => ({ kind: "record" as const, record }))]);
  }, [sorted, group]);
  const visibleRecordIds = useMemo(() => display.flatMap(row => row.kind === "record" && !isGeneratedRow(row.record) ? [rowId(row.record, idKey)] : []), [display, idKey]);
  const selectedIds = useMemo(() => [...selected], [selected]);
  const selectedVisibleCount = useMemo(() => visibleRecordIds.reduce((count, id) => count + (selected.has(id) ? 1 : 0), 0), [visibleRecordIds, selected]);
  const selectedHiddenCount = selectedIds.length - selectedVisibleCount;
  const allVisibleSelected = visibleRecordIds.length > 0 && selectedVisibleCount === visibleRecordIds.length;
  const someVisibleSelected = selectedVisibleCount > 0;
  const selectedRows = useMemo(() => rawRows.filter(row => selected.has(rowId(row, idKey))), [rawRows, selected, idKey]);
  useEffect(() => {
    const known = new Set(rawRows.map(row => rowId(row, idKey)));
    setSelected(previous => {
      const next = new Set([...previous].filter(id => known.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [rawRows, idKey]);
  useEffect(() => {
    if (selectionHeaderRef.current) selectionHeaderRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
  }, [someVisibleSelected, allVisibleSelected]);
  const virtualizer = useVirtualizer({ count: display.length, getScrollElement: () => scrollRef.current, estimateSize: index => display[index]?.kind === "group" ? 37 : 64, overscan: 7, getItemKey: index => { const row = display[index]; return row?.kind === "record" ? rowId(row.record, idKey) : `group:${row?.label}`; } });
  useEffect(() => { setActive(-1); scrollRef.current?.scrollTo({ top: 0 }); }, [search, group]);
  function move(key: string) {
    if (key === "Enter" && active >= 0) {
      const selectedRow = display[active];
      if (selectedRow?.kind === "record") navigate(collection, rowId(selectedRow.record, idKey));
      return;
    }
    const step = key === "ArrowUp" || key === "End" ? -1 : 1;
    let next = key === "Home" ? 0 : key === "End" ? display.length - 1 : active < 0 ? (step > 0 ? 0 : display.length - 1) : active + step;
    while (next >= 0 && next < display.length && display[next]?.kind === "group") next += step;
    if (next >= 0 && next < display.length) { setActive(next); virtualizer.scrollToIndex(next, { align: "auto" }); }
  }
  function toggleSelection(id: string) {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleVisibleSelection() {
    setSelected(previous => {
      const next = new Set(previous);
      if (allVisibleSelected) visibleRecordIds.forEach(id => next.delete(id));
      else visibleRecordIds.forEach(id => next.add(id));
      return next;
    });
  }
  const gridColumns = `${editable ? "36px " : ""}minmax(230px, 1fr) ${fields.map(() => "minmax(90px, 0.35fr)").join(" ")} 28px`;
  return <div className="collection-page">
    {editable && FormulaStatusObserver && <Suspense fallback={null}><FormulaStatusObserver collection={collection} rawRows={rawRows} enabled={editable} onChange={setFormulaStatuses}/></Suspense>}
    <header className="page-heading">
      <div className="heading-title"><h1>{labelFor(collection)}</h1><span className="count-badge">{rows.length}</span></div>
      <p>{descriptions[collection] ?? (collection.startsWith("balance/") ? "The parameters used by Corealm's balance formulas." : "Browse records and inspect their details.")}</p>
      {collection.startsWith("balance/") && !__DEVDOCS_PLAYER__ && <button className="button" onClick={() => navigate(collection, "$collection")}>Open formula and parameters</button>}
      {editable && RecordActions && <div style={{ marginTop: 15 }}><Suspense fallback={null}><RecordActions collection={collection} mode="collection" templateRecord={rawRows[0]} knownIds={rawRows.map(row => rowId(row, idKey))} editable={editable} idKey={idKey} navigate={navigate} /></Suspense></div>}
    </header>
    <div className="collection-toolbar">
      <label className="search-field"><Search size={17} /><input aria-label={`Search ${labelFor(collection).toLowerCase()}`} placeholder="Search names, IDs, types..." value={search} onChange={event => setSearch(event.target.value)} />{search ? <button aria-label="Clear search" className="icon-button" onClick={() => setSearch("")}><X size={15} /></button> : <kbd>/</kbd>}</label>
      {groupFields.length > 0 && <label className="group-select"><Layers2 size={16} /><span className="sr-only">Group by</span><select value={group} aria-label="Group by" onChange={event => setGroup(event.target.value)}><option value="">No grouping</option>{groupFields.map(key => <option value={key} key={key}>Group by {fieldLabel(key).toLowerCase()}</option>)}</select></label>}
      <span className="result-count" aria-live="polite">{filtered.length === rows.length ? `${rows.length} records` : `${filtered.length} of ${rows.length}`}</span>
      {editable && <div className={`collection-selection-status${selectedIds.length ? " has-selection" : ""}`} role="status" aria-live="polite"><span>{selectedIds.length} selected{selectedHiddenCount > 0 ? `, ${selectedHiddenCount} hidden by filter` : ""}</span>{selectedIds.length > 0 && <button type="button" className="text-button" onClick={() => setSelected(new Set())}>Clear selection</button>}</div>}
    </div>
    {editable && selectedIds.length > 0 && BulkActionsPanel && <Suspense fallback={null}><BulkActionsPanel collection={collection} idKey={idKey} revision={revision} rows={selectedRows} selectedIds={selectedIds} onClearSelection={() => setSelected(new Set())} /></Suspense>}
    {!filtered.length ? <EmptyState title={rows.length ? undefined : "This collection is empty"} /> : <div className="table-frame">
      <div className="table-scroll" ref={scrollRef} role="grid" aria-label={labelFor(collection)} aria-rowcount={display.length + 1} aria-colcount={fields.length + (editable ? 2 : 1)} tabIndex={0} aria-activedescendant={active >= 0 ? `content-row-${active}` : undefined} onKeyDown={event => { if (event.target !== event.currentTarget) return; if (["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(event.key)) { event.preventDefault(); move(event.key); } }}>
        <div className="table-header" role="row" style={{ gridTemplateColumns: gridColumns }}>
          {editable && <div role="columnheader" className="selection-header"><input ref={selectionHeaderRef} type="checkbox" checked={allVisibleSelected} aria-label={`Select filtered records (${visibleRecordIds.length})`} title="Select filtered records" onChange={toggleVisibleSelection} onClick={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} /><span className="sr-only">Select filtered records</span></div>}
          {table.getHeaderGroups()[0]?.headers.map(header => <div role="columnheader" aria-sort={header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : "none"} key={header.id}><button onClick={header.column.getToggleSortingHandler()}>{String(header.column.columnDef.header)}{header.column.getIsSorted() === "asc" ? <ArrowUp size={13} /> : header.column.getIsSorted() === "desc" ? <ArrowDown size={13} /> : <ArrowUpDown size={12} />}</button></div>)}
          <span />
        </div>
        <div className="virtual-body" style={{ height: virtualizer.getTotalSize() }}>{virtualizer.getVirtualItems().map(item => {
          const row = display[item.index]!;
          if (row.kind === "group") return <div key={item.key} role="row" className="table-group" style={{ height: item.size, transform: `translateY(${item.start}px)` }}><span role="gridcell">{row.label}</span><span className="group-count">{row.count}</span></div>;
          const id = rowId(row.record, idKey);
          const isSelected = selected.has(id);
          const rowEditable = editable && !isGeneratedRow(row.record);
          const formulaStatus = rowEditable ? formulaStatuses?.statuses.get(id) : undefined;
          return <div id={`content-row-${item.index}`} key={item.key} role="row" aria-rowindex={item.index + 2} aria-selected={isSelected} className={`table-row${active === item.index ? " is-active" : ""}${isSelected ? " is-selected" : ""}`} style={{ height: item.size, gridTemplateColumns: gridColumns, transform: `translateY(${item.start}px)` }} onClick={() => navigate(collection, id)}>
            {editable && <div role="gridcell" className="selection-cell">{rowEditable ? <label className="row-select" onClick={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}><input type="checkbox" checked={isSelected} aria-label={`Select record ${id}`} onChange={() => toggleSelection(id)} onClick={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} /><span className="sr-only">Select record {id}</span></label> : <span className="muted" title="Generated records are read-only">·</span>}</div>}
            <div role="gridcell" className="name-cell">
              {(collection === "items" || collection === "compiled-items") && <ItemIcon id={id} />}<button tabIndex={-1} className="row-name"><strong>{rowName(row.record, idKey)}</strong><span className="row-record-meta"><code>{id}</code>{isGeneratedRow(row.record) && <span className="formula-list-status" data-status="generated">Generated</span>}{formulaStatus && <span className="formula-list-status" data-status={formulaStatus}>{FORMULA_STATUS_LABELS[formulaStatus]}</span>}</span></button>
            </div>
            {fields.map(field => <div role="gridcell" key={field} className={typeof row.record[field] === "number" ? "numeric-cell" : "text-cell"}>{field === "tier" && row.record[field] !== undefined ? <span className="tier-tag">{String(row.record[field])}</span> : compactValue(row.record[field])}</div>)}
            <ChevronRight className="row-chevron" size={15} />
          </div>;
        })}</div>
      </div>
      <footer className="table-footer"><span>{group ? `Grouped by ${fieldLabel(group).toLowerCase()}` : "All records"}</span><span><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>↵</kbd> open</span></footer>
    </div>}
  </div>;
}
