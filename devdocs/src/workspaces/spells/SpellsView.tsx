import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { SpellSchema } from "../../../../game/src/content/schema/spells.js";
import { collectionQuery } from "../../api/client.js";
import type { ContentRow } from "../../model/contracts.js";
import { fieldPath } from "../../model/fields.js";
import { contentRows } from "../../model/rows.js";
import { iconForElement, spellThumb, titleCase, hueFor } from "../../model/summaries.js";
import { Thumb } from "../../ui/Thumb.js";
import { EntitySummary } from "../../ui/EntitySummary.js";
import {
  ChoiceField, Field, Fields, ListField, NumberField, RefField, ReferencedBy, Section, Sheet, TextField, ToggleField,
} from "../../ui/field/index.js";
import { ErrorState, LoadingRows } from "../../ui/States.js";
import type { ViewProps } from "../types.js";
import { asRecord, list, num, PageState, RecordShell, text, usePage } from "../story/shared.js";
import { EmptyCell, Table, TableBody, TableCell, TableFrame, TableHead, TableHeader, TableRow } from "../../components/ui/index.js";
import { FACTS, PAGE, PAGE_HEADING } from "../../ui/layout.js";
import { cn } from "../../lib/utils.js";

interface Spell extends ContentRow {
  id: string; name: string; element?: string; rung?: string; rank?: number; reqLevel?: number; tier?: number; baseMax?: number; divisor?: number; baseXp?: number; castMs?: number;
  cost?: { element?: string; charges?: number; runes?: { itemId: string; quantity: number }[] }; description?: string; catalog?: string; aoe?: boolean;
}

const ELEMENTS = ["wind", "water", "earth", "fire"] as const;
const RUNGS = ["lash", "bolt", "burst", "surge"] as const;
/** Advanced spells are one per element per rank; the rung only sets their flight shape. */
const RANKS = [1, 2, 3, 4, 5] as const;

export default function SpellsView({ recordId, navigate }: ViewProps) {
  if (recordId === undefined) return <SpellMatrix navigate={navigate} />;
  return <SpellPage id={recordId} navigate={navigate} />;
}

/* ---------- Matrix ---------- */

