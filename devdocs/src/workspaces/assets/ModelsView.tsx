import { Suspense, useEffect, useMemo, useState } from "react";
import { lazyComponent } from "../lazyView.js";
import { useQuery } from "@tanstack/react-query";
import { Box, ExternalLink, LayoutGrid, List, Maximize2, Minimize2, SlidersHorizontal } from "lucide-react";
import assetReviewStatus from "../../../../docs/asset-review.md?raw";
import { collectionQuery } from "../../api/client.js";
import type { ContentRow } from "../../model/contracts.js";
import { contentRows } from "../../model/rows.js";
import { summarize, titleCase } from "../../model/summaries.js";
import { viewerSource } from "../../model/viewerSource.js";
import { Facts, Field, RefField, ReferencedBy, Section, Sheet, Static } from "../../ui/field/index.js";
import { EmptyState, ErrorState, LoadingRows } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import type { ViewProps } from "../types.js";
import { asRecord, num, RecordShell, strings, text } from "../story/shared.js";
import { Badge, Button, NativeSelect, Segmented, SearchInput } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
import { COUNT, EMPTY, PAGE as PAGE_FRAME, TOOLBAR } from "../../ui/layout.js";
import { TileGrid, tileArtClasses, tileClasses, tileSubtitleClasses, tileTitleClasses } from "../../ui/RecordTile.js";

const AssetViewer = lazyComponent(() => import("../../viewer/AssetViewer.js").then(module => ({ default: module.AssetViewer })), null);

interface Asset extends ContentRow { id: string; file?: string; pack?: string; category?: string; is?: string; tags?: string[]; bytes?: number; size?: { x: number; y: number; z: number }; animations?: string[]; materials?: string[]; procedural?: boolean; itemId?: string }

const PAGE = 96;

interface TripoStatusRow { status: string; assets: string; details: string }

function parseTripoStatus(source: string): { updated: string; rows: TripoStatusRow[] } {
  const start = source.indexOf("## Tripo integration status");
  if (start < 0) return { updated: "", rows: [] };
  const nextHeading = source.indexOf("\n## ", start + 1);
  const section = source.slice(start, nextHeading < 0 ? undefined : nextHeading);
  const updated = section.match(/Updated\s+([^.]*)\./)?.[1] ?? "";
  const rows = section.split(/\r?\n/).flatMap(line => {
    if (!line.startsWith("|") || /^\|\s*:?-{3,}/.test(line) || /^\|\s*Status\s*\|/i.test(line)) return [];
    const cells = line.slice(1, -1).split("|").map(cell => cell.trim().replaceAll("`", ""));
    if (cells.length < 3 || !cells[0] || !cells[1]) return [];
    return [{ status: cells[0]!, assets: cells[1]!, details: cells[2] ?? "" }];
  });
  return { updated, rows };
}

const TRIPO_STATUS = parseTripoStatus(assetReviewStatus);

function lastDetailSentence(value: string): string {
  const clean = value.replaceAll("**", "").trim();
  const boundary = clean.lastIndexOf(". ");
  return boundary >= 0 ? clean.slice(boundary + 2) : clean;
}

function tripoNote(row: TripoStatusRow): string {
  if (/^Starred\b/i.test(row.status)) return row.details;
  const lower = row.details.toLowerCase();
  if (lower.includes("authored-world proof remains pending")) {
    const checks = lower.includes("production build passed") ? "Production sync and build passed; " : "";
    return `${checks}authored-world proof pending.`;
  }
  return lastDetailSentence(row.details);
}

function isRigRepairHeld(row: TripoStatusRow): boolean {
  return /rig repair/i.test(`${row.status} ${row.details}`);
}

function isImageDenied(row: TripoStatusRow): boolean {
  return /image denied/i.test(row.status);
}

function isHeld(row: TripoStatusRow): boolean {
  return /held|blocked/i.test(row.status) || isRigRepairHeld(row) || isImageDenied(row);
}

type StarredStage = "Source export" | "Extracted parts" | "Candidate rig" | "Lab accepted" | "Production integrated" | "Design hold";

function starredStage(row: TripoStatusRow): StarredStage {
  const status = row.status.toLowerCase();
  if (/design hold|design review provisional|visual hold|rig held|rig\/texture held|candidate held|provenance held/.test(status)) return "Design hold";
  if (/production integrated|in production/.test(status)) return "Production integrated";
  if (/lab accepted/.test(status)) return "Lab accepted";
  if (/candidate rig|candidate lab/.test(status)) return "Candidate rig";
  if (/extracted parts|extraction complete/.test(status)) return "Extracted parts";
  return "Source export";
}

