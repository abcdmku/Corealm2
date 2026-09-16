import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { ItemSchema, ItemSkillRequirementsSchema } from "../../../../game/src/content/schema/items.js";
import type { EquipmentFamily, ProgressionTier } from "../../../../game/src/content/schema/progression.js";
import type { AppProps, ContentRow } from "../../model/contracts.js";
import { BONUS_KEYS, deriveEquipmentMember, deriveProductionEntry, equipmentSource, fmt, type BonusKey } from "../../model/derive.js";
import { getPath, setPath, useRecordDraft } from "../../model/draft.js";
import type { Path, RecordRef, Resolved } from "../../model/origin.js";
import { useReferenceIndex } from "../../model/refs.js";
import { EntitySummary } from "../../ui/EntitySummary.js";
import { ItemCard, type Bind, type BlockKey, type ItemView } from "../../ui/gamecard/ItemCard.js";
import { ChoiceField, Field, MapField, NumberField, RefField, ReferencedBy, Row, Section, Sheet, Static, ToggleField, usePeek } from "../../ui/field/index.js";
import { Thumb } from "../../ui/Thumb.js";
import { FamilyDrawer } from "./FamilyDrawer.js";
import { choicesOf, emptyBonuses, seconds, specAt, stationText, titleCase, type ItemRecord, type ItemsData, type PathSpec } from "./data.js";

/*
  One page for every item, and it opens with the item's own tooltip (`ui/gamecard/ItemCard`).
  Everything the player reads — the name, the line under it, the description, the stats that are not
  zero, the speed, the requirement, the price — is edited in place, in the shape the client draws it.

  What is left below the card is the backstage: the parts of a record the tooltip has no room for
  (which skills a piece needs, what a charge recharges with) and its place in the world (what makes
  it, what points at it). A block the item does not have is a chip on the card, not an empty
  section, so a plain sword is a short page rather than four headings saying "None".

  Gear expanded from a tier edits the tier member; each number carries the family curve that
  produced it, so its dot, its revert and its provenance sentence work on the card unchanged.
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
const SKILL_KEYS = Object.keys(ItemSkillRequirementsSchema.fields).map(key => ({ value: key, label: specAt(ItemSkillRequirementsSchema, [key]).label }));
const SKILL_VALUES = SKILL_KEYS.map(entry => entry.value);
const CATEGORIES = item("category").choices ?? [];
const SLOTS = item("equip", "slot").choices ?? [];
const pathKey = (path: Path): string => path.join(".");

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

/** The record's context column: the model stage and everything that points at it. */
function Rail({ collection, record, recordId, navigate }: { collection: string; record: ContentRow; recordId: string; navigate: AppProps["navigate"] }) {
  const { index } = useReferenceIndex();
  return <aside className="record-rail"><EntitySummary collection={collection} record={record} recordId={recordId} index={index} navigate={navigate} editing /></aside>;
}

function OpenPage({ id, navigate }: { id: string; navigate: AppProps["navigate"] }) {
  return <span className="record-actions"><button type="button" className="button button-small" onClick={() => navigate("items/catalog", id)}>Open page <ArrowRight size={12} /></button></span>;
}

