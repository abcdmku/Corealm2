import { useCallback, useMemo, useState } from "react";
import { ArrowRight, Plus, X } from "lucide-react";
import type { EquipmentFamily, ProgressionTier } from "../../../../game/src/content/schema/progression.js";
import type { AppProps, ContentRow } from "../../model/contracts.js";
import { BONUS_KEYS, BONUS_LABELS, deriveEquipmentMember, deriveProductionEntry, equipmentSource, fmt, type BonusKey } from "../../model/derive.js";
import { getPath, useRecordDraft, type Path } from "../../model/draft.js";
import { useReferenceIndex } from "../../model/refs.js";
import { EntitySummary } from "../../ui/EntitySummary.js";
import { Derived, Facts, Field, Fields, NumberInput, Row, SaveBar, Section, Select, Sheet, Static, TextInput, Toggle } from "../../ui/Sheet.js";
import { Thumb } from "../../ui/Thumb.js";
import { FamilyDrawer } from "./FamilyDrawer.js";
import { ItemPick } from "./ItemPick.js";
import { CATEGORY_OPTIONS, ELEMENT_OPTIONS, EQUIP_SLOT_OPTIONS, SKILL_OPTIONS, SLOT_LABELS, emptyBonuses, seconds, stationText, titleCase, useSaveShortcut, type ItemRecord, type ItemsData } from "./data.js";

/*
  One page for every item. Gear expanded from a tier edits the tier member (name, description,
  adjustments) and shows each number with the curve that produced it. Authored items edit the item
  row directly. Neither page says where the record came from; the derivation is the explanation.
*/

export interface ItemPageProps {
  id: string; navigate: AppProps["navigate"]; data: ItemsData;
  /** In a drawer there is no rail and the family drawer is handed to the owner. */
  variant?: "page" | "drawer";
  onOpenFamily?: (familyId: string) => void;
  /** A family draft being edited elsewhere; numbers follow it. */
  liveFamily?: EquipmentFamily;
}

export function ItemPage(props: ItemPageProps) {
  const { id, data } = props;
  const source = useMemo(() => equipmentSource(id, data.tiers, data.families), [id, data.tiers, data.families]);
  if (data.loading) return <p className="empty-inline">Loading…</p>;
  if (source) return <ExpandedItem key={id} {...props} tierId={source.tier.id} />;
  if (data.authored.has(id)) return <AuthoredItem key={id} {...props} />;
  return <div className="ws-page"><p className="empty-inline">"{id}" is not an item.</p></div>;
}

/** Remove empty `adjustments` / `bonuses` objects after clearing an override so the row is saved clean. */
function prune(tier: ProgressionTier, index: number): ProgressionTier {
  const member = tier.equipment[index];
  if (!member?.adjustments) return tier;
  const adjustments = { ...member.adjustments };
  if (adjustments.bonuses && Object.keys(adjustments.bonuses).length === 0) delete adjustments.bonuses;
  const next = Object.keys(adjustments).length ? { ...member, adjustments } : (({ adjustments: _drop, ...rest }) => rest)(member);
  const equipment = [...tier.equipment];
  equipment[index] = next;
  return { ...tier, equipment };
}