function TripoProgress() {
  const accepted = TRIPO_STATUS.rows.filter(row => /^Production\b/i.test(row.status)
    && !/pending|held|blocked/i.test(row.status)
    && !row.details.toLowerCase().includes("authored-world proof remains pending"));
  const modelReview = TRIPO_STATUS.rows.filter(row => /^Image approved/i.test(row.status) && !isHeld(row));
  const pendingWorld = TRIPO_STATUS.rows.filter(row => row.details.toLowerCase().includes("authored-world proof remains pending"));
  const labReview = TRIPO_STATUS.rows.filter(row => /^Lab review queued/i.test(row.status));
  const tierRewire = TRIPO_STATUS.rows.filter(row => /^Previously accepted;.*rewire pending/i.test(row.status));
  const tracked = TRIPO_STATUS.rows.filter(row => /^Starred\b|^Composite sheet\b/i.test(row.status));
  const pipeline: { stage: StarredStage; tone: "info" | "accent" | "ok" | "warn" }[] = [
    { stage: "Source export", tone: "info" },
    { stage: "Extracted parts", tone: "info" },
    { stage: "Candidate rig", tone: "accent" },
    { stage: "Lab accepted", tone: "ok" },
    { stage: "Production integrated", tone: "ok" },
    { stage: "Design hold", tone: "warn" },
  ];
  const held = TRIPO_STATUS.rows.filter(row => !/^Starred\b|^Composite sheet\b/i.test(row.status) && isHeld(row));
  const groups = [
    ...pipeline.map(stage => {
      const rows = tracked.filter(row => starredStage(row) === stage.stage);
      return {
      title: `${stage.stage} (${rows.length})`,
      rows,
      tone: stage.tone,
      collapsible: true,
    }; }),
    { title: "Production", rows: accepted, tone: "ok" as const },
    { title: "Model review", rows: modelReview, tone: "info" as const },
    { title: "Lab review", rows: labReview, tone: "accent" as const },
    { title: "World proof", rows: pendingWorld, tone: "info" as const },
    { title: "Tier rewire", rows: tierRewire, tone: "warn" as const },
    { title: "Held", rows: held, tone: "warn" as const },
  ].filter(group => group.rows.length > 0);
  if (!groups.length) return null;
  return <section aria-labelledby="tripo-progress-title" className="mb-3 rounded-md border border-border bg-card px-3 py-2.5">
    <header className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <h2 id="tripo-progress-title" className="text-[13px] font-semibold">Tripo progress</h2>
      <span className="text-[11px] text-faint">From docs/asset-review.md{TRIPO_STATUS.updated ? ` - updated ${TRIPO_STATUS.updated}` : ""}</span>
    </header>
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {groups.map(group => {
        const rows = <ul className="space-y-1.5">
          {group.rows.map(row => <li key={`${row.status}:${row.assets}`} className="min-w-0 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={group.tone} className="h-4 px-1 text-[10px]">{row.status}</Badge>
              <span className="min-w-0 font-medium text-foreground">{row.assets}</span>
            </div>
          {group.title !== "Production" && <p className="mt-0.5 text-[11px] text-muted-foreground">{group.title === "Model review" ? "Model gate pending; not in game." : group.title === "Held" && isImageDenied(row) ? "Image denied; no model generated; not in game." : group.title === "Held" && isRigRepairHeld(row) ? "Held for rig repair; not in game." : tripoNote(row)}</p>}
          </li>)}
        </ul>;
        return <section key={group.title} aria-label={group.title} className="min-w-0">
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{group.title}</h3>
          {"collapsible" in group && group.collapsible
            ? <details className="rounded border border-border/70 px-2 py-1.5 text-xs">
                <summary className="cursor-pointer text-muted-foreground">View {group.rows.length} records and current gate</summary>
                <div className="pt-2">{rows}</div>
              </details>
            : rows}
        </section>;
      })}
    </div>
  </section>;
}

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
  if (query.isPending) return <div className={PAGE_FRAME}><LoadingRows /></div>;
  if (query.isError) return <ErrorState message={query.error.message} retry={() => void query.refetch()} />;
  const shown = filtered.slice(0, limit);
  const list = view === "list";
  const open = (id: string) => navigate("assets", id);
  const tiles = shown.map(row => {
    const summary = summarize("assets", row);
    return <div role="button" tabIndex={0} className={tileClasses({ row: list })} key={row.id} data-id={row.id} onClick={() => open(row.id)} onKeyDown={event => { if (event.key === "Enter") open(row.id); }}>
      <span className={tileArtClasses(list)}><Thumb spec={summary.thumb} size={list ? "m" : "xl"} alt="" /></span>
      <span className={cn("flex min-w-0", list ? "flex-1 flex-row items-center gap-2" : "flex-col gap-0.5")}>
        <span className={cn(tileTitleClasses(list), list && "min-w-50")} title={row.id}>{titleCase(row.id)}</span>
        <Facts className={cn(tileSubtitleClasses(list), "flex-nowrap", list && "flex-none")} items={[titleCase(categoryOf(row)), text(row.pack)]} />
        {list && <span className={cn(tileSubtitleClasses(list), "font-mono text-faint")}>{text(row.file) ?? ""}</span>}
      </span>
    </div>;
  });
  return <div className={PAGE_FRAME}>
    <TripoProgress />
    <div className={TOOLBAR}>
      <SearchInput label="Search models" shortcut placeholder="Search id, file, tag…" value={search} onChange={setSearch} onEnter={() => { const first = filtered[0]; if (first) open(first.id); }} />
      <span className={COUNT}>{filtered.length === rows.length ? rows.length : `${filtered.length} of ${rows.length}`}</span>
      <Button asChild variant="secondary" size="xs" title="Start npm run assets:review, then inspect current and staged models">
        <a href="http://127.0.0.1:4186/review/" target="_blank" rel="noreferrer"><ExternalLink />Asset review</a>
      </Button>
      <Segmented aria-label="Layout">
        <Button variant="segment" size="xs" aria-label="Grid" title="Grid" aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid size={13} /></Button>
        <Button variant="segment" size="xs" aria-label="List" title="List" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={13} /></Button>
      </Segmented>
    </div>
    <div className="-mt-1 mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
      <div className="flex flex-wrap items-center gap-1"><span className="mr-0.5 text-[11px] text-faint">Category</span>{categories.map(([value, total]) => <Button variant="chip" size="xs" key={value} aria-pressed={category === value} onClick={() => setCategory(category === value ? "" : value)}>{titleCase(value)}<small className="font-mono text-faint">{total}</small></Button>)}</div>
      <div className="flex flex-wrap items-center gap-1"><span className="mr-0.5 text-[11px] text-faint">Pack</span>{packs.length > 18
        ? <NativeSelect value={pack} aria-label="Filter by pack" wrapperClassName="w-56" onChange={event => setPack(event.target.value)}><option value="">Any ({packs.length})</option>{packs.map(([value, total]) => <option key={value} value={value}>{value} · {total}</option>)}</NativeSelect>
        : packs.map(([value, total]) => <Button variant="chip" size="xs" key={value} aria-pressed={pack === value} onClick={() => setPack(pack === value ? "" : value)}>{value}<small className="font-mono text-faint">{total}</small></Button>)}</div>
    </div>
    {!filtered.length && <p className={EMPTY}>No models match.</p>}
    {list ? <div className="flex flex-col gap-0.5">{tiles}</div> : <TileGrid>{tiles}</TileGrid>}
    {filtered.length > limit && <div className="flex justify-center p-4"><Button variant="secondary" size="sm" onClick={() => setLimit(value => value + PAGE)}>Show {Math.min(PAGE, filtered.length - limit)} more of {filtered.length - limit}</Button></div>}
  </div>;
}