function SpellMatrix({ navigate }: { navigate: ViewProps["navigate"] }) {
  const query = useQuery(collectionQuery("spells"));
  const rows = useMemo(() => (query.data ? contentRows(query.data) : []) as Spell[], [query.data]);
  const basic = useMemo(() => rows.filter(row => row.catalog !== "ADVANCED_SPELLS"), [rows]);
  const advanced = useMemo(() => rows.filter(row => row.catalog === "ADVANCED_SPELLS").sort((a, b) => (num(a.reqLevel) ?? 0) - (num(b.reqLevel) ?? 0)), [rows]);
  if (query.isPending) return <div className={PAGE}><LoadingRows /></div>;
  if (query.isError) return <ErrorState message={query.error.message} retry={() => void query.refetch()} />;
  const cell = (spell: Spell) => <button type="button" className="group/spell flex min-w-40 cursor-pointer items-center gap-2 rounded-sm p-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40" key={spell.id} onClick={() => navigate("spells", spell.id)} title={spell.id}>
    <Thumb spec={spellThumb(spell)} size="m" alt="" />
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="text-xs font-semibold whitespace-nowrap group-hover/spell:text-link">{spell.name}</span>
      <span className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">level {num(spell.reqLevel) ?? "?"} · max {num(spell.baseMax) ?? "?"}</span>
    </span>
  </button>;
  const table = <K extends string | number>(spells: Spell[], caption: string, columns: readonly K[], head: (column: K) => string, match: (spell: Spell, column: K) => boolean) => <TableFrame>
    <Table className="min-w-0">
      <caption className="sr-only">{caption}</caption>
      <TableHeader><TableRow><TableHead pin className="px-2.5">Element</TableHead>{columns.map(column => <TableHead key={column} className="px-2.5">{head(column)}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{ELEMENTS.map(element => {
        const Icon = iconForElement(element);
        return <TableRow key={element}>
          <TableCell pin className="pr-4 pl-2.5"><span className="inline-flex items-center gap-1.5" style={{ color: `color-mix(in oklab, hsl(${hueFor(element)} 60% 50%) 70%, var(--color-foreground))` }}><Icon size={13} />{titleCase(element)}</span></TableCell>
          {columns.map(column => {
            const matches = spells.filter(spell => spell.element === element && match(spell, column));
            return <TableCell key={column} className="px-2.5">{matches.length ? <span className="flex flex-col gap-0.5">{matches.map(cell)}</span> : <EmptyCell />}</TableCell>;
          })}
        </TableRow>;
      })}</TableBody>
    </Table>
  </TableFrame>;
  return <div className={PAGE}>
    <div className={PAGE_HEADING}><h1>Standard</h1><span className={FACTS}><span>One spell per element and rung</span></span></div>
    {table(basic, "Standard spells by element and rung", RUNGS, rung => titleCase(rung), (spell, rung) => spell.rung === rung)}
    <div className={cn(PAGE_HEADING, "mt-5")}><h1>Advanced</h1><span className={FACTS}><span>One invocation per element and rank</span></span></div>
    {table(advanced, "Advanced spells by element and rank", RANKS, rank => `Rank ${rank}`, (spell, rank) => spell.rank === rank)}
  </div>;
}

/* ---------- Record ---------- */

type Path = readonly (string | number)[];
/** Label, unit, step, bounds and help come from the spell schema; this page declares no metadata. */
const spellField = (path: Path) => fieldPath(SpellSchema, path);
/**
 * The lowest value the control will accept. An exclusive bound on an integer is the next integer;
 * on a real number there is no next value to clamp to, so validation flags it instead.
 */
const lower = (spec: ReturnType<typeof spellField>): number | undefined =>
  spec?.min ?? (spec?.exclusiveMin !== undefined && spec.integer ? spec.exclusiveMin + 1 : undefined);

/**
 * Which numbers share the first grid. The schema groups the cast cost (`group: "cost"`) and says
 * nothing about the rest, so the order is this page's only layout choice: every label, unit, step
 * and bound still comes from the schema.
 */
const NUMBER_KEYS = ["reqLevel", "tier", "baseMax", "divisor", "baseXp", "castMs"] as const;

function SpellPage({ id, navigate }: { id: string; navigate: ViewProps["navigate"] }) {
  const page = usePage<Spell>("spells", id);
  const { draft, index } = page;
  const readOnly = !draft.editable;
  const set = (path: Path, value: unknown) => draft.setPath(path, value);

  const number = (path: Path, value: number | undefined, compact = false): ReactNode => {
    const spec = spellField(path);
    if (!spec) return null;
    return <Field key={String(path.at(-1))} label={spec.label} hint={spec.help} unit={spec.unit} compact={compact}>
      <NumberField value={value} optional={spec.optional} integer={spec.integer} min={lower(spec)} max={spec.max} step={spec.step} unit={spec.unit}
        readOnly={readOnly} placeholder={spec.optional ? "none" : undefined} onChange={next => set(path, next)} />
    </Field>;
  };
  const choice = (path: Path, value: string | undefined, compact = false): ReactNode => {
    const spec = spellField(path);
    if (!spec) return null;
    return <Field key={String(path.at(-1))} label={spec.label} hint={spec.help} compact={compact}>
      <ChoiceField value={value} options={spec.choices?.map(String) ?? []} allowEmpty={spec.optional ? "none" : undefined} readOnly={readOnly} onChange={next => set(path, next)} />
    </Field>;
  };
  const line = (path: Path, value: string | undefined): ReactNode => {
    const spec = spellField(path);
    if (!spec) return null;
    return <Field label={spec.label} hint={spec.help}>
      <TextField value={value ?? ""} multiline={spec.multiline} width={spec.multiline ? "full" : "text"} readOnly={readOnly} onChange={next => set(path, next)} />
    </Field>;
  };

  return <PageState page={page} collection="spells" navigate={navigate}>{(spell, record) => {
    const cost = asRecord(spell.cost);
    const runes = list(cost.runes).map(asRecord);
    const element = text(spell.element) ?? "wind";
    const runeList = spellField(["cost", "runes"]);
    const runeItem = spellField(["cost", "runes", 0, "itemId"]);
    const runeQuantity = spellField(["cost", "runes", 0, "quantity"]);
    const areaSpell = spellField(["aoe"]);
    const setRunes = (next: ContentRow[]) => set(["cost", "runes"], next.length ? next : undefined);
    return <RecordShell
      thumb={spellThumb(spell)}
      title={spell.name} id={id}
      facts={[titleCase(element), spell.rung && titleCase(spell.rung), `level ${num(spell.reqLevel) ?? "?"}`, `tier ${num(spell.tier) ?? "?"}`, spell.catalog === "ADVANCED_SPELLS" && "advanced"]}
      draft={draft}
      rail={<EntitySummary collection="spells" record={record} recordId={id} index={index} navigate={navigate} editing bare />}>
      <Sheet>
        <Section title="Identity">
          {line(["name"], spell.name)}
          {line(["description"], spell.description)}
          {choice(["element"], text(spell.element))}
          {choice(["rung"], text(spell.rung))}
          {number(["rank"], num(spell.rank))}
          {areaSpell && <Field label={areaSpell.label} hint={areaSpell.help}>
            <ToggleField value={spell.aoe === true} readOnly={readOnly} onChange={next => set(["aoe"], next)} />
          </Field>}
        </Section>
        <Section title="Numbers">
          <Fields>{NUMBER_KEYS.map(key => number([key], num(spell[key]), true))}</Fields>
        </Section>
        <Section title="Cost">
          <Fields>
            {choice(["cost", "element"], text(cost.element), true)}
            {number(["cost", "charges"], num(cost.charges), true)}
          </Fields>
          {runeList && runeItem && runeQuantity && <ListField<ContentRow>
            label={runeList.label} hint={runeList.help} items={runes} readOnly={readOnly} emptyText="No runes."
            addLabel="Add rune" onAdd={() => ({ itemId: "", quantity: 1 })} onChange={setRunes}
            keyOf={(rune, at) => text(rune.itemId) ?? at}
            removeLabel={(_, at) => `Remove rune ${at + 1}`}
            renderItem={(rune, api) => <>
              <RefField bare className="min-w-49" kind={runeItem.ref} label={`${runeItem.label} ${api.index + 1}`} value={text(rune.itemId)} readOnly={readOnly}
                exclude={new Set(runes.map(entry => text(entry.itemId) ?? "").filter((_, at) => at !== api.index))}
                onChange={next => api.update({ ...rune, itemId: next ?? "" })} />
              <NumberField className="w-24 data-[unit]:w-24" value={num(rune.quantity) ?? 1} integer min={lower(runeQuantity)} unit={runeQuantity.unit} readOnly={readOnly}
                ariaLabel={`${runeQuantity.label} ${api.index + 1}`} onChange={next => api.update({ ...rune, quantity: next ?? 1 })} />
            </>} />}
        </Section>
        <ReferencedBy collection="spells" id={id} navigate={navigate} />
      </Sheet>
    </RecordShell>;
  }}</PageState>;
}
