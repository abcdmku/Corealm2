import { memo, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { GLYPH_DISC, LAYER_ICON, glyphColor, glyphIcon } from "./glyphs.js";
import { LAYERS, LAYER_LABEL, type Bounds, type Feature, type Layer } from "./model.js";
import { Button, SearchInput } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";

/*
  The left rail: search, layer toggles with counts, and the list of what is in view (or what
  matches the search anywhere), grouped by layer. Spawns and resource nodes are listed once per
  creature or resource with their places underneath, so a frog that spawns in four fields is one
  line, not four. Capped so the DOM stays light while panning.
*/

/** A list entry: a feature on its own, or one creature/resource with every place it appears. */
type Entry = { key: string; feature: Feature; members?: undefined } | { key: string; feature: Feature; members: Feature[] };

function clusters(rows: readonly Feature[]): Entry[] {
  const out: Entry[] = [];
  const byGroup = new Map<string, Entry & { members: Feature[] }>();
  for (const feature of rows) {
    if (!feature.group) { out.push({ key: feature.key, feature }); continue; }
    const key = `${feature.layer}:${feature.group.key}`;
    const existing = byGroup.get(key);
    if (existing) { existing.members.push(feature); continue; }
    const entry = { key, feature, members: [feature] };
    byGroup.set(key, entry); out.push(entry);
  }
  return out;
}

/** The place a member is, without repeating the creature or resource it is. */
function placeFact(feature: Feature): string {
  const name = feature.group?.name ?? "";
  return feature.fact.startsWith(name) ? feature.fact.slice(name.length).replace(/^[\s·]+/, "") : feature.fact;
}

const PAGE = 60;
/** Wider than this and the view holds too much to list; the search box is the way in. */
const LIST_SPAN = 700;

export const Rail = memo(function Rail({ features, counts, layers, onToggleLayer, search, onSearch, viewBounds, selectedKey, onPick, onShowAll }: {
  features: readonly Feature[];
  counts: Record<Layer, number>;
  layers: Record<Layer, boolean>;
  onToggleLayer: (layer: Layer) => void;
  search: string;
  onSearch: (value: string) => void;
  viewBounds: Bounds | undefined;
  selectedKey: string | undefined;
  onPick: (feature: Feature) => void;
  onShowAll: (members: readonly Feature[]) => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Partial<Record<Layer, boolean>>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const selectedLayer = selectedKey ? features.find(feature => feature.key === selectedKey)?.layer : undefined;
  const needle = search.trim().toLowerCase();
  const zoomedOut = !needle && viewBounds !== undefined && (viewBounds.maxX - viewBounds.minX) > LIST_SPAN;
  const rows = useMemo(() => {
    if (zoomedOut) return [] as Feature[];
    const matching = features.filter(feature => {
      if (feature.layer === "regions" && !needle) return false;
      if (!layers[feature.layer]) return false;
      if (needle) return `${feature.name} ${feature.fact} ${feature.key}`.toLowerCase().includes(needle);
      if (!viewBounds) return true;
      return feature.x >= viewBounds.minX && feature.x <= viewBounds.maxX && feature.z >= viewBounds.minZ && feature.z <= viewBounds.maxZ;
    });
    const order = new Map(LAYERS.map((layer, index) => [layer, index]));
    return matching.sort((a, b) => (order.get(a.layer)! - order.get(b.layer)!) || a.name.localeCompare(b.name));
  }, [features, layers, needle, viewBounds, zoomedOut]);
  const groups: { layer: Layer; rows: Entry[] }[] = [];
  for (const entry of clusters(rows)) {
    const last = groups.at(-1);
    if (last && last.layer === entry.feature.layer) last.rows.push(entry); else groups.push({ layer: entry.feature.layer, rows: [entry] });
  }
  const isOpen = (layer: Layer) => open[layer] ?? (Boolean(needle) || layer === selectedLayer || groups.length === 1);
  // Different creature definitions can share a display name; those entries carry their id so the reader can tell them apart.
  const ambiguous = new Set<string>();
  for (const group of groups) {
    const byName = new Map<string, Entry[]>();
    for (const entry of group.rows) if (entry.members) { const list = byName.get(entry.feature.group!.name) ?? []; list.push(entry); byName.set(entry.feature.group!.name, list); }
    for (const list of byName.values()) if (list.length > 1) for (const entry of list) ambiguous.add(entry.key);
  }

  return <aside className="flex min-h-0 min-w-0 flex-col border-r border-border bg-card text-xs">
    <div className="flex flex-col gap-2 border-b border-border-subtle px-2.5 pt-2.5 pb-2">
      <SearchInput className="w-full" label="Search the world" placeholder="Search the world" value={search} onChange={value => { onSearch(value); setLimit(PAGE); }} onEnter={() => { if (rows[0]) onPick(rows[0]); }} />
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-0.5" role="group" aria-label="Layers">
        {LAYERS.map(layer => { const Icon = LAYER_ICON[layer]; const on = layers[layer]; return <button type="button" key={layer} aria-pressed={on} title={LAYER_LABEL[layer]} onClick={() => onToggleLayer(layer)} className={cn(
          "flex h-6 cursor-pointer items-center gap-1 rounded-sm border px-1 text-left text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring",
          on ? "border-border-subtle bg-secondary text-foreground" : "border-transparent text-faint hover:bg-accent hover:text-foreground",
        )}>
          <Icon size={12} className={cn("shrink-0", on && "text-primary")} /><span className="min-w-0 flex-1 truncate">{LAYER_LABEL[layer]}</span><small className="font-mono text-[11px] text-faint">{counts[layer]}</small>
        </button>; })}
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pt-1 pb-3 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]" role="list">
      {groups.map(group => { const folded = !isOpen(group.layer); return <section key={group.layer}>
        <h3 className="sticky top-0 z-[1] bg-card pt-1 pb-0.5">
          <button type="button" className="flex h-6 w-full cursor-pointer items-center gap-1.5 rounded-sm px-1.5 text-left text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground" aria-expanded={!folded} onClick={() => setOpen(current => ({ ...current, [group.layer]: folded }))}>
            <ChevronDown className={cn("size-3 shrink-0 text-faint transition-transform", folded && "-rotate-90")} />{LAYER_LABEL[group.layer]}<small className="ml-auto font-mono text-[11px] font-normal text-faint">{group.rows.length}</small>
          </button>
        </h3>
        {!folded && group.rows.slice(0, limit).map(entry => entry.members
          ? <Cluster key={entry.key} name={entry.feature.group!.name} id={ambiguous.has(entry.key) ? entry.feature.group!.key : undefined} members={entry.members} selectedKey={selectedKey} onPick={onPick} onShowAll={onShowAll}
              expanded={expanded[entry.key] ?? entry.members.some(member => member.key === selectedKey)} onToggle={() => setExpanded(current => ({ ...current, [entry.key]: !(current[entry.key] ?? entry.members.some(member => member.key === selectedKey)) }))} />
          : <FeatureRow key={entry.key} feature={entry.feature} selected={entry.feature.key === selectedKey} onPick={onPick} />)}
        {!folded && group.rows.length > limit && <Button variant="secondary" size="sm" className="mx-1.5 my-2 w-[calc(100%-0.75rem)]" onClick={() => setLimit(limit + PAGE)}>Show more · {group.rows.length - limit} hidden</Button>}
      </section>; })}
      {!rows.length && <p className="px-3 py-6 text-center text-xs text-faint">{needle ? "Nothing matches." : zoomedOut ? "Zoom in, pick a region, or search to list what is here." : "Nothing in view with these layers on."}</p>}
    </div>
  </aside>;
});

/** A list line: glyph, then the name over one line of facts. The selected line carries the selection fill. */
const ROW = "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm border px-1.5 py-[3px] text-left outline-none focus-visible:ring-1 focus-visible:ring-ring";
const rowState = (selected: boolean) => selected ? "border-border bg-selected" : "border-transparent hover:bg-accent";
const NAME = "truncate text-xs font-medium";
const FACT = "truncate text-[11px] text-faint";

/** One creature or resource and everywhere it is. A single place opens directly; more fold under the name. */
const Cluster = memo(function Cluster({ name, id, members, selectedKey, expanded, onToggle, onPick, onShowAll }: { name: string; id?: string; members: Feature[]; selectedKey: string | undefined; expanded: boolean; onToggle: () => void; onPick: (feature: Feature) => void; onShowAll: (members: readonly Feature[]) => void }) {
  const first = members[0]!;
  const Icon = glyphIcon(first);
  const inside = members.some(member => member.key === selectedKey);
  const single = members.length === 1;
  const regions = [...new Set(members.map(member => member.fact.split(" · ").at(-1)))];
  const noun = first.layer === "spawns" ? "spawns" : "nodes";
  const fact = single ? placeFact(first) : `${members.length} ${noun} · ${regions.length > 2 ? `${regions.length} regions` : regions.join(", ")}`;
  return <div>
    <div className="flex items-stretch" role="listitem" data-key={single ? first.key : undefined}>
      {single
        ? <span className="w-3 shrink-0" />
        : <button type="button" className="grid w-3 shrink-0 cursor-pointer place-items-center rounded-sm text-faint hover:bg-accent hover:text-foreground" aria-label={`${expanded ? "Fold" : "Unfold"} ${name}`} aria-expanded={expanded} onClick={onToggle}>
          <ChevronDown className={cn("size-3 transition-transform", !expanded && "-rotate-90")} />
        </button>}
      <button type="button" className={cn(ROW, rowState(single && inside))} title={single ? first.key : `Show every ${name} ${first.layer === "spawns" ? "spawn" : "node"}`} onClick={() => { if (single) { onPick(first); return; } onShowAll(members); if (!expanded) onToggle(); }}>
        <span className={GLYPH_DISC} style={{ background: glyphColor(first, 40) }}><Icon size={11} /></span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn(NAME, inside && "text-primary")}>{name}</span>
          <span className={FACT}>{id && <span className="font-mono text-[10px]">{id} · </span>}{fact}</span>
        </span>
      </button>
    </div>
    {expanded && !single && <div className="flex flex-col pl-[38px]">
      {members.map(member => <button type="button" role="listitem" key={member.key} className={cn(ROW, rowState(member.key === selectedKey), "py-0.5")} data-key={member.key} onClick={() => onPick(member)} title={member.key}>
        <span className="truncate text-xs">{placeFact(member)}</span>
      </button>)}
    </div>}
  </div>;
});

const FeatureRow = memo(function FeatureRow({ feature, selected, onPick }: { feature: Feature; selected: boolean; onPick: (feature: Feature) => void }) {
  const Icon = glyphIcon(feature);
  return <button type="button" role="listitem" className={cn(ROW, rowState(selected))} data-key={feature.key} onClick={() => onPick(feature)} title={feature.key}>
    <span className={GLYPH_DISC} style={{ background: glyphColor(feature, 40) }}><Icon size={11} /></span>
    <span className="flex min-w-0 flex-1 flex-col">
      <span className={NAME}>{feature.name}</span>
      <span className={FACT}>{feature.fact}</span>
    </span>
  </button>;
});
