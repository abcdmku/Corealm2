import { useState, type ReactNode } from "react";
import {
  BONUS_LABELS, ELEMENT_LABELS, attackSpeedLine, magicWeaponLine, sellPrice,
} from "../../../../game/src/ui/itemFacts.js";
import { SKILLS } from "../../../../game/src/content/skills.js";
import type { SkillId } from "../../../../game/src/contracts.js";
import type { BonusKey } from "../../model/derive.js";
import type { Path, RecordRef, Resolved } from "../../model/origin.js";
import { ChoiceField, Field, NumberField, TextField, ToggleField } from "../field/index.js";
import { Thumb } from "../Thumb.js";
import { Card, CardAdd, CardBlock, CardHead, CardLine, CardLines, CardMeta, CardRule, CardStats, type AddOption } from "./Card.js";

/*
  The item as its tooltip: the icon, the brass name, the line under it, the description, the stats
  the player would actually see, and the sentences the client prints about speed, charges, food and
  tools. Every one of those is the control that edits it.

  The two item shapes share this view. A tier-expanded piece of gear passes binds whose values come
  from its family curve, so the number carries its origin dot and reverts to the curve; an authored
  item passes binds straight onto its own row. `bind` returning nothing means this page does not own
  that path, and the value is drawn as plain text.
*/

export interface ItemView {
  id: string;
  name: string;
  description: string;
  category?: string;
  stackable?: boolean;
  tier?: number;
  value?: number;
  equip?: { slot?: string; bonuses?: Partial<Record<BonusKey, number>>; requires?: Record<string, number>; attackSpeedMs?: number };
  tool?: { skill?: string; gatherBonus?: number };
  food?: { healAmount?: number };
  magicWeapon?: { kind?: string; hands?: number; charge?: Record<string, unknown> };
  orb?: { element?: string; released?: boolean };
}

/** What a page hands back for one path on the record. Everything but `set` is optional. */
export interface Bind {
  set?: (value: unknown) => void;
  /** The value's origin chain, when the page derives it. Draws the dot, the revert and the sentence. */
  resolved?: Resolved<unknown>;
  dirty?: boolean;
  revert?: () => void;
}

export interface ItemCardProps {
  item: ItemView;
  /** Called for every editable path on the card. Return `{}` for a value this page cannot write. */
  bind: (path: Path) => Bind;
  categories?: readonly string[];
  slots?: readonly string[];
  skills?: readonly string[];
  onOpenRef?: (ref: RecordRef) => void;
  /** Add and remove the optional blocks (tool, food, magic weapon, orb, equipment). */
  onSetBlock?: (key: BlockKey, present: boolean) => void;
  note?: ReactNode;
}

export type BlockKey = "equip" | "tool" | "food" | "magicWeapon" | "orb";
const BLOCK_LABELS: Readonly<Record<BlockKey, string>> = {
  equip: "Equipment", tool: "Gathering tool", food: "Food effect", magicWeapon: "Magic weapon", orb: "Essence orb",
};
const skillName = (skill: string): string => SKILLS[skill as SkillId]?.name ?? skill;
const titleCase = (value: string): string => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, first => first.toUpperCase());

