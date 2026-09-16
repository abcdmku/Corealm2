import { useMemo, useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { EquipmentBonusesSchema, ItemSchema, ItemSkillRequirementsSchema } from "../../../../game/src/content/schema/items.js";
import { ProgressionTierSchema, type EquipmentFamily, type ProgressionTier } from "../../../../game/src/content/schema/progression.js";
import type { AppProps, ContentRow } from "../../model/contracts.js";
import { BONUS_KEYS, deriveEquipmentMember, deriveProductionEntry, equipmentSource, fmt, type BonusKey } from "../../model/derive.js";
import { getPath, setPath, useRecordDraft } from "../../model/draft.js";
import type { Path, RecordRef } from "../../model/origin.js";
import { useReferenceIndex } from "../../model/refs.js";
import { EntitySummary } from "../../ui/EntitySummary.js";
import { ChoiceField, DerivedNumber, Facts, Field, Fields, MapField, NumberField, RefField, ReferencedBy, Row, Section, Sheet, Static, TextField, ToggleField, usePeek } from "../../ui/field/index.js";
import { Thumb } from "../../ui/Thumb.js";
import { FamilyDrawer } from "./FamilyDrawer.js";
import { choicesOf, emptyBonuses, seconds, specAt, stationText, titleCase, type ItemRecord, type ItemsData, type PathSpec } from "./data.js";

/*
  One page for every item. Gear expanded from a tier edits the tier member (name, description,
  adjustments) and shows each number with the curve that produced it. Authored items edit the item
  row directly. Neither page says where the record came from; the derivation is the explanation.
  Every label, unit, bound and choice comes from the schemas.
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

const item = (...path: Path[number][]): PathSpec => specAt(ItemSchema, path);
const member = (...path: Path[number][]): PathSpec => specAt(ProgressionTierSchema, ["equipment", 0, ...path]);
const BONUS: Readonly<Record<BonusKey, PathSpec>> = Object.fromEntries(BONUS_KEYS.map(key => [key, specAt(EquipmentBonusesSchema, [key])])) as Record<BonusKey, PathSpec>;
const SKILL_KEYS = Object.keys(ItemSkillRequirementsSchema.fields).map(key => ({ value: key, label: specAt(ItemSkillRequirementsSchema, [key]).label }));

/** Remove empty `adjustments` / `bonuses` objects after clearing an override so the row is saved clean. */
function prune(tier: ProgressionTier, index: number): ProgressionTier {
  const row = tier.equipment[index];
  if (!row?.adjustments) return tier;
  const adjustments = { ...row.adjustments };
  if (adjustments.bonuses && Object.keys(adjustments.bonuses).length === 0) delete adjustments.bonuses;
  const next = Object.keys(adjustments).length ? { ...row, adjustments } : (({ adjustments: _drop, ...rest }) => rest)(row);
  const equipment = [...tier.equipment];
  equipment[index] = next;
  return { ...tier, equipment };
}

function ExpandedItem({ id, navigate, data, variant = "page", onOpenFamily, liveFamily, tierId }: ItemPageProps & { tierId: string }) {
  const draft = useRecordDraft<ProgressionTier>("progression", tierId);
  const peek = usePeek();
  const readOnly = __DEVDOCS_PLAYER__ || !draft.editable;
  const [familyDrawer, setFamilyDrawer] = useState<string>();
  const [localFamily, setLocalFamily] = useState<EquipmentFamily>();
  const tier = draft.draft ?? data.tiers.find(row => row.id === tierId);
  const index = tier ? tier.equipment.findIndex(row => row.id === id) : -1;
  const row = tier?.equipment[index];
  const family = useMemo(() => {
    if (!row) return undefined;
    const live = liveFamily ?? localFamily;
    return live?.id === row.familyId ? live : data.familyById(row.familyId);
  }, [row, liveFamily, localFamily, data]);
  const derived = tier && row && family ? deriveEquipmentMember(tier, row, family) : undefined;
  const compiled = data.compiled.get(id);

  const setMember = (path: Path, value: unknown) => draft.set(previous => prune(setPath(previous, ["equipment", index, ...path], value), index));
  /** The tier row holds every expanded item, so a field is dirty only when its own path moved. */
  const dirtyAt = (path: Path): boolean => draft.dirty && JSON.stringify(getPath(draft.draft, ["equipment", index, ...path])) !== JSON.stringify(getPath(draft.record, ["equipment", index, ...path]));
  const openFamily = (familyId: string) => onOpenFamily ? onOpenFamily(familyId) : setFamilyDrawer(familyId);
  /** The family in a provenance line opens its curve beside the item; anything else peeks. */
  const openRef = (ref: RecordRef) => ref.collection === "equipmentFamilies" ? openFamily(ref.id) : peek.open(ref);

  /** The item as the game will see it after this draft, for the rail. */
  const liveRecord = useMemo<ContentRow | undefined>(() => {
    if (!derived || !row || !tier || !family) return compiled;
    const bonuses = Object.fromEntries(BONUS_KEYS.map(key => [key, derived.bonuses[key].value]));
    return { ...compiled, id, name: row.name, description: row.description, tier: tier.tier, value: derived.value.value, category: family.category, stackable: false,
      ...(family.category === "tool" ? { tool: { skill: family.skill, gatherBonus: derived.gatherBonus.value } }
        : { equip: { slot: derived.slot, requires: { [family.skill]: tier.reqLevel }, bonuses, ...(family.attackSpeedMs ? { attackSpeedMs: family.attackSpeedMs } : {}) } }),
      ...(family.magicWeapon ? { magicWeapon: family.magicWeapon } : {}) };
  }, [derived, row, tier, family, compiled, id]);

  if (!tier || !row || !family || !derived) return <p className="empty-inline">Loading…</p>;
  const isTool = family.category === "tool";
  const value = item("value");
  const facts = [`Tier ${tier.tier}`, isTool ? `${titleCase(family.skill)} tool` : titleCase(derived.slot), `requires ${family.skill} ${tier.reqLevel}`];

  const main = <div className="record-main">
    <header className="record-head">
      <Thumb spec={{ kind: "item", id }} size="l" alt="" />
      <div className="record-title">
        <h1>{row.name}</h1>
        <Facts items={facts} />
        <code>{id}</code>
      </div>
      {variant === "drawer" && <span className="record-actions"><button type="button" className="button button-small" onClick={() => navigate("items/catalog", id)}>Open page <ArrowRight size={12} /></button></span>}
    </header>
    <Sheet>
      <Section title="Identity">
        <Field label={member("name").label} dirty={dirtyAt(["name"])}><TextField value={row.name} readOnly={readOnly} onChange={next => setMember(["name"], next)} /></Field>
        <Field label={member("description").label} dirty={dirtyAt(["description"])}><TextField value={row.description} multiline readOnly={readOnly} onChange={next => setMember(["description"], next)} /></Field>
      </Section>
      <Section title="Numbers" aside={<button type="button" className="text-button" onClick={() => openFamily(family.id)}>{family.name} curve</button>}>
        <DerivedNumber label={value.label} unit={value.unit} min={0} resolved={derived.value.resolved} readOnly={readOnly} optional dirty={dirtyAt(["adjustments", "value"])} onChange={next => setMember(["adjustments", "value"], next)} onOpenRef={openRef} />
        {isTool
          ? <DerivedNumber label={item("tool", "gatherBonus").label} integer={false} min={0} resolved={derived.gatherBonus.resolved} readOnly={readOnly} optional dirty={dirtyAt(["adjustments", "gatherBonus"])} onChange={next => setMember(["adjustments", "gatherBonus"], next)} onOpenRef={openRef} />
          : <Fields columns={4}>
            {BONUS_KEYS.map(key => <DerivedNumber key={key} compact label={BONUS[key].label} resolved={derived.bonuses[key].resolved} readOnly={readOnly} optional dirty={dirtyAt(["adjustments", "bonuses", key])} onChange={next => setMember(["adjustments", "bonuses", key], next)} onOpenRef={openRef} />)}
          </Fields>}
        <Facts className="kv-facts" items={[
          !isTool && titleCase(derived.slot),
          <>Requires {titleCase(family.skill)} {tier.reqLevel}<span className="muted"> from the tier</span></>,
          family.attackSpeedMs !== undefined && <span className="mono">{family.attackSpeedMs} ms per attack</span>,
          family.magicWeapon && `${family.magicWeapon.kind} · ${family.magicWeapon.hands === 2 ? "two-handed" : "one-handed"}`,
        ]} />
      </Section>
      <MadeBy itemId={id} data={data} navigate={navigate} />
      <ReferencedBy collection="items" id={id} navigate={navigate} />
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

type BlockKey = "equip" | "tool" | "food" | "magicWeapon" | "orb";
const BLOCKS: readonly { key: BlockKey; make: () => unknown }[] = [
  { key: "equip", make: () => ({ slot: "mainHand", bonuses: emptyBonuses(), requires: {} }) },
  { key: "tool", make: () => ({ skill: "mining", gatherBonus: 1 }) },
  { key: "food", make: () => ({ healAmount: 1 }) },
  { key: "magicWeapon", make: () => ({ kind: "wand", hands: 1 }) },
  { key: "orb", make: () => ({ element: "wind", released: true }) },
];
const HANDS = [{ value: "1", label: "One-handed" }, { value: "2", label: "Two-handed" }];
const PRESENCE = [{ value: "none", label: "None" }, { value: "present", label: "Present" }];

/**
 * An optional block of the item as a section whose presence is a field: the aside reads None or
 * Present, and choosing None removes the block. Absent blocks still show, so every item page has
 * the same sections in the same order and a block is one choice away.
 */
function BlockSection({ spec, present, readOnly, onPresence, children }: { spec: PathSpec; present: boolean; readOnly: boolean; onPresence: (present: boolean) => void; children: ReactNode }) {
  const aside = readOnly ? undefined : <ChoiceField value={present ? "present" : "none"} options={PRESENCE} ariaLabel={`${spec.label} block`} className="block-presence" onChange={next => onPresence(next === "present")} />;
  // An absent block is one muted line: the schema label reads as a noun ("No food effect."), so it
  // needs no article. The schema's help belongs with the fields it describes, not with their absence.
  return <Section title={spec.label} aside={aside} className={`block-section${present ? "" : " is-absent"}`}>
    {present
      ? <>{spec.hint && <p className="field-hint">{spec.hint}</p>}{children}</>
      : <p className="empty-inline">No {spec.label.toLowerCase()}.</p>}
  </Section>;
}

function AuthoredItem({ id, navigate, data, variant = "page" }: ItemPageProps) {
  const draft = useRecordDraft<ItemRecord>("items", id);
  const readOnly = __DEVDOCS_PLAYER__ || !draft.editable;
  const record = draft.draft;
  if (!record) return <p className="empty-inline">Loading…</p>;
  const set = draft.setPath;
  const equip = record.equip;
  const charge = record.magicWeapon?.charge;
  const requires = Object.fromEntries(Object.entries(equip?.requires ?? {}).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
  const requirement = Object.entries(requires).map(([skill, level]) => `requires ${skill} ${level}`)[0];
  const facts = [record.tier !== undefined && `Tier ${record.tier}`, equip?.slot ? titleCase(equip.slot) : titleCase(record.category ?? ""), requirement];

  const num = (path: Path, spec = item(...path)) => <Field label={spec.label} hint={spec.hint}>
    <NumberField value={getPath(record, path) as number | undefined} integer={spec.integer} min={spec.min} max={spec.max} step={spec.step} unit={spec.unit} optional={spec.optional} readOnly={readOnly} onChange={next => set(path, next)} />
  </Field>;
  const choice = (path: Path, spec = item(...path)) => <Field label={spec.label} hint={spec.hint}>
    <ChoiceField value={getPath(record, path) as string | undefined} options={choicesOf(spec)} readOnly={readOnly} onChange={next => set(path, next)} />
  </Field>;
  const toggle = (path: Path, spec = item(...path)) => <Field label={spec.label} hint={spec.hint}>
    <ToggleField value={getPath(record, path) === true} readOnly={readOnly} onChange={next => set(path, next)} />
  </Field>;
  const ref = (path: Path, spec = item(...path)) => <RefField kind="item" collection="compiled-items" label={spec.label} hint={spec.hint} value={(getPath(record, path) as string | undefined) || undefined} readOnly={readOnly} onChange={next => set(path, next ?? "")} />;
  const block = (key: BlockKey) => BLOCKS.find(candidate => candidate.key === key)!;
  const presence = (key: BlockKey) => (present: boolean) => set([key], present ? block(key).make() : undefined);

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
    <Sheet>
      <Section title="Identity">
        <Field label={item("name").label}><TextField value={record.name} readOnly={readOnly} onChange={next => set(["name"], next)} /></Field>
        <Field label={item("description").label}><TextField value={record.description ?? ""} multiline readOnly={readOnly} onChange={next => set(["description"], next)} /></Field>
        {choice(["category"])}
        {num(["tier"])}
        {num(["value"])}
        {toggle(["stackable"])}
      </Section>
      <BlockSection spec={item("equip")} present={Boolean(equip)} readOnly={readOnly} onPresence={presence("equip")}>
        {choice(["equip", "slot"])}
        <Fields columns={4}>
          {BONUS_KEYS.map(key => <Field key={key} compact label={BONUS[key].label}><NumberField value={equip?.bonuses?.[key]} readOnly={readOnly} onChange={next => set(["equip", "bonuses", key], next ?? 0)} /></Field>)}
        </Fields>
        {num(["equip", "attackSpeedMs"])}
        <MapField<number> label={item("equip", "requires").label} value={requires} keys={SKILL_KEYS} keyLabel="skill" readOnly={readOnly} emptyText="No skill requirement" defaultValue={() => 1}
          onChange={next => set(["equip", "requires"], next)}
          renderValue={(skill, level, update) => <NumberField value={level} integer min={1} ariaLabel={`${titleCase(skill)} level`} readOnly={readOnly} onChange={next => update(next ?? 1)} />} />
      </BlockSection>
      <BlockSection spec={item("tool")} present={Boolean(record.tool)} readOnly={readOnly} onPresence={presence("tool")}>
        {choice(["tool", "skill"])}
        {num(["tool", "gatherBonus"])}
      </BlockSection>
      <BlockSection spec={item("food")} present={Boolean(record.food)} readOnly={readOnly} onPresence={presence("food")}>
        {num(["food", "healAmount"])}
      </BlockSection>
      <BlockSection spec={item("magicWeapon")} present={Boolean(record.magicWeapon)} readOnly={readOnly} onPresence={presence("magicWeapon")}>
        {choice(["magicWeapon", "kind"])}
        <Field label={item("magicWeapon", "hands").label}><ChoiceField value={String(record.magicWeapon?.hands ?? 1)} options={HANDS} readOnly={readOnly} onChange={next => set(["magicWeapon", "hands"], Number(next))} /></Field>
        <Field label={item("magicWeapon", "charge").label}>
          <ChoiceField value={charge ? "present" : "none"} options={PRESENCE} readOnly={readOnly} onChange={next => set(["magicWeapon", "charge"], next === "present" ? { element: "wind", capacity: 10, initialCharges: 0, rechargeItemId: "", rechargeCost: 1, orbItemId: "", released: false } : undefined)} />
        </Field>
        {charge && <>
          {choice(["magicWeapon", "charge", "element"])}
          {num(["magicWeapon", "charge", "capacity"])}
          {num(["magicWeapon", "charge", "initialCharges"])}
          {ref(["magicWeapon", "charge", "rechargeItemId"])}
          {num(["magicWeapon", "charge", "rechargeCost"])}
          {ref(["magicWeapon", "charge", "orbItemId"])}
          {toggle(["magicWeapon", "charge", "released"])}
        </>}
      </BlockSection>
      <BlockSection spec={item("orb")} present={Boolean(record.orb)} readOnly={readOnly} onPresence={presence("orb")}>
        {choice(["orb", "element"])}
        {toggle(["orb", "released"])}
      </BlockSection>
      <MadeBy itemId={id} data={data} navigate={navigate} />
      <ReferencedBy collection="items" id={id} navigate={navigate} />
    </Sheet>
  </div>;

  if (variant === "drawer") return main;
  return <div className="ws-page"><div className="record">{main}<Rail collection="items" record={record} recordId={id} navigate={navigate} /></div></div>;
}

export type { BonusKey };
