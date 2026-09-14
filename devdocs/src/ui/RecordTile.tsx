import { useState, type MouseEvent } from "react";
import { ChevronRight } from "lucide-react";
import type { RecordSummary } from "../model/summaries.js";
import { HoverCard } from "./RefChip.js";
import { Thumb } from "./Thumb.js";

export function Badges({ badges, limit = 3 }: { badges: RecordSummary["badges"]; limit?: number }) {
  if (!badges.length) return null;
  return <span className="tile-badges">{badges.slice(0, limit).map((badge, index) => <span key={index} className={`badge${badge.mono ? " badge-mono" : ""}`} data-tone={badge.tone} title={badge.title}>{badge.text}</span>)}</span>;
}

/** A record as a card (grid) or a compact row (list). Selection is a corner checkbox. */
export function RecordTile({ collection, id, summary, mode, selectable, selected, active, onToggle, onOpen, generated, hoverCard = false }: {
  collection: string;
  id: string;
  summary: RecordSummary;
  mode: "grid" | "row";
  selectable?: boolean;
  selected?: boolean;
  active?: boolean;
  onToggle?: (id: string, shiftKey: boolean) => void;
  onOpen: (id: string) => void;
  generated?: boolean;
  hoverCard?: boolean;
}) {
  const [hover, setHover] = useState<{ x: number; y: number }>();
  function click(event: MouseEvent) {
    if (selectable && (event.ctrlKey || event.metaKey)) { event.preventDefault(); onToggle?.(id, event.shiftKey); return; }
    onOpen(id);
  }
  return <>
    <div role="button" tabIndex={0} className={`tile${mode === "row" ? " tile-row" : ""}${selected ? " is-selected" : ""}${active ? " is-active" : ""}`} data-id={id} onClick={click}
      onKeyDown={event => { if (event.key === "Enter") onOpen(id); if (event.key === " " && selectable) { event.preventDefault(); onToggle?.(id, event.shiftKey); } }}
      onMouseEnter={event => hoverCard && setHover({ x: event.clientX, y: event.clientY })}
      onMouseMove={event => hover && setHover({ x: event.clientX, y: event.clientY })}
      onMouseLeave={() => setHover(undefined)}>
      {selectable && mode === "grid" && <span className="tile-corner"><input type="checkbox" className="tile-check" checked={Boolean(selected)} aria-label={`Select ${summary.title}`} onClick={event => event.stopPropagation()} onChange={event => onToggle?.(id, (event.nativeEvent as unknown as { shiftKey?: boolean }).shiftKey ?? false)} /></span>}
      {mode === "grid" && summary.tier !== undefined && <span className="tile-corner-right"><span className="tier-tag" title="Tier">{summary.tier}</span></span>}
      {selectable && mode === "row" && <input type="checkbox" className="tile-check" checked={Boolean(selected)} aria-label={`Select ${summary.title}`} onClick={event => event.stopPropagation()} onChange={event => onToggle?.(id, (event.nativeEvent as unknown as { shiftKey?: boolean }).shiftKey ?? false)} />}
      <span className="tile-art"><Thumb spec={summary.thumb} size={mode === "grid" ? "xl" : "m"} alt="" /></span>
      <span className="tile-body">
        <span className="tile-title" title={`${summary.title} · ${id}`}>{summary.title}</span>
        {summary.subtitle && <span className="tile-subtitle" title={summary.subtitle}>{summary.subtitle}</span>}
        <Badges badges={generated ? [{ text: "Generated", tone: "warn" }, ...summary.badges] : summary.badges} limit={mode === "grid" ? 2 : 4} />
      </span>
      {mode === "row" && summary.tier !== undefined && <span className="tier-tag" title="Tier">{summary.tier}</span>}
      {mode === "row" && <ChevronRight size={14} className="row-chevron" />}
    </div>
    {hover && <HoverCard summary={summary} collection={collection} id={id} at={hover} />}
  </>;
}
