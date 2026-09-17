import { useState, type ReactNode } from "react";
import { LiteralSchema, ObjectSchema, type Schema } from "../../../../game/src/content/schema/core.js";
import { fieldCore, serialFieldSpec, unionVariant } from "../../model/fields.js";
import { Button } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
import { ChoiceField } from "./ChoiceField.js";
import { fieldFromSchema } from "./fromSchema.js";
import { NumberField } from "./NumberField.js";
import { RefField } from "./RefField.js";
import { carryOver, variantSchema, variantTag, type CarryOver } from "./reorder.js";
import { StackField } from "./StackField.js";
import { TextField } from "./TextField.js";
import { ToggleField } from "./ToggleField.js";
import { UnionField, type RenderRef } from "./UnionField.js";

/*
  One variant of a discriminated union on one line: the kind, then its fields as bare controls, each
  number or text with a short word in front so the line reads as a phrase.

    [Visit ▾]  [◉ Blackwater Pools]  within [ — ] m
    [Gather ▾] [🜲 Copper Ore × 6]
    [Flag ▾]   [saw_great_cairn]  ☐ unset

  An item and its count are one stack. A field that cannot sit on a line (a nested list or union)
  sends the whole value back to `UnionField`.
*/

const COUNT_KEYS = new Set(["quantity", "count", "amount"]);
const INLINE_KINDS = new Set(["number", "string", "boolean", "enum"]);

export function UnionRow({ schema, value, onChange, renderRef, readOnly = false, label, className }: {
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
  renderRef?: RenderRef;
  readOnly?: boolean;
  /** Names the controls for assistive tech ("Condition B"). */
  label: string;
  className?: string;
}) {
  const [pending, setPending] = useState<{ key: string; label: string; result: CarryOver } | null>(null);
  const spec = serialFieldSpec(schema);
  const variants = spec.variants ?? [];
  const selected = unionVariant(schema, value);
  const member = variantSchema(schema, selected);
  const tag = variantTag(schema);
  const core = member ? fieldCore(member) : undefined;
  const fields = core instanceof ObjectSchema
    ? (Object.entries(core.fields) as [string, Schema][]).filter(([key, field]) => key !== tag && !(fieldCore(field) instanceof LiteralSchema) && !serialFieldSpec(field, key).hidden)
    : [];
  const inline = fields.every(([key, field]) => { const own = serialFieldSpec(field, key); return own.ref !== undefined || INLINE_KINDS.has(own.kind); });
  if (!inline) return <UnionField schema={schema} value={value} onChange={onChange} renderRef={renderRef} readOnly={readOnly} compact />;

  const current = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const setKey = (key: string, next: unknown) => { const out = { ...current }; if (next === undefined) delete out[key]; else out[key] = next; onChange(out); };
  const switchTo = (key: string | undefined) => {
    if (!key || key === selected || !member) return;
    const target = variantSchema(schema, key);
    if (!target) return;
    const result = carryOver(member, target, value);
    if (result.dropped.length) setPending({ key, label: variants.find(variant => variant.key === key)?.label ?? key, result });
    else onChange(result.value);
  };

  const itemKey = fields.find(([key, field]) => serialFieldSpec(field, key).ref === "item")?.[0];
  const countKey = itemKey ? fields.find(([key, field]) => COUNT_KEYS.has(key) && serialFieldSpec(field, key).kind === "number")?.[0] : undefined;
  const word = (text: string) => <span className="shrink-0 text-[11px] text-faint">{text}</span>;

  const controls: ReactNode[] = fields.map(([key, field]) => {
    const own = serialFieldSpec(field, key);
    const name = `${label} ${own.label.toLowerCase()}`;
    const raw = current[key];
    if (key === countKey) return null;
    if (key === itemKey && countKey) {
      const countSpec = serialFieldSpec(fields.find(([other]) => other === countKey)![1], countKey);
      const low = countSpec.min ?? 1;
      return <StackField key={key} label={name} className="w-60 min-w-0 shrink" value={typeof raw === "string" && raw ? raw : undefined} readOnly={readOnly} onChange={next => setKey(key, next)}
        quantity={typeof current[countKey] === "number" ? current[countKey] as number : low} min={low} onQuantityChange={next => setKey(countKey, next)} />;
    }
    if (own.ref) {
      const text = typeof raw === "string" && raw ? raw : undefined;
      return renderRef
        ? <span key={key} className="inline-flex w-60 min-w-0 shrink [&_.field]:w-full [&_.field-body]:w-full [&_.ref-control]:w-full [&_.ref-chip]:w-full [&_.ref-chip]:min-w-0">{renderRef(own.ref, text, next => setKey(key, own.optional && !next ? undefined : next ?? ""), { ...fieldFromSchema(field, key), label: name })}</span>
        : <RefField key={key} bare className="w-60 min-w-0 shrink [&_.ref-control]:w-full [&_.ref-chip]:w-full [&_.ref-chip]:min-w-0" kind={own.ref} label={name} optional={own.optional} value={text} readOnly={readOnly} onChange={next => setKey(key, own.optional && !next ? undefined : next ?? "")} />;
    }
    switch (own.kind) {
      case "number": return <span key={key} className="inline-flex shrink-0 items-center gap-1">{word(own.label.toLowerCase())}
        <NumberField value={typeof raw === "number" ? raw : undefined} optional={own.optional} integer={own.integer} min={own.min} max={own.max} step={own.step} unit={own.unit}
          placeholder={own.optional ? "—" : undefined} readOnly={readOnly} ariaLabel={name} onChange={next => setKey(key, next)} /></span>;
      case "boolean": return <span key={key} className="inline-flex shrink-0 items-center gap-1">{word(own.label.toLowerCase())}
        <ToggleField value={raw === true} readOnly={readOnly} ariaLabel={name} onChange={next => setKey(key, next)} /></span>;
      case "enum": return <ChoiceField key={key} display="select" value={typeof raw === "string" ? raw : undefined} options={(own.choices ?? []).map(String)} allowEmpty={own.optional ? "—" : undefined} readOnly={readOnly} ariaLabel={name} onChange={next => setKey(key, next)} />;
      default: return <TextField key={key} value={typeof raw === "string" ? raw : ""} mono width="short" placeholder={own.label.toLowerCase()} readOnly={readOnly} ariaLabel={name}
        onChange={next => setKey(key, own.optional && !next ? undefined : next)} />;
    }
  });

  return <div className={cn("flex min-w-0 flex-col gap-1", className)}>
    {/* One line: the target control gives way (its name truncates) before the line would wrap. */}
    <div className="flex min-w-0 flex-nowrap items-center gap-1.5">
      <ChoiceField display="select" className="w-32 shrink-0" value={pending?.key ?? selected} options={variants.map(variant => ({ value: variant.key, label: variant.label }))} readOnly={readOnly} ariaLabel={`${label} kind`} onChange={switchTo} />
      {controls}
    </div>
    {pending && <div className="flex min-h-6 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-sm bg-warn-soft px-2 py-0.5 text-xs text-foreground" role="alert">
      <span>Switching to {pending.label} drops {pending.result.dropped.map(drop => drop.label).join(", ")}.</span>
      <Button variant="link" size="xs" className="font-medium" onClick={() => { onChange(pending.result.value); setPending(null); }}>Switch</Button>
      <Button variant="link" size="xs" className="font-medium" onClick={() => setPending(null)}>Keep</Button>
    </div>}
  </div>;
}
