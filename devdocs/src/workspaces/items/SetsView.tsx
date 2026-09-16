import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { EquipmentSetRecordSchema, EquipmentSetThresholdSchema } from "../../../../game/src/content/schema/equipmentSets.js";
import { collectionQuery } from "../../api/client.js";
import { BONUS_KEYS, type BonusKey } from "../../model/derive.js";
import { useRecordDraft } from "../../model/draft.js";
import type { Link, RecordRef, Resolved } from "../../model/origin.js";
import { useReferenceIndex } from "../../model/refs.js";
import { EntitySummary } from "../../ui/EntitySummary.js";
import { ChoiceField, DerivedNumber, Facts, Field, Fields, ListField, NumberField, RefField, ReferencedBy, Section, Sheet, TextField, usePeek } from "../../ui/field/index.js";
import { LoadingRows, ErrorState } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import type { ViewProps } from "../types.js";
import { SET_SLOTS, choicesOf, emptyBonuses, specAt, targetThresholds, thresholdText, useItemsData, type ItemsData, type SetBalance, type SetRecord, type SetThreshold } from "./data.js";
import "./items.css";
import { Button } from "../../components/ui/index.js";

/*
  Armour sets: five pieces, the threshold bonuses, and the balance target for the tier behind each
  bonus. A threshold value that equals its target reads as the target (hollow dot); one that differs
  is an override of it (brass dot, revert hands the target back).
*/

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

const setSpec = (...path: (string | number)[]) => specAt(EquipmentSetRecordSchema, path);
const THRESHOLDS = setSpec("thresholds");
const PIECES = specAt(EquipmentSetThresholdSchema, ["pieces"]);
const BONUS = Object.fromEntries(BONUS_KEYS.map(key => [key, specAt(EquipmentSetThresholdSchema, ["bonuses", key])])) as Record<BonusKey, ReturnType<typeof specAt>>;
const BALANCE: RecordRef = { collection: "balance/sets", id: "sets", label: "Set balance" };

/** A threshold bonus against its balance target: the target when they agree, own-over-target when they differ, own alone without a target. */
function resolveBonus(row: number, key: BonusKey, own: number, target: number | undefined): Resolved<number | undefined> {
  const path = ["thresholds", row, "bonuses", key];
  const ownLink: Link<number | undefined> = { origin: { kind: "own" }, value: own };
  if (target === undefined) return { value: own, chain: [ownLink], path };
  const targetLink: Link<number | undefined> = { origin: { kind: "balance", source: BALANCE }, value: target };
  return { value: own, chain: own === target ? [targetLink] : [ownLink, targetLink], path };
}