/* ---------- Gear expanded from a tier ---------- */

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

  /** The item as the game will see it after this draft, for the card and the rail. */
  const live = useMemo<ItemView & ContentRow | undefined>(() => {
    if (!derived || !row || !tier || !family) return undefined;
    const bonuses = Object.fromEntries(BONUS_KEYS.map(key => [key, derived.bonuses[key].value])) as Record<BonusKey, number>;
    return {
      ...compiled, id, name: row.name, description: row.description, tier: tier.tier, value: derived.value.value,
      category: family.category, stackable: false,
      ...(family.category === "tool"
        ? { tool: { skill: family.skill, gatherBonus: derived.gatherBonus.value } }
        : { equip: { slot: derived.slot, requires: { [family.skill]: tier.reqLevel }, bonuses, ...(family.attackSpeedMs ? { attackSpeedMs: family.attackSpeedMs } : {}) } }),
      ...(family.magicWeapon ? { magicWeapon: family.magicWeapon } : {}),
    };
  }, [derived, row, tier, family, compiled, id]);

  if (!tier || !row || !family || !derived || !live) return <p className="empty-inline">Loading…</p>;

  /*
    Which paths this page owns. The name and the description belong to the tier row; the price and
    the bonuses are adjustments over the family curve, so they carry the curve's chain; slot, tier,
    requirement and cadence come from the tier and the family and are shown but not edited here —
    the curve behind them opens from the note beside the card.
  */
  const adjustment = (path: Path, resolved: Resolved<unknown>): Bind => ({
    set: readOnly ? undefined : value => setMember(path, value),
    resolved, dirty: dirtyAt(path),
    revert: readOnly ? undefined : () => setMember(path, undefined),
  });
  const binds: Record<string, Bind> = {
    name: { set: readOnly ? undefined : value => setMember(["name"], value), dirty: dirtyAt(["name"]) },
    description: { set: readOnly ? undefined : value => setMember(["description"], value), dirty: dirtyAt(["description"]) },
    value: adjustment(["adjustments", "value"], derived.value.resolved),
    "tool.gatherBonus": adjustment(["adjustments", "gatherBonus"], derived.gatherBonus.resolved),
    ...Object.fromEntries(BONUS_KEYS.map(key => [`equip.bonuses.${key}`, adjustment(["adjustments", "bonuses", key], derived.bonuses[key].resolved)])),
  };

  const main = <div className="record-main">
    <ItemCard item={live} bind={path => binds[pathKey(path)] ?? {}} onOpenRef={openRef}
      note={<><button type="button" className="text-button" onClick={() => openFamily(family.id)}>{family.name} curve</button> at tier {tier.tier}</>} />
    {variant === "drawer" && <OpenPage id={id} navigate={navigate} />}
    <Sheet className="record-backstage">
      <Section title="From the ladder" aside={<button type="button" className="text-button" onClick={() => openFamily(family.id)}>{family.name} curve <ArrowRight size={11} /></button>}>
        <Row label="Tier"><Static>{tier.name ?? `Tier ${tier.tier}`} · requires {titleCase(family.skill)} {tier.reqLevel}</Static></Row>
        {family.attackSpeedMs !== undefined && <Row label="Cadence"><Static mono>{family.attackSpeedMs} ms per attack</Static></Row>}
        {family.magicWeapon && <Row label="Magic weapon"><Static>{family.magicWeapon.kind} · {family.magicWeapon.hands === 2 ? "two-handed" : "one-handed"}</Static></Row>}
      </Section>
      <MadeBy itemId={id} data={data} navigate={navigate} />
      <ReferencedBy collection="items" id={id} navigate={navigate} />
    </Sheet>
  </div>;

  return <>
    {variant === "page"
      ? <div className="ws-page"><div className="record">{main}<Rail collection="items" record={live} recordId={id} navigate={navigate} /></div></div>
      : main}
    {familyDrawer && <FamilyDrawer familyId={familyDrawer} data={data} onClose={() => setFamilyDrawer(undefined)} onLive={setLocalFamily} onOpenItem={itemId => navigate("items/catalog", itemId)} />}
  </>;
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

const BLOCKS: Readonly<Record<BlockKey, () => unknown>> = {
  equip: () => ({ slot: "mainHand", bonuses: emptyBonuses(), requires: {} }),
  tool: () => ({ skill: "mining", gatherBonus: 1 }),
  food: () => ({ healAmount: 1 }),
  magicWeapon: () => ({ kind: "wand", hands: 1 }),
  orb: () => ({ element: "wind", released: true }),
};
const HANDS = [{ value: "1", label: "One-handed" }, { value: "2", label: "Two-handed" }];

