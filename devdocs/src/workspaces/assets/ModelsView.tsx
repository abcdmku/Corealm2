import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, LayoutGrid, List, Server, Trash2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import type { AssetEntry } from "../../../../game/src/render/assets.js";
import { can } from "../../api/backend.js";
import { incomingReferences, useReferenceIndex } from "../../model/refs.js";
import { serverModels, subscribeServerModels } from "../../viewer/registry.js";
import { ModelUpload } from "./ModelUpload.js";
import { removeModel } from "./modelStore.js";
import assetReviewStatus from "../../../../docs/asset-review.md?raw";
import { collectionQuery } from "../../api/client.js";
import type { ContentRow } from "../../model/contracts.js";
import { contentRows } from "../../model/rows.js";
import { titleCase } from "../../model/summaries.js";
import { viewerSource } from "../../model/viewerSource.js";
import { creatureBodies } from "../../model/creatureArt.js";
import { ModelPreview, ModelStage, ReviewArtLink, TabbedSections } from "../../ui/EntitySummary.js";
import { Facts, Field, RefField, ReferencedBy, Section, Sheet, Static } from "../../ui/field/index.js";
import { EmptyState, ErrorState, LoadingRows } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import type { ViewProps } from "../types.js";
import { asRecord, num, RecordShell, strings, text } from "../story/shared.js";
import { useCreatureData } from "../creatures/shared.js";
import { Badge, Button, NativeSelect, Segmented, SearchInput } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
import { COUNT, EMPTY, PAGE as PAGE_FRAME, RAIL_BLOCK, TOOLBAR } from "../../ui/layout.js";
import { TileGrid, tileArtClasses, tileClasses, tileSubtitleClasses, tileTitleClasses } from "../../ui/RecordTile.js";

interface Asset extends ContentRow { id: string; file?: string; pack?: string; category?: string; is?: string; tags?: string[]; bytes?: number; size?: { x: number; y: number; z: number }; animations?: string[]; materials?: string[]; procedural?: boolean; itemId?: string; origin?: "server" }

/**
 * The asset catalog with the live server's own models over it by id (`viewer/registry.ts` reads its
 * overlay), each marked `origin: "server"`. In the repository an upload is part of the manifest.
 */
function useAssetRows() {
  const query = useQuery(collectionQuery("assets"));
  const overlay = useSyncExternalStore(subscribeServerModels, serverModels);
  const rows = useMemo(() => {
    const host = (query.data ? contentRows(query.data) : []) as Asset[];
    if (!overlay.length) return host;
    const own = new Map(overlay.map(entry => [entry.id, { ...entry, origin: "server" as const } as unknown as Asset]));
    return [...host.map(row => own.get(row.id) ?? row), ...[...own.values()].filter(row => !host.some(other => other.id === row.id))];
  }, [query.data, overlay]);
  return { query, rows };
}

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
  return <details className="mb-2 rounded-md border border-border bg-card px-3 py-2.5">
    <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
      <span className="font-semibold">Tripo progress</span>
      <span className="text-[11px] text-faint">{TRIPO_STATUS.rows.length} tracked records across {groups.length} status groups{TRIPO_STATUS.updated ? ` · updated ${TRIPO_STATUS.updated}` : ""}</span>
    </summary>
    <div className="grid grid-cols-1 gap-3 pt-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {groups.map(group => {
        const rows = <ul className="space-y-1.5 [overflow-wrap:anywhere]">
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
  </details>;
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
  const { query, rows } = useAssetRows();
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [pack, setPack] = useState("");
  const [view, setView] = useState<"grid" | "list">(readView);
  const [limit, setLimit] = useState(PAGE);
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
    return <div role="button" tabIndex={0} className={tileClasses({ row: list })} key={row.id} data-id={row.id} onClick={() => open(row.id)} onKeyDown={event => { if (event.key === "Enter") open(row.id); }}>
      <span className={tileArtClasses(list)}><AssetArt asset={row} list={list} /></span>
      <span className={cn("flex min-w-0", list ? "flex-1 flex-row items-center gap-2" : "flex-col gap-0.5")}>
        <span className={cn(tileTitleClasses(list), list && "min-w-50")} title={row.id}>{titleCase(row.id)}</span>
        <Facts className={cn(tileSubtitleClasses(list), "flex-nowrap", list && "flex-none")} items={[row.origin === "server" && <ServerMark key="origin" />, titleCase(categoryOf(row)), text(row.pack)]} />
        {list && <span className={cn(tileSubtitleClasses(list), "font-mono text-faint")}>{text(row.file) ?? ""}</span>}
      </span>
    </div>;
  });
  return <div className={PAGE_FRAME}>
    <TripoProgress />
    {uploading && <ModelUpload onClose={() => setUploading(false)} onSaved={entry => { setUploading(false); open(entry.id); }} />}
    <div className={TOOLBAR}>
      <SearchInput label="Search models" shortcut placeholder="Search id, file, tag…" value={search} onChange={setSearch} onEnter={() => { const first = filtered[0]; if (first) open(first.id); }} />
      <span className={COUNT}>{filtered.length === rows.length ? rows.length : `${filtered.length} of ${rows.length}`}</span>
      {can("files") && !uploading && <Button variant="secondary" size="xs" onClick={() => setUploading(true)}><UploadCloud />Upload model</Button>}
      {import.meta.env.DEV && <Button asChild variant="secondary" size="xs" title="Start npm run assets:review, then inspect current and staged models">
        <a href="http://127.0.0.1:4186/review/" target="_blank" rel="noreferrer"><ExternalLink />Asset review</a>
      </Button>}
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

