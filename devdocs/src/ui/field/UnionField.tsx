import { useState, type ReactNode } from "react";
import {
  ArraySchema, LiteralSchema, ObjectSchema, RecordSchema, TupleSchema, type RefKind, type Schema,
} from "../../../../game/src/content/schema/core.js";
import { defaultFieldValue, fieldCore, fieldTitle, serialFieldSpec, unionVariant } from "../../model/fields.js";
import { ChoiceField } from "./ChoiceField.js";
import { Button } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
import { Field } from "./Field.js";
import { ON_SHEET, useOnSheet } from "../Sheet.js";
import { fieldFromSchema, type SchemaFieldSpec } from "./fromSchema.js";
import { ListField, type ListFieldProps } from "./ListField.js";
import { MapField } from "./MapField.js";
import { StackField } from "./StackField.js";
import { NumberField } from "./NumberField.js";
import { carryOver, variantSchema, variantTag, type CarryOver } from "./reorder.js";
import { TextField } from "./TextField.js";
import { ToggleField } from "./ToggleField.js";


/*
  A discriminated union (quest predicate, dialogue condition, effect) as a `kind` choice followed
  by the chosen variant's fields, each rendered from its schema. Switching variant keeps the fields
  the two variants share by name; when the old variant held a non-default value the new one has no
  place for, an inline row asks before dropping it. JSON is not offered here.

  `SchemaControl` is the renderer underneath: any field schema to the matching control, arrays to
  `ListField`, records to `MapField`, unions back to `UnionField`. Refs go through `renderRef` so
  the page decides how a reference is picked.
*/

export type RenderRef = (kind: RefKind, value: string | undefined, onChange: (value: string | undefined) => void, spec: SchemaFieldSpec) => ReactNode;

export interface UnionFieldProps {
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
  renderRef?: RenderRef;
  /** Label of the variant choice. Defaults to the discriminator's title ("Kind"). */
  kindLabel?: ReactNode;
  readOnly?: boolean;
  compact?: boolean;
  className?: string;
}

type PendingSwitch = { key: string; label: string; result: CarryOver };

const show = (value: unknown): string => typeof value === "string" ? `"${value}"` : JSON.stringify(value) ?? String(value);

export function UnionField({ schema, value, onChange, renderRef, kindLabel, readOnly = false, compact, className = "" }: UnionFieldProps) {
  const spec = serialFieldSpec(schema);
  const variants = spec.variants ?? [];
  const selected = unionVariant(schema, value);
  const member = variantSchema(schema, selected);
  const tag = variantTag(schema);
  const [pending, setPending] = useState<PendingSwitch | null>(null);

  const requestSwitch = (key: string | undefined) => {
    if (!key || key === selected || !member) return;
    const target = variantSchema(schema, key);
    if (!target) return;
    const result = carryOver(member, target, value);
    if (result.dropped.length) setPending({ key, label: variants.find(variant => variant.key === key)?.label ?? key, result });
    else onChange(result.value);
  };
  const confirm = () => { if (pending) { onChange(pending.result.value); setPending(null); } };

  const core = member ? fieldCore(member) : undefined;
  const fields = core instanceof ObjectSchema ? (Object.entries(core.fields) as [string, Schema][]).filter(([key, field]) => key !== tag && !(fieldCore(field) instanceof LiteralSchema) && !serialFieldSpec(field, key).hidden) : [];
  const onSheet = useOnSheet();
  const current = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const setKey = (key: string, next: unknown) => {
    const out = { ...current };
    if (next === undefined) delete out[key]; else out[key] = next;
    onChange(out);
  };

  return <div className={cn(onSheet && !compact ? cn(ON_SHEET, "gap-y-px [&>[role=alert]]:col-start-2") : "flex min-w-0 flex-1 flex-col gap-px", className)} data-pending={pending ? "true" : undefined}>
    <Field label={kindLabel ?? (spec.discriminator ? fieldTitle(spec.discriminator) : "Kind")} compact={compact}>
      <ChoiceField value={pending?.key ?? selected} options={variants.map(variant => ({ value: variant.key, label: variant.label }))} readOnly={readOnly} onChange={requestSwitch} />
    </Field>
    {pending && <div className="my-px flex min-h-6 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-sm bg-warn-soft px-2 py-0.5 text-xs text-foreground" role="alert">
      <span>Switching to {pending.label} drops {pending.result.dropped.map(drop => `${drop.label} (${show(drop.value)})`).join(", ")}.</span>
      <Button variant="link" size="xs" className="font-medium" onClick={confirm}>Switch</Button>
      <Button variant="link" size="xs" className="font-medium" onClick={() => setPending(null)}>Keep</Button>
    </div>}
    <ObjectFields entries={fields} current={current} setKey={setKey} renderRef={renderRef} readOnly={readOnly} compact={compact} />
  </div>;
}

