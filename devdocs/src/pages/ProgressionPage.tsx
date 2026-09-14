import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Boxes, Hammer, Leaf, Search, Sparkles } from "lucide-react";
import type { CollectionResponse } from "../../shared/contracts.js";
import type { AppProps, ContentRow } from "../model/contracts.js";
import { collectionQuery, collectionsQuery } from "../api/client.js";
import { contentRows, rowId, rowName } from "../model/rows.js";
import { EmptyState, ErrorState, LoadingRows } from "../ui/States.js";
import { labelFor, taskSource } from "../ui/library.js";

const RecordActions = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/RecordActions.js"));

const PROGRESSION_SOURCES = ["progression", "materials", "equipmentFamilies", "recipeTemplates"] as const;

function objectRecord(value: unknown): ContentRow {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ContentRow : {};
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function tierOf(row: ContentRow, fallback: number): number {
  return numeric(row.tier) ?? numeric(row.reqLevel) ?? fallback;
}

function rowList(response: CollectionResponse | undefined): ContentRow[] {
  return response ? contentRows(response) : [];
}

interface ProgressionPageProps { navigate: AppProps["navigate"] }

export default function ProgressionPage({ navigate }: ProgressionPageProps) {
  const summaries = useQuery(collectionsQuery());
  const available = useMemo(() => {
    const names = new Set((summaries.data ?? []).map(collection => collection.name));
    return PROGRESSION_SOURCES.filter(name => names.has(name));
  }, [summaries.data]);
  const queries = useQueries({ queries: available.map(name => ({ ...collectionQuery(name), staleTime: 10_000 })) });
  const byName = useMemo(() => new Map(queries.flatMap(query => query.data ? [[query.data.collection.name, query.data] as const] : [])), [queries]);
  const unified = byName.get("progression");
  const sourceRoute = taskSource("progression", summaries.data ?? []) ?? "progression";
  const tiers = useMemo(() => unified ? contentRows(unified).sort((a, b) => tierOf(a, 0) - tierOf(b, 0)) : [], [unified]);
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const visible = tiers.filter(row => !needle || JSON.stringify(row).toLowerCase().includes(needle));
  const sourceRows = available.flatMap(name => rowList(byName.get(name)));
  const loading = summaries.isPending || queries.some(query => query.isPending);
  const error = summaries.error ?? queries.find(query => query.isError)?.error;

  if (loading) return <div className="collection-page"><ProgressionHeader count={0} onCreate={undefined} /><LoadingRows /></div>;
  if (error) return <div className="collection-page"><ProgressionHeader count={0} onCreate={undefined} /><ErrorState message={error.message} retry={() => { void summaries.refetch(); queries.forEach(query => void query.refetch()); }} /></div>;

  const editable = Boolean(unified?.collection.editable && unified.collection.shape === "array");
  return <div className="collection-page">
    <ProgressionHeader count={visible.length} onCreate={editable && RecordActions ? <Suspense fallback={null}><RecordActions collection="progression" mode="collection" templateRecord={tiers[0]} knownIds={tiers.map(row => rowId(row))} navigate={navigate} /></Suspense> : undefined} />
    {!unified && <div className="editor-formula-notice" role="status"><Sparkles size={15} /><p>The unified progression source is unavailable in this snapshot. Add a progression row after the source is restored.</p></div>}
    <label className="search-field" style={{ marginBottom: 18 }}><Search size={17} /><span className="sr-only">Search progression</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search tiers, materials, families, or recipes" aria-label="Search progression" />{search && <button className="icon-button" type="button" aria-label="Clear progression search" onClick={() => setSearch("")}>×</button>}</label>
    {!visible.length ? <EmptyState title={tiers.length ? "No progression rows match" : "No progression rows are available"}>Try a tier, material, or production family.</EmptyState> : <div className="progression-ladder">{visible.map((row, index) => <ProgressionTierCard key={rowId(row) || index} row={row} index={index} sourceRoute={sourceRoute} navigate={navigate} unified={Boolean(unified)} />)}</div>}
    <section className="detail-section" style={{ marginTop: 34 }} aria-label="Progression sources">
      <div className="section-heading"><h2>Related definitions</h2><span>{available.length} source collections</span></div>
      <div className="collection-directory">{available.map(name => <button className="directory-row" type="button" key={name} onClick={() => navigate(name)}><SourceIcon name={name} /><span><strong>{labelFor(name)}</strong><small>{sourceRows.filter(row => row.id !== undefined).length ? `${rowList(byName.get(name)).length} records available` : "No records in this snapshot"}</small></span><ArrowUpRight size={16} /></button>)}</div>
    </section>
  </div>;
}

function ProgressionHeader({ count, onCreate }: { count: number; onCreate: ReactNode }) {
  return <header className="page-heading"><div className="heading-title"><h1>Progression</h1><span className="count-badge">{count}</span></div><p>Tiers connect materials, acquisition, equipment families, and production templates in one authoring view.</p>{onCreate && <div style={{ marginTop: 15 }}>{onCreate}</div>}</header>;
}

function SourceIcon({ name }: { name: string }) {
  if (name.toLowerCase().includes("recipe")) return <Hammer size={20} />;
  if (name.toLowerCase().includes("material") || name.toLowerCase().includes("resource")) return <Leaf size={20} />;
  return <Boxes size={20} />;
}

function ProgressionTierCard({ row, index, sourceRoute, navigate, unified }: { row: ContentRow; index: number; sourceRoute: string; navigate: AppProps["navigate"]; unified: boolean }) {
  const tier = tierOf(row, index + 1);
  const materials = objectRecord(row.materials);
  const equipment = Array.isArray(row.equipment) ? row.equipment : [];
  const production = Array.isArray(row.production) ? row.production : [];
  const resources = Array.isArray(row.resourceIds) ? row.resourceIds : Array.isArray(row.resources) ? row.resources : [];
  const id = rowId(row);
  return <article className="detail-section" style={{ borderTop: "1px solid var(--border)", padding: "22px 0 4px", maxWidth: "1100px" }}>
    <header className="section-heading"><div><span className="eyebrow"><Boxes size={14} /> Tier {String(tier)}</span><h2 style={{ marginTop: 8 }}>{rowName(row)}</h2></div><div style={{ display: "flex", gap: 12, alignItems: "center" }}>{unified && id && <button className="reference-link" type="button" onClick={() => navigate(sourceRoute, id)}>Open definition <ArrowUpRight size={14} /></button>}<span className="mono">{equipment.length + production.length} outputs</span></div></header>
    <div className="field-list">
      <div className="field-row"><dt>Required level</dt><dd>{String(row.reqLevel ?? "Not set")}</dd></div>
      <div className="field-row"><dt>Materials</dt><dd>{Object.keys(materials).length ? <div className="value-tags">{Object.entries(materials).map(([key, value]) => <span className="value-tag" key={key}>{key}: {String(value)}</span>)}</div> : <span className="muted">No material assignments</span>}</dd></div>
      <div className="field-row"><dt>Acquisition</dt><dd>{resources.length ? <div className="value-tags">{resources.map((value, valueIndex) => <button className="reference-link" type="button" key={`${String(value)}:${valueIndex}`} onClick={() => navigate("resources", String(value))}>{String(value)} <ArrowUpRight size={12} /></button>)}</div> : <span className="muted">No resource links</span>}</dd></div>
      <div className="field-row"><dt>Equipment families</dt><dd>{equipment.length ? <div className="value-list">{equipment.slice(0, 12).map((value, valueIndex) => <span key={valueIndex}>{String(objectRecord(value).name ?? objectRecord(value).familyId ?? objectRecord(value).id ?? "Unnamed family member")}</span>)}</div> : <span className="muted">No equipment members</span>}</dd></div>
      <div className="field-row"><dt>Production</dt><dd>{production.length ? <div className="value-list">{production.slice(0, 12).map((value, valueIndex) => <span key={valueIndex}>{String(objectRecord(value).name ?? objectRecord(value).templateId ?? objectRecord(value).id ?? "Unnamed production")}</span>)}</div> : <span className="muted">No production templates</span>}</dd></div>
    </div>
  </article>;
}
