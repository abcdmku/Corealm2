import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import type { ContentRow } from "../../model/contracts.js";
import { useRecordDraft, type RecordDraft } from "../../model/draft.js";
import { refTargetCollection, summaryContext, useReferenceIndex, type ReferenceIndex } from "../../model/refs.js";
import { contentRows } from "../../model/rows.js";
import { titleCase, type SummaryContext, type ThumbSpec } from "../../model/summaries.js";
import { Facts, NumberInput, SaveBar, Select, Static, TextInput, type InputWidth } from "../../ui/Sheet.js";
import { RefChip } from "../../ui/RefChip.js";
import { Thumb } from "../../ui/Thumb.js";
import { EmptyState, ErrorState, LoadingRows } from "../../ui/States.js";
import type { ViewProps } from "../types.js";
import "./story.css";

/*
  Helpers shared by the story, spells and assets pages: a record draft joined with the reference
  index, a record shell (header, save strip, sheet, rail), and controls that turn into static text
  when the page is read-only.
*/

export const asRecord = (value: unknown): ContentRow => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ContentRow : {};
export const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const text = (value: unknown): string | undefined => typeof value === "string" && value ? value : undefined;
export const num = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
export const strings = (value: unknown): string[] => list(value).filter((entry): entry is string => typeof entry === "string");

export const REGION_IDS = ["fallowmarch", "vellenwood", "karrowmoor", "kilnhalt", "wilderness", "gravelmaw", "crownward", "gloamgarden", "faeholme"] as const;
export const SKILLS = ["melee", "magic", "mining", "woodcutting", "fishing", "smithing", "crafting", "cooking", "fletching", "agility"] as const;

export interface Page<T extends ContentRow> { draft: RecordDraft<T>; index: ReferenceIndex; ctx: SummaryContext; itemCollection: string }
/** The lookup half of a page, for helpers that only read. */
export type Lookup = Pick<Page<ContentRow>, "index" | "ctx" | "itemCollection">;
/** The save-strip half of a draft, independent of the record type. */
export type DraftState = Pick<RecordDraft<ContentRow>, "editable" | "dirty" | "saving" | "saveError" | "conflict" | "save" | "reset" | "diagnostics">;

/** A record draft plus the cross-reference index every page needs for chips and rails. */
export function usePage<T extends ContentRow>(collection: string, id: string | undefined): Page<T> {
  const draft = useRecordDraft<T>(collection, id);
  const { index } = useReferenceIndex();
  const ctx = useMemo(() => summaryContext(index), [index]);
  const itemCollection = refTargetCollection("item", index.available) ?? "items";
  return { draft, index, ctx, itemCollection };
}

/** Region ids with their display names, from the world file when it is loaded. */
export function regionOptions(index: ReferenceIndex): { value: string; label: string }[] {
  const world = index.collections.get("worldRegions");
  const names = new Map(world ? contentRows(world).map(row => [String(row.id), text(row.name) ?? titleCase(String(row.id))]) : []);
  return REGION_IDS.map(id => ({ value: id, label: names.get(id) ?? titleCase(id) }));
}

export function regionName(index: ReferenceIndex, id: string | undefined): string | undefined {
  if (!id) return undefined;
  return regionOptions(index).find(option => option.value === id)?.label ?? titleCase(id);
}

export interface SettlementHit { regionId: string; regionName: string; settlement: ContentRow }

/** The region and settlement that a settlement id lives in. */
export function findSettlement(index: ReferenceIndex, settlementId: string | undefined): SettlementHit | undefined {
  if (!settlementId) return undefined;
  const world = index.collections.get("worldRegions");
  if (!world) return undefined;
  for (const region of contentRows(world)) {
    const settlement = asRecord(region.settlement);
    if (settlement.id === settlementId) return { regionId: String(region.id), regionName: text(region.name) ?? titleCase(String(region.id)), settlement };
  }
  return undefined;
}

/** A settlement's stand (NPC or shop) by id. */
export function findStand(index: ReferenceIndex, key: "npcs" | "shops", id: string): (SettlementHit & { stand: ContentRow }) | undefined {
  const world = index.collections.get("worldRegions");
  if (!world) return undefined;
  for (const region of contentRows(world)) {
    const settlement = asRecord(region.settlement);
    const stand = list(settlement[key]).map(asRecord).find(entry => entry.id === id);
    if (stand) return { regionId: String(region.id), regionName: text(region.name) ?? titleCase(String(region.id)), settlement, stand };
  }
  return undefined;
}

