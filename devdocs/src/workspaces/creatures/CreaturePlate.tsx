import type { ReactNode } from "react";
import { EnemyOverridesSchema } from "../../../../game/src/content/schema/enemies.js";
import type { deriveCreature } from "../../model/derive.js";
import { fmtValue, type Path, type RecordRef, type Resolved } from "../../model/origin.js";
import { Card, CardHead, CardLine, CardLines, CardRule, CardStats } from "../../ui/gamecard/Card.js";
import { DerivedChoice, DerivedNumber, Field, NumberField, TextField, fieldFromSchema } from "../../ui/field/index.js";

/*
  The creature as the player meets it: the plate over its head, then what fighting it feels like,
  then the numbers behind that, then what it drops.

  Every value is still one field with its chain, so a number the Guardian curve produced carries no
  mark, and a number this creature overrides carries the brass dot and hands itself back on
  Backspace. The difference from the old grid is only that the words around the number are the
  field's label, so "Hits up to 3 every 2.4 s" is both the sentence the game implies and the two
  controls that set it.
*/

type Derived = ReturnType<typeof deriveCreature>;
const spec = (key: string) => fieldFromSchema(EnemyOverridesSchema, key);
const resolvedAs = <T,>(derived: Derived, key: string): Resolved<T> => derived.combat[key]!.resolved as Resolved<T>;
const seconds = (ms: unknown): string => typeof ms === "number" ? `${Number((ms / 1000).toFixed(2))} s` : "—";

/** The five numbers that decide a fight, as the tooltip's two-column table. */
const STAT_KEYS = ["attackLevel", "defenceLevel", "accuracy", "armour", "magicArmour"] as const;

export interface CreaturePlateProps {
  art: ReactNode;
  /** The name, with its chain: a variant that has not renamed itself shows the base's name. */
  name: Resolved<string | undefined>;
  placeholder: string;
  facts: ReactNode;
  derived: Derived;
  editable: boolean;
  note?: ReactNode;
  dirtyAt: (path: Path) => boolean;
  setName: (value: string | undefined) => void;
  setAdjustment: (key: string, value: unknown) => void;
  onOpenRef: (ref: RecordRef) => void;
  /** What it drops, drawn as the loot window (`DropPlate`), and its spawn places. */
  children?: ReactNode;
}

export function CreaturePlate({ art, name, placeholder, facts, derived, editable, note, dirtyAt, setName, setAdjustment, onOpenRef, children }: CreaturePlateProps) {
  const health = resolvedAs<number | undefined>(derived, "maxHealth");
  const marks = resolvedAs<[number, number] | undefined>(derived, "marks");

  /** One field in a sentence: the words are the label, the number is the control. */
  const at = (key: string, label: string, extra: { unit?: string; integer?: boolean; step?: number; min?: number } = {}) => {
    const rules = spec(key);
    return <Field key={key} compact label={label} hint={rules.hint} unit={extra.unit ?? rules.unit} resolved={resolvedAs<number | undefined>(derived, key)}
      dirty={dirtyAt(["adjustments", key])} disabled={!editable} onOpenRef={onOpenRef}
      onRevert={editable ? () => setAdjustment(key, undefined) : undefined}>
      <NumberField value={resolvedAs<number | undefined>(derived, key).value} optional unit={extra.unit ?? rules.unit}
        integer={extra.integer ?? rules.integer ?? false} min={extra.min ?? rules.min} step={extra.step ?? rules.step}
        readOnly={!editable} placeholder="none" ariaLabel={rules.label} onChange={value => setAdjustment(key, value)} />
    </Field>;
  };
  const choice = (key: string, label: string) => {
    const rules = spec(key);
    return <DerivedChoice compact label={label} hint={rules.hint} resolved={resolvedAs<string | undefined>(derived, key)} options={rules.choices ?? []}
      dirty={dirtyAt(["adjustments", key])} readOnly={!editable} onOpenRef={onOpenRef} onChange={value => setAdjustment(key, value)} />;
  };

  return <Card caption="As the player meets it" note={note} wide>
    <CardHead art={art} title={name.value ?? placeholder}
      name={editable
        ? <TextField value={name.value ?? ""} width="full" placeholder={placeholder} ariaLabel="Name" onChange={value => setName(value.trim() || undefined)} />
        : <h2>{name.value ?? placeholder}</h2>}
      sub={facts} />

    {/* The plate over its head: a full bar, because that is how the player first sees it. */}
    <div className="gamecard-plate">
      <div className="gamecard-bar" title="Full health, as the plate shows it"><span style={{ width: "100%" }} /></div>
      <Field compact label="" resolved={health} dirty={dirtyAt(["adjustments", "maxHealth"])} disabled={!editable} onOpenRef={onOpenRef}
        onRevert={editable ? () => setAdjustment("maxHealth", undefined) : undefined}>
        <NumberField value={health.value} integer min={1} optional readOnly={!editable} ariaLabel="Max health" onChange={value => setAdjustment("maxHealth", value)} />
      </Field>
      <span>health</span>
    </div>

    <CardLines>
      <CardLine>
        {at("maxHit", "Hits up to")}
        {choice("attackStyle", "with")}
        {at("attackRangeM", "from", { unit: "m" })}
        {at("attackSpeedMs", "away, every", { unit: "ms" })}
        <span className="gamecard-derived">({seconds(derived.combat.attackSpeedMs?.value)})</span>
      </CardLine>
      <CardLine>
        {choice("behaviour", "Is")}
        {at("aggroRadius", "within", { unit: "m" })}
        {at("moveSpeedMps", ", chases at", { unit: "m/s" })}
        {at("walkSpeedMps", ", wanders at", { unit: "m/s" })}
      </CardLine>
    </CardLines>

    <CardStats>
      {/* Compact keeps the curve's sentence in the focus popover: the caption above already says
          which curve every one of these came from, so five copies of it would only be noise. */}
      {STAT_KEYS.map(key => <DerivedNumber key={key} compact label={spec(key).label} hint={spec(key).hint} unit={spec(key).unit}
        resolved={resolvedAs<number | undefined>(derived, key)} integer={spec(key).integer ?? true} min={spec(key).min} step={spec(key).step}
        dirty={dirtyAt(["adjustments", key])} readOnly={!editable} optional onOpenRef={onOpenRef} onChange={value => setAdjustment(key, value)} />)}
    </CardStats>

    <CardRule />
    <CardLine tone="value">
      {/* The curve sets both ends of the coin drop together, so it is read here, not typed. */}
      <Field compact label="Drops" unit="marks" resolved={marks} disabled onOpenRef={onOpenRef}>
        <span className="field-static mono">{fmtValue(marks.value)}<span className="field-unit">marks</span></span>
      </Field>
    </CardLine>

    {children}
  </Card>;
}