function SetPage({ id, data, navigate }: { id: string; data: ItemsData; navigate: ViewProps["navigate"] }) {
  const draft = useRecordDraft<SetRecord>("equipmentSets", id);
  const balance = useQuery(collectionQuery("balance/sets"));
  const { index } = useReferenceIndex();
  const peek = usePeek();
  const readOnly = __DEVDOCS_PLAYER__ || !draft.editable;
  const set = draft.draft;
  const targets = useMemo(() => targetThresholds(balance.data?.data as SetBalance | undefined, set?.tier), [balance.data, set?.tier]);
  if (draft.error) return <ErrorState message={draft.error} />;
  if (!set) return draft.loading ? <div className="ws-page"><LoadingRows /></div> : <div className="ws-page"><p className="empty-inline">"{id}" is not an armour set. <Button variant="link" size="inline" onClick={() => navigate("equipmentSets")}>All sets</Button></p></div>;
  const thresholds = set.thresholds ?? [];
  const ids = SET_SLOTS.map(slot => set.members?.[slot]).filter((value): value is string => Boolean(value));
  const targetFor = (pieces: number) => targets?.find(target => target.pieces === pieces);
  const openRef = (ref: RecordRef) => ref.collection === BALANCE.collection ? navigate(BALANCE.collection) : peek.open(ref);
  const style = setSpec("style"), acquisition = setSpec("acquisition"), tier = setSpec("tier");

  return <div className="ws-page"><div className="record">
    <div className="record-main">
      <header className="record-head">
        <Thumb spec={{ kind: "items", ids }} size="l" alt="" />
        <div className="record-title"><h1>{set.name}</h1><Facts items={[`Tier ${set.tier ?? 0}`, set.style, set.acquisition, `${ids.length} of 5 pieces`]} /><code>{id}</code></div>
      </header>
      <Sheet>
        <Section title="Set">
          <Field label={setSpec("name").label}><TextField value={set.name} readOnly={readOnly} onChange={next => draft.setPath(["name"], next)} /></Field>
          <Field label={style.label}><ChoiceField value={set.style} options={choicesOf(style)} readOnly={readOnly} onChange={next => draft.setPath(["style"], next)} /></Field>
          <Field label={acquisition.label}><ChoiceField value={set.acquisition} options={choicesOf(acquisition)} readOnly={readOnly} onChange={next => draft.setPath(["acquisition"], next)} /></Field>
          <Field label={tier.label}><NumberField value={set.tier} integer min={tier.min} step={tier.step} readOnly={readOnly} onChange={next => draft.setPath(["tier"], next ?? 0)} /></Field>
        </Section>
        <Section title={setSpec("members").label} aside={<span>{setSpec("members").hint}</span>}>
          {SET_SLOTS.map(slot => <RefField key={slot} kind="item" collection="compiled-items" label={setSpec("members", slot).label} optional value={set.members?.[slot]} exclude={data.notInSlot(slot)} readOnly={readOnly} onChange={next => draft.setPath(["members", slot], next)} />)}
        </Section>
        <Section title={THRESHOLDS.label} className="thresholds" aside={targets
          ? (!readOnly && <Button variant="link" size="inline" onClick={() => draft.setPath(["thresholds"], targets.map(target => ({ pieces: target.pieces, bonuses: { ...emptyBonuses(), ...target.bonuses } })))}>Use target</Button>)
          : <span>No balance target for tier {set.tier}</span>}>
          <ListField<SetThreshold> items={thresholds} readOnly={readOnly} min={1} emptyText="No thresholds" addLabel="Add threshold" removeLabel={(row) => `Remove the ${row.pieces}-piece threshold`}
            keyOf={(_, i) => i} onChange={next => draft.setPath(["thresholds"], next)}
            onAdd={() => ({ pieces: Math.min(5, (thresholds.at(-1)?.pieces ?? 1) + 1), bonuses: emptyBonuses() })}
            renderItem={(row, api) => {
              const target = targetFor(row.pieces);
              return <Fields columns={8}>
                <Field compact label={PIECES.label}><NumberField value={row.pieces} integer min={2} max={5} readOnly={readOnly} ariaLabel={`Threshold ${api.index + 1} pieces`} onChange={next => api.update({ ...row, pieces: next ?? row.pieces })} /></Field>
                {BONUS_KEYS.map(key => {
                  const goal = target ? target.bonuses[key] ?? 0 : undefined;
                  return <DerivedNumber key={key} compact label={BONUS[key].label} integer={false} readOnly={readOnly} resolved={resolveBonus(api.index, key, row.bonuses[key] ?? 0, goal)} onOpenRef={openRef}
                    onChange={next => api.update({ ...row, bonuses: { ...row.bonuses, [key]: next ?? goal ?? 0 } })} />;
                })}
              </Fields>;
            }} />
          <p className="field-hint">{THRESHOLDS.hint}</p>
        </Section>
        <ReferencedBy collection="equipmentSets" id={id} navigate={navigate} />
      </Sheet>
    </div>
    <aside className="record-rail"><EntitySummary collection="equipmentSets" record={set} recordId={id} index={index} navigate={navigate} editing /></aside>
  </div></div>;
}
