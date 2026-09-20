import { Fragment, useMemo, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "../components/ui/index.js";
import { CONTENT_COLLECTIONS } from "../../../game/src/content/compiler/collections.js";
import { ArraySchema, ObjectSchema, RecordSchema, TupleSchema, type Schema } from "../../../game/src/content/schema/core.js";
import type { ContentRow } from "../model/contracts.js";
import { useRecordDraft } from "../model/draft.js";
import type { Resolved } from "../model/origin.js";
import { containsIdentity, defaultFieldValue, fieldCore, fieldIssues, fieldTitle, recordLabelKey, serialFieldSpec, type SerialFieldSpec } from "../model/fields.js";
import { ChoiceField, Field, Fields, ListField, MapField, MultiChoiceField, NumberField, RefField, Section, Sheet, StackField, Static, TextField, ToggleField, UnionField, WeightedList, type ListItemApi, type RenderRef } from "../ui/field/index.js";
import { StatMatrix } from "../ui/StatMatrix.js";

/*
  The generic record form: a thin walker from a schema node to the field component that edits it
  (docs/devdocs-inputs.md §3.11). Numbers, text, choices, toggles, references, lists, maps and
  unions are the shared `ui/field` components, so this page owns layout and nothing else.

  The draft is the shared store's (`model/store.ts`): dirty state, undo, save and discard all run
  through the shell save bar, so there is no toolbar and no form library here. An optional field
  that is not set renders in its absent state — the empty control, with the absent dot — instead of
  a "Not set / + Add" chip; typing sets it and an empty commit clears it again.
*/

type Path = readonly (string | number)[];
interface Issue { path: string; message: string; severity: string }

const ADVANCED_FIELDS = new Set(["catalog", "source", "sourceInputId", "legacyOverride", "derived", "registrationOrder", "labOrder", "fantasyTierOrder", "lineage", "history", "provenance", "migration"]);
const SCALAR_KINDS = new Set(["number", "string", "boolean", "enum"]);

const asObject = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** `["cost", "runes", 0, "quantity"]` → `cost.runes[0].quantity`, the path a schema issue carries. */
const pathText = (path: Path): string => path.reduce<string>((out, key) => typeof key === "number" ? `${out}[${key}]` : out ? `${out}.${key}` : String(key), "");

/**
 * The class that marks where a field sits, so a diagnostic can scroll to it and focus its control.
 * Both spellings of a path (`a.b[0]` and `a.b.0`) fold to the same token.
 */
const anchorClass = (path: string): string => `at-${path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "record"}`;

/** Server diagnostics arrive as `collection[id].field`; the form addresses fields from the record down. */
function diagnosticPath(path: string, collection: string): string {
  const inside = path.startsWith(collection) ? path.slice(collection.length).replace(/^\[[^\]]*\]/, "") : path;
  return inside.replace(/^record\.?/, "").replace(/^\./, "");
}

const absent = (path: Path): Resolved<unknown> => ({ value: undefined, chain: [{ origin: { kind: "absent" }, value: undefined }], path });

function focusField(path: string): void {
  const target = document.querySelector<HTMLElement>(`.${anchorClass(path)}`);
  if (!target) return;
  target.scrollIntoView({ block: "center", behavior: "instant" });
  target.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
}

/** Every reference, wherever it is nested, is the one `RefField`. */
const renderRef: RenderRef = (kind, value, onChange, spec) => <RefField kind={kind} value={value} onChange={onChange} label={spec.label} hint={spec.hint} optional={spec.optional} readOnly={spec.readOnly} bare />;

