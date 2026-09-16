import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import type { ContentRow } from "../model/contracts.js";
import { rowId, rowName } from "../model/rows.js";
import { summarize, type RecordSummary, type SummaryContext } from "../model/summaries.js";
import { Thumb } from "./Thumb.js";
import { Badge } from "../components/ui/index.js";
import { chipVariants } from "../components/ui/chip.js";
import { labelFor } from "./library.js";

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
  return createPortal(<div className="hover-card" style={{ left, top, width }} role="presentation">
    <div className="hover-card-head">
      <Thumb spec={summary.thumb} size="l" />
      <div style={{ minWidth: 0 }}><strong>{summary.title}</strong><small>{labelFor(collection)} · {id}</small></div>
    </div>
    {summary.subtitle && <p className="muted" style={{ fontSize: 11.5, marginBottom: summary.stats.length ? 8 : 0 }}>{summary.subtitle}</p>}
    {summary.stats.length > 0 && <dl>{summary.stats.slice(0, 8).map(stat => <div key={stat.label}><dt>{stat.label}</dt><dd>{stat.value}</dd></div>)}</dl>}
    {summary.badges.length > 0 && <div className="chip-row" style={{ marginTop: 8 }}>{summary.badges.map((badge, index) => <Badge key={index} variant={badge.tone === "accent" || badge.tone === "ok" || badge.tone === "warn" || badge.tone === "danger" || badge.tone === "info" ? badge.tone : "default"} className={badge.mono ? "font-mono" : undefined}>{badge.text}</Badge>)}</div>}
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
    <button type="button" className="ref-row" onClick={() => onOpen?.(collection, id)}
      onMouseEnter={event => summary && setHover({ x: event.clientX, y: event.clientY })}
      onMouseMove={event => hover && setHover({ x: event.clientX, y: event.clientY })}
      onMouseLeave={() => setHover(undefined)}>
      <Thumb spec={summary?.thumb ?? { kind: "glyph", icon: ChevronRight, letter: id.slice(0, 2).toUpperCase() }} size="m" />
      <span className="ref-row-body">
        <span className="ref-row-title">{summary?.title ?? id}{tag !== undefined && <small className="ref-row-tag">{tag}</small>}</span>
        <span className="ref-row-sub">{subtitle ?? summary?.subtitle ?? (record ? rowId(record) : `Missing from ${labelFor(collection).toLowerCase()}`)}</span>
      </span>
      {meta !== undefined && <span className="ref-row-meta">{meta}</span>}
      {trailing}
    </button>
    {hover && summary && <HoverCard summary={summary} collection={collection} id={id} at={hover} />}
  </>;
}
