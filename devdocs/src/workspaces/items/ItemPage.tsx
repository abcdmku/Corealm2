import { useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Plus } from "lucide-react";
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
import { InlineStats, ItemStack } from "../../ui/ItemStack.js";
import { StatMatrix } from "../../ui/StatMatrix.js";
import { Button } from "../../components/ui/index.js";
import { FamilyDrawer } from "./FamilyDrawer.js";
import { choicesOf, emptyBonuses, seconds, specAt, stationText, titleCase, type ItemRecord, type ItemsData, type PathSpec } from "./data.js";
import { EMPTY, PAGE, RECORD, RECORD_HEAD, RECORD_RAIL, RECORD_TITLE } from "../../ui/layout.js";

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
  if (data.loading) return <p className={EMPTY}>Loading…</p>;
  if (source) return <ExpandedItem key={id} {...props} tierId={source.tier.id} />;
  if (data.authored.has(id)) return <AuthoredItem key={id} {...props} />;
  return <div className={PAGE}><p className={EMPTY}>"{id}" is not an item.</p></div>;
}

const item = (...path: Path[number][]): PathSpec => specAt(ItemSchema, path);
const member = (...path: Path[number][]): PathSpec => specAt(ProgressionTierSchema, ["equipment", 0, ...path]);
const BONUS: Readonly<Record<BonusKey, PathSpec>> = Object.fromEntries(BONUS_KEYS.map(key => [key, specAt(EquipmentBonusesSchema, [key])])) as Record<BonusKey, PathSpec>;
const SKILL_KEYS = Object.keys(ItemSkillRequirementsSchema.fields).map(key => ({ value: key, label: specAt(ItemSkillRequirementsSchema, [key]).label }));

/**
 * The seven equipment bonuses as the stat table the game thinks in: accuracy and power by style,
 * then the three that have no style. Row names sit in the sheet's label column.
 */
function BonusMatrix({ cell }: { cell: (key: BonusKey) => ReactNode }) {
  return <StatMatrix columns={["Melee", "Magic"]} rows={[
    { key: "accuracy", label: "Accuracy", cells: [cell("meleeAccuracy"), cell("magicAccuracy")] },
    { key: "power", label: "Power", cells: [cell("meleePower"), cell("magicPower")] },
    { key: "defence", label: BONUS.defence.label, cells: [cell("defence")] },
    { key: "health", label: BONUS.health.label, cells: [cell("health")] },
    { key: "vitality", label: BONUS.vitality.label, hint: BONUS.vitality.hint, cells: [cell("vitality")] },
  ]} />;
}

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

  if (!tier || !row || !family || !derived) return <p className={EMPTY}>Loading…</p>;
  const isTool = family.category === "tool";
  const value = item("value");
  const facts = [`Tier ${tier.tier}`, isTool ? `${titleCase(family.skill)} tool` : titleCase(derived.slot), `requires ${family.skill} ${tier.reqLevel}`];

  const main = <div className="min-w-0">
    <header className={RECORD_HEAD}>
      <Thumb spec={{ kind: "item", id }} size="l" alt="" />
      <div className={RECORD_TITLE}>
        <h1>{row.name}</h1>
        <Facts items={facts} />
        <code>{id}</code>
      </div>
      {variant === "drawer" && <span className="flex shrink-0 items-center gap-1"><Button variant="secondary" size="sm" onClick={() => navigate("items/catalog", id)}>Open page <ArrowRight size={12} /></Button></span>}
    </header>
    <Sheet>
      <Section title="Identity">
        <Field label={member("name").label} dirty={dirtyAt(["name"])}><TextField value={row.name} readOnly={readOnly} onChange={next => setMember(["name"], next)} /></Field>
        <Field label={member("description").label} dirty={dirtyAt(["description"])}><TextField value={row.description} multiline readOnly={readOnly} onChange={next => setMember(["description"], next)} /></Field>
      </Section>
      <Section title="Numbers" aside={<Button variant="link" size="xs" onClick={() => openFamily(family.id)}>{family.name} curve <ArrowRight /></Button>}>
        <DerivedNumber label={value.label} unit={value.unit} min={0} resolved={derived.value.resolved} readOnly={readOnly} optional dirty={dirtyAt(["adjustments", "value"])} onChange={next => setMember(["adjustments", "value"], next)} onOpenRef={openRef} />
        {isTool
          ? <DerivedNumber label={item("tool", "gatherBonus").label} integer={false} min={0} resolved={derived.gatherBonus.resolved} readOnly={readOnly} optional dirty={dirtyAt(["adjustments", "gatherBonus"])} onChange={next => setMember(["adjustments", "gatherBonus"], next)} onOpenRef={openRef} />
          : <BonusMatrix cell={key => <DerivedNumber compact labelHidden label={BONUS[key].label} resolved={derived.bonuses[key].resolved} readOnly={readOnly} optional dirty={dirtyAt(["adjustments", "bonuses", key])} onChange={next => setMember(["adjustments", "bonuses", key], next)} onOpenRef={openRef} />} />}
        {!isTool && <Row label="Slot"><Static>{titleCase(derived.slot)}</Static></Row>}
        <Row label="Requires"><Static>{titleCase(family.skill)} {tier.reqLevel}<span className="text-faint">&nbsp;· from the tier</span></Static></Row>
        {family.attackSpeedMs !== undefined && <Row label="Attack speed"><Static>{seconds(family.attackSpeedMs)}<span className="text-faint">&nbsp;· {family.attackSpeedMs} ms, from the family</span></Static></Row>}
        {family.magicWeapon && <Row label="Weapon"><Static>{titleCase(family.magicWeapon.kind)} · {family.magicWeapon.hands === 2 ? "two-handed" : "one-handed"}</Static></Row>}
      </Section>
      <MadeBy itemId={id} data={data} navigate={navigate} />
      <ReferencedBy collection="items" id={id} navigate={navigate} />
    </Sheet>
  </div>;

  return <>
    {variant === "page"
      ? <div className={PAGE}><div className={RECORD}>{main}<Rail collection="items" record={liveRecord ?? compiled ?? { id }} recordId={id} navigate={navigate} /></div></div>
      : main}
    {familyDrawer && <FamilyDrawer familyId={familyDrawer} data={data} onClose={() => setFamilyDrawer(undefined)} onLive={setLocalFamily} onOpenItem={itemId => navigate("items/catalog", itemId)} />}
  </>;
}