export default function EntityEditor({ collection, recordId }: { collection: string; recordId: string }) {
  const spec = CONTENT_COLLECTIONS.find(candidate => candidate.name === collection);
  const objectShaped = spec?.shape === "object";
  const draft = useRecordDraft<ContentRow>(collection, spec ? (objectShaped ? "$collection" : recordId) : undefined);
  const record = draft.draft;
  const schema = spec?.schema;
  const issues = useMemo<Issue[]>(() => {
    const client: Issue[] = schema && record !== undefined ? fieldIssues(schema, record) : [];
    const server: Issue[] = draft.diagnostics.map(diagnostic => ({ ...diagnostic, path: diagnosticPath(diagnostic.path, collection) }));
    return [...client, ...server];
  }, [schema, record, draft.diagnostics, collection]);

  if (!spec || !schema) return <p className="py-1.5 text-xs text-muted-foreground">This collection has no editable schema.</p>;
  if (draft.loading) return <p className="py-1.5 text-xs text-muted-foreground" role="status">Loading fields…</p>;
  if (draft.error) return <p className="py-1.5 text-xs text-muted-foreground" role="alert">{draft.error}</p>;
  if (record === undefined) return <p className="py-1.5 text-xs text-muted-foreground" role="alert">This record no longer exists. Your other content has not changed.</p>;

  // An object-shaped collection is one record; the id in the route names the section to read first.
  const focusSection = objectShaped && recordId !== "$collection" ? recordId : undefined;
  return <div className="min-w-0 max-w-[70rem]">
    {draft.saveError && <div className="my-1.5 flex items-start gap-2 rounded-md border border-destructive bg-destructive-soft px-2.5 py-2 text-xs leading-snug" role="alert"><AlertCircle size={15} className="mt-px shrink-0 text-destructive" /><p>{draft.saveError}</p></div>}
    {issues.length > 0 && <div className="mt-1.5 mb-2.5 rounded-md border border-border bg-card px-2.5 py-2" aria-label="Validation diagnostics">
      <h3 className="text-[13px] font-semibold">{issues.some(issue => issue.severity === "error") ? "Fix these fields" : "Notes"}</h3>
      <ul className="mt-1 flex flex-col">{issues.map((issue, index) => <li key={`${issue.path}:${index}`}>
        <Button variant="ghost" size="sm" className="h-auto min-h-6 w-full justify-start gap-2 px-1.5 py-0.5 text-left font-normal whitespace-normal" onClick={() => focusField(issue.path)}>
          <span className="shrink-0 font-mono text-[11px] text-foreground">{issue.path || "Record"}</span><span>{issue.message}</span>
        </Button>
      </li>)}</ul>
    </div>}
    <Sheet>
      <FieldNode schema={schema} name="record" value={record} base={draft.record} onChange={next => draft.set(next as ContentRow)} path={[]} issues={issues}
        readOnly={!draft.editable} root focusSection={focusSection} idKey={spec.shape === "array" ? spec.idKey : undefined} />
    </Sheet>
  </div>;
}

interface NodeProps {
  schema: Schema;
  /** The field's key; titles the label when the schema has none. */
  name: string;
  value: unknown;
  /** The same field on disk, so a changed leaf can mark itself. */
  base?: unknown;
  onChange: (next: unknown) => void;
  path: Path;
  issues: readonly Issue[];
  readOnly?: boolean;
  /** Inside a `Fields` grid: label above the control, provenance in the dot. */
  compact?: boolean;
  /** Inside a list row or a map cell: the control alone, no section and no label column. */
  bare?: boolean;
  root?: boolean;
  focusSection?: string;
  idKey?: string;
  /** A cell of a matrix: the row and column heads name it, so its label is for assistive tech only. */
  cellLabel?: string;
}