export function position(value: unknown): { x: number; z: number } | undefined {
  const point = list(value);
  return typeof point[0] === "number" && typeof point[1] === "number" ? { x: point[0], z: point[1] } : undefined;
}

/** Loading, error and not-found states for a record page; renders children once the draft exists. */
export function PageState<T extends ContentRow>({ page, collection, navigate, children }: { page: Page<T>; collection: string; navigate: ViewProps["navigate"]; children: (draft: T, record: T) => ReactNode }) {
  const { draft } = page;
  if (draft.loading) return <div className="ws-page"><LoadingRows /></div>;
  if (draft.error) return <ErrorState message={draft.error} />;
  if (!draft.draft || !draft.record) return <EmptyState title="Record not found">This record is not in {collection}. <button className="text-button" onClick={() => navigate(collection)}>Back to the list</button></EmptyState>;
  return <>{children(draft.draft, draft.record)}</>;
}

/** The record page frame: header with thumb, title and facts; the save strip; the sheet; the rail. */
export function RecordShell({ thumb, title, id, facts, draft, rail, children, className = "" }: { thumb?: ThumbSpec; title: ReactNode; id: string; facts: readonly (ReactNode | undefined | false | null)[]; draft?: DraftState; rail?: ReactNode; children: ReactNode; className?: string }) {
  return <article className={`ws-page record ${className}`.trim()}>
    <div className="record-main">
      <header className="record-head">
        {thumb && <Thumb spec={thumb} size="l" alt="" />}
        <div className="record-title">
          <h1>{title}</h1>
          <Facts items={[...facts, <code key="id">{id}</code>]} />
        </div>
      </header>
      {draft && draft.editable && <SaveBar dirty={draft.dirty} saving={draft.saving} error={draft.saveError || undefined} conflict={draft.conflict} onSave={() => void draft.save()} onReset={draft.reset} />}
      {draft && draft.diagnostics.length > 0 && <ul className="story-diagnostics" role="alert">{draft.diagnostics.map((diagnostic, index) => <li key={index}>{diagnostic.path ? <code>{diagnostic.path}</code> : null} {diagnostic.message}</li>)}</ul>}
      {children}
    </div>
    {rail && <aside className="record-rail">{rail}</aside>}
  </article>;
}

/* ---------- Controls that read as text when the page is read-only ---------- */

export function TextField({ editable, value, onChange, multiline = false, width = "text", mono = false, ariaLabel, placeholder }: { editable: boolean; value: string | undefined; onChange: (value: string) => void; multiline?: boolean; width?: InputWidth; mono?: boolean; ariaLabel: string; placeholder?: string }) {
  if (!editable) return value ? <Static mono={mono}>{multiline ? <span className="story-prose">{value}</span> : value}</Static> : <Static muted>—</Static>;
  return <TextInput value={value ?? ""} onChange={onChange} multiline={multiline} width={width} mono={mono} ariaLabel={ariaLabel} placeholder={placeholder} />;
}

export function NumberField({ editable, value, onChange, unit, ariaLabel, integer, min, step }: { editable: boolean; value: number | undefined; onChange: (value: number | undefined) => void; unit?: string; ariaLabel: string; integer?: boolean; min?: number; step?: number }) {
  if (!editable) return <Static mono>{value === undefined ? "—" : value}{unit && <span className="kv-unit"> {unit}</span>}</Static>;
  return <NumberInput value={value} onChange={onChange} unit={unit} ariaLabel={ariaLabel} integer={integer} min={min} step={step} />;
}

export function SelectField<T extends string>({ editable, value, onChange, options, ariaLabel, allowEmpty, width }: { editable: boolean; value: T | undefined; onChange: (value: T) => void; options: readonly { value: T; label?: string }[] | readonly T[]; ariaLabel: string; allowEmpty?: string; width?: InputWidth }) {
  if (!editable) {
    const match = options.map(option => typeof option === "string" ? { value: option, label: option } : option).find(option => option.value === value);
    return <Static>{match?.label ?? value ?? "—"}</Static>;
  }
  return <Select value={value} onChange={onChange} options={options} ariaLabel={ariaLabel} allowEmpty={allowEmpty} width={width} />;
}

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="icon-button story-remove" aria-label={label} title={label} onClick={onClick}><X size={12} /></button>;
}