function Rail({ collection, record, recordId, navigate }: { collection: string; record: ContentRow; recordId: string; navigate: AppProps["navigate"] }) {
  const { index } = useReferenceIndex();
  return <aside className={RECORD_RAIL}><EntitySummary collection={collection} record={record} recordId={recordId} index={index} navigate={navigate} editing bare /></aside>;
}

/** The production entry that outputs this item, with its inputs, station and rates. */
export function MadeBy({ itemId, data, navigate }: { itemId: string; data: ItemsData; navigate: AppProps["navigate"] }) {
  const made = data.madeBy(itemId);
  if (!made) return null;
  const template = data.templateById(made.entry.templateId);
  const rates = template ? deriveProductionEntry(made.tier, made.entry, template) : undefined;
  const name = (itemId: string) => data.item(itemId)?.name ?? itemId;
  return <Section title="Made by" aside={<Button variant="link" size="xs" onClick={() => navigate("compiled-recipes", made.entry.id)}>{made.entry.name} <ArrowRight /></Button>}>
    <Row label="Recipe">
      <div className="flex min-h-7 flex-wrap items-center gap-1.5">
        {made.entry.inputs.map((input, i) => <ItemStack key={i} id={input.itemId} name={name(input.itemId)} quantity={input.quantity} onOpen={() => navigate("items/catalog", input.itemId)} />)}
        <ArrowRight className="mx-0.5 size-3.5 text-faint" aria-label="makes" />
        <ItemStack id={made.entry.output.itemId} name={name(made.entry.output.itemId)} quantity={made.entry.output.quantity} />
      </div>
    </Row>
    {template && <Row label="Station"><Static>{titleCase(template.skill)}<span className="text-faint">&nbsp;·&nbsp;</span>{stationText(template.stations)}</Static></Row>}
    {rates && <Row label="Rates"><InlineStats items={[
      { label: "Time", value: seconds(rates.durationMs.value) },
      { label: "XP", value: fmt(rates.xp.value) },
      { label: "Level", value: rates.reqLevel.value },
    ]} /></Row>}
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
const BLOCK_ORDER: readonly BlockKey[] = ["equip", "tool", "food", "magicWeapon", "orb"];

/**
 * An optional block the item has, as a section with a way to remove it. Blocks the item does not
 * have are not drawn as empty sections; they are offered together on one "Add" line at the end of
 * the sheet (`AddBlocks`), so a sword is a sword-length page.
 */
function BlockSection({ spec, readOnly, onRemove, children }: { spec: PathSpec; readOnly: boolean; onRemove: () => void; children: ReactNode }) {
  const aside = readOnly ? undefined : <Button variant="link" size="inline" title={`Remove the ${spec.label.toLowerCase()} from this item`} onClick={onRemove}>Remove</Button>;
  return <Section title={spec.label} aside={aside}>
    {spec.hint && <p className="mb-1.5 text-[11px] leading-snug text-faint [overflow-wrap:anywhere]">{spec.hint}</p>}
    {children}
  </Section>;
}

function AddBlocks({ absent, readOnly, onAdd }: { absent: readonly BlockKey[]; readOnly: boolean; onAdd: (key: BlockKey) => void }) {
  if (readOnly || !absent.length) return null;
  return <Row label="Add">
    <span className="flex flex-wrap gap-1">{absent.map(key => <Button variant="secondary" size="sm" key={key} onClick={() => onAdd(key)}><Plus size={12} /> {item(key).label}</Button>)}</span>
  </Row>;
}

function AuthoredItem({ id, navigate, data, variant = "page" }: ItemPageProps) {
  const draft = useRecordDraft<ItemRecord>("items", id);
  const readOnly = __DEVDOCS_PLAYER__ || !draft.editable;
  const record = draft.draft;
  if (!record) return <p className={EMPTY}>Loading…</p>;
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
    const presence = (key: BlockKey) => (present: boolean) => set([key], present ? BLOCKS.find(candidate => candidate.key === key)!.make() : undefined);

  const main = <div className="min-w-0">
    <header className={RECORD_HEAD}>
      <Thumb spec={{ kind: "item", id }} size="l" alt="" />
      <div className={RECORD_TITLE}>
        <h1>{record.name}</h1>
        <Facts items={facts} />
        <code>{id}</code>
      </div>
      {variant === "drawer" && <span className="flex shrink-0 items-center gap-1"><Button variant="secondary" size="sm" onClick={() => navigate("items/catalog", id)}>Open page <ArrowRight size={12} /></Button></span>}
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
      {equip && <BlockSection spec={item("equip")} readOnly={readOnly} onRemove={() => presence("equip")(false)}>
        {choice(["equip", "slot"])}
        <BonusMatrix cell={key => <Field compact labelHidden label={BONUS[key].label}><NumberField value={equip?.bonuses?.[key]} readOnly={readOnly} ariaLabel={BONUS[key].label} onChange={next => set(["equip", "bonuses", key], next ?? 0)} /></Field>} />
        {num(["equip", "attackSpeedMs"])}
        <MapField<number> label={item("equip", "requires").label} value={requires} keys={SKILL_KEYS} keyLabel="skill" readOnly={readOnly} emptyText="No skill requirement" defaultValue={() => 1}
          onChange={next => set(["equip", "requires"], next)}
          renderValue={(skill, level, update) => <NumberField value={level} integer min={1} ariaLabel={`${titleCase(skill)} level`} readOnly={readOnly} onChange={next => update(next ?? 1)} />} />
      </BlockSection>}
      {record.tool && <BlockSection spec={item("tool")} readOnly={readOnly} onRemove={() => presence("tool")(false)}>
        {choice(["tool", "skill"])}
        {num(["tool", "gatherBonus"])}
      </BlockSection>}
      {record.food && <BlockSection spec={item("food")} readOnly={readOnly} onRemove={() => presence("food")(false)}>
        {num(["food", "healAmount"])}
      </BlockSection>}
      {record.magicWeapon && <BlockSection spec={item("magicWeapon")} readOnly={readOnly} onRemove={() => presence("magicWeapon")(false)}>
        {choice(["magicWeapon", "kind"])}
        <Field label={item("magicWeapon", "hands").label}><ChoiceField value={String(record.magicWeapon?.hands ?? 1)} options={HANDS} readOnly={readOnly} onChange={next => set(["magicWeapon", "hands"], Number(next))} /></Field>
        <Field label={item("magicWeapon", "charge").label}>
          {readOnly
            ? <Static muted>{charge ? "Elemental" : "None"}</Static>
            : charge
              ? <Button variant="link" size="inline" onClick={() => set(["magicWeapon", "charge"], undefined)}>Remove charge</Button>
              : <Button variant="secondary" size="sm" onClick={() => set(["magicWeapon", "charge"], { element: "wind", capacity: 10, initialCharges: 0, rechargeItemId: "", rechargeCost: 1, orbItemId: "", released: false })}><Plus size={12} /> Add elemental charge</Button>}
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
      </BlockSection>}
      {record.orb && <BlockSection spec={item("orb")} readOnly={readOnly} onRemove={() => presence("orb")(false)}>
        {choice(["orb", "element"])}
        {toggle(["orb", "released"])}
      </BlockSection>}
      <Section title="More"><AddBlocks absent={BLOCK_ORDER.filter(key => !record[key])} readOnly={readOnly} onAdd={key => presence(key)(true)} /></Section>
      <MadeBy itemId={id} data={data} navigate={navigate} />
      <ReferencedBy collection="items" id={id} navigate={navigate} />
    </Sheet>
  </div>;

  if (variant === "drawer") return main;
  return <div className={PAGE}><div className={RECORD}>{main}<Rail collection="items" record={record} recordId={id} navigate={navigate} /></div></div>;
}

export type { BonusKey };