export interface SchemaControlProps {
  schema: Schema;
  /** The field's key: titles the label when the schema has none. Empty for an array item. */
  name: string;
  value: unknown;
  onChange: (value: unknown) => void;
  renderRef?: RenderRef;
  readOnly?: boolean;
  compact?: boolean;
  /** Render the control alone, without a `Field` wrapper: for a list row or a tuple cell. */
  bare?: boolean;
}

/** Any field schema to the control that edits it. */
export function SchemaControl({ schema, name, value, onChange, renderRef, readOnly = false, compact, bare = false }: SchemaControlProps) {
  const spec = fieldFromSchema(schema, name);
  const node = fieldCore(schema);
  const inert = readOnly || spec.readOnly;
  const wrap = (control: ReactNode): ReactNode => bare ? control : <Field label={spec.label} hint={spec.hint} unit={spec.unit} compact={compact}>{control}</Field>;

  switch (spec.kind) {
    case "number":
      return wrap(<NumberField value={typeof value === "number" ? value : undefined} optional={spec.optional} integer={spec.integer} min={spec.min} max={spec.max} step={spec.step} unit={spec.unit} readOnly={inert} placeholder={spec.optional ? "none" : undefined} ariaLabel={bare ? spec.label : undefined} onChange={onChange} />);
    case "string": {
      const text = typeof value === "string" ? value : undefined;
      const set = (next: string | undefined) => onChange(spec.optional && !next ? undefined : next ?? "");
      if (spec.ref && renderRef) return wrap(renderRef(spec.ref, text, set, spec));
      return wrap(<TextField value={text ?? ""} mono={Boolean(spec.ref)} width={spec.ref ? "id" : spec.multiline ? "full" : "text"} multiline={spec.multiline} readOnly={inert} placeholder={spec.optional ? "none" : undefined} ariaLabel={bare ? spec.label : undefined} onChange={set} />);
    }
    case "enum":
      return wrap(<ChoiceField value={typeof value === "string" ? value : undefined} options={spec.choices ?? []} allowEmpty={spec.optional ? "none" : undefined} readOnly={inert} ariaLabel={bare ? spec.label : undefined} onChange={onChange} />);
    case "boolean":
      return wrap(<ToggleField value={value === true} readOnly={inert} ariaLabel={bare ? spec.label : undefined} onChange={onChange} />);
    case "literal":
      return null;
    case "union":
      return <UnionField schema={schema} value={value} onChange={onChange} renderRef={renderRef} readOnly={inert} compact={compact} kindLabel={bare ? undefined : spec.label} />;
    case "array": {
      if (!(node instanceof ArraySchema)) break;
      const item = node.item as Schema;
      const items = Array.isArray(value) ? value as unknown[] : [];
      const props: ListFieldProps<unknown> = {
        items, onChange, readOnly: inert, ordered: Boolean(serialFieldSpec(schema).ordered), min: spec.optional ? 0 : (node.options.minLength ?? 0), max: node.options.maxLength,
        addLabel: `Add ${spec.label.toLowerCase()}`, onAdd: () => defaultFieldValue(item), compact,
        renderItem: (entry, api) => <SchemaControl schema={item} name="" value={entry} onChange={api.update} renderRef={renderRef} readOnly={inert} compact={compact} bare />,
      };
      return bare ? <ListField {...props} /> : <ListField {...props} label={spec.label} hint={spec.hint} />;
    }
    case "tuple": {
      if (!(node instanceof TupleSchema)) break;
      const parts = node.items as readonly Schema[];
      const values = Array.isArray(value) ? value as unknown[] : parts.map(part => defaultFieldValue(part));
      return wrap(<span className="inline-flex items-center gap-1.5">{parts.map((part, index) => <SchemaControl key={index} schema={part} name={`${spec.label} ${index + 1}`} value={values[index]} onChange={next => onChange(values.map((existing, at) => at === index ? next : existing))} renderRef={renderRef} readOnly={inert} bare />)}</span>);
    }
    case "object": {
      if (!(node instanceof ObjectSchema)) break;
      const current = value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
      const entries = (Object.entries(node.fields) as [string, Schema][]).filter(([key, field]) => !serialFieldSpec(field, key).hidden);
      const setKey = (key: string, next: unknown) => { const out = { ...current }; if (next === undefined) delete out[key]; else out[key] = next; onChange(out); };
      return <div className="min-w-0 flex flex-1 flex-col gap-px"><ObjectFields entries={entries} current={current} setKey={setKey} renderRef={renderRef} readOnly={inert} compact={compact} /></div>;
    }
    case "record": {
      if (!(node instanceof RecordSchema)) break;
      const keySpec = node.key ? serialFieldSpec(node.key) : undefined;
      const current = value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
      const valueSchema = node.value as Schema;
      return <MapField label={bare ? undefined : spec.label} hint={spec.hint} value={current} onChange={onChange} keys={keySpec?.choices?.map(String)} keyLabel={keySpec?.label.toLowerCase() ?? "key"} readOnly={inert} compact={compact}
        defaultValue={() => defaultFieldValue(valueSchema)}
        renderValue={(key, entry, update) => <SchemaControl schema={valueSchema} name={key} value={entry} onChange={update} renderRef={renderRef} readOnly={inert} bare />} />;
    }
  }
  return wrap(<span className="inline-flex min-h-7 items-center font-mono text-xs" title="No typed control for this value">{JSON.stringify(value) ?? "—"}</span>);
}

