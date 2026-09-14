import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, LayoutGrid, List, Maximize2, Minimize2, Search, SlidersHorizontal, X } from "lucide-react";
import { collectionQuery } from "../../api/client.js";
import type { ContentRow } from "../../model/contracts.js";
import { incomingReferences } from "../../model/refs.js";
import { contentRows } from "../../model/rows.js";
import { summarize, titleCase } from "../../model/summaries.js";
import { viewerSource } from "../../model/viewerSource.js";
import { RefRow } from "../../ui/RefChip.js";
import { Facts, Row, Section, Sheet, Static } from "../../ui/Sheet.js";
import { ErrorState, LoadingRows } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import { labelFor } from "../../ui/library.js";
import type { ViewProps } from "../types.js";
import { asRecord, list, num, PageState, RecordShell, strings, text, usePage } from "../story/shared.js";
import "./assets.css";

const AssetViewer = lazy(() => import("../../viewer/AssetViewer.js").then(module => ({ default: module.AssetViewer })));

interface Asset extends ContentRow { id: string; file?: string; pack?: string; category?: string; is?: string; tags?: string[]; bytes?: number; size?: { x: number; y: number; z: number }; animations?: string[]; materials?: string[]; procedural?: boolean; itemId?: string }

const PAGE = 96;

export default function ModelsView({ recordId, navigate }: ViewProps) {
  if (recordId === undefined) return <ModelGallery navigate={navigate} />;
  return <ModelPage id={recordId} navigate={navigate} />;
}

/* ---------- Gallery ---------- */

function readView(): "grid" | "list" {
  try { const saved = localStorage.getItem("corealm-codex-view:assets"); if (saved === "grid" || saved === "list") return saved; } catch { /* optional */ }
  return "grid";
}

function ModelGallery({ navigate }: { navigate: ViewProps["navigate"] }) {
  const query = useQuery(collectionQuery("assets"));
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [pack, setPack] = useState("");
  const [view, setView] = useState<"grid" | "list">(readView);
  const [limit, setLimit] = useState(PAGE);
  const rows = useMemo(() => (query.data ? contentRows(query.data) : []) as Asset[], [query.data]);
  const categories = useMemo(() => count(rows.map(row => categoryOf(row))), [rows]);
  const packs = useMemo(() => count(rows.map(row => text(row.pack) ?? "procedural")), [rows]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter(row => {
      if (category && categoryOf(row) !== category) return false;
      if (pack && (text(row.pack) ?? "procedural") !== pack) return false;
      if (!needle) return true;
      return `${row.id} ${text(row.file) ?? ""} ${strings(row.tags).join(" ")} ${text(row.pack) ?? ""}`.toLowerCase().includes(needle);
    }).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }, [rows, search, category, pack]);
  useEffect(() => { setLimit(PAGE); }, [search, category, pack, view]);
  useEffect(() => { try { localStorage.setItem("corealm-codex-view:assets", view); } catch { /* optional */ } }, [view]);
  if (query.isPending) return <div className="ws-page"><LoadingRows /></div>;
  if (query.isError) return <ErrorState message={query.error.message} retry={() => void query.refetch()} />;
  const shown = filtered.slice(0, limit);
  return <div className="ws-page">
    <div className="browser-toolbar">
      <label className="search-field"><Search size={14} /><input aria-label="Search models" placeholder="Search id, file, tag…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button type="button" aria-label="Clear search" className="icon-button" onClick={() => setSearch("")}><X size={13} /></button>}</label>
      <span className="result-count">{filtered.length === rows.length ? rows.length : `${filtered.length} / ${rows.length}`}</span>
      <div className="toolbar-right">
        <div className="segmented" role="group" aria-label="View">
          <button type="button" className={view === "grid" ? "is-active" : ""} aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid size={13} /> Grid</button>
          <button type="button" className={view === "list" ? "is-active" : ""} aria-pressed={view === "list"} onClick={() => setView("list")}><List size={13} /> List</button>
        </div>
      </div>
    </div>
    <div className="facets">
      <div className="facet"><span>Category</span>{categories.map(([value, total]) => <button type="button" key={value} className={`filter-chip${category === value ? " is-active" : ""}`} aria-pressed={category === value} onClick={() => setCategory(category === value ? "" : value)}>{titleCase(value)}<small>{total}</small></button>)}</div>
      <div className="facet"><span>Pack</span>{packs.length > 18
        ? <label className="select"><span className="sr-only">Pack</span><select value={pack} aria-label="Filter by pack" onChange={event => setPack(event.target.value)}><option value="">Any ({packs.length})</option>{packs.map(([value, total]) => <option key={value} value={value}>{value} · {total}</option>)}</select></label>
        : packs.map(([value, total]) => <button type="button" key={value} className={`filter-chip${pack === value ? " is-active" : ""}`} aria-pressed={pack === value} onClick={() => setPack(pack === value ? "" : value)}>{value}<small>{total}</small></button>)}</div>
    </div>
    {!filtered.length && <p className="empty-inline">No models match.</p>}
    <div className={view === "grid" ? "tile-grid" : "model-list"} data-density="compact">{shown.map(row => {
      const summary = summarize("assets", row);
      const facts = <Facts items={[titleCase(categoryOf(row)), text(row.pack)]} />;
      return <div role="button" tabIndex={0} className={`tile${view === "list" ? " tile-row" : ""}`} key={row.id} data-id={row.id} onClick={() => navigate("assets", row.id)} onKeyDown={event => { if (event.key === "Enter") navigate("assets", row.id); }}>
        <span className="tile-art"><Thumb spec={summary.thumb} size={view === "grid" ? "xl" : "m"} alt="" /></span>
        <span className="tile-body">
          <span className="tile-title" title={row.id}>{titleCase(row.id)}</span>
          <span className="tile-subtitle">{facts}</span>
          {view === "list" && <span className="tile-subtitle mono">{text(row.file) ?? ""}</span>}
        </span>
      </div>;
    })}</div>
    {filtered.length > limit && <div className="model-more"><button type="button" className="button" onClick={() => setLimit(value => value + PAGE)}>Show {Math.min(PAGE, filtered.length - limit)} more of {filtered.length - limit}</button></div>}
  </div>;
}