/** One schema node as the field that edits it. */
function FieldNode({ schema, name, value, base, onChange, path, issues, readOnly = false, compact = false, bare = false, root = false, focusSection, idKey, cellLabel }: NodeProps) {
  const spec = serialFieldSpec(schema, name);
  const node = fieldCore(schema);
  if (spec.hidden || ADVANCED_FIELDS.has(name) || spec.kind === "literal") return null;

  const inert = readOnly || Boolean(spec.readOnly);
  const text = pathText(path);
  const anchor = anchorClass(text);
  const own = issues.filter(issue => issue.path === text);
  const error = own.find(issue => issue.severity === "error")?.message ?? own[0]?.message;
  const unset = value === undefined && spec.optional;
  const label = spec.label;
  const hint = spec.help;
  const wrap = (control: ReactNode): ReactNode => bare ? control : <Field label={cellLabel ?? label} labelHidden={cellLabel !== undefined} hint={hint} unit={spec.unit} compact={compact} error={error}
    dirty={base !== undefined && !same(base, value)} resolved={unset ? absent(path) : undefined} disabled={inert} className={anchor}>{control}</Field>;

  if (node instanceof ObjectSchema) {
    const current = asObject(value);
    const setKey = (key: string, next: unknown) => {
      // The first edit of an optional object that is not set writes the whole default shape, so the
      // record never holds a half-built object.
      const start = unset ? asObject(defaultFieldValue(node)) : current;
      const out = { ...start };
      if (next === undefined) delete out[key]; else out[key] = next;
      onChange(out);
    };
    const body = <ObjectBody node={node} value={current} base={asObject(base)} setKey={setKey} path={path} issues={issues} readOnly={inert}
      focusSection={root ? focusSection : undefined} idKey={root ? idKey : undefined} matrices={!bare} titled={root} />;
    if (root || bare) return body;
    return <Section title={label} className={anchor}>{body}</Section>;
  }

  if (node instanceof ArraySchema) {
    const item = node.item as Schema;
    const items = Array.isArray(value) ? value as unknown[] : [];
    // Rows that carry a saved identity cannot be added, removed or reordered; their fields still edit.
    const locked = containsIdentity(item);
    const objectRows = fieldCore(item) instanceof ObjectSchema;
    const listHint = [hint, locked ? "Membership and order are fixed: the rows carry save identity." : undefined].filter(Boolean).join(" · ") || undefined;
    const stack = stackOf(item);
    const pick = spec.weight || spec.probability ? onlyRef(item, spec.weight ?? spec.probability!) : undefined;
    const rowOf = (entry: unknown, api: ListItemApi<unknown>): ReactNode => stack
      ? <StackRow schema={item} stack={stack} label={`${singular(label)} ${api.index + 1}`} value={asObject(entry)} readOnly={inert} onChange={api.update} />
      : pick
        ? <RefField kind={pick.ref} label={`${singular(label)} ${api.index + 1}`} bare className="w-60" value={typeof asObject(entry)[pick.key] === "string" ? asObject(entry)[pick.key] as string || undefined : undefined} readOnly={inert}
          onChange={next => api.update({ ...asObject(entry), [pick.key]: next ?? "" })} />
      : <FieldNode schema={item} name={name} value={entry} onChange={api.update} path={[...path, api.index]} issues={issues} readOnly={inert} bare />;
    const shared = {
      items, readOnly: inert || locked, ordered: Boolean(spec.ordered), min: spec.minLength ?? 0, max: spec.maxLength,
      addLabel: `Add ${singular(label)}`, onAdd: () => defaultFieldValue(item), emptyText: "None",
      summarize: objectRows && !stack && !pick ? (entry: unknown, index: number) => rowSummary(item, entry, index) : undefined,
      className: anchor, ...(bare ? {} : { label, hint: listHint }),
    };
    if (spec.weight || spec.probability) {
      return <WeightedList<Record<string, unknown>> {...shared} items={items as Record<string, unknown>[]} weightKey={spec.weight} probabilityKey={spec.probability} keepTotal={Boolean(spec.weight)}
        onAdd={() => defaultFieldValue(item) as Record<string, unknown>} onChange={next => onChange(next)} renderItem={(entry, api) => rowOf(entry, api as ListItemApi<unknown>)} />;
    }
    const list = <ListField<unknown> {...shared} onChange={next => onChange(next)} renderItem={rowOf} />;
    // A list of an enum or an option kind is a set of chips, when the set is small and the order carries nothing.
    const itemSpec = serialFieldSpec(item);
    if (!spec.ordered && !locked && (itemSpec.choices || itemSpec.ref) && items.every(entry => typeof entry === "string")) {
      return <MultiChoiceField label={bare ? undefined : label} hint={bare ? undefined : hint} value={items as string[]} onChange={next => onChange(next)} readOnly={inert}
        choices={itemSpec.choices?.map(String)} kind={itemSpec.choices ? undefined : itemSpec.ref} dirty={base !== undefined && !same(base, value)} fallback={list} />;
    }
    return list;
  }

  if (node instanceof TupleSchema) {
    const parts = node.items as readonly Schema[];
    const values = Array.isArray(value) ? value as unknown[] : [];
    const setAt = (index: number, next: unknown) => onChange(parts.map((part, at) => at === index ? next : values[at] ?? defaultFieldValue(part)));
    return wrap(<span className="inline-flex items-center gap-1.5">{parts.map((part, index) => <Fragment key={index}>
      {index > 0 && parts.length === 2 && <span aria-hidden className="text-xs text-faint">–</span>}
      <FieldNode schema={part} name={`${label} ${index + 1}`} value={values[index]} onChange={next => setAt(index, next)}
        path={[...path, index]} issues={issues} readOnly={inert} bare />
    </Fragment>)}</span>);
  }

  if (node instanceof RecordSchema) {
    const keySpec = node.key ? serialFieldSpec(node.key) : undefined;
    const entrySchema = node.value as Schema;
    const current = asObject(value);
    return <MapField label={bare ? undefined : label} hint={bare ? undefined : hint} value={current} onChange={next => onChange(next)}
      keys={keySpec?.choices?.map(String)} keyLabel={keySpec?.label.toLowerCase() ?? "key"} readOnly={inert || containsIdentity(entrySchema)}
      compact={compact} className={anchor} defaultValue={() => defaultFieldValue(entrySchema)}
      counts={serialFieldSpec(entrySchema).kind === "number" ? { min: serialFieldSpec(entrySchema).min, max: serialFieldSpec(entrySchema).max, integer: serialFieldSpec(entrySchema).integer } : undefined}
      renderValue={(key, entry, update) => <FieldNode schema={entrySchema} name={key} value={entry} onChange={update} path={[...path, key]} issues={issues} readOnly={inert} bare />} />;
  }

  if (spec.variants && !spec.choices) {
    return <UnionField schema={schema} value={value} onChange={onChange} renderRef={renderRef} readOnly={inert} compact={compact}
      kindLabel={bare ? undefined : label} className={anchor} />;
  }

  if (spec.choices) {
    const choices = spec.choices;
    return wrap(<ChoiceField value={value === undefined || value === null ? undefined : String(value)} options={choices.map(choice => String(choice))}
      allowEmpty={spec.optional ? "none" : undefined} readOnly={inert} ariaLabel={bare ? label : undefined}
      onChange={next => onChange(next === undefined ? undefined : choices.find(choice => String(choice) === next))} />);
  }

  switch (spec.kind) {
    case "number":
      return wrap(<NumberField value={typeof value === "number" ? value : undefined} optional={spec.optional} integer={spec.integer} min={lowerBound(spec)} max={upperBound(spec)}
        step={spec.step} unit={spec.unit} readOnly={inert} placeholder={spec.optional ? "none" : undefined} ariaLabel={bare ? label : undefined} onChange={onChange} />);
    case "string": {
      const current = typeof value === "string" ? value : undefined;
      const set = (next: string | undefined) => onChange(spec.optional && !next ? undefined : next ?? "");
      if (spec.ref) {
        return <RefField kind={spec.ref} value={current} onChange={set} label={label} hint={hint} optional={spec.optional} readOnly={inert}
          error={error} dirty={base !== undefined && !same(base, value)} compact={compact} bare={bare} className={bare ? undefined : anchor} />;
      }
      return wrap(<TextField value={current ?? ""} multiline={spec.multiline} mono={Boolean(spec.identity)} width={spec.multiline ? "full" : spec.identity ? "id" : "text"} readOnly={inert}
        placeholder={spec.optional ? "none" : undefined} ariaLabel={bare ? label : undefined} onChange={set} />);
    }
    case "boolean":
      return wrap(<ToggleField value={value === true} readOnly={inert} ariaLabel={bare ? label : undefined} onChange={onChange} />);
  }
  return wrap(<Static mono title="No typed control for this value">{JSON.stringify(value) ?? "—"}</Static>);
}

