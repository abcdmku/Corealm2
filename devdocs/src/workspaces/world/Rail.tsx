import { memo, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { LAYER_ICON, glyphColor, glyphIcon } from "./glyphs.js";
import { LAYERS, LAYER_LABEL, type Bounds, type Feature, type Layer } from "./model.js";

/*
  The left rail: search, layer toggles with counts, and the list of what is in view (or what
  matches the search anywhere), grouped by layer. Capped so the DOM stays light while panning.
*/

const PAGE = 60;
/** Wider than this and the view holds too much to list; the search box is the way in. */
const LIST_SPAN = 700;

export const Rail = memo(function Rail({ features, counts, layers, onToggleLayer, search, onSearch, viewBounds, selectedKey, onPick }: {
  features: readonly Feature[];
  counts: Record<Layer, number>;
  layers: Record<Layer, boolean>;
  onToggleLayer: (layer: Layer) => void;
  search: string;
  onSearch: (value: string) => void;
  viewBounds: Bounds | undefined;
  selectedKey: string | undefined;
  onPick: (feature: Feature) => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Partial<Record<Layer, boolean>>>({});
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
  const groups: { layer: Layer; rows: Feature[] }[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last && last.layer === row.layer) last.rows.push(row); else groups.push({ layer: row.layer, rows: [row] });
  }
  const isOpen = (layer: Layer) => open[layer] ?? (Boolean(needle) || layer === selectedLayer || groups.length === 1);

  return <aside className="world-rail world-rail-left">
    <div className="world-rail-tools">
      <label className="search-field" style={{ width: "100%" }}>
        <Search size={13} />
        <input value={search} onChange={event => { onSearch(event.target.value); setLimit(PAGE); }} placeholder="Search the world" aria-label="Search the world" />
        {search && <button type="button" className="icon-button" aria-label="Clear search" onClick={() => onSearch("")}><X size={12} /></button>}
      </label>
      <div className="world-layers" role="group" aria-label="Layers">
        {LAYERS.map(layer => { const Icon = LAYER_ICON[layer]; return <button type="button" key={layer} className={`world-layer${layers[layer] ? " is-active" : ""}`} aria-pressed={layers[layer]} title={LAYER_LABEL[layer]} onClick={() => onToggleLayer(layer)}>
          <Icon size={12} /><span>{LAYER_LABEL[layer]}</span><small>{counts[layer]}</small>
        </button>; })}
      </div>
    </div>
    <div className="world-list" role="list">
      {groups.map(group => <section key={group.layer} className={`world-group${isOpen(group.layer) ? "" : " is-folded"}`}>
        <h3><button type="button" aria-expanded={isOpen(group.layer)} onClick={() => setOpen(current => ({ ...current, [group.layer]: !isOpen(group.layer) }))}>{LAYER_LABEL[group.layer]}<small>{group.rows.length}</small></button></h3>
        {isOpen(group.layer) && group.rows.slice(0, limit).map(feature => <ListRow key={feature.key} feature={feature} selected={feature.key === selectedKey} onPick={onPick} />)}
        {isOpen(group.layer) && group.rows.length > limit && <button type="button" className="button button-small world-more" onClick={() => setLimit(limit + PAGE)}>Show more · {group.rows.length - limit} hidden</button>}
      </section>)}
      {!rows.length && <p className="world-empty">{needle ? "Nothing matches." : zoomedOut ? "Zoom in, pick a region, or search to list what is here." : "Nothing in view with these layers on."}</p>}
    </div>
  </aside>;
});

const ListRow = memo(function ListRow({ feature, selected, onPick }: { feature: Feature; selected: boolean; onPick: (feature: Feature) => void }) {
  const Icon = glyphIcon(feature);
  return <button type="button" role="listitem" className={`world-row${selected ? " is-selected" : ""}`} data-key={feature.key} onClick={() => onPick(feature)} title={feature.key}>
    <span className="world-row-glyph" style={{ background: glyphColor(feature, 40) }}><Icon size={11} /></span>
    <span className="world-row-name">{feature.name}</span>
    <span className="world-row-fact">{feature.fact}</span>
  </button>;
});
