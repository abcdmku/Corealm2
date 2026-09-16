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
import { ChoiceField, Field, Fields, ListField, NumberField, RefField, ReferencedBy, Section, Sheet, TextField, ToggleField } from "../../ui/field/index.js";
import { Card, CardBlock, CardHead, CardLine, CardLines, CardMeta } from "../../ui/gamecard/Card.js";
import { ErrorState, LoadingRows } from "../../ui/States.js";
import type { ViewProps } from "../types.js";
import { asRecord, list, num, PageState, RecordShell, text, usePage } from "../story/shared.js";
import "./spells.css";

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
  if (query.isPending) return <div className="ws-page"><LoadingRows /></div>;
  if (query.isError) return <ErrorState message={query.error.message} retry={() => void query.refetch()} />;
  const cell = (spell: Spell) => <button type="button" className="cell spell-cell" key={spell.id} onClick={() => navigate("spells", spell.id)} title={spell.id}>
    <Thumb spec={spellThumb(spell)} size="m" alt="" />
    <span className="spell-cell-text">
      <span className="spell-cell-name">{spell.name}</span>
      <span className="spell-cell-meta">level {num(spell.reqLevel) ?? "?"} · max {num(spell.baseMax) ?? "?"}</span>
    </span>
  </button>;
  const table = <K extends string | number>(spells: Spell[], caption: string, columns: readonly K[], head: (column: K) => string, match: (spell: Spell, column: K) => boolean) => <div className="matrix spell-matrix">
    <table>
      <caption className="sr-only">{caption}</caption>
      <thead><tr><th>Element</th>{columns.map(column => <th key={column}>{head(column)}</th>)}</tr></thead>
      <tbody>{ELEMENTS.map(element => {
        const Icon = iconForElement(element);
        return <tr key={element}>
          <td><span className="spell-element" style={{ color: `hsl(${hueFor(element)} 55% 60%)` }}><Icon size={13} />{titleCase(element)}</span></td>
          {columns.map(column => {
            const matches = spells.filter(spell => spell.element === element && match(spell, column));
            return <td key={column}>{matches.length ? <span className="spell-cell-stack">{matches.map(cell)}</span> : <span className="cell-empty">—</span>}</td>;
          })}
        </tr>;
      })}</tbody>
    </table>
  </div>;
  return <div className="ws-page">
    <div className="ws-heading"><h1>Standard</h1><span className="facts"><span>One spell per element and rung</span></span></div>
    {table(basic, "Standard spells by element and rung", RUNGS, rung => titleCase(rung), (spell, rung) => spell.rung === rung)}
    <div className="ws-heading" style={{ marginTop: 20 }}><h1>Advanced</h1><span className="facts"><span>One invocation per element and rank</span></span></div>
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
    const advanced = spell.catalog === "ADVANCED_SPELLS";

    /*
      The spellbook entry: the swatch the client paints from the element's own colours, the name,
      the line the tooltip prints under it, and the two numbers a caster actually reads — the max
      hit and the xp — followed by what one cast costs. Everything else about a spell (its tier, its
      damage divisor, the rank that only sets a flight shape) is authoring, and waits below.
    */
    const card = <Card caption="As the spellbook shows it"
      note={<>{titleCase(element)} · {advanced ? `rank ${num(spell.rank) ?? "?"} invocation` : titleCase(text(spell.rung) ?? "")}</>}>
      <CardHead art={<Thumb spec={spellThumb(spell)} size="xl" alt="" />} title={spell.name}
        name={<TextField value={spell.name} width="full" ariaLabel="Name" readOnly={readOnly} onChange={next => set(["name"], next)} />}
        sub={<CardMeta parts={[
          <Field key="element" compact label=""><ChoiceField value={text(spell.element)} options={[...ELEMENTS]} ariaLabel="Element" readOnly={readOnly} onChange={next => set(["element"], next)} /></Field>,
          <Field key="rung" compact label=""><ChoiceField value={text(spell.rung)} options={[...RUNGS]} ariaLabel="Rung" readOnly={readOnly} onChange={next => set(["rung"], next)} /></Field>,
          advanced ? <Field key="rank" compact label="rank"><NumberField value={num(spell.rank)} integer min={1} max={5} optional readOnly={readOnly} ariaLabel="Rank" onChange={next => set(["rank"], next)} /></Field> : undefined,
          <Field key="req" compact label="Magic"><NumberField value={num(spell.reqLevel)} integer min={1} readOnly={readOnly} ariaLabel="Required Magic level" onChange={next => set(["reqLevel"], next)} /></Field>,
          areaSpell && spell.aoe === true ? "area" : undefined,
        ]} />} />
      <div className="gamecard-body"><TextField value={spell.description ?? ""} multiline placeholder="No description yet." ariaLabel="Description" readOnly={readOnly} onChange={next => set(["description"], next)} /></div>
      <CardLines>
        <CardLine>
          <Field compact label="Max hit"><NumberField value={num(spell.baseMax)} integer min={0} readOnly={readOnly} ariaLabel="Base maximum hit" onChange={next => set(["baseMax"], next)} /></Field>
          <Field compact label="·"><NumberField value={num(spell.baseXp)} min={0} readOnly={readOnly} ariaLabel="Base experience" onChange={next => set(["baseXp"], next)} /></Field>
          <span>base xp</span>
          <Field compact label="· cadence" unit="ms"><NumberField value={num(spell.castMs)} integer min={0} step={100} unit="ms" optional placeholder="weapon" readOnly={readOnly} ariaLabel="Fallback cast time" onChange={next => set(["castMs"], next)} /></Field>
        </CardLine>
      </CardLines>
      <CardBlock title="Cost per cast">
        <CardLine>
          <Field compact label=""><ChoiceField value={text(cost.element)} options={[...ELEMENTS]} allowEmpty="no essence" ariaLabel="Cost element" readOnly={readOnly} onChange={next => set(["cost", "element"], next)} /></Field>
          <span>essence</span>
          <Field compact label="×"><NumberField value={num(cost.charges)} integer min={0} optional readOnly={readOnly} ariaLabel="Elemental charges" onChange={next => set(["cost", "charges"], next)} /></Field>
        </CardLine>
        {runeList && runeItem && runeQuantity && <ListField<ContentRow>
          label={runeList.label} hint={runeList.help} items={runes} readOnly={readOnly} emptyText="No runes."
          addLabel="Add rune" onAdd={() => ({ itemId: "", quantity: 1 })} onChange={setRunes}
          keyOf={(rune, at) => text(rune.itemId) ?? at}
          removeLabel={(_, at) => `Remove rune ${at + 1}`}
          renderItem={(rune, api) => <>
            <RefField className="is-bare" kind={runeItem.ref} label={`${runeItem.label} ${api.index + 1}`} value={text(rune.itemId)} readOnly={readOnly}
              exclude={new Set(runes.map(entry => text(entry.itemId) ?? "").filter((_, at) => at !== api.index))}
              onChange={next => api.update({ ...rune, itemId: next ?? "" })} />
            <NumberField className="spell-rune-quantity" value={num(rune.quantity) ?? 1} integer min={lower(runeQuantity)} unit={runeQuantity.unit} readOnly={readOnly}
              ariaLabel={`${runeQuantity.label} ${api.index + 1}`} onChange={next => api.update({ ...rune, quantity: next ?? 1 })} />
          </>} />}
      </CardBlock>
    </Card>;

    return <RecordShell
      thumb={spellThumb(spell)}
      title={spell.name} id={id}
      facts={[titleCase(element), spell.rung && titleCase(spell.rung), `level ${num(spell.reqLevel) ?? "?"}`]}
      card={card}
      draft={draft}
      rail={<EntitySummary collection="spells" record={record} recordId={id} index={index} navigate={navigate} editing />}>
      <Sheet className="record-backstage">
        <Section title="Balance" aside={<span className="mono">{id}</span>}>
          <Fields>
            {number(["tier"], num(spell.tier), true)}
            {number(["divisor"], num(spell.divisor), true)}
            {number(["rank"], num(spell.rank), true)}
          </Fields>
          {areaSpell && <Field label={areaSpell.label} hint={areaSpell.help}>
            <ToggleField value={spell.aoe === true} readOnly={readOnly} onChange={next => set(["aoe"], next)} />
          </Field>}
        </Section>
        <ReferencedBy collection="spells" id={id} navigate={navigate} />
      </Sheet>
    </RecordShell>;
  }}</PageState>;
}