const COUNT_KEYS = new Set(["quantity", "count", "amount"]);
interface Stack { item: string; count: string }

/** An object that is an item reference and how many of it, with nothing else to edit. */
function stackOf(schema: Schema): Stack | undefined {
  const core = fieldCore(schema);
  if (!(core instanceof ObjectSchema)) return undefined;
  const entries = (Object.entries(core.fields) as [string, Schema][]).filter(([key, field]) => { const spec = serialFieldSpec(field, key); return !spec.hidden && spec.kind !== "literal"; });
  const pair = stackKeys(entries);
  return pair && entries.length === 2 ? pair : undefined;
}

/** An object that is one reference plus the list's weight or chance key. */
function onlyRef(schema: Schema, numberKey: string): { key: string; ref: string } | undefined {
  const core = fieldCore(schema);
  if (!(core instanceof ObjectSchema)) return undefined;
  const entries = (Object.entries(core.fields) as [string, Schema][]).filter(([key, field]) => { const spec = serialFieldSpec(field, key); return key !== numberKey && !spec.hidden && spec.kind !== "literal"; });
  const spec = entries.length === 1 ? serialFieldSpec(entries[0]![1], entries[0]![0]) : undefined;
  return spec?.ref ? { key: entries[0]![0], ref: spec.ref } : undefined;
}

