import { createContext, useContext, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { ExternalLink, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Schema, SchemaIssue } from "../../../game/src/content/schema/core.js";
import type { AppProps, ContentRow } from "../model/contracts.js";
import { REF_COLLECTIONS, refKindForKey, refTargetCollection, type ReferenceIndex } from "../model/refs.js";
import { rowName } from "../model/rows.js";
import { noContext, percent, rangeText, titleCase, type SummaryContext } from "../model/summaries.js";
import { RecordPicker } from "../ui/RecordPicker.js";
import { RefChip } from "../ui/RefChip.js";
import { Thumb } from "../ui/Thumb.js";

/*
  Visual editors for the structured fields authors touch most. Each one edits the same JSON the
  schema form would, so validation and saving are unchanged; the form is always one click away.
*/

export interface EditorEnvironment { collection: string; ctx: SummaryContext; index: ReferenceIndex | undefined; navigate?: AppProps["navigate"] }
export const EditorContext = createContext<EditorEnvironment>({ collection: "", ctx: noContext, index: undefined });

export interface VisualEditorProps { path: string; value: unknown; onChange: (value: unknown) => void; issues: SchemaIssue[]; schema: Schema }

const asRecord = (value: unknown): ContentRow => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ContentRow : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string | undefined => typeof value === "string" && value ? value : undefined;
const normalize = (path: string): string => path.replace(/\[\d+\]/g, "[]");

interface Registration { collection: RegExp; path: RegExp; component: ComponentType<VisualEditorProps> }

function useTarget(kind: string): string {
  const { index } = useContext(EditorContext);
  return (index ? refTargetCollection(kind, index.available) : undefined) ?? REF_COLLECTIONS[kind]?.[0] ?? kind;
}

/** Reference picker for any id-valued string field. */
export function RefField({ kind, value, onChange, readOnly, fieldProps, name }: { kind: string; value: unknown; onChange: (value: unknown) => void; readOnly?: boolean; fieldProps?: Record<string, unknown>; name: string }) {
  const { ctx, navigate } = useContext(EditorContext);
  const target = useTarget(kind);
  const [raw, setRaw] = useState(false);
  const id = typeof value === "string" ? value : "";
  const record = id ? ctx.lookup(kind, id) : undefined;
  if (raw || !REF_COLLECTIONS[kind]) {
    return <div className="ref-field"><input {...fieldProps} className="ref-field-raw" value={id} type="text" onChange={event => onChange(event.target.value)} placeholder={`${titleCase(kind)} id`} />{REF_COLLECTIONS[kind] && <button type="button" className="editor-small-button" onClick={() => setRaw(false)}>Pick</button>}</div>;
  }
  return <div className="ref-field">
    {id ? <RefChip collection={target} id={id} record={record} ctx={ctx} onOpen={navigate} missing={!record} /> : <span className="empty-inline">No {titleCase(kind).toLowerCase()} chosen</span>}
    {!readOnly && <RecordPicker collection={target} value={id} ctx={ctx} onPick={picked => onChange(picked)} trigger={<button type="button" className="button button-small" aria-label={`Choose ${name}`}><Pencil size={12} />{id ? "Change" : "Choose"}</button>} />}
    {id && navigate && <button type="button" className="icon-button" aria-label="Open record" title="Open record" onClick={() => navigate(target, id)}><ExternalLink size={13} /></button>}
    {!readOnly && <button type="button" className="editor-small-button" onClick={() => setRaw(true)}>Type id</button>}
  </div>;
}

export function refKindFor(spec: { ref?: string }, name: string): string | undefined {
  return spec.ref ?? refKindForKey(name);
}

/* ---------- Loot drops ---------- */

interface Drop { itemId: string; quantity: [number, number]; chance: number; exclusiveGroup?: string }

function dropOf(value: unknown): Drop {
  const row = asRecord(value);
  const quantity = list(row.quantity);
  return { itemId: text(row.itemId) ?? "", quantity: [Number(quantity[0] ?? 1), Number(quantity[1] ?? quantity[0] ?? 1)], chance: typeof row.chance === "number" ? row.chance : 1, ...(text(row.exclusiveGroup) ? { exclusiveGroup: row.exclusiveGroup as string } : {}) };
}

export function LootDropsEditor({ path, value, onChange, issues }: VisualEditorProps) {
  const { ctx, navigate } = useContext(EditorContext);
  const target = useTarget("item");
  const drops = list(value);
  const [selected, setSelected] = useState<number>();
  const groups = useMemo(() => [...new Set(drops.map(dropOf).map(drop => drop.exclusiveGroup).filter(Boolean))] as string[], [drops]);
  const errorsAt = (index: number) => issues.filter(issue => issue.path.startsWith(`${path}[${index}]`) && issue.severity === "error");
  function update(index: number, patch: Partial<Drop>) {
    const next = drops.map((entry, i) => {
      if (i !== index) return entry;
      const merged = { ...asRecord(entry), ...patch } as Record<string, unknown>;
      if (!text(merged.exclusiveGroup)) delete merged.exclusiveGroup;
      return merged;
    });
    onChange(next);
  }
  function remove(index: number) { onChange(drops.filter((_, i) => i !== index)); setSelected(undefined); }
  function add(itemId: string) { onChange([...drops, { itemId, quantity: [1, 1], chance: 1 }]); setSelected(drops.length); }
  const current = selected !== undefined ? dropOf(drops[selected]) : undefined;
  return <div className="drop-editor">
    <div className="drop-grid">
      {drops.map((entry, index) => {
        const drop = dropOf(entry);
        const record = ctx.lookup("item", drop.itemId);
        const errors = errorsAt(index);
        return <div role="button" tabIndex={0} key={index} className={`drop-tile${selected === index ? " is-selected" : ""}${!record ? " is-missing" : ""}`} onClick={() => setSelected(selected === index ? undefined : index)} onKeyDown={event => { if (event.key === "Enter") setSelected(index); }} title={errors.map(issue => issue.message).join("\n") || drop.itemId} style={errors.length ? { borderColor: "var(--danger)" } : undefined}>
          <Thumb spec={{ kind: "item", id: drop.itemId }} size="l" />
          <span className="drop-tile-name">{record ? rowName(record) : drop.itemId || "Choose item"}</span>
          <span className="drop-tile-meta"><span>×{rangeText(drop.quantity) || "1"}</span><span className="drop-chance" style={{ "--chance": drop.chance } as React.CSSProperties}>{percent(drop.chance)}</span></span>
          {drop.exclusiveGroup && <span className="badge" data-tone="info">{drop.exclusiveGroup}</span>}
          <button type="button" className="drop-tile-remove" aria-label={`Remove ${record ? rowName(record) : drop.itemId}`} onClick={event => { event.stopPropagation(); remove(index); }}><X size={12} /></button>
        </div>;
      })}
      <RecordPicker collection={target} ctx={ctx} onPick={add} trigger={<button type="button" className="drop-tile drop-tile-add"><Plus size={18} /><span className="drop-tile-name">Add drop</span></button>} />
    </div>
    {current && selected !== undefined && <div className="drop-editor-fields" role="group" aria-label="Edit drop">
      <div className="drop-editor-item">
        <RefChip collection={target} id={current.itemId} record={ctx.lookup("item", current.itemId)} ctx={ctx} onOpen={navigate} missing={!ctx.lookup("item", current.itemId)} />
        <RecordPicker collection={target} value={current.itemId} ctx={ctx} onPick={itemId => update(selected, { itemId })} trigger={<button type="button" className="button button-small"><Pencil size={12} /> Change item</button>} />
        <span style={{ flex: 1 }} />
        <button type="button" className="button button-small button-danger" onClick={() => remove(selected)}><Trash2 size={12} /> Remove</button>
        <button type="button" className="icon-button" aria-label="Close" onClick={() => setSelected(undefined)}><X size={14} /></button>
      </div>
      <label>Min<input type="number" min={1} step={1} value={current.quantity[0]} onChange={event => update(selected, { quantity: [event.target.valueAsNumber, Math.max(event.target.valueAsNumber, current.quantity[1])] })} /></label>
      <label>Max<input type="number" min={current.quantity[0]} step={1} value={current.quantity[1]} onChange={event => update(selected, { quantity: [current.quantity[0], event.target.valueAsNumber] })} /></label>
      <label>Chance %<input type="number" min={0} max={100} step={0.5} value={Number((current.chance * 100).toFixed(2))} onChange={event => update(selected, { chance: Math.min(1, Math.max(0, event.target.valueAsNumber / 100)) })} /></label>
      <label>Exclusive group<input list={`groups-${path}`} value={current.exclusiveGroup ?? ""} placeholder="none" onChange={event => update(selected, { exclusiveGroup: event.target.value })} /><datalist id={`groups-${path}`}>{groups.map(group => <option key={group} value={group} />)}</datalist></label>
      <input type="range" min={0} max={100} step={0.5} value={current.chance * 100} aria-label="Chance" onChange={event => update(selected, { chance: Number(event.target.value) / 100 })} style={{ accentColor: "var(--accent)" }} />
    </div>}
    {issues.some(issue => issue.path === path && issue.severity === "error") && <p className="editor-field-errors">{issues.filter(issue => issue.path === path).map(issue => issue.message).join(" ")}</p>}
  </div>;
}

/* ---------- Item stacks: recipe inputs, shop stock, quest rewards, rune costs ---------- */

function StackRow({ kind, entry, onChange, onRemove, quantityKey }: { kind: string; entry: ContentRow; onChange: (next: ContentRow) => void; onRemove: () => void; quantityKey: string }) {
  const { ctx, navigate } = useContext(EditorContext);
  const target = useTarget(kind);
  const id = text(entry.itemId) ?? "";
  const record = ctx.lookup(kind, id) ?? ctx.lookup("item", id);
  return <div className="stack-row">
    <RefChip collection={target} id={id} record={record} ctx={ctx} onOpen={navigate} missing={!record} />
    <RecordPicker collection={target} value={id} ctx={ctx} onPick={itemId => onChange({ ...entry, itemId })} trigger={<button type="button" className="icon-button" aria-label="Change item" title="Change item"><Pencil size={12} /></button>} />
    {quantityKey && <input type="number" min={0} step={1} aria-label="Quantity" value={typeof entry[quantityKey] === "number" ? entry[quantityKey] as number : ""} onChange={event => onChange({ ...entry, [quantityKey]: event.target.valueAsNumber })} />}
    <button type="button" className="icon-button" aria-label="Remove" onClick={onRemove}><X size={13} /></button>
  </div>;
}

function stackEditor(kind: string, quantityKey = "quantity"): ComponentType<VisualEditorProps> {
  return function ItemStackListEditor({ value, onChange, issues, path }: VisualEditorProps) {
    const { ctx } = useContext(EditorContext);
    const target = useTarget(kind);
    const entries = list(value).map(asRecord);
    return <div className="recipe-editor-column">
      <div className="ref-list">
        {entries.map((entry, index) => <StackRow key={index} kind={kind} entry={entry} quantityKey={quantityKey} onChange={next => onChange(entries.map((existing, i) => i === index ? next : existing))} onRemove={() => onChange(entries.filter((_, i) => i !== index))} />)}
        <RecordPicker collection={target} ctx={ctx} onPick={itemId => onChange([...entries, { itemId, [quantityKey]: 1 }])} trigger={<button type="button" className="button button-small"><Plus size={12} /> Add</button>} />
      </div>
      {issues.some(issue => issue.path.startsWith(path) && issue.severity === "error") && <p className="editor-field-errors">{issues.filter(issue => issue.path.startsWith(path)).map(issue => issue.message).join(" ")}</p>}
    </div>;
  };
}

function SingleStackEditor({ value, onChange }: VisualEditorProps) {
  const entry = asRecord(value);
  const { ctx } = useContext(EditorContext);
  const target = useTarget("item");
  if (!text(entry.itemId)) return <RecordPicker collection={target} ctx={ctx} onPick={itemId => onChange({ ...entry, itemId, quantity: typeof entry.quantity === "number" ? entry.quantity : 1 })} trigger={<button type="button" className="button button-small"><Plus size={12} /> Choose item</button>} />;
  return <div className="ref-list"><StackRow kind="item" entry={entry} quantityKey="quantity" onChange={onChange} onRemove={() => onChange({ ...entry, itemId: "" })} /></div>;
}

/* ---------- Armour set slots ---------- */

const SLOTS = ["head", "body", "legs", "hands", "feet"] as const;

function SetMembersEditor({ value, onChange }: VisualEditorProps) {
  const { ctx, navigate } = useContext(EditorContext);
  const target = useTarget("item");
  const members = asRecord(value);
  return <div className="slot-grid">{SLOTS.map(slot => {
    const id = text(members[slot]);
    const record = id ? ctx.lookup("item", id) : undefined;
    return <RecordPicker key={slot} collection={target} value={id} ctx={ctx} onPick={itemId => onChange({ ...members, [slot]: itemId })} trigger={<button type="button" className={`slot-tile${id ? "" : " is-empty"}`} title={id ?? `Choose ${slot}`}>
      <small>{slot}</small>
      <Thumb spec={id ? { kind: "item", id } : { kind: "glyph", icon: Plus }} size="l" />
      <strong>{record ? rowName(record) : id ?? "Empty"}</strong>
      {id && navigate && <span className="text-button" role="link" onClick={event => { event.stopPropagation(); navigate(target, id); }}>Open</span>}
    </button>} />;
  })}</div>;
}

/* ---------- Encounter members ---------- */

function EncounterMembersEditor({ value, onChange }: VisualEditorProps) {
  const { ctx, navigate } = useContext(EditorContext);
  const target = useTarget("enemy");
  const members = list(value).map(asRecord);
  return <div className="recipe-editor-column"><div className="ref-list">
    {members.map((member, index) => {
      const id = text(member.creatureId) ?? "";
      const record = ctx.lookup("enemy", id);
      return <div className="stack-row" key={index}>
        <RefChip collection={target} id={id} record={record} ctx={ctx} onOpen={navigate} missing={!record} />
        <RecordPicker collection={target} value={id} ctx={ctx} onPick={creatureId => onChange(members.map((existing, i) => i === index ? { ...existing, creatureId } : existing))} trigger={<button type="button" className="icon-button" aria-label="Change creature"><Pencil size={12} /></button>} />
        <input type="number" min={0.01} step={0.5} aria-label="Weight" title="Weight" value={typeof member.weight === "number" ? member.weight : ""} onChange={event => onChange(members.map((existing, i) => i === index ? { ...existing, weight: event.target.valueAsNumber } : existing))} />
        <button type="button" className="icon-button" aria-label="Remove" disabled={members.length <= 1} onClick={() => onChange(members.filter((_, i) => i !== index))}><X size={13} /></button>
      </div>;
    })}
    <RecordPicker collection={target} ctx={ctx} onPick={creatureId => onChange([...members, { creatureId, weight: 1 }])} trigger={<button type="button" className="button button-small"><Plus size={12} /> Add creature</button>} />
  </div></div>;
}

const REGISTRY: readonly Registration[] = [
  { collection: /^(lootTables|creatureDefinitions|compiled-.*)$/, path: /^(drops|loot\.drops|stats\.drops)$/, component: LootDropsEditor },
  { collection: /^(recipes|progression|recipeTemplates)$/, path: /^(inputs|production\[\]\.inputs)$/, component: stackEditor("item") },
  { collection: /^(recipes|progression)$/, path: /^(output|production\[\]\.output)$/, component: SingleStackEditor },
  { collection: /^shops$/, path: /^stock$/, component: stackEditor("item") },
  { collection: /^quests$/, path: /^(rewards\.items|onStart\.items|stages\[\]\.grants\.items|stages\[\]\.onFlag\[\]\.grant\.items)$/, component: stackEditor("item") },
  { collection: /^spells$/, path: /^cost\.runes$/, component: stackEditor("rune") },
  { collection: /^resources$/, path: /^bonus$/, component: stackEditor("item", "") },
  { collection: /^equipmentSets$/, path: /^members$/, component: SetMembersEditor },
  { collection: /^encounters$/, path: /^members$/, component: EncounterMembersEditor },
];

export function visualEditorFor(collection: string, path: string): ComponentType<VisualEditorProps> | undefined {
  const normalized = normalize(path);
  return REGISTRY.find(entry => entry.collection.test(collection) && entry.path.test(normalized))?.component;
}

export function VisualEditorFrame({ label, onShowFields, children }: { label: string; onShowFields: () => void; children: ReactNode }) {
  return <div className="visual-editor">
    {children}
    <div style={{ marginTop: 6 }}><button type="button" className="editor-small-button" onClick={onShowFields}>Show {label.toLowerCase()} as fields</button></div>
  </div>;
}