function ExpandedItem({ id, navigate, data, variant = "page", onOpenFamily, liveFamily, tierId }: ItemPageProps & { tierId: string }) {
  const draft = useRecordDraft<ProgressionTier>("progression", tierId);
  const readOnly = __DEVDOCS_PLAYER__ || !draft.editable;
  const [familyDrawer, setFamilyDrawer] = useState<string>();
  const [localFamily, setLocalFamily] = useState<EquipmentFamily>();
  const tier = draft.draft ?? data.tiers.find(row => row.id === tierId);
  const index = tier ? tier.equipment.findIndex(member => member.id === id) : -1;
  const member = tier?.equipment[index];
  const family = useMemo(() => {
    if (!member) return undefined;
    const live = liveFamily ?? localFamily;
    return live?.id === member.familyId ? live : data.familyById(member.familyId);
  }, [member, liveFamily, localFamily, data]);
  const derived = tier && member && family ? deriveEquipmentMember(tier, member, family) : undefined;
  const compiled = data.compiled.get(id);
  const save = useCallback(() => { if (draft.dirty) void draft.save(); }, [draft]);
  useSaveShortcut(!readOnly && draft.dirty, save);

  const setMember = (path: Path, value: unknown) => draft.set(previous => prune({ ...previous, equipment: previous.equipment.map((row, i) => i === index ? setIn(row, path, value) : row) } as ProgressionTier, index));
  const openFamily = (familyId: string) => onOpenFamily ? onOpenFamily(familyId) : setFamilyDrawer(familyId);

  /** The item as the game will see it after this draft, for the rail. */
  const liveRecord = useMemo<ContentRow | undefined>(() => {
    if (!derived || !member || !tier || !family) return compiled;
    const bonuses = Object.fromEntries(BONUS_KEYS.map(key => [key, derived.bonuses[key].value]));
    return { ...compiled, id, name: member.name, description: member.description, tier: tier.tier, value: derived.value.value, category: family.category, stackable: false,
      ...(family.category === "tool" ? { tool: { skill: family.skill, gatherBonus: derived.gatherBonus.value } }
        : { equip: { slot: derived.slot, requires: { [family.skill]: tier.reqLevel }, bonuses, ...(family.attackSpeedMs ? { attackSpeedMs: family.attackSpeedMs } : {}) } }),
      ...(family.magicWeapon ? { magicWeapon: family.magicWeapon } : {}) };
  }, [derived, member, tier, family, compiled, id]);

  if (!tier || !member || !family || !derived) return <p className="empty-inline">Loading…</p>;
  const isTool = family.category === "tool";
  const facts = [`Tier ${tier.tier}`, isTool ? `${titleCase(family.skill)} tool` : SLOT_LABELS[derived.slot] ?? derived.slot, `requires ${family.skill} ${tier.reqLevel}`];
  const familyLink = <button type="button" className="text-button" onClick={() => openFamily(family.id)}>{family.name}</button>;

  const main = <div className="record-main">
    <header className="record-head">
      <Thumb spec={{ kind: "item", id }} size="l" alt="" />
      <div className="record-title">
        <h1>{member.name}</h1>
        <Facts items={facts} />
        <code>{id}</code>
      </div>
      {variant === "drawer" && <span className="record-actions"><button type="button" className="button button-small" onClick={() => navigate("items/catalog", id)}>Open page <ArrowRight size={12} /></button></span>}
    </header>
    {!readOnly && <SaveBar dirty={draft.dirty} saving={draft.saving} error={draft.saveError} conflict={draft.conflict} onSave={save} onReset={draft.reset} />}
    <Sheet>
      <Section title="Identity">
        <Row label="Name"><TextInput value={member.name} disabled={readOnly} ariaLabel="Name" onChange={value => setMember(["name"], value)} /></Row>
        <Row label="Description" align="start"><TextInput value={member.description} multiline disabled={readOnly} ariaLabel="Description" onChange={value => setMember(["description"], value)} /></Row>
        <Row label="Family"><Static>{familyLink}</Static></Row>
      </Section>
      <Section title="Numbers" aside={<span>{family.name} curve at tier {tier.tier} · edit a cell to override it</span>}>
        <Fields>
          <Field label="Value"><Derived derivation={derived.value} readOnly={readOnly} onOverride={value => setMember(["adjustments", "value"], value)} onOpenSource={source => openFamily(source.id)} /></Field>
          {isTool
            ? <Field label="Gather bonus"><Derived derivation={derived.gatherBonus} integer={false} readOnly={readOnly} onOverride={value => setMember(["adjustments", "gatherBonus"], value)} onOpenSource={source => openFamily(source.id)} /></Field>
            : BONUS_KEYS.map(key => <Field key={key} label={BONUS_LABELS[key]}><Derived derivation={derived.bonuses[key]} readOnly={readOnly} onOverride={value => setMember(["adjustments", "bonuses", key], value)} onOpenSource={source => openFamily(source.id)} /></Field>)}
        </Fields>
        <Facts className="kv-facts" items={[
          !isTool && (SLOT_LABELS[derived.slot] ?? derived.slot),
          <>Requires {titleCase(family.skill)} {tier.reqLevel}<span className="muted"> from the tier</span></>,
          family.attackSpeedMs !== undefined && <span className="mono">{family.attackSpeedMs} ms per attack</span>,
          family.magicWeapon && `${family.magicWeapon.kind} · ${family.magicWeapon.hands === 2 ? "two-handed" : "one-handed"}`,
        ]} />
      </Section>
      <MadeBy itemId={id} data={data} navigate={navigate} />
    </Sheet>
  </div>;

  return <>
    {variant === "page"
      ? <div className="ws-page"><div className="record">{main}<Rail collection="items" record={liveRecord ?? compiled ?? { id }} recordId={id} navigate={navigate} /></div></div>
      : main}
    {familyDrawer && <FamilyDrawer familyId={familyDrawer} data={data} onClose={() => setFamilyDrawer(undefined)} onLive={setLocalFamily} onOpenItem={itemId => navigate("items/catalog", itemId)} />}
  </>;
}