function categoryOf(row: Asset): string { return text(row.category) ?? (row.procedural ? "weapon" : "prop"); }

function count(values: readonly string[]): [string, number][] {
  const totals = new Map<string, number>();
  for (const value of values) totals.set(value, (totals.get(value) ?? 0) + 1);
  return [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/* ---------- Record ---------- */

function ModelPage({ id, navigate }: { id: string; navigate: ViewProps["navigate"] }) {
  const page = usePage<Asset>("assets", id);
  const { index, ctx } = page;
  const incoming = useMemo(() => incomingReferences(index, "assets", id), [index, id]);
  const [large, setLarge] = useState(false);
  const [controls, setControls] = useState(false);
  return <PageState page={page} collection="assets" navigate={navigate}>{asset => {
    const source = viewerSource("assets", asset);
    const size = asRecord(asset.size);
    const animations = strings(asset.animations);
    const materials = strings(asset.materials);
    const tags = strings(asset.tags);
    const grouped = new Map<string, typeof incoming>();
    for (const reference of incoming) { const bucket = grouped.get(reference.collection) ?? []; bucket.push(reference); grouped.set(reference.collection, bucket); }
    return <RecordShell
      thumb={asset.itemId ? { kind: "item", id: asset.itemId } : { kind: "asset", assetId: id, icon: Box }}
      title={titleCase(id)} id={id}
      facts={[titleCase(categoryOf(asset)), text(asset.pack), animations.length > 0 && `${animations.length} animation${animations.length === 1 ? "" : "s"}`]}
      className="model-page">
      {source && <div className="model-stage model-page-stage" data-large={large} data-controls={controls}>
        <div className="model-stage-actions">
          <button className={`icon-button${controls ? " is-active" : ""}`} aria-label={controls ? "Hide viewer controls" : "Show viewer controls"} title="Animation, pose and material controls" onClick={() => setControls(value => !value)}><SlidersHorizontal size={13} /></button>
          <button className="icon-button" aria-label={large ? "Smaller preview" : "Larger preview"} onClick={() => setLarge(value => !value)}>{large ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
        </div>
        <Suspense fallback={<p className="empty-inline" style={{ padding: 12 }}>Loading model…</p>}><AssetViewer source={source} label={titleCase(id)} /></Suspense>
      </div>}
      <Sheet>
        <Section title="File">
          <Row label="File"><Static mono>{text(asset.file) ?? "—"}</Static></Row>
          <Row label="Pack"><Static>{text(asset.pack) ?? "—"}</Static></Row>
          <Row label="Category"><Static>{titleCase(categoryOf(asset))}{text(asset.is) && text(asset.is) !== asset.category && <span className="muted"> · {String(asset.is)}</span>}</Static></Row>
          <Row label="Bytes"><Static mono>{num(asset.bytes) !== undefined ? `${Math.round(num(asset.bytes)! / 1024).toLocaleString()} KB` : "—"}</Static></Row>
          <Row label="Size"><Static mono>{num(size.x) !== undefined ? `${fmtM(size.x)} × ${fmtM(size.y)} × ${fmtM(size.z)} m` : "—"}</Static></Row>
          <Row label="Animations"><Static mono>{animations.length}</Static></Row>
          {asset.itemId && <Row label="Item"><Static><button type="button" className="text-button" onClick={() => navigate(page.itemCollection, String(asset.itemId))}>{String(asset.itemId)}</button></Static></Row>}
        </Section>
        <Section title="Tags"><Static>{tags.length ? tags.join(", ") : <span className="muted">No tags</span>}</Static></Section>
        <Section title="Animations">{animations.length ? <ul className="model-names">{animations.map(name => <li key={name}>{name}</li>)}</ul> : <span className="empty-inline">No animation clips.</span>}</Section>
        <Section title="Materials">{materials.length ? <ul className="model-names">{materials.map(name => <li key={name}>{name}</li>)}</ul> : <span className="empty-inline">No named materials.</span>}</Section>
        <Section title="Used by">
          {grouped.size ? [...grouped.entries()].map(([collection, references]) => <Row key={collection} label={labelFor(collection)} align="start">
            <div className="ref-rows model-used-by">{references.map(reference => <RefRow key={`${reference.recordId}:${reference.path}`} collection={collection} id={reference.recordId} record={reference.record} ctx={ctx} onOpen={(target, targetId) => navigate(target, targetId)} subtitle={reference.role} />)}</div>
          </Row>) : <span className="empty-inline">Nothing references this model.</span>}
        </Section>
      </Sheet>
    </RecordShell>;
  }}</PageState>;
}

const fmtM = (value: unknown): string => num(value) !== undefined ? String(Math.round(num(value)! * 100) / 100) : "?";


