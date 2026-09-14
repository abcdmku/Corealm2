import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { collectionQuery } from "../../api/client.js";
import { BONUS_KEYS, BONUS_LABELS, type BonusKey } from "../../model/derive.js";
import { useRecordDraft } from "../../model/draft.js";
import { useReferenceIndex } from "../../model/refs.js";
import { EntitySummary } from "../../ui/EntitySummary.js";
import { Facts, NumberInput, Row, SaveBar, Section, Select, Sheet, Static } from "../../ui/Sheet.js";
import { LoadingRows, ErrorState } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import type { ViewProps } from "../types.js";
import { ItemPick } from "./ItemPick.js";
import { BONUS_SHORT, SET_SLOTS, SLOT_LABELS, emptyBonuses, targetThresholds, thresholdText, titleCase, useItemsData, useSaveShortcut, type ItemsData, type SetBalance, type SetRecord } from "./data.js";
import "./items.css";

/* Armour sets: five pieces, the threshold bonuses, and the balance target for the tier beside them. */

export default function SetsView({ recordId, navigate }: ViewProps) {
  const data = useItemsData();
  if (data.error) return <ErrorState message={data.error} />;
  if (data.loading) return <div className="ws-page"><LoadingRows /></div>;
  if (recordId) return <SetPage key={recordId} id={recordId} data={data} navigate={navigate} />;
  return <SetList data={data} navigate={navigate} />;
}

function SetList({ data, navigate }: { data: ItemsData; navigate: ViewProps["navigate"] }) {
  const groups = useMemo(() => {
    const byTier = new Map<number, SetRecord[]>();
    for (const set of data.sets) { const list = byTier.get(set.tier ?? 0) ?? []; list.push(set); byTier.set(set.tier ?? 0, list); }
    return [...byTier.entries()].sort((a, b) => a[0] - b[0]).map(([tier, sets]) => ({ tier, sets: sets.sort((a, b) => (a.style ?? "").localeCompare(b.style ?? "") || a.name.localeCompare(b.name)) }));
  }, [data.sets]);
  return <div className="ws-page sets-page">
    <div className="ws-heading"><h1>Sets</h1><span className="facts"><span>{data.sets.length} sets</span><span>{groups.length} tiers</span></span></div>
    {groups.map(group => <section key={group.tier} className="sets-group">
      <h2>Tier {group.tier}</h2>
      <div className="tile-grid" data-density="compact">
        {group.sets.map(set => {
          const ids = SET_SLOTS.map(slot => set.members?.[slot]).filter((id): id is string => Boolean(id));
          return <button key={set.id} type="button" className="tile set-tile" onClick={() => navigate("equipmentSets", set.id)}>
            <Thumb spec={{ kind: "items", ids }} size="xl" alt="" />
            <span className="tile-body">
              <span className="tile-title">{set.name}</span>
              <Facts className="tile-subtitle" items={[`Tier ${set.tier ?? 0}`, set.style, set.acquisition]} />
              <span className="tile-subtitle mono" title={thresholdText(set.thresholds)}>{thresholdText(set.thresholds) || "no bonuses"}</span>
            </span>
          </button>;
        })}
      </div>
    </section>)}
  </div>;
}