function stackKeys(entries: readonly [string, Schema][]): Stack | undefined {
  const item = entries.find(([key, field]) => serialFieldSpec(field, key).ref === "item")?.[0];
  const count = entries.find(([key, field]) => COUNT_KEYS.has(key) && serialFieldSpec(field, key).kind === "number")?.[0];
  return item && count ? { item, count } : undefined;
}

function StackRow({ schema, stack, label, value, readOnly, onChange }: { schema: Schema; stack: Stack; label: string; value: Record<string, unknown>; readOnly: boolean; onChange: (next: Record<string, unknown>) => void }) {
  const fields = (fieldCore(schema) as ObjectSchema<Record<string, Schema>>).fields;
  const countSpec = serialFieldSpec(fields[stack.count] as Schema, stack.count);
  const low = countSpec.min ?? (countSpec.exclusiveMin !== undefined ? countSpec.exclusiveMin + 1 : 1);
  return <StackField kind={serialFieldSpec(fields[stack.item] as Schema, stack.item).ref} label={label} className="w-72" readOnly={readOnly}
    value={typeof value[stack.item] === "string" && value[stack.item] ? value[stack.item] as string : undefined} onChange={next => onChange({ ...value, [stack.item]: next ?? "" })}
    quantity={typeof value[stack.count] === "number" ? value[stack.count] as number : low} min={low} onQuantityChange={next => onChange({ ...value, [stack.count]: next })} />;
}

type Block = { kind: "field"; entry: [string, Schema] } | { kind: "group"; name: string; entries: [string, Schema][] } | { kind: "matrix"; entries: [string, Schema][]; keys: string[] } | { kind: "stack"; entry: [string, Schema] };

/** The number fields of an object schema, when that is all it holds. */
function numberKeys(schema: Schema): string[] | undefined {
  const core = fieldCore(schema);
  if (!(core instanceof ObjectSchema)) return undefined;
  const entries = (Object.entries(core.fields) as [string, Schema][]).filter(([key, field]) => !serialFieldSpec(field, key).hidden);
  if (!entries.length || entries.some(([key, field]) => { const spec = serialFieldSpec(field, key); return spec.kind !== "number" || spec.ref; })) return undefined;
  return entries.map(([key]) => key);
}

/** "Bonuses base" and "Bonuses per level" share "Bonuses "; the columns read "Base" and "Per level". */
function commonPrefix(labels: readonly string[]): string {
  const words = labels.map(label => label.split(" "));
  let shared = 0;
  while (words.every(parts => parts.length > shared + 1 && parts[shared] === words[0]![shared])) shared++;
  return words[0]!.slice(0, shared).join(" ");
}