function AuthoredItem({ id, navigate, data, variant = "page" }: ItemPageProps) {
  const draft = useRecordDraft<ItemRecord>("items", id);
  const readOnly = __DEVDOCS_PLAYER__ || !draft.editable;
  const record = draft.draft;
  if (!record) return <p className="empty-inline">Loading…</p>;
  const set = draft.setPath;
  const charge = record.magicWeapon?.charge as Record<string, unknown> | undefined;
  const requires = Object.fromEntries(Object.entries(record.equip?.requires ?? {}).filter((entry): entry is [string, number] => typeof entry[1] === "number"));

  // Every value on the card writes straight to its own path on the item row.
  const bind = (path: Path): Bind => readOnly ? {} : { set: value => set(path, value) };
  const setBlock = (key: BlockKey, present: boolean) => set([key], present ? BLOCKS[key]() : undefined);

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

  const main = <div className="record-main">
    <ItemCard item={record as ItemView} bind={bind} categories={CATEGORIES} slots={SLOTS} skills={SKILL_VALUES} onSetBlock={readOnly ? undefined : setBlock} />
    {variant === "drawer" && <OpenPage id={id} navigate={navigate} />}
    <Sheet className="record-backstage">
      {/*
        Only the blocks the item actually has, and only the parts of them the tooltip cannot say.
        A sword therefore ends at its skill requirements; adding a food effect adds one section.
      */}
      {record.equip && <Section title="Skill requirements" collapsible>
        <MapField<number> label={item("equip", "requires").label} value={requires} keys={SKILL_KEYS} keyLabel="skill" readOnly={readOnly} emptyText="No skill requirement" defaultValue={() => 1}
          onChange={next => set(["equip", "requires"], next)}
          renderValue={(skill, level, update) => <NumberField value={level} integer min={1} ariaLabel={`${titleCase(skill)} level`} readOnly={readOnly} onChange={next => update(next ?? 1)} />} />
      </Section>}
      {record.tool && <Section title={item("tool").label} collapsible>{choice(["tool", "skill"])}</Section>}
      {record.magicWeapon && <Section title={item("magicWeapon").label} collapsible>
        {choice(["magicWeapon", "kind"])}
        <Field label={item("magicWeapon", "hands").label}><ChoiceField value={String(record.magicWeapon.hands ?? 1)} options={HANDS} readOnly={readOnly} onChange={next => set(["magicWeapon", "hands"], Number(next))} /></Field>
        {charge
          ? <>
            {choice(["magicWeapon", "charge", "element"])}
            {num(["magicWeapon", "charge", "capacity"])}
            {num(["magicWeapon", "charge", "initialCharges"])}
            {ref(["magicWeapon", "charge", "rechargeItemId"])}
            {num(["magicWeapon", "charge", "rechargeCost"])}
            {ref(["magicWeapon", "charge", "orbItemId"])}
            {toggle(["magicWeapon", "charge", "released"])}
            <button type="button" className="text-button" disabled={readOnly} onClick={() => set(["magicWeapon", "charge"], undefined)}>Remove the elemental charge</button>
          </>
          : <button type="button" className="text-button" disabled={readOnly} onClick={() => set(["magicWeapon", "charge"], { element: "wind", capacity: 10, initialCharges: 0, rechargeItemId: "", rechargeCost: 1, orbItemId: "", released: false })}>Add an elemental charge</button>}
      </Section>}
      {record.orb && <Section title={item("orb").label} collapsible>{choice(["orb", "element"])}{toggle(["orb", "released"])}</Section>}
      <MadeBy itemId={id} data={data} navigate={navigate} />
      <ReferencedBy collection="items" id={id} navigate={navigate} />
    </Sheet>
  </div>;

  if (variant === "drawer") return main;
  return <div className="ws-page"><div className="record">{main}<Rail collection="items" record={record} recordId={id} navigate={navigate} /></div></div>;
}

export type { BonusKey };
