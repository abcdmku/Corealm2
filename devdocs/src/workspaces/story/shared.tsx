import { useMemo, type ReactNode } from "react";
import { ArraySchema, ObjectSchema, type RefKind, type Schema } from "../../../../game/src/content/schema/core.js";
import { npcSchema } from "../../../../game/src/content/schema/people.js";
import type { ContentRow } from "../../model/contracts.js";
import { useRecordDraft, type RecordDraft } from "../../model/draft.js";
import { fieldCore } from "../../model/fields.js";
import { optionsFor, refTargetCollection, summaryContext, useReferenceIndex, type ReferenceIndex } from "../../model/refs.js";
import { contentRows } from "../../model/rows.js";
import { titleCase, type SummaryContext, type ThumbSpec } from "../../model/summaries.js";
import { Facts, ListField, NumberField, RefField, fieldFromSchema, type ChoiceOption, type RenderRef } from "../../ui/field/index.js";
import { EmptyState, ErrorState, LoadingRows } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import type { ViewProps } from "../types.js";
import "./story.css";
import { Button } from "../../components/ui/index.js";

/*
  Helpers shared by the story pages: a record draft joined with the reference index, the record
  shell (header, sheet, optional rail), schema lookups, and the two ways this workspace shows a
  reference inside a row — `RefCell` and the `renderRef` every union field is given. Controls come
  from `ui/field`; nothing here wraps them again.
*/

export const asRecord = (value: unknown): ContentRow => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ContentRow : {};
export const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const text = (value: unknown): string | undefined => typeof value === "string" && value ? value : undefined;
export const num = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
export const strings = (value: unknown): string[] => list(value).filter((entry): entry is string => typeof entry === "string");

export interface Page<T extends ContentRow> { draft: RecordDraft<T>; index: ReferenceIndex; ctx: SummaryContext; itemCollection: string }
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

/* ---------- Schema lookups ---------- */

/** One field of an object schema, past optional, nullable and lazy wrappers. */
export function sub(schema: Schema, key: string): Schema | undefined {
  const node = fieldCore(schema);
  return node instanceof ObjectSchema && Object.hasOwn(node.fields, key) ? node.fields[key] as Schema : undefined;
}

/** The member schema of an array field. */
export function itemOf(schema: Schema | undefined): Schema | undefined {
  if (!schema) return undefined;
  const node = fieldCore(schema);
  return node instanceof ArraySchema ? node.item as Schema : undefined;
}

/** Region ids from the schema enum, named from the world file when it is loaded. */
export function regionOptions(index: ReferenceIndex): ChoiceOption[] {
  const ids = fieldFromSchema(npcSchema, "regionId").choices ?? [];
  const world = index.collections.get("worldRegions");
  const names = new Map(world ? contentRows(world).map(row => [String(row.id), text(row.name) ?? titleCase(String(row.id))]) : []);
  return ids.map(id => ({ value: id, label: names.get(id) ?? titleCase(id) }));
}

export function regionName(index: ReferenceIndex, id: string | undefined): string | undefined {
  if (!id) return undefined;
  return regionOptions(index).find(option => option.value === id)?.label ?? titleCase(id);
}

/** The skill enum as map keys, with the same glyphs the reference picker uses. */
export function skillKeys(index: ReferenceIndex): ChoiceOption[] {
  return (optionsFor("skill", index) ?? []).map(option => ({ value: option.value, label: option.label }));
}

/* ---------- Settlements and stands, read out of the world file ---------- */

export interface SettlementHit { regionId: string; regionName: string; settlement: ContentRow }

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

/* ---------- Page frame ---------- */

/** Loading, error and not-found states for a record page; renders children once the draft exists. */
export function PageState<T extends ContentRow>({ page, collection, navigate, children }: { page: Page<T>; collection: string; navigate: ViewProps["navigate"]; children: (draft: T, record: T) => ReactNode }) {
  const { draft } = page;
  if (draft.loading) return <div className="ws-page"><LoadingRows /></div>;
  if (draft.error) return <ErrorState message={draft.error} />;
  if (!draft.draft || !draft.record) return <EmptyState title="Record not found">This record is not in {collection}. <Button variant="link" size="inline" onClick={() => navigate(collection)}>Back to the list</Button></EmptyState>;
  return <>{children(draft.draft, draft.record)}</>;
}