/**
 * The fields of one object. Scalars that share a schema `group` are laid out together in one
 * compact grid; everything else is a row of its own, in schema order.
 */
function ObjectBody({ node, value, base, setKey, path, issues, readOnly, focusSection, idKey, matrices = false, titled = false }: {
  node: ObjectSchema<Record<string, Schema>>; value: Record<string, unknown>; base: Record<string, unknown>;
  setKey: (key: string, next: unknown) => void; path: Path; issues: readonly Issue[]; readOnly: boolean; focusSection?: string; idKey?: string;
  /** Draw a run of like number groups as one table. */
  matrices?: boolean;
  /** At the top of a record a table gets its own section heading; inside a section it sits in the body. */
  titled?: boolean;
}) {
  const entries = (Object.entries(node.fields) as [string, Schema][]).filter(([key, field]) => !ADVANCED_FIELDS.has(key) && !serialFieldSpec(field, key).hidden);
  if (focusSection) entries.sort(([a], [b]) => a === focusSection ? -1 : b === focusSection ? 1 : 0);
  const blocks: Block[] = [];
  const groups = new Map<string, Block & { kind: "group" }>();
  const pair = stackKeys(entries);
  for (const entry of entries) {
    const spec = serialFieldSpec(entry[1], entry[0]);
    if (pair && entry[0] === pair.count) continue;
    if (pair && entry[0] === pair.item) { blocks.push({ kind: "stack", entry }); continue; }
    // Objects of the same number fields, one after another (a balance table's rows, a curve's base and
    // per-level bonuses), are one matrix rather than a stack of sections.
    const keys = matrices ? numberKeys(entry[1]) : undefined;
    const last = blocks.at(-1);
    if (keys && last?.kind === "matrix" && same(last.keys, keys)) { last.entries.push(entry); continue; }
    if (keys) { blocks.push({ kind: "matrix", entries: [entry], keys }); continue; }
    if (spec.group && SCALAR_KINDS.has(spec.kind)) {
      let block = groups.get(spec.group);
      if (!block) { block = { kind: "group", name: spec.group, entries: [] }; groups.set(spec.group, block); blocks.push(block); }
      block.entries.push(entry);
    } else blocks.push({ kind: "field", entry });
  }
  const preserved = Object.keys(value).filter(key => !Object.hasOwn(node.fields, key) && !ADVANCED_FIELDS.has(key));
  const field = ([key, schema]: [string, Schema], compact: boolean) => <FieldNode key={key} schema={schema} name={key} value={value[key]} base={base[key]}
    onChange={next => setKey(key, next)} path={[...path, key]} issues={issues} readOnly={readOnly || key === idKey} compact={compact} />;

  const matrix = (block: Block & { kind: "matrix" }) => {
    if (block.entries.length === 1) return field(block.entries[0]!, false);
    const labels = block.entries.map(([key, schema]) => serialFieldSpec(schema, key).label);
    const prefix = commonPrefix(labels);
    const inner = (fieldCore(block.entries[0]![1]) as ObjectSchema<Record<string, Schema>>).fields;
    const cell = ([outer, schema]: [string, Schema], key: string, name: string) => {
      const current = asObject(value[outer]);
      return <FieldNode key={`${outer}.${key}`} schema={inner[key] as Schema} name={key} value={current[key]} base={asObject(base[outer])[key]} cellLabel={name}
        onChange={next => { const start = value[outer] === undefined ? asObject(defaultFieldValue(schema)) : current; const out = { ...start }; if (next === undefined) delete out[key]; else out[key] = next; setKey(outer, out); }}
        path={[...path, outer, key]} issues={issues} readOnly={readOnly} />;
    };
    const short = (label: string) => { const rest = label.slice(prefix.length).trim(); return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : label; };
    // The longer dimension runs down the page: many groups of two numbers are rows, two groups of many numbers are columns.
    const table = block.entries.length >= block.keys.length
      ? <StatMatrix key={`matrix:${block.entries[0]![0]}`} columns={block.keys.map(key => serialFieldSpec(inner[key] as Schema, key).label)}
        rows={block.entries.map((entry, at) => ({ key: entry[0], label: short(labels[at]!), cells: block.keys.map(key => cell(entry, key, `${labels[at]} ${serialFieldSpec(inner[key] as Schema, key).label}`)) }))} />
      : <StatMatrix key={`matrix:${block.entries[0]![0]}`} columns={labels.map(short)}
        rows={block.keys.map(key => { const name = serialFieldSpec(inner[key] as Schema, key).label; return { key, label: name, cells: block.entries.map((entry, at) => cell(entry, key, `${labels[at]} ${name}`)) }; })} />;
    return titled ? <Section key={`matrix:${block.entries[0]![0]}`} title={prefix || "Values"}>{table}</Section> : table;
  };

  return <>
    {blocks.map(block => block.kind === "group"
      ? <Fields key={`group:${block.name}`} className="mt-0.5 mb-1">{block.entries.map(entry => field(entry, true))}</Fields>
      : block.kind === "matrix" ? matrix(block)
      : block.kind === "stack" && pair ? <Field key={`stack:${block.entry[0]}`} label={serialFieldSpec(block.entry[1], block.entry[0]).label} dirty={!same(base[pair.item], value[pair.item]) || !same(base[pair.count], value[pair.count])} className={anchorClass(pathText([...path, block.entry[0]]))}>
        <StackRow schema={node} stack={pair} label={serialFieldSpec(block.entry[1], block.entry[0]).label} value={value} readOnly={readOnly} onChange={next => { const key = same(next[pair.item], value[pair.item]) ? pair.count : pair.item; setKey(key, next[key]); }} />
      </Field>
      : field(block.entry, false))}
    {preserved.map(key => <Field key={key} label={fieldTitle(key)} hint="Unrecognized field, kept as is." disabled>
      <Static mono>{JSON.stringify(value[key])}</Static>
    </Field>)}
  </>;
}

