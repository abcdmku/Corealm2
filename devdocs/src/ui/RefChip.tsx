import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import type { ContentRow } from "../model/contracts.js";
import { rowId, rowName } from "../model/rows.js";
import { summarize, type RecordSummary, type SummaryContext } from "../model/summaries.js";
import { ListRow } from "./ListRow.js";
import { Thumb } from "./Thumb.js";
import { Badge } from "../components/ui/index.js";
import { chipVariants } from "../components/ui/chip.js";
import { labelFor } from "./library.js";
import { cn } from "../lib/utils.js";


interface HoverState { x: number; y: number }

/** A record's name and thumbnail, with a hover card of its key stats. Clicking opens the record. */
export function RefChip({ collection, record, id, ctx, onOpen, size = "m", detail, missing, trailing }: {
  collection: string;
  record?: ContentRow;
  id: string;
  ctx: SummaryContext;
  onOpen?: (collection: string, id: string) => void;
  size?: "m" | "l";
  /** Text shown after the name, for quantities and chances. */
  detail?: ReactNode;
  missing?: boolean;
  trailing?: ReactNode;
}) {
  const summary = record ? summarize(collection, record, ctx) : undefined;
  const [hover, setHover] = useState<HoverState>();
  const isMissing = missing ?? !record;
  return <>
    <button type="button" className={chipVariants({ state: isMissing ? "missing" : "link", size: size === "l" ? "lg" : "default" })} data-size={size} title={isMissing ? `${id} is not in ${labelFor(collection).toLowerCase()}` : `${labelFor(collection)} · ${id}`}
      onClick={() => onOpen?.(collection, id)}
      onMouseEnter={event => summary && setHover({ x: event.clientX, y: event.clientY })}
      onMouseMove={event => hover && setHover({ x: event.clientX, y: event.clientY })}
      onMouseLeave={() => setHover(undefined)}>
      <Thumb spec={summary?.thumb ?? { kind: "glyph", icon: ChevronRight, letter: id.slice(0, 2).toUpperCase() }} size="s" />
      <span>{summary?.title ?? (record ? rowName(record) : id)}</span>
      {detail !== undefined && <small>{detail}</small>}
      {trailing}
    </button>
    {hover && summary && <HoverCard summary={summary} collection={collection} id={id} at={hover} />}
  </>;
}

export function HoverCard({ summary, collection, id, at }: { summary: RecordSummary; collection: string; id: string; at: HoverState }) {
  const width = 260;
  const left = Math.min(at.x + 14, window.innerWidth - width - 8);
  const top = Math.min(at.y + 14, window.innerHeight - 200);
  return createPortal(<div className="pointer-events-none fixed z-[70] rounded-md border border-border bg-popover p-2 text-xs shadow-lg shadow-shadow" style={{ left, top, width }} role="presentation">
    <div className="mb-1.5 flex items-center gap-2">
      <Thumb spec={summary.thumb} size="l" />
      <div className="min-w-0"><strong className="block truncate text-xs">{summary.title}</strong><small className="font-mono text-[11px] text-faint">{labelFor(collection)} · {id}</small></div>
    </div>
    {summary.subtitle && <p className={cn("text-[11.5px] text-faint", summary.stats.length > 0 && "mb-2")}>{summary.subtitle}</p>}
    {summary.stats.length > 0 && <dl className="m-0 grid grid-cols-2 gap-x-2 gap-y-[3px]">{summary.stats.slice(0, 8).map(stat => <div key={stat.label}><dt className="text-[11px] text-faint">{stat.label}</dt><dd className="m-0 font-mono text-xs">{stat.value}</dd></div>)}</dl>}
    {summary.badges.length > 0 && <div className="flex flex-wrap items-center gap-1 mt-2">{summary.badges.map((badge, index) => <Badge key={index} variant={badge.tone === "accent" || badge.tone === "ok" || badge.tone === "warn" || badge.tone === "danger" || badge.tone === "info" ? badge.tone : "default"} className={badge.mono ? "font-mono" : undefined}>{badge.text}</Badge>)}</div>}
  </div>, document.body);
}

/** A stacked row for lists of references: thumb, title, subtitle and a right-hand meta slot. */
export function RefRow({ collection, record, id, ctx, onOpen, meta, subtitle, tag, trailing }: {
  collection: string;
  record?: ContentRow;
  id: string;
  ctx: SummaryContext;
  onOpen?: (collection: string, id: string) => void;
  meta?: ReactNode;
  subtitle?: ReactNode;
  /** A short word that qualifies the title and belongs beside it, not at the far end of the row. */
  tag?: ReactNode;
  trailing?: ReactNode;
}) {
  const summary = record ? summarize(collection, record, ctx) : undefined;
  const [hover, setHover] = useState<HoverState>();
  return <>
    <ListRow onClick={() => onOpen?.(collection, id)}
      onMouseEnter={event => summary && setHover({ x: event.clientX, y: event.clientY })}
      onMouseMove={event => hover && setHover({ x: event.clientX, y: event.clientY })}
      onMouseLeave={() => setHover(undefined)}
      art={<Thumb spec={summary?.thumb ?? { kind: "glyph", icon: ChevronRight, letter: id.slice(0, 2).toUpperCase() }} size="m" />}
      title={summary?.title ?? id} tag={tag}
      subtitle={subtitle ?? summary?.subtitle ?? (record ? rowId(record) : `Missing from ${labelFor(collection).toLowerCase()}`)}
      meta={meta} trailing={trailing} />
    {hover && summary && <HoverCard summary={summary} collection={collection} id={id} at={hover} />}
  </>;
}
