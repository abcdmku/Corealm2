import { useState, type MouseEvent, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { RecordSummary } from "../model/summaries.js";
import { HoverCard } from "./RefChip.js";
import { Facts } from "./Sheet.js";
import { Thumb } from "./Thumb.js";
import { Badge, Checkbox } from "../components/ui/index.js";
import { toneVariant } from "../components/ui/badge.js";
import { cn } from "../lib/utils.js";

const STATE_TONES = new Set(["ok", "warn", "danger"]);

/** State badges stay badges; descriptive ones (slot, category, style) read as a line of facts. */
export function Badges({ badges, limit = 3 }: { badges: RecordSummary["badges"]; limit?: number }) {
  const state = badges.filter(badge => badge.tone && STATE_TONES.has(badge.tone) && badge.text !== "Generated").slice(0, limit);
  const facts = badges.filter(badge => !badge.tone || !STATE_TONES.has(badge.tone)).slice(0, limit);
  if (!state.length && !facts.length) return null;
  return <span className="mt-px flex flex-wrap items-center gap-[3px] text-[11px] [&_[data-slot=badge]]:h-4 [&_[data-slot=badge]]:px-1">
    {state.map((badge, index) => <Badge key={`s${index}`} variant={toneVariant(badge.tone)} className={badge.mono ? "font-mono" : undefined} title={badge.title}>{badge.text}</Badge>)}
    {facts.length > 0 && <Facts items={facts.map((badge, index) => <span key={index} title={badge.title}>{badge.text}</span>)} />}
  </span>;
}

/** The grid a page of tiles sits in. `compact` fits smaller art. */
export function TileGrid({ children, compact = false, className }: { children: ReactNode; compact?: boolean; className?: string }) {
  return <div className={cn("grid gap-1.5", compact ? "grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]", className)}>{children}</div>;
}

/** The recipe a tile is drawn with, for pages that lay out their own (the bestiary's creature cards). */
export const tileClasses = ({ row = false, selected = false, active = false, indent = false }: { row?: boolean; selected?: boolean; active?: boolean; indent?: boolean } = {}): string => cn(
  "tile group/tile relative flex min-w-0 cursor-pointer rounded-md border border-border-subtle bg-card text-left outline-none hover:border-faint hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/40",
  row ? "flex-row items-center gap-2 py-[3px] pr-2 pl-1" : "flex-col gap-1.5 p-[7px]",
  selected && "border-primary shadow-[inset_0_0_0_1px_var(--accent)]",
  active && "border-primary",
  indent && "ml-4",
);
export const tileArtClasses = (row = false): string => cn(
  "grid place-items-center overflow-hidden rounded-md bg-art [&_.thumb]:size-full [&_.thumb]:rounded-none [&_.thumb]:border-0 [&_.thumb]:bg-transparent",
  row ? "size-8 shrink-0" : "aspect-square [&_img]:size-[74%]!",
);
export const tileTitleClasses = (row = false): string => cn("truncate text-xs leading-tight font-semibold", row && "min-w-30 flex-[0_1_auto]");
export const tileSubtitleClasses = (row = false): string => cn("truncate text-[11px] text-muted-foreground", row && "flex-1");

/** A record as a card (grid) or a compact row (list). Selection is a corner checkbox. */
export function RecordTile({ collection, id, summary, mode, selectable, selected, active, onToggle, onOpen, hoverCard = false }: {
  collection: string;
  id: string;
  summary: RecordSummary;
  mode: "grid" | "row";
  selectable?: boolean;
  selected?: boolean;
  active?: boolean;
  onToggle?: (id: string, shiftKey: boolean) => void;
  onOpen: (id: string) => void;
  /** Kept for callers; generated rows are no longer marked. */
  generated?: boolean;
  hoverCard?: boolean;
}) {
  const [hover, setHover] = useState<{ x: number; y: number }>();
  const row = mode === "row";
  function click(event: MouseEvent) {
    if (selectable && (event.ctrlKey || event.metaKey)) { event.preventDefault(); onToggle?.(id, event.shiftKey); return; }
    onOpen(id);
  }
  const check = <Checkbox checked={Boolean(selected)} aria-label={`Select ${summary.title}`} onClick={event => { event.stopPropagation(); event.preventDefault(); onToggle?.(id, event.shiftKey); }} />;
  return <>
    <div role="button" tabIndex={0} className={tileClasses({ row, selected, active })} data-id={id} onClick={click}
      onKeyDown={event => { if (event.key === "Enter") onOpen(id); if (event.key === " " && selectable) { event.preventDefault(); onToggle?.(id, event.shiftKey); } }}
      onMouseEnter={event => hoverCard && setHover({ x: event.clientX, y: event.clientY })}
      onMouseMove={event => hover && setHover({ x: event.clientX, y: event.clientY })}
      onMouseLeave={() => setHover(undefined)}>
      {selectable && !row && <span className={cn("absolute top-1.5 left-1.5 z-10 flex gap-1 opacity-0 group-hover/tile:opacity-100", selected && "opacity-100")}>{check}</span>}
      {selectable && row && check}
      <span className={tileArtClasses(row)}><Thumb spec={summary.thumb} size={row ? "m" : "xl"} alt="" /></span>
      <span className={cn("flex min-w-0", row ? "flex-1 flex-row items-center gap-2" : "flex-col gap-0.5")}>
        <span className={tileTitleClasses(row)} title={`${summary.title} · ${id}`}>{summary.title}</span>
        {summary.subtitle && <span className={tileSubtitleClasses(row)} title={summary.subtitle}>{summary.subtitle}</span>}
        <Badges badges={summary.badges} limit={row ? 4 : 2} />
      </span>
      {row && <ChevronRight size={14} className="justify-self-end text-faint opacity-0 group-hover/tile:opacity-100" />}
    </div>
    {hover && <HoverCard summary={summary} collection={collection} id={id} at={hover} />}
  </>;
}