export function AddButton({ label, children, onClick }: { label: string; children?: ReactNode; onClick?: () => void }) {
  return <button type="button" className="button button-small" aria-label={label} onClick={onClick}><Plus size={12} />{children ?? label}</button>;
}

/** An item and a quantity, as the stack row used by shops, costs, grants and rewards. */
export function ItemStack({ itemId, quantity, editable, page, onQuantity, onRemove, open, removeLabel }: { itemId: string; quantity: number | undefined; editable: boolean; page: Lookup; onQuantity?: (value: number | undefined) => void; onRemove?: () => void; open: ViewProps["navigate"]; removeLabel?: string }) {
  const record = page.ctx.lookup("item", itemId);
  const name = record ? String(record.name ?? itemId) : itemId;
  return <span className="stack-row">
    <RefChip collection={page.itemCollection} id={itemId} record={record} ctx={page.ctx} onOpen={(collection, id) => open(collection, id)} />
    {editable && onQuantity ? <input type="number" min={1} step={1} value={quantity ?? ""} aria-label={`${name} quantity`} onChange={event => onQuantity(event.target.value === "" ? undefined : Number(event.target.value))} /> : <span className="stack-qty mono">×{quantity ?? 1}</span>}
    {editable && onRemove && <RemoveButton label={removeLabel ?? `Remove ${name}`} onClick={onRemove} />}
  </span>;
}

/** Raw JSON for one value, validated on blur. The fallback editor for predicate and condition trees. */
export function JsonField({ value, onChange, editable, ariaLabel, rows = 6 }: { value: unknown; onChange: (value: unknown) => void; editable: boolean; ariaLabel: string; rows?: number }) {
  const printed = useMemo(() => JSON.stringify(value ?? null, null, 2), [value]);
  const [draft, setDraft] = useState(printed);
  const [error, setError] = useState("");
  useEffect(() => { setDraft(printed); setError(""); }, [printed]);
  if (!editable) return <pre className="story-json">{printed}</pre>;
  return <span className="story-json-field">
    <textarea className="kv-input kv-textarea mono" rows={rows} value={draft} aria-label={ariaLabel} aria-invalid={error ? true : undefined} onChange={event => setDraft(event.target.value)} onBlur={() => {
      try { const parsed: unknown = JSON.parse(draft); setError(""); if (JSON.stringify(parsed) !== JSON.stringify(value ?? null)) onChange(parsed); }
      catch (caught) { setError(caught instanceof Error ? caught.message : "Invalid JSON"); }
    }} />
    {error && <span className="kv-error">{error}</span>}
  </span>;
}

/** A readable line with an "Edit as fields" toggle that reveals the JSON editor for the same value. */
export function ReadableOrJson({ readable, value, onChange, editable, ariaLabel, aside }: { readable: ReactNode; value: unknown; onChange: (value: unknown) => void; editable: boolean; ariaLabel: string; aside?: ReactNode }) {
  const [raw, setRaw] = useState(false);
  return <span className="story-readable">
    <span className="story-readable-line">{readable}{editable && <button type="button" className="text-button story-readable-toggle" aria-pressed={raw} onClick={() => setRaw(!raw)}>{raw ? "Done" : "Edit as fields"}</button>}{editable && aside}</span>
    {raw && editable && <JsonField value={value} onChange={onChange} editable ariaLabel={ariaLabel} />}
  </span>;
}

/** Column of ids rendered as chips, with an optional × per chip. */
export function ChipList({ ids, collection, kind, page, open, onRemove, empty = "None" }: { ids: readonly string[]; collection: string; kind: string; page: Lookup; open: ViewProps["navigate"]; onRemove?: (index: number) => void; empty?: string }) {
  if (!ids.length) return <span className="empty-inline">{empty}</span>;
  return <span className="ref-list">{ids.map((id, index) => <span className="story-chip" key={`${id}:${index}`}>
    <RefChip collection={collection} id={id} record={page.ctx.lookup(kind, id)} ctx={page.ctx} onOpen={(target, targetId) => open(target, targetId)} />
    {onRemove && <RemoveButton label={`Remove ${id}`} onClick={() => onRemove(index)} />}
  </span>)}</span>;
}

/** Name of a referenced record for readable lines, falling back to the id. */
export function nameOf(ctx: SummaryContext, kind: string, id: string | undefined): string {
  if (!id) return "?";
  const record = ctx.lookup(kind, id);
  return record ? String(record.name ?? id) : id;
}

export const clip = (value: string | undefined, max = 90): string => !value ? "" : value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