export interface UnionListProps {
  label?: ReactNode;
  hint?: string;
  /** The union schema of one item (`questPredicateSchema`), not the array around it. */
  schema: Schema;
  items: readonly unknown[];
  onChange: (items: unknown[]) => void;
  /** The collapsed row: "Has 3 × Fox Fur". Enter or click expands the row to its fields. */
  summarize: (item: unknown, index: number) => string;
  renderRef?: RenderRef;
  ordered?: boolean;
  keyOf?: (item: unknown, index: number) => string | number;
  readOnly?: boolean;
  addLabel?: string;
  emptyText?: string;
  max?: number;
  min?: number;
  compact?: boolean;
  className?: string;
}

/** A `ListField` of `UnionField`s, each row collapsed to its sentence. */
export function UnionList({ schema, summarize, renderRef, readOnly, compact, addLabel = "Add", ...rest }: UnionListProps) {
  return <ListField<unknown> {...rest} readOnly={readOnly} compact={compact} summarize={summarize} addLabel={addLabel} onAdd={() => defaultFieldValue(schema)}
    className={rest.className}
    renderItem={(item, api) => <UnionField schema={schema} value={item} onChange={api.update} renderRef={renderRef} readOnly={readOnly} compact={compact} />} />;
}

const COUNT_KEYS = new Set(["quantity", "count", "amount"]);

/** An item reference and its count in the same object ("give 2 × Copper Bar") are one stack. */
function stackKeys(entries: readonly (readonly [string, Schema])[]): { item: string; count: string } | undefined {
  const item = entries.find(([key, field]) => serialFieldSpec(field, key).ref === "item")?.[0];
  const count = entries.find(([key, field]) => COUNT_KEYS.has(key) && serialFieldSpec(field, key).kind === "number")?.[0];
  return item && count ? { item, count } : undefined;
}

function ObjectFields({ entries, current, setKey, renderRef, readOnly, compact }: { entries: readonly (readonly [string, Schema])[]; current: Record<string, unknown>; setKey: (key: string, next: unknown) => void; renderRef?: RenderRef; readOnly: boolean; compact?: boolean }) {
  const stack = stackKeys(entries);
  return <>{entries.map(([key, field]) => {
    if (stack && key === stack.count) return null;
    if (stack && key === stack.item) {
      const itemSpec = fieldFromSchema(field, key);
      const countSpec = fieldFromSchema(entries.find(([other]) => other === stack.count)![1], stack.count);
      const low = countSpec.min ?? 1;
      return <Field key={key} label={itemSpec.label} hint={itemSpec.hint} compact={compact}>
        <StackField label={itemSpec.label} value={typeof current[key] === "string" ? current[key] as string : undefined} readOnly={readOnly || itemSpec.readOnly} onChange={next => setKey(key, next)}
          quantity={typeof current[stack.count] === "number" ? current[stack.count] as number : low} min={low} onQuantityChange={next => setKey(stack.count, next)} />
      </Field>;
    }
    return <SchemaControl key={key} schema={field} name={key} value={current[key]} onChange={next => setKey(key, next)} renderRef={renderRef} readOnly={readOnly} compact={compact} />;
  })}</>;
}