/** The record page frame: header with thumb, title and facts; the sheet; the rail. The save bar is the shell's. */
export function RecordShell({ thumb, title, id, facts, draft, rail, children, className = "" }: { thumb?: ThumbSpec; title: ReactNode; id: string; facts: readonly (ReactNode | undefined | false | null)[]; draft?: DraftState; rail?: ReactNode; children: ReactNode; className?: string }) {
  return <article className={`ws-page record story-record${rail ? "" : " story-single"} ${className}`.trim()}>
    <div className="record-main">
      <header className="record-head">
        {thumb && <Thumb spec={thumb} size="l" alt="" />}
        <div className="record-title">
          <h1>{title}</h1>
          <Facts items={[...facts, <code key="id">{id}</code>]} />
        </div>
      </header>
      {draft && draft.diagnostics.length > 0 && <ul className="story-diagnostics" role="alert">{draft.diagnostics.map((diagnostic, index) => <li key={index}>{diagnostic.path ? <code>{diagnostic.path}</code> : null} {diagnostic.message}</li>)}</ul>}
      {children}
    </div>
    {rail && <aside className="record-rail">{rail}</aside>}
  </article>;
}

/* ---------- References inside a row ---------- */

export interface RefCellProps {
  /** The accessible name. Hidden visually: the row or the enclosing field already says it. */
  label: string;
  kind?: RefKind | string;
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  optional?: boolean;
  readOnly?: boolean;
  exclude?: ReadonlySet<string>;
}

/**
 * The one reference control this workspace uses inside a list row or beneath a union's own label:
 * `RefField` with its label column collapsed, so the row stays one 28px line. The label still names
 * the control through `aria-labelledby`.
 */
export function RefCell({ label, kind, value, onChange, optional, readOnly, exclude }: RefCellProps) {
  return <RefField className="story-ref-cell" label={label} kind={kind} value={value} onChange={onChange} optional={optional} readOnly={readOnly} exclude={exclude} />;
}

/**
 * An item and a count per row: the shape shops stock in and quests grant, take and reward. One
 * 28px line each, the picker excluding the items already listed when the list may not repeat.
 */
export function StackList({ label, hint, items, readOnly, onChange, quantityMin = 1, unique = false, addLabel, bare = false }: {
  label: string; hint?: string; items: readonly ContentRow[]; readOnly: boolean;
  onChange: (next: ContentRow[]) => void; quantityMin?: number; unique?: boolean; addLabel?: string;
  /** The section heading already says what the list is: render the rows without a label column. */
  bare?: boolean;
}) {
  const ids = items.map(entry => text(entry.itemId) ?? "");
  return <ListField<ContentRow> label={bare ? undefined : label} hint={bare ? undefined : hint} items={items} readOnly={readOnly} className="story-stacks"
    emptyText="None." addLabel={addLabel ?? "Add item"} onAdd={() => ({ itemId: "", quantity: quantityMin })}
    onChange={onChange}
    removeLabel={(_, index) => `Remove row ${index + 1}`}
    renderItem={(entry, api) => <>
      <RefCell label={`${label} item ${api.index + 1}`} kind="item" value={text(entry.itemId)} readOnly={readOnly}
        exclude={unique ? new Set(ids.filter((_, at) => at !== api.index)) : undefined}
        onChange={value => api.update({ ...entry, itemId: value ?? "" })} />
      <NumberField value={num(entry.quantity) ?? quantityMin} integer min={quantityMin} ariaLabel={`${label} quantity ${api.index + 1}`} readOnly={readOnly}
        onChange={value => api.update({ ...entry, quantity: value ?? quantityMin })} />
    </>} />;
}

/** Every `ref()` inside a union (predicate, condition, effect) picks through `RefField`, never a text box. */
export function refRenderer(readOnly: boolean): RenderRef {
  return (kind, value, onChange, spec) => <RefCell label={spec.label} kind={kind} value={value} optional={spec.optional} readOnly={readOnly} onChange={onChange} />;
}

/* ---------- Readable helpers ---------- */

/** Name of a referenced record for readable lines, falling back to the id. */
export function nameOf(ctx: SummaryContext, kind: string, id: string | undefined): string {
  if (!id) return "?";
  const record = ctx.lookup(kind, id);
  return record ? String(record.name ?? id) : id;
}

export const clip = (value: string | undefined, max = 90): string => !value ? "" : value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