function categoryOf(row: Asset): string { return text(row.category) ?? (row.procedural ? "weapon" : "prop"); }

function count(values: readonly string[]): [string, number][] {
  const totals = new Map<string, number>();
  for (const value of values) totals.set(value, (totals.get(value) ?? 0) + 1);
  return [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/* ---------- Record ---------- */

/*
  The viewer brings its own heading, playback and outfit controls, and sizes its viewport inline.
  The stage fills its frame with the viewport and hides the controls until the sliders button asks
  for them; then the viewport takes a fixed height and the controls stack under it.
*/
const STAGE = cn(
  "relative mb-4 overflow-hidden rounded-md border border-border bg-art",
  "[&_.asset-viewer]:m-0 [&_.asset-viewer]:flex [&_.asset-viewer]:h-full [&_.asset-viewer]:flex-col [&_.asset-viewer]:border-0 [&_.asset-viewer]:bg-transparent [&_.asset-viewer]:p-0",
  "[&_.viewer-viewport]:rounded-none! [&_.viewer-viewport]:bg-art!",
);
/** Controls hidden: the viewport's wrapper and the viewport grow to fill the stage's aspect box. */
const STAGE_FILL = cn(
  "[&_.viewer-heading]:hidden! [&_.viewer-outfit-controls]:hidden! [&_.viewer-playback]:hidden! [&_.viewer-readout]:hidden! [&_.asset-viewer>details]:hidden! [&_.asset-viewer>:not(:has(.viewer-viewport))]:hidden!",
  "[&_.asset-viewer>:has(.viewer-viewport)]:flex [&_.asset-viewer>:has(.viewer-viewport)]:min-h-0 [&_.asset-viewer>:has(.viewer-viewport)]:flex-1 [&_.asset-viewer>:has(.viewer-viewport)]:flex-col",
  "[&_.viewer-viewport]:h-auto! [&_.viewer-viewport]:min-h-0 [&_.viewer-viewport]:flex-1",
);
const STAGE_CONTROLS = cn(
  "[&_.viewer-viewport]:h-60! [&_.asset-viewer]:pb-1.5 text-xs",
  // Every row but the viewport's own wrapper: the viewer's inline margins give way to one inset.
  "[&_.asset-viewer>:not(:has(.viewer-viewport))]:m-0! [&_.asset-viewer>:not(:has(.viewer-viewport))]:px-2 [&_.asset-viewer>:not(:has(.viewer-viewport))]:py-1",
  // The heading row runs under the stage's two buttons.
  "[&_.viewer-heading]:min-h-9 [&_.viewer-heading]:pr-18! [&_.viewer-heading_h3]:text-[13px] [&_.viewer-heading_h3]:font-semibold",
);
const NAMES = "grid list-none grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-x-4 gap-y-0.5 font-mono text-xs";
const NAME = "min-h-[22px] min-w-0 truncate leading-[22px] text-muted-foreground";

/** Assets are read-only here: the page reads the collection, it does not open a draft. */
function ModelPage({ id, navigate }: { id: string; navigate: ViewProps["navigate"] }) {
  const query = useQuery(collectionQuery("assets"));
  const asset = useMemo(() => (query.data ? contentRows(query.data) : []).find(row => String(row.id) === id) as Asset | undefined, [query.data, id]);
  const [large, setLarge] = useState(false);
  const [controls, setControls] = useState(false);
  if (query.isPending) return <div className={PAGE_FRAME}><LoadingRows /></div>;
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
    facts={[titleCase(categoryOf(asset)), text(asset.pack), animations.length > 0 && `${animations.length} animation${animations.length === 1 ? "" : "s"}`]}>
    {source && <div className={cn(STAGE, controls ? STAGE_CONTROLS : cn(STAGE_FILL, large ? "aspect-[4/3]" : "aspect-video"))}>
      <div className="absolute top-1.5 right-1.5 z-10 flex gap-0.5">
        <Button variant="ghost" size="icon-sm" aria-pressed={controls} aria-label={controls ? "Hide viewer controls" : "Show viewer controls"} title="Animation, pose and material controls" onClick={() => setControls(value => !value)}><SlidersHorizontal size={13} /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={large ? "Smaller preview" : "Larger preview"} onClick={() => setLarge(value => !value)}>{large ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</Button>
      </div>
      <Suspense fallback={<p className={cn(EMPTY, "p-3")}>Loading model…</p>}><AssetViewer source={source} label={titleCase(id)} /></Suspense>
    </div>}
    <Sheet>
      <Section title="File">
        <Field label="File"><Static mono>{text(asset.file) ?? "—"}</Static></Field>
        <Field label="Pack"><Static>{text(asset.pack) ?? "—"}</Static></Field>
        <Field label="Category"><Static>{titleCase(categoryOf(asset))}{text(asset.is) && text(asset.is) !== asset.category && <span className="text-faint"> · {String(asset.is)}</span>}</Static></Field>
        <Field label="Bytes"><Static mono>{num(asset.bytes) !== undefined ? `${Math.round(num(asset.bytes)! / 1024).toLocaleString()} KB` : "—"}</Static></Field>
        <Field label="Size" unit="m"><Static mono>{num(size.x) !== undefined ? `${fmtM(size.x)} × ${fmtM(size.y)} × ${fmtM(size.z)} m` : "—"}</Static></Field>
        <Field label="Animations"><Static mono>{animations.length}</Static></Field>
        {asset.itemId && <RefField kind="item" label="Item" value={String(asset.itemId)} onChange={() => undefined} readOnly />}
      </Section>
      <Section title="Tags"><Static>{tags.length ? tags.join(", ") : <span className="text-faint">No tags</span>}</Static></Section>
      <Section title="Animations">{animations.length ? <ul className={NAMES}>{animations.map(name => <li key={name} className={NAME} title={name}>{name}</li>)}</ul> : <span className={EMPTY}>No animation clips.</span>}</Section>
      <Section title="Materials">{materials.length ? <ul className={NAMES}>{materials.map(name => <li key={name} className={NAME} title={name}>{name}</li>)}</ul> : <span className={EMPTY}>No named materials.</span>}</Section>
      <ReferencedBy collection="assets" id={id} navigate={navigate} title="Used by" />
    </Sheet>
  </RecordShell>;
}

const fmtM = (value: unknown): string => num(value) !== undefined ? String(Math.round(num(value)! * 100) / 100) : "?";