function SetPage({ id, data, navigate }: { id: string; data: ItemsData; navigate: ViewProps["navigate"] }) {
  const draft = useRecordDraft<SetRecord>("equipmentSets", id);
  const balance = useQuery(collectionQuery("balance/sets"));
  const { index } = useReferenceIndex();
  const readOnly = __DEVDOCS_PLAYER__ || !draft.editable;
  const set = draft.draft;
  const save = useCallback(() => { if (draft.dirty) void draft.save(); }, [draft]);
  useSaveShortcut(!readOnly && draft.dirty, save);
  const targets = useMemo(() => targetThresholds(balance.data?.data as SetBalance | undefined, set?.tier), [balance.data, set?.tier]);
  if (draft.error) return <ErrorState message={draft.error} />;
  if (!set) return draft.loading ? <div className="ws-page"><LoadingRows /></div> : <div className="ws-page"><p className="empty-inline">"{id}" is not an armour set. <button type="button" className="text-button" onClick={() => navigate("equipmentSets")}>All sets</button></p></div>;
  const thresholds = set.thresholds ?? [];
  const ids = SET_SLOTS.map(slot => set.members?.[slot]).filter((value): value is string => Boolean(value));
  const setThreshold = (row: number, key: BonusKey, value: number | undefined) => draft.setPath(["thresholds", row, "bonuses", key], value ?? 0);
  const targetFor = (row: { pieces: number }) => targets?.find(target => target.pieces === row.pieces);
  const drift = (row: NonNullable<SetRecord["thresholds"]>[number]) => {
    const target = targetFor(row);
    if (!target) return undefined;
    return BONUS_KEYS.every(key => (row.bonuses[key] ?? 0) === (target.bonuses[key] ?? 0)) ? "matches" : "differs";
  };
  const targetText = (row: { pieces: number }) => { const target = targetFor(row); return target ? BONUS_KEYS.filter(key => target.bonuses[key]).map(key => `+${target.bonuses[key]} ${BONUS_SHORT[key]}`).join(", ") : "—"; };

  return <div className="ws-page"><div className="record">
    <div className="record-main">
      <header className="record-head">
        <Thumb spec={{ kind: "items", ids }} size="l" alt="" />
        <div className="record-title"><h1>{set.name}</h1><Facts items={[`Tier ${set.tier ?? 0}`, set.style, set.acquisition, `${ids.length} of 5 pieces`]} /><code>{id}</code></div>
      </header>
      {!readOnly && <SaveBar dirty={draft.dirty} saving={draft.saving} error={draft.saveError} conflict={draft.conflict} onSave={save} onReset={draft.reset} />}
      <Sheet>
        <Section title="Pieces">
          <div className="slot-grid">{SET_SLOTS.map(slot => {
            const itemId = set.members?.[slot];
            const item = itemId ? data.item(itemId) : undefined;
            const tile = <button type="button" className={`slot-tile${itemId ? "" : " is-empty"}`} aria-label={`${SLOT_LABELS[slot]} piece`} disabled={readOnly} title={itemId}>
              {itemId ? <Thumb spec={{ kind: "item", id: itemId }} size="l" alt="" /> : <span className="thumb" data-size="l" />}
              <small>{SLOT_LABELS[slot]}</small>
              <strong>{item?.name ?? itemId ?? "Empty"}</strong>
            </button>;
            return <ItemPick key={slot} slot={slot} value={itemId} data={data} disabled={readOnly} trigger={tile} ariaLabel={`${SLOT_LABELS[slot]} piece`} onPick={picked => draft.setPath(["members", slot], picked)} />;
          })}</div>
        </Section>
        <Section title="Thresholds" aside={targets ? <span>Target from set balance, tier {set.tier}</span> : <span>No balance target for tier {set.tier}</span>}>
          <div className="matrix thresholds-table"><table>
            <thead><tr><th>Pieces</th>{BONUS_KEYS.map(key => <th key={key} className="cell-num" title={BONUS_LABELS[key]}>{BONUS_SHORT[key]}</th>)}<th>Target</th><th /></tr></thead>
            <tbody>{thresholds.map((row, rowIndex) => {
              const state = drift(row);
              return <tr key={rowIndex}>
                <td><NumberInput value={row.pieces} integer min={1} max={5} disabled={readOnly} ariaLabel={`Threshold ${rowIndex + 1} pieces`} onChange={value => draft.setPath(["thresholds", rowIndex, "pieces"], value ?? 1)} /></td>
                {BONUS_KEYS.map(key => <td key={key} className="cell-num"><NumberInput value={row.bonuses[key] ?? 0} disabled={readOnly} ariaLabel={`${row.pieces} pieces ${BONUS_LABELS[key]}`} onChange={value => setThreshold(rowIndex, key, value)} /></td>)}
                <td className="mono muted">{targetText(row)}</td>
                <td className="threshold-state" data-state={state}>{state ?? ""}{!readOnly && <button type="button" className="text-button" aria-label={`Remove threshold ${rowIndex + 1}`} onClick={() => draft.setPath(["thresholds", rowIndex], undefined)}>Remove</button>}</td>
              </tr>;
            })}</tbody>
          </table></div>
          {!readOnly && <div className="kv-row"><span className="kv-label" /><div className="kv-value">
            <button type="button" className="button button-small" onClick={() => draft.setPath(["thresholds", thresholds.length], { pieces: Math.min(5, (thresholds.at(-1)?.pieces ?? 1) + 1), bonuses: emptyBonuses() })}>Add threshold</button>
            {targets && <button type="button" className="button button-small" onClick={() => draft.setPath(["thresholds"], targets.map(target => ({ pieces: target.pieces, bonuses: { ...emptyBonuses(), ...target.bonuses } })))}>Use target</button>}
          </div></div>}
        </Section>
        <Section title="Set">
          <Row label="Style"><Select value={set.style} options={["melee", "magic"]} disabled={readOnly} ariaLabel="Style" onChange={value => draft.setPath(["style"], value)} /></Row>
          <Row label="Acquisition"><Select value={set.acquisition} options={["crafting", "boss"]} disabled={readOnly} ariaLabel="Acquisition" onChange={value => draft.setPath(["acquisition"], value)} /></Row>
          <Row label="Tier"><NumberInput value={set.tier} integer min={0} disabled={readOnly} ariaLabel="Tier" onChange={value => draft.setPath(["tier"], value ?? 0)} /></Row>
          <Row label="Members"><Static muted>{SET_SLOTS.map(slot => `${titleCase(slot)}: ${set.members?.[slot] ?? "—"}`).join(" · ")}</Static></Row>
        </Section>
      </Sheet>
    </div>
    <aside className="record-rail"><EntitySummary collection="equipmentSets" record={set} recordId={id} index={index} navigate={navigate} editing /></aside>
  </div></div>;
}

