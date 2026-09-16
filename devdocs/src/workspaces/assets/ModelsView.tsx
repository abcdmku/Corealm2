import { Suspense, useEffect, useMemo, useState } from "react";
import { lazyComponent } from "../lazyView.js";
import { useQuery } from "@tanstack/react-query";
import { Box, LayoutGrid, List, Maximize2, Minimize2, Search, SlidersHorizontal, X } from "lucide-react";
import { collectionQuery } from "../../api/client.js";
import type { ContentRow } from "../../model/contracts.js";
import { contentRows } from "../../model/rows.js";
import { summarize, titleCase } from "../../model/summaries.js";
import { viewerSource } from "../../model/viewerSource.js";
import { Facts, Field, RefField, ReferencedBy, Section, Sheet } from "../../ui/field/index.js";
import { EmptyState, ErrorState, LoadingRows } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import type { ViewProps } from "../types.js";
import { asRecord, num, RecordShell, strings, text } from "../story/shared.js";
import "./assets.css";
import { Button, NativeSelect, InputGroup, InputGroupAddon, InputGroupInput } from "../../components/ui/index.js";

const AssetViewer = lazyComponent(() => import("../../viewer/AssetViewer.js").then(module => ({ default: module.AssetViewer })));

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
      <InputGroup className="w-60"><InputGroupAddon align="start"><Search /></InputGroupAddon><InputGroupInput aria-label="Search models" placeholder="Search id, file, tag…" value={search} onChange={event => setSearch(event.target.value)} />{search && <Button variant="ghost" size="icon-sm" aria-label="Clear search" onClick={() => setSearch("")}><X size={13} /></Button>}</InputGroup>
      <span className="result-count">{filtered.length === rows.length ? rows.length : `${filtered.length} / ${rows.length}`}</span>
      <div className="toolbar-right">
        <div role="group" className="inline-flex h-7 items-center gap-0.5 rounded-md border border-border bg-card p-0.5" aria-label="View">
          <Button variant="segment" size="xs" aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid size={13} /> Grid</Button>
          <Button variant="segment" size="xs" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={13} /> List</Button>
        </div>
      </div>
    </div>
    <div className="facets">
      <div className="facet"><span>Category</span>{categories.map(([value, total]) => <Button variant="chip" size="xs" key={value} aria-pressed={category === value} onClick={() => setCategory(category === value ? "" : value)}>{titleCase(value)}<small>{total}</small></Button>)}</div>
      <div className="facet"><span>Pack</span>{packs.length > 18
        ? <NativeSelect value={pack} aria-label="Filter by pack" onChange={event => setPack(event.target.value)}><option value="">Any ({packs.length})</option>{packs.map(([value, total]) => <option key={value} value={value}>{value} · {total}</option>)}</NativeSelect>
        : packs.map(([value, total]) => <Button variant="chip" size="xs" key={value} aria-pressed={pack === value} onClick={() => setPack(pack === value ? "" : value)}>{value}<small>{total}</small></Button>)}</div>
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
    {filtered.length > limit && <div className="model-more"><Button variant="secondary" size="sm" onClick={() => setLimit(value => value + PAGE)}>Show {Math.min(PAGE, filtered.length - limit)} more of {filtered.length - limit}</Button></div>}
  </div>;
}

function categoryOf(row: Asset): string { return text(row.category) ?? (row.procedural ? "weapon" : "prop"); }

function count(values: readonly string[]): [string, number][] {
  const totals = new Map<string, number>();
  for (const value of values) totals.set(value, (totals.get(value) ?? 0) + 1);
  return [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/* ---------- Record ---------- */

/** Assets are read-only here: the page reads the collection, it does not open a draft. */
function ModelPage({ id, navigate }: { id: string; navigate: ViewProps["navigate"] }) {
  const query = useQuery(collectionQuery("assets"));
  const asset = useMemo(() => (query.data ? contentRows(query.data) : []).find(row => String(row.id) === id) as Asset | undefined, [query.data, id]);
  const [large, setLarge] = useState(false);
  const [controls, setControls] = useState(false);
  if (query.isPending) return <div className="ws-page"><LoadingRows /></div>;
  if (query.isError) return <ErrorState message={query.error.message} retry={() => void query.refetch()} />;
  if (!asset) return <EmptyState title="Model not found">This id is not in the asset catalog. <Button variant="link" size="inline" onClick={() => navigate("assets")}>Back to the gallery</Button></EmptyState>;

  const source = viewerSource("assets", asset);
  const size = asRecord(asset.size);
  const animations = strings(asset.animations);
  const materials = strings(asset.materials);
  const tags = strings(asset.tags);
  return <RecordShell
    thumb={asset.itemId ? { kind: "item", id: asset.itemId } : { kind: "asset", assetId: id, icon: Box }}
    title={titleCase(id)} id={id}
    facts={[titleCase(categoryOf(asset)), text(asset.pack), animations.length > 0 && `${animations.length} animation${animations.length === 1 ? "" : "s"}`]}
    className="model-page">
    {source && <div className="model-stage model-page-stage" data-large={large} data-controls={controls}>
      <div className="model-stage-actions">
        <Button variant="ghost" size="icon-sm" aria-pressed={controls} aria-label={controls ? "Hide viewer controls" : "Show viewer controls"} title="Animation, pose and material controls" onClick={() => setControls(value => !value)}><SlidersHorizontal size={13} /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={large ? "Smaller preview" : "Larger preview"} onClick={() => setLarge(value => !value)}>{large ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</Button>
      </div>
      <Suspense fallback={<p className="empty-inline" style={{ padding: 12 }}>Loading model…</p>}><AssetViewer source={source} label={titleCase(id)} /></Suspense>
    </div>}
    <Sheet>
      <Section title="File">
        <Field label="File"><span className="field-static mono">{text(asset.file) ?? "—"}</span></Field>
        <Field label="Pack"><span className="field-static">{text(asset.pack) ?? "—"}</span></Field>
        <Field label="Category"><span className="field-static">{titleCase(categoryOf(asset))}{text(asset.is) && text(asset.is) !== asset.category && <span className="muted"> · {String(asset.is)}</span>}</span></Field>
        <Field label="Bytes"><span className="field-static mono">{num(asset.bytes) !== undefined ? `${Math.round(num(asset.bytes)! / 1024).toLocaleString()} KB` : "—"}</span></Field>
        <Field label="Size" unit="m"><span className="field-static mono">{num(size.x) !== undefined ? `${fmtM(size.x)} × ${fmtM(size.y)} × ${fmtM(size.z)} m` : "—"}</span></Field>
        <Field label="Animations"><span className="field-static mono">{animations.length}</span></Field>
        {asset.itemId && <RefField kind="item" label="Item" value={String(asset.itemId)} onChange={() => undefined} readOnly />}
      </Section>
      <Section title="Tags"><span className="field-static">{tags.length ? tags.join(", ") : <span className="muted">No tags</span>}</span></Section>
      <Section title="Animations">{animations.length ? <ul className="model-names">{animations.map(name => <li key={name}>{name}</li>)}</ul> : <span className="empty-inline">No animation clips.</span>}</Section>
      <Section title="Materials">{materials.length ? <ul className="model-names">{materials.map(name => <li key={name}>{name}</li>)}</ul> : <span className="empty-inline">No named materials.</span>}</Section>
      <ReferencedBy collection="assets" id={id} navigate={navigate} title="Used by" />
    </Sheet>
  </RecordShell>;
}

const fmtM = (value: unknown): string => num(value) !== undefined ? String(Math.round(num(value)! * 100) / 100) : "?";


