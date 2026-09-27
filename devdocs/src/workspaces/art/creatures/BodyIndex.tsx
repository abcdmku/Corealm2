import { Button, NativeSelect, SearchInput, Segmented } from "../../../components/ui/index.js";
import { ART_VERDICT_LABEL, useArtDigest, type ArtSummary } from "../../../model/artReview.js";
import { VerdictDot } from "../../../ui/FocusLayout.js";
import { COUNT, EMPTY } from "../../../ui/layout.js";
import { LoadingRows } from "../../../ui/States.js";
import { CreatureArt } from "./CreatureArt.js";
import type { Region } from "../../creatures/shared.js";
import type { BodyEntry, BodyFilters, SortBy, VerdictFilter } from "./model.js";

const VERDICT_FILTERS: readonly { value: VerdictFilter; label: string }[] = [
  { value: "all", label: "All" }, { value: "unreviewed", label: "Unreviewed" },
  { value: "approved", label: ART_VERDICT_LABEL.approved }, { value: "polish", label: ART_VERDICT_LABEL.polish }, { value: "replace", label: ART_VERDICT_LABEL.replace },
];
const SORTS: readonly { value: SortBy; label: string }[] = [{ value: "level", label: "Level" }, { value: "name", label: "Name" }, { value: "verdict", label: "Verdict" }];

/** The contact sheet: every body as a tile, with its own verdict and its variants' verdicts. */
export function BodyIndex({ entries, total, regions, filters, setFilters, loading, open }: {
  entries: readonly BodyEntry[];
  total: number;
  regions: readonly Region[];
  filters: BodyFilters;
  setFilters: (next: BodyFilters) => void;
  loading: boolean;
  open: (assetId: string) => void;
}) {
  const bodies = useArtDigest("assets").data;
  const variants = useArtDigest("creatureDefinitions").data;
  const set = (patch: Partial<BodyFilters>) => setFilters({ ...filters, ...patch });
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2">
      <SearchInput label="Search creature bodies" shortcut placeholder="Name, id, family, asset…" value={filters.search} onChange={search => set({ search })}
        onEnter={() => { const first = entries[0]; if (first) open(first.assetId); }} />
      <Segmented aria-label="Verdict">{VERDICT_FILTERS.map(option => <Button key={option.value} variant="segment" size="xs" aria-pressed={filters.verdict === option.value} onClick={() => set({ verdict: option.value })}>{option.label}</Button>)}</Segmented>
      <NativeSelect className="h-7 text-xs" aria-label="Region" value={filters.region} onChange={event => set({ region: event.target.value })}>
        <option value="">Every region</option>
        {regions.map(region => <option key={region.id} value={region.id}>{region.name}</option>)}
      </NativeSelect>
      <Segmented aria-label="Sort">{SORTS.map(option => <Button key={option.value} variant="segment" size="xs" aria-pressed={filters.sort === option.value} onClick={() => set({ sort: option.value })}>{option.label}</Button>)}</Segmented>
      <span className={COUNT}>{loading && !total ? "" : `${entries.length} of ${total} bodies`}</span>
    </div>
    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3">
      {loading && !total && <LoadingRows />}
      {!loading && !entries.length && <p className={EMPTY}>No bodies match.</p>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-1.5">
        {entries.map(entry => <BodyTile key={entry.assetId} entry={entry} verdict={bodies.get(entry.assetId)} variants={variants} open={open} />)}
      </div>
    </div>
  </div>;
}

function BodyTile({ entry, verdict, variants, open }: { entry: BodyEntry; verdict: ArtSummary | undefined; variants: ReadonlyMap<string, ArtSummary>; open: (assetId: string) => void }) {
  const looks = entry.body.looks;
  return <button type="button" className="group flex min-w-0 cursor-pointer flex-col gap-1 rounded-md border border-border-subtle bg-card p-1.5 text-left outline-none hover:border-faint hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/40"
    data-asset-id={entry.assetId} title={`${entry.name} · ${entry.assetId}`} onClick={() => open(entry.assetId)}>
    <span className="relative grid aspect-square w-full place-items-center overflow-hidden rounded-sm bg-art">
      <CreatureArt creatureId={entry.leadId} className="size-full" />
      <span className="absolute top-1 right-1 flex items-center rounded-full bg-background/70 p-[3px]"><BodyVerdict summary={verdict} /></span>
    </span>
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-xs leading-tight font-semibold text-foreground">{entry.name}</span>
      <span className="truncate text-[11px] text-faint">Level {entry.level} · {looks.length} {looks.length === 1 ? "variant" : "variants"}</span>
      {entry.nameRepeats && <code className="truncate font-mono text-[10px] text-faint">{entry.assetId}</code>}
    </span>
    {looks.length > 1 && <span className="flex min-h-1.5 flex-wrap items-center gap-[3px]" aria-label="Variant verdicts">
      {looks.slice(0, 24).map(look => { const summary = variants.get(look.creatureId); return <span key={look.creatureId} title={look.creatureId}>{summary?.verdict ? <VerdictDot verdict={summary.verdict} /> : <Unreviewed />}</span>; })}
      {looks.length > 24 && <span className="text-[10px] leading-none text-faint">+{looks.length - 24}</span>}
    </span>}
  </button>;
}

/** A body's verdict, or a hollow dot while nobody has reviewed it. */
export function BodyVerdict({ summary }: { summary: ArtSummary | undefined }) {
  return summary?.verdict ? <VerdictDot verdict={summary.verdict} /> : <Unreviewed />;
}

export function Unreviewed() {
  return <span className="inline-block size-1.5 shrink-0 rounded-full border border-faint" role="img" aria-label="Unreviewed" title="Unreviewed" />;
}
