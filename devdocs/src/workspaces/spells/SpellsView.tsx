import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { collectionQuery } from "../../api/client.js";
import type { ContentRow } from "../../model/contracts.js";
import { contentRows } from "../../model/rows.js";
import { iconForElement, spellThumb, titleCase, hueFor } from "../../model/summaries.js";
import { Thumb } from "../../ui/Thumb.js";
import { EntitySummary } from "../../ui/EntitySummary.js";
import { RecordPicker } from "../../ui/RecordPicker.js";
import { Row, Section, Sheet } from "../../ui/Sheet.js";
import { ErrorState, LoadingRows } from "../../ui/States.js";
import type { ViewProps } from "../types.js";
import { AddButton, asRecord, ItemStack, list, num, NumberField, PageState, RecordShell, SelectField, text, TextField, usePage } from "../story/shared.js";
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

function SpellPage({ id, navigate }: { id: string; navigate: ViewProps["navigate"] }) {
  const page = usePage<Spell>("spells", id);
  const { draft, index, ctx } = page;
  const editable = draft.editable;
  return <PageState page={page} collection="spells" navigate={navigate}>{(spell, record) => {
    const cost = asRecord(spell.cost);
    const runes = list(cost.runes).map(asRecord);
    const element = text(spell.element) ?? "wind";
    return <RecordShell
      thumb={spellThumb(spell)}
      title={spell.name} id={id}
      facts={[titleCase(element), spell.rung && titleCase(spell.rung), `level ${num(spell.reqLevel) ?? "?"}`, `tier ${num(spell.tier) ?? "?"}`, spell.catalog === "ADVANCED_SPELLS" && "advanced"]}
      draft={draft}
      rail={<EntitySummary collection="spells" record={record} recordId={id} index={index} navigate={navigate} editing />}>
      <Sheet>
        <Section title="Identity">
          <Row label="Name"><TextField editable={editable} value={spell.name} onChange={value => draft.setPath(["name"], value)} ariaLabel="Name" /></Row>
          <Row label="Description" align="start"><TextField editable={editable} value={spell.description} onChange={value => draft.setPath(["description"], value)} multiline ariaLabel="Description" /></Row>
          <Row label="Element"><SelectField editable={editable} value={spell.element} onChange={value => draft.setPath(["element"], value)} options={ELEMENTS.map(value => ({ value, label: titleCase(value) }))} ariaLabel="Element" /></Row>
          <Row label="Rung"><SelectField editable={editable} value={spell.rung} onChange={value => draft.setPath(["rung"], value)} options={RUNGS.map(value => ({ value, label: titleCase(value) }))} ariaLabel="Rung" /></Row>
          {(spell.rank !== undefined || editable) && <Row label="Rank"><NumberField editable={editable} value={num(spell.rank)} onChange={value => draft.setPath(["rank"], value)} integer min={0} ariaLabel="Rank" /></Row>}
        </Section>
        <Section title="Numbers">
          <Row label="Required level"><NumberField editable={editable} value={num(spell.reqLevel)} onChange={value => draft.setPath(["reqLevel"], value)} integer min={1} unit="magic" ariaLabel="Required level" /></Row>
          <Row label="Tier"><NumberField editable={editable} value={num(spell.tier)} onChange={value => draft.setPath(["tier"], value)} integer min={0} ariaLabel="Tier" /></Row>
          <Row label="Base max hit"><NumberField editable={editable} value={num(spell.baseMax)} onChange={value => draft.setPath(["baseMax"], value)} integer min={0} unit="damage" ariaLabel="Base max hit" /></Row>
          <Row label="Divisor" hint="Levels per extra point of max hit"><NumberField editable={editable} value={num(spell.divisor)} onChange={value => draft.setPath(["divisor"], value)} min={0} unit="levels / point" ariaLabel="Divisor" /></Row>
          <Row label="Base xp"><NumberField editable={editable} value={num(spell.baseXp)} onChange={value => draft.setPath(["baseXp"], value)} min={0} unit="xp" ariaLabel="Base xp" /></Row>
          <Row label="Cast time"><NumberField editable={editable} value={num(spell.castMs)} onChange={value => draft.setPath(["castMs"], value)} integer min={0} unit="ms" ariaLabel="Cast time" /></Row>
        </Section>
        <Section title="Cost">
          <Row label="Element"><SelectField editable={editable} value={text(cost.element)} onChange={value => draft.setPath(["cost", "element"], value)} options={ELEMENTS.map(value => ({ value, label: titleCase(value) }))} ariaLabel="Cost element" /></Row>
          <Row label="Charges"><NumberField editable={editable} value={num(cost.charges)} onChange={value => draft.setPath(["cost", "charges"], value)} integer min={0} unit="essence" ariaLabel="Charges" /></Row>
          <Row label="Runes" align="start">
            <span className="ref-list">
              {runes.map((rune, at) => <ItemStack key={at} itemId={text(rune.itemId) ?? ""} quantity={num(rune.quantity)} editable={editable} page={page} open={navigate} onQuantity={value => draft.setPath(["cost", "runes", at, "quantity"], value ?? 1)} onRemove={() => { const next = runes.filter((_, index) => index !== at); draft.setPath(["cost", "runes"], next.length ? next : undefined); }} />)}
              {!runes.length && <span className="story-empty">No runes.</span>}
              {editable && <RecordPicker collection="spellRunes" ctx={ctx} exclude={new Set(runes.map(rune => text(rune.itemId) ?? ""))} onPick={picked => draft.setPath(["cost", "runes", runes.length], { itemId: picked, quantity: 1 })} trigger={<AddButton label="Add rune">Add rune</AddButton>} />}
            </span>
          </Row>
        </Section>
      </Sheet>
    </RecordShell>;
  }}</PageState>;
}