function Rail({ collection, record, recordId, navigate }: { collection: string; record: ContentRow; recordId: string; navigate: AppProps["navigate"] }) {
  const { index } = useReferenceIndex();
  return <aside className="record-rail"><EntitySummary collection={collection} record={record} recordId={recordId} index={index} navigate={navigate} editing /></aside>;
}

function setIn<T>(value: T, path: Path, next: unknown): T {
  if (path.length === 0) return next as T;
  const [head, ...rest] = path;
  const container = (value !== null && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const copy: Record<string, unknown> = { ...container };
  if (rest.length === 0 && next === undefined) delete copy[String(head)];
  else copy[String(head)] = setIn(copy[String(head)], rest, next);
  return copy as T;
}

/** The production entry that outputs this item, with its inputs, station and rates. */
export function MadeBy({ itemId, data, navigate }: { itemId: string; data: ItemsData; navigate: AppProps["navigate"] }) {
  const made = data.madeBy(itemId);
  if (!made) return null;
  const template = data.templateById(made.entry.templateId);
  const rates = template ? deriveProductionEntry(made.tier, made.entry, template) : undefined;
  return <Section title="Made by" aside={<button type="button" className="text-button" onClick={() => navigate("compiled-recipes", made.entry.id)}>{made.entry.name} <ArrowRight size={11} /></button>}>
    <Row label="Inputs" align="start">
      <span className="recipe-line">
        {made.entry.inputs.map((input, i) => <span key={i} className="recipe-part"><button type="button" className="cell" onClick={() => navigate("items/catalog", input.itemId)}><Thumb spec={{ kind: "item", id: input.itemId }} size="s" /><span>{data.item(input.itemId)?.name ?? input.itemId}</span></button><small className="mono">×{input.quantity}</small></span>)}
        <ArrowRight size={12} className="muted" />
        <span className="recipe-part"><Thumb spec={{ kind: "item", id: made.entry.output.itemId }} size="s" /><span>{data.item(made.entry.output.itemId)?.name ?? made.entry.output.itemId}</span><small className="mono">×{made.entry.output.quantity}</small></span>
      </span>
    </Row>
    {template && <Row label="Station"><Static>{titleCase(template.skill)} · {stationText(template.stations)}</Static></Row>}
    {rates && <Row label="Rates"><Static mono>{seconds(rates.durationMs.value)} · {fmt(rates.xp.value)} xp · level {rates.reqLevel.value}</Static></Row>}
  </Section>;
}

/* ---------- Authored items ---------- */

const OPTIONAL_BLOCKS = [
  { key: "equip", label: "Equip", make: () => ({ slot: "mainHand", bonuses: emptyBonuses(), requires: {} }) },
  { key: "tool", label: "Tool", make: () => ({ skill: "mining", gatherBonus: 1 }) },
  { key: "food", label: "Food", make: () => ({ healAmount: 1 }) },
  { key: "magicWeapon", label: "Magic weapon", make: () => ({ kind: "wand", hands: 1 }) },
  { key: "orb", label: "Orb", make: () => ({ element: "wind", released: true }) },
] as const;

function AuthoredItem({ id, navigate, data, variant = "page" }: ItemPageProps) {
  const draft = useRecordDraft<ItemRecord>("items", id);
  const readOnly = __DEVDOCS_PLAYER__ || !draft.editable;
  const record = draft.draft;
  const save = useCallback(() => { if (draft.dirty) void draft.save(); }, [draft]);
  useSaveShortcut(!readOnly && draft.dirty, save);
  const [addSkill, setAddSkill] = useState("");
  if (!record) return <p className="empty-inline">Loading…</p>;
  const set = draft.setPath;
  const equip = record.equip;
  const requires = equip?.requires ?? {};
  const requirement = Object.entries(requires).filter(([, level]) => typeof level === "number").map(([skill, level]) => `requires ${skill} ${level}`)[0];
  const facts = [record.tier !== undefined && `Tier ${record.tier}`, equip?.slot ? SLOT_LABELS[equip.slot] ?? equip.slot : titleCase(record.category ?? ""), requirement];
  const missing = OPTIONAL_BLOCKS.filter(block => record[block.key] === undefined);
  const remove = (key: string) => !readOnly && <button type="button" className="text-button" onClick={() => set([key], undefined)}>Remove</button>;
  const num = (path: Path, options: { integer?: boolean; min?: number; unit?: string; label?: string } = {}) => <NumberInput value={getPath(record, path) as number | undefined} integer={options.integer} min={options.min} unit={options.unit} disabled={readOnly} ariaLabel={options.label ?? path.join(".")} onChange={value => set(path, value)} />;

  const main = <div className="record-main">
    <header className="record-head">
      <Thumb spec={{ kind: "item", id }} size="l" alt="" />
      <div className="record-title">
        <h1>{record.name}</h1>
        <Facts items={facts} />
        <code>{id}</code>
      </div>
      {variant === "drawer" && <span className="record-actions"><button type="button" className="button button-small" onClick={() => navigate("items/catalog", id)}>Open page <ArrowRight size={12} /></button></span>}
    </header>
    {!readOnly && <SaveBar dirty={draft.dirty} saving={draft.saving} error={draft.saveError} conflict={draft.conflict} onSave={save} onReset={draft.reset} />}
    <Sheet>
      <Section title="Identity">
        <Row label="Name"><TextInput value={record.name} disabled={readOnly} ariaLabel="Name" onChange={value => set(["name"], value)} /></Row>
        <Row label="Description" align="start"><TextInput value={record.description ?? ""} multiline disabled={readOnly} ariaLabel="Description" onChange={value => set(["description"], value)} /></Row>
        <Row label="Category"><Select value={record.category} options={CATEGORY_OPTIONS} disabled={readOnly} ariaLabel="Category" onChange={value => set(["category"], value)} /></Row>
        <Row label="Tier">{num(["tier"], { integer: true, min: 0, label: "Tier" })}</Row>
        <Row label="Value">{num(["value"], { integer: true, min: 0, unit: "marks", label: "Value" })}</Row>
        <Row label="Stackable"><Toggle value={record.stackable === true} disabled={readOnly} onChange={value => set(["stackable"], value)} /></Row>
      </Section>
      {equip && <Section title="Equip" aside={remove("equip")}>
        <Row label="Slot"><Select value={equip.slot} options={EQUIP_SLOT_OPTIONS.map(slot => ({ value: slot, label: SLOT_LABELS[slot] ?? slot }))} disabled={readOnly} ariaLabel="Slot" onChange={value => set(["equip", "slot"], value)} /></Row>
        <Fields>
          {BONUS_KEYS.map(key => <Field key={key} label={BONUS_LABELS[key]}>{num(["equip", "bonuses", key], { label: BONUS_LABELS[key] })}</Field>)}
          <Field label="Attack speed">{num(["equip", "attackSpeedMs"], { min: 1, unit: "ms", label: "Attack speed" })}</Field>
        </Fields>
        {Object.keys(requires).map(skill => <Row key={skill} label={`Requires ${skill}`}>
          <NumberInput value={requires[skill]} integer min={1} disabled={readOnly} ariaLabel={`Requires ${skill}`} onChange={value => set(["equip", "requires", skill], value)} />
          {!readOnly && <button type="button" className="icon-button" aria-label={`Remove ${skill} requirement`} onClick={() => set(["equip", "requires", skill], undefined)}><X size={12} /></button>}
        </Row>)}
        {!readOnly && <Row label={Object.keys(requires).length ? "" : "Requires"}><Select value={addSkill || undefined} options={SKILL_OPTIONS.filter(skill => !(skill in requires))} allowEmpty="Add requirement…" ariaLabel="Add requirement" onChange={skill => { if (skill) { set(["equip", "requires", skill], 1); setAddSkill(""); } }} /></Row>}
      </Section>}
      {record.tool && <Section title="Tool" aside={remove("tool")}>
        <Row label="Skill"><Select value={record.tool.skill} options={["mining", "woodcutting", "fishing"]} disabled={readOnly} ariaLabel="Tool skill" onChange={value => set(["tool", "skill"], value)} /></Row>
        <Row label="Gather bonus">{num(["tool", "gatherBonus"], { min: 0, label: "Gather bonus" })}</Row>
      </Section>}
      {record.food && <Section title="Food" aside={remove("food")}>
        <Row label="Heals">{num(["food", "healAmount"], { min: 0, unit: "hp", label: "Heal amount" })}</Row>
      </Section>}
      {record.magicWeapon && <Section title="Magic weapon" aside={remove("magicWeapon")}>
        <Row label="Kind"><Select value={record.magicWeapon.kind} options={["wand", "staff"]} disabled={readOnly} ariaLabel="Weapon kind" onChange={value => set(["magicWeapon", "kind"], value)} /></Row>
        <Row label="Hands"><Select value={String(record.magicWeapon.hands ?? 1)} options={[{ value: "1", label: "One-handed" }, { value: "2", label: "Two-handed" }]} disabled={readOnly} ariaLabel="Hands" onChange={value => set(["magicWeapon", "hands"], Number(value))} /></Row>
        {record.magicWeapon.charge ? <>
          <Row label="Element"><Select value={record.magicWeapon.charge.element as string | undefined} options={ELEMENT_OPTIONS} disabled={readOnly} ariaLabel="Charge element" onChange={value => set(["magicWeapon", "charge", "element"], value)} /></Row>
          <Row label="Capacity">{num(["magicWeapon", "charge", "capacity"], { integer: true, min: 1, label: "Charge capacity" })}<span className="muted">starts with</span>{num(["magicWeapon", "charge", "initialCharges"], { integer: true, min: 0, label: "Initial charges" })}</Row>
          <Row label="Recharge"><ItemPick value={record.magicWeapon.charge.rechargeItemId as string | undefined} data={data} ariaLabel="Recharge item" disabled={readOnly} onPick={itemId => set(["magicWeapon", "charge", "rechargeItemId"], itemId)} /><span className="muted">×</span>{num(["magicWeapon", "charge", "rechargeCost"], { integer: true, min: 1, label: "Items per recharge" })}</Row>
          <Row label="Altar orb"><ItemPick value={record.magicWeapon.charge.orbItemId as string | undefined} data={data} ariaLabel="Altar orb" disabled={readOnly} onPick={itemId => set(["magicWeapon", "charge", "orbItemId"], itemId)} /></Row>
          <Row label="Released"><Toggle value={record.magicWeapon.charge.released === true} disabled={readOnly} onChange={value => set(["magicWeapon", "charge", "released"], value)} />{!readOnly && <button type="button" className="text-button" onClick={() => set(["magicWeapon", "charge"], undefined)}>Remove charge</button>}</Row>
        </> : !readOnly && <Row label="Charge"><button type="button" className="button button-small" onClick={() => set(["magicWeapon", "charge"], { element: "wind", capacity: 10, initialCharges: 0, rechargeItemId: "", rechargeCost: 1, orbItemId: "", released: false })}><Plus size={12} /> Add elemental charge</button></Row>}
      </Section>}
      {record.orb && <Section title="Orb" aside={remove("orb")}>
        <Row label="Element"><Select value={record.orb.element} options={ELEMENT_OPTIONS} disabled={readOnly} ariaLabel="Orb element" onChange={value => set(["orb", "element"], value)} /></Row>
        <Row label="Released"><Toggle value={record.orb.released === true} disabled={readOnly} onChange={value => set(["orb", "released"], value)} /></Row>
      </Section>}
      <MadeBy itemId={id} data={data} navigate={navigate} />
      {!readOnly && missing.length > 0 && <Section title="Add section">
        <Row label=""><span className="add-blocks">{missing.map(block => <button key={block.key} type="button" className="button button-small" onClick={() => set([block.key], block.make())}><Plus size={12} /> {block.label}</button>)}</span></Row>
      </Section>}
    </Sheet>
  </div>;

  if (variant === "drawer") return main;
  return <div className="ws-page"><div className="record">{main}<Rail collection="items" record={record} recordId={id} navigate={navigate} /></div></div>;
}

export type { BonusKey };