/** An exclusive bound on an integer is the next integer; on a real number validation flags it. */
const lowerBound = (spec: SerialFieldSpec): number | undefined => spec.min ?? (spec.exclusiveMin !== undefined && spec.integer ? spec.exclusiveMin + 1 : undefined);
const upperBound = (spec: SerialFieldSpec): number | undefined => spec.max ?? (spec.exclusiveMax !== undefined && spec.integer ? spec.exclusiveMax - 1 : undefined);

/** "Bonus rolls" adds one bonus roll; a list label names the set, the add row names a member. */
const singular = (label: string): string => label.toLowerCase().replace(/ies$/, "y").replace(/([^s])s$/, "$1");

/** The one-line sentence a collapsed object row shows: its name, then its first short values. */
function rowSummary(schema: Schema, value: unknown, index: number): string {
  const node = fieldCore(schema);
  const row = asObject(value);
  if (!(node instanceof ObjectSchema)) return `Row ${index + 1}`;
  const nameKey = recordLabelKey(node);
  const parts: string[] = [];
  const named = nameKey === undefined ? undefined : row[nameKey];
  if (typeof named === "string" && named) parts.push(named);
  for (const [key, field] of Object.entries(node.fields) as [string, Schema][]) {
    if (parts.length >= 3) break;
    if (key === nameKey || ADVANCED_FIELDS.has(key)) continue;
    const spec = serialFieldSpec(field, key);
    if (spec.multiline || spec.hidden) continue;
    const entry = row[key];
    // Beside a name, ids and references are noise: "Crownsilver Sword", not "Crownsilver Sword · gear_mainHand_melee_2400".
    if (parts.length && typeof entry === "string" && (spec.ref || spec.identity || /^[a-z0-9]+(_[a-z0-9]+)+$/i.test(entry))) continue;
    if (typeof entry === "string" && entry) parts.push(entry.length > 48 ? `${entry.slice(0, 48)}…` : entry);
    else if (typeof entry === "number") parts.push(spec.unit ? `${entry} ${spec.unit}` : String(entry));
  }
  return parts.length ? parts.join(" · ") : `Row ${index + 1}`;
}