/**
 * A gallery tile's picture: an item's generated icon, else the model's rendered thumbnail (the same
 * renders the bestiary shows), else a plain tile that says so in words.
 */
function AssetArt({ asset, list }: { asset: Asset; list: boolean }) {
  if (asset.itemId) return <Thumb spec={{ kind: "item", id: String(asset.itemId) }} size={list ? "m" : "xl"} alt="" />;
  const words = list ? "" : categoryOf(asset) === "animation" ? "Clips only" : "No render yet";
  return <ModelPreview assetId={asset.id} text={words} className="size-full rounded-none border-0 bg-transparent" />;
}

function categoryOf(row: Asset): string { return text(row.category) ?? (row.procedural ? "weapon" : "prop"); }

function count(values: readonly string[]): [string, number][] {
  const totals = new Map<string, number>();
  for (const value of values) totals.set(value, (totals.get(value) ?? 0) + 1);
  return [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/* ---------- Record ---------- */

const NAMES = "grid list-none grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-x-4 gap-y-0.5 font-mono text-xs";
const NAME = "min-h-[22px] min-w-0 truncate leading-[22px] text-muted-foreground";

/** Assets are read-only here: the page reads the collection, it does not open a draft. */
function ModelPage({ id, navigate }: { id: string; navigate: ViewProps["navigate"] }) {
  const { query, rows } = useAssetRows();
  const creatures = useCreatureData();
  const asset = useMemo(() => rows.find(row => String(row.id) === id), [rows, id]);
  const [replacing, setReplacing] = useState(false);
  // Creatures that wear this model: a character body is reviewed in the art workspace.
  const wearers = useMemo(() => creatureBodies(creatures.creatures).find(body => body.assetId === id)?.looks ?? [], [creatures.creatures, id]);
  if (query.isPending) return <div className={PAGE_FRAME}><LoadingRows /></div>;
  if (query.isError) return <ErrorState message={query.error.message} retry={() => void query.refetch()} />;
  if (!asset) return <EmptyState title="Model not found">This id is not in the asset catalog. <Button variant="link" size="inline" onClick={() => navigate("assets")}>Back to the gallery</Button></EmptyState>;

  const source = viewerSource("assets", asset);
  const size = asRecord(asset.size);
  const animations = strings(asset.animations);
  const materials = strings(asset.materials);
  const tags = strings(asset.tags);
  const rail = source || wearers.length ? <>
    {source && <ModelStage source={source} label={titleCase(id)} />}
    {wearers.length > 0 && <ReviewArtLink route="art/creatures" id={id} collection="assets" navigate={navigate} detail={`worn by ${wearers.length} ${wearers.length === 1 ? "creature" : "creatures"}`} />}
    {wearers.length > 0 && <section className={RAIL_BLOCK}>
      <h3>Worn by</h3>
      <div className="flex flex-wrap gap-1">
        {wearers.slice(0, 24).map(look => <Button key={look.creatureId} variant="chip" size="xs" title={look.creatureId} onClick={() => navigate("creatures/bestiary", look.creatureId)}>{look.name}<small className="font-mono text-faint">{wearers.filter(other => other.name === look.name).length > 1 ? look.creatureId : look.level}</small></Button>)}
        {wearers.length > 24 && <span className={EMPTY}>{wearers.length - 24} more</span>}
      </div>
    </section>}
  </> : undefined;
  return <RecordShell
    thumb={asset.itemId ? { kind: "item", id: asset.itemId } : undefined}
    title={titleCase(id)} id={id} rail={rail}
    facts={[asset.origin === "server" && <ServerMark key="origin" />, titleCase(categoryOf(asset)), text(asset.pack), animations.length > 0 && `${animations.length} animation${animations.length === 1 ? "" : "s"}`]}>
    {asset.origin === "server" && (replacing
      ? <ModelUpload replacing={asset as unknown as AssetEntry} onClose={() => setReplacing(false)} onSaved={() => setReplacing(false)} />
      : <ServerModelActions id={id} onReplace={() => setReplacing(true)} onRemoved={() => navigate("assets")} />)}
    <Sheet>
      <Section title="File">
        <Field label="File"><Static mono>{text(asset.file) ?? "—"}</Static></Field>
        <Field label="Pack"><Static>{text(asset.pack) ?? "—"}</Static></Field>
        <Field label="Category"><Static>{titleCase(categoryOf(asset))}{text(asset.is) && text(asset.is) !== asset.category && <span className="text-faint"> · {String(asset.is)}</span>}</Static></Field>
        <Field label="Bytes"><Static mono>{num(asset.bytes) !== undefined ? `${Math.round(num(asset.bytes)! / 1024).toLocaleString()} KB` : "—"}</Static></Field>
        <Field label="Size" unit="m"><Static mono>{num(size.x) !== undefined ? `${fmtM(size.x)} × ${fmtM(size.y)} × ${fmtM(size.z)} m` : "—"}</Static></Field>
        {asset.itemId && <RefField kind="item" label="Item" value={String(asset.itemId)} onChange={() => undefined} readOnly />}
      </Section>
      <TabbedSections scope="model" label="Model sections" sections={[
        { tab: { key: "animations", label: "Animations", count: animations.length }, render: bar => <Section title={bar}>{animations.length ? <ul className={NAMES}>{animations.map(name => <li key={name} className={NAME} title={name}>{name}</li>)}</ul> : <span className={EMPTY}>No animation clips.</span>}</Section> },
        { tab: { key: "materials", label: "Materials", count: materials.length }, render: bar => <Section title={bar}>{materials.length ? <ul className={NAMES}>{materials.map(name => <li key={name} className={NAME} title={name}>{name}</li>)}</ul> : <span className={EMPTY}>No named materials.</span>}</Section> },
        { tab: { key: "tags", label: "Tags", count: tags.length }, render: bar => <Section title={bar}><Static>{tags.length ? tags.join(", ") : <span className="text-faint">No tags</span>}</Static></Section> },
        { tab: { key: "references", label: "Used by" }, render: bar => <Section title={bar}><ReferencedBy collection="assets" id={id} navigate={navigate} title="Used by" /></Section> },
      ]} />
    </Sheet>
  </RecordShell>;
}

function ServerMark() {
  return <Badge variant="info" className="h-4 gap-0.5 px-1 text-[10px]" title="Added on this server; not part of the base game"><Server size={9} />Server</Badge>;
}

/** Replace or remove a model this server added. Removing waits until no content names it. */
function ServerModelActions({ id, onReplace, onRemoved }: { id: string; onReplace(): void; onRemoved(): void }) {
  const queryClient = useQueryClient();
  const { index, loading } = useReferenceIndex();
  const users = useMemo(() => incomingReferences(index, "assets", id), [index, id]);
  const [removing, setRemoving] = useState(false);
  const blocked = loading ? "Checking what uses this model…" : users.length ? `Used by ${users.length} record${users.length === 1 ? "" : "s"}: ${users.slice(0, 3).map(user => user.recordId).join(", ")}${users.length > 3 ? "…" : ""}. Point them at another model first.` : undefined;
  async function remove() {
    setRemoving(true);
    try {
      await removeModel(id);
      await queryClient.invalidateQueries({ queryKey: ["collection", "assets"] });
      toast.success(`Removed ${id}`); onRemoved();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setRemoving(false); }
  }
  return <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs" data-role="server-model">
    <Server size={13} className="text-muted-foreground" />
    <span className="text-muted-foreground">This server added this model. Players load it from the server after joining.</span>
    <span className="ml-auto flex gap-1">
      {can("files") && <Button variant="secondary" size="xs" onClick={onReplace}><UploadCloud />Replace</Button>}
      {can("files") && <Button variant="destructive" size="xs" disabled={Boolean(blocked) || removing} title={blocked} onClick={() => void remove()}><Trash2 />{removing ? "Removing…" : "Remove"}</Button>}
    </span>
    {blocked && !loading && <span className="basis-full text-[11px] text-warn">{blocked}</span>}
  </div>;
}

const fmtM = (value: unknown): string => num(value) !== undefined ? String(Math.round(num(value)! * 100) / 100) : "?";


