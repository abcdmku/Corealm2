import { memo, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { LAYER_ICON, glyphColor, glyphIcon } from "./glyphs.js";
import { LAYERS, LAYER_LABEL, type Bounds, type Feature, type Layer } from "./model.js";
import { Button, InputGroup, InputGroupAddon, InputGroupInput } from "../../components/ui/index.js";

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

  return <aside className="world-rail world-rail-left">
    <div className="world-rail-tools">
      <InputGroup className="w-full"><InputGroupAddon align="start"><Search /></InputGroupAddon><InputGroupInput value={search} onChange={event => { onSearch(event.target.value); setLimit(PAGE); }} placeholder="Search the world" aria-label="Search the world" />
        {search && <Button variant="ghost" size="icon-sm" aria-label="Clear search" onClick={() => onSearch("")}><X size={12} /></Button>}
      </InputGroup>
      <div className="world-layers" role="group" aria-label="Layers">
        {LAYERS.map(layer => { const Icon = LAYER_ICON[layer]; return <button type="button" key={layer} className={`world-layer${layers[layer] ? " is-active" : ""}`} aria-pressed={layers[layer]} title={LAYER_LABEL[layer]} onClick={() => onToggleLayer(layer)}>
          <Icon size={12} /><span>{LAYER_LABEL[layer]}</span><small>{counts[layer]}</small>
        </button>; })}
      </div>
    </div>
    <div className="world-list" role="list">
      {groups.map(group => <section key={group.layer} className={`world-group${isOpen(group.layer) ? "" : " is-folded"}`}>
        <h3><button type="button" aria-expanded={isOpen(group.layer)} onClick={() => setOpen(current => ({ ...current, [group.layer]: !isOpen(group.layer) }))}>{LAYER_LABEL[group.layer]}<small>{group.rows.length}</small></button></h3>
        {isOpen(group.layer) && group.rows.slice(0, limit).map(entry => entry.members
          ? <Cluster key={entry.key} name={entry.feature.group!.name} id={ambiguous.has(entry.key) ? entry.feature.group!.key : undefined} members={entry.members} selectedKey={selectedKey} onPick={onPick} onShowAll={onShowAll}
              expanded={expanded[entry.key] ?? entry.members.some(member => member.key === selectedKey)} onToggle={() => setExpanded(current => ({ ...current, [entry.key]: !(current[entry.key] ?? entry.members.some(member => member.key === selectedKey)) }))} />
          : <ListRow key={entry.key} feature={entry.feature} selected={entry.feature.key === selectedKey} onPick={onPick} />)}
        {isOpen(group.layer) && group.rows.length > limit && <Button variant="secondary" size="sm" className="world-more" onClick={() => setLimit(limit + PAGE)}>Show more · {group.rows.length - limit} hidden</Button>}
      </section>)}
      {!rows.length && <p className="world-empty">{needle ? "Nothing matches." : zoomedOut ? "Zoom in, pick a region, or search to list what is here." : "Nothing in view with these layers on."}</p>}
    </div>
  </aside>;
});

/** One creature or resource and everywhere it is. A single place opens directly; more fold under the name. */
const Cluster = memo(function Cluster({ name, id, members, selectedKey, expanded, onToggle, onPick, onShowAll }: { name: string; id?: string; members: Feature[]; selectedKey: string | undefined; expanded: boolean; onToggle: () => void; onPick: (feature: Feature) => void; onShowAll: (members: readonly Feature[]) => void }) {
  const first = members[0]!;
  const Icon = glyphIcon(first);
  const inside = members.some(member => member.key === selectedKey);
  const single = members.length === 1;
  const regions = [...new Set(members.map(member => member.fact.split(" · ").at(-1)))];
  const noun = first.layer === "spawns" ? "spawns" : "nodes";
  const fact = single ? placeFact(first) : `${members.length} ${noun} · ${regions.length > 2 ? `${regions.length} regions` : regions.join(", ")}`;
  return <div className={`world-cluster${expanded && !single ? " is-open" : ""}${inside ? " has-selected" : ""}`}>
    <div className={`world-row world-cluster-head${single && inside ? " is-selected" : ""}`} role="listitem" data-key={single ? first.key : undefined}>
      {single ? <span /> : <button type="button" className="world-cluster-toggle" aria-label={`${expanded ? "Fold" : "Unfold"} ${name}`} aria-expanded={expanded} onClick={onToggle} />}
      <span className="world-row-glyph" style={{ background: glyphColor(first, 40) }}><Icon size={11} /></span>
      <button type="button" className="world-cluster-name" title={single ? first.key : `Show every ${name} ${first.layer === "spawns" ? "spawn" : "node"}`} onClick={() => { if (single) { onPick(first); return; } onShowAll(members); if (!expanded) onToggle(); }}>
        <span className="world-row-name">{name}</span>
        <span className="world-row-fact">{id && <span className="world-row-id">{id} · </span>}{fact}</span>
      </button>
    </div>
    {expanded && !single && <div className="world-cluster-members">
      {members.map(member => <button type="button" role="listitem" key={member.key} className={`world-row world-row-member${member.key === selectedKey ? " is-selected" : ""}`} data-key={member.key} onClick={() => onPick(member)} title={member.key}>
        <span className="world-row-name">{placeFact(member)}</span>
      </button>)}
    </div>}
  </div>;
});

const ListRow = memo(function ListRow({ feature, selected, onPick }: { feature: Feature; selected: boolean; onPick: (feature: Feature) => void }) {
  const Icon = glyphIcon(feature);
  return <button type="button" role="listitem" className={`world-row${selected ? " is-selected" : ""}`} data-key={feature.key} onClick={() => onPick(feature)} title={feature.key}>
    <span className="world-row-glyph" style={{ background: glyphColor(feature, 40) }}><Icon size={11} /></span>
    <span className="world-row-name">{feature.name}</span>
    <span className="world-row-fact">{feature.fact}</span>
  </button>;
});