export function ItemCard({ item, bind, categories, slots, skills, onOpenRef, onSetBlock, note }: ItemCardProps) {
  // Bonuses the client would hide because they are zero. Choosing one from the add row reveals its
  // row so it can be typed into; it stays on the card until the page is left.
  const [revealed, setRevealed] = useState<ReadonlySet<BonusKey>>(new Set());
  const bonuses = item.equip?.bonuses ?? {};
  const shown = BONUS_LABELS.filter(([key]) => {
    const handle = bind(["equip", "bonuses", key]);
    return (bonuses[key] ?? 0) !== 0 || revealed.has(key) || handle.dirty;
  });
  const hidden = BONUS_LABELS.filter(([key]) => !shown.some(([shownKey]) => shownKey === key));

  const num = (path: Path, value: number | undefined, extra: { unit?: string; integer?: boolean; min?: number; step?: number; optional?: boolean; placeholder?: string; ariaLabel: string } ) => {
    const handle = bind(path);
    const resolved = handle.resolved as Resolved<number | undefined> | undefined;
    return <NumberField value={resolved ? resolved.value : value} readOnly={!handle.set} ariaLabel={extra.ariaLabel}
      unit={extra.unit} integer={extra.integer ?? true} min={extra.min} step={extra.step} optional={extra.optional} placeholder={extra.placeholder}
      onChange={next => handle.set?.(next)} />;
  };

  const stat = (key: BonusKey, label: string) => {
    const handle = bind(["equip", "bonuses", key]);
    const resolved = handle.resolved as Resolved<number | undefined> | undefined;
    // Compact keeps the curve's sentence in the focus popover. The note above the card already
    // names the curve every one of these came from; a copy on each row would only be noise.
    return <Field key={key} compact label={label} resolved={resolved} dirty={handle.dirty} disabled={!handle.set} onOpenRef={onOpenRef}
      onRevert={handle.revert ? () => handle.revert!() : undefined}>
      <NumberField value={resolved ? resolved.value : bonuses[key]} readOnly={!handle.set} onChange={next => handle.set?.(next)} />
    </Field>;
  };

  const nameBind = bind(["name"]);
  const descriptionBind = bind(["description"]);
  const categoryBind = bind(["category"]);
  const stackBind = bind(["stackable"]);
  const slotBind = bind(["equip", "slot"]);
  const charge = item.magicWeapon?.charge as { element?: string; capacity?: number; rechargeCost?: number } | undefined;

  const additions: AddOption[] = onSetBlock
    ? (Object.keys(BLOCK_LABELS) as BlockKey[])
      .filter(key => !item[key])
      .map(key => ({ key, label: BLOCK_LABELS[key], onAdd: () => onSetBlock(key, true) }))
    : [];

  return <Card caption="As the player sees it" note={note}>
    <CardHead
      art={<Thumb spec={{ kind: "item", id: item.id }} size="xl" alt="" />}
      title={item.name}
      name={nameBind.set
        ? <TextField value={item.name} width="full" ariaLabel="Name" onChange={next => nameBind.set!(next)} />
        : <h2>{item.name}</h2>}
      sub={<CardMeta parts={[
        item.tier !== undefined ? <>Tier {num(["tier"], item.tier, { min: 0, ariaLabel: "Tier" })}</> : undefined,
        categoryBind.set && categories
          ? <ChoiceField value={item.category} options={categories} ariaLabel="Category" onChange={next => categoryBind.set!(next)} />
          : item.category,
        item.equip && (slotBind.set && slots
          ? <ChoiceField value={item.equip.slot} options={slots.map(value => ({ value, label: titleCase(value) }))} ariaLabel="Equipment slot" onChange={next => slotBind.set!(next)} />
          : item.equip.slot && titleCase(item.equip.slot)),
        stackBind.set
          ? <ToggleField value={item.stackable === true} labels={["stacks", "stacks"]} ariaLabel="Stackable" onChange={next => stackBind.set!(next)} />
          : item.stackable ? "stacks" : undefined,
      ]} />} />

    {(descriptionBind.set || item.description) && <div className="gamecard-body">
      {descriptionBind.set
        ? <TextField value={item.description} multiline placeholder="No description yet." ariaLabel="Description" onChange={next => descriptionBind.set!(next)} />
        : <p>{item.description}</p>}
    </div>}

    {item.equip && <>
      <CardStats>{shown.map(([key, label]) => stat(key, label))}</CardStats>
      {hidden.length > 0 && Boolean(bind(["equip", "bonuses", hidden[0]![0]]).set) && <div className="gamecard-add" data-quiet>
        <span>Zero:</span>
        {hidden.map(([key, label], at) => <button key={key} type="button" title={`Give this item a ${label.toLowerCase()} bonus`} onClick={() => setRevealed(current => new Set([...current, key]))}>{label}{at < hidden.length - 1 ? " ·" : ""}</button>)}
      </div>}
    </>}

    <CardLines>
      {item.equip?.attackSpeedMs !== undefined && (bind(["equip", "attackSpeedMs"]).set
        ? <CardLine>{item.magicWeapon ? "Cast cadence" : "Attack speed"} {num(["equip", "attackSpeedMs"], item.equip.attackSpeedMs, { unit: "ms", min: 0, step: 100, ariaLabel: "Attack interval" })}<span className="gamecard-derived">= {(item.equip.attackSpeedMs / 1000).toFixed(1)} s</span></CardLine>
        : <CardLine>{attackSpeedLine(item.equip.attackSpeedMs, Boolean(item.magicWeapon))}</CardLine>)}

      {item.magicWeapon && <CardBlock onRemove={onSetBlock ? () => onSetBlock("magicWeapon", false) : undefined} removeLabel="Remove the magic weapon block">
        <CardLine>{magicWeaponLine(item.magicWeapon.kind === "staff" ? "staff" : "wand")}</CardLine>
        {charge && <CardLine>{ELEMENT_LABELS[(charge.element ?? "wind") as keyof typeof ELEMENT_LABELS]} weapon · {num(["magicWeapon", "charge", "capacity"], charge.capacity, { min: 0, ariaLabel: "Charge capacity" })} charge capacity, {num(["magicWeapon", "charge", "rechargeCost"], charge.rechargeCost, { min: 0, ariaLabel: "Recharge cost" })} essence to refill.</CardLine>}
      </CardBlock>}

      {item.tool && <CardBlock onRemove={onSetBlock ? () => onSetBlock("tool", false) : undefined} removeLabel="Remove the gathering tool block">
        <CardLine>{skillName(item.tool.skill ?? "mining")} tool, +{num(["tool", "gatherBonus"], item.tool.gatherBonus, { integer: false, min: 0, step: 0.5, ariaLabel: "Gather bonus" })} effective levels.</CardLine>
      </CardBlock>}

      {item.food && <CardBlock onRemove={onSetBlock ? () => onSetBlock("food", false) : undefined} removeLabel="Remove the food effect block">
        <CardLine>Heals {num(["food", "healAmount"], item.food.healAmount, { min: 0, ariaLabel: "Heal amount" })} health.</CardLine>
      </CardBlock>}

      {item.orb && <CardBlock onRemove={onSetBlock ? () => onSetBlock("orb", false) : undefined} removeLabel="Remove the essence orb block">
        <CardLine>Craft this into {ELEMENT_LABELS[(item.orb.element ?? "wind") as keyof typeof ELEMENT_LABELS]} wands and staves.</CardLine>
        {item.orb.released === false && <CardLine tone="warn">This orb is not released.</CardLine>}
      </CardBlock>}

      {Object.entries(item.equip?.requires ?? {}).filter((entry): entry is [string, number] => typeof entry[1] === "number").map(([skill, level]) => {
        const handle = bind(["equip", "requires", skill]);
        return <CardLine key={skill} tone="requirement">Requires {skillName(skill)} {num(["equip", "requires", skill], level, { min: 1, ariaLabel: `${skillName(skill)} level` })}</CardLine>;
      })}
    </CardLines>

    <CardRule />
    <CardLine tone="value">Value {num(["value"], item.value, { min: 0, ariaLabel: "Buy value" })} marks<span className="gamecard-derived">· sells for {sellPrice(item.value ?? 0).toLocaleString("en-US")}</span></CardLine>

    {additions.length > 0 && <CardAdd options={additions} />}
  </Card>;
}
