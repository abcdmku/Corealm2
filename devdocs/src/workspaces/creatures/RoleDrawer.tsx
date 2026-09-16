import { useEffect, useMemo } from "react";
import { X } from "lucide-react";
import { calculateCreatureCombat } from "../../../../game/src/content/formulas/creature.js";
import { CreatureProfileSchema } from "../../../../game/src/content/schema/creatureDefinitions.js";
import { EnemyOverridesSchema } from "../../../../game/src/content/schema/enemies.js";
import { deriveCreature, fmt } from "../../model/derive.js";
import { useRecordDraft } from "../../model/draft.js";
import { fieldPath } from "../../model/fields.js";
import type { Resolved } from "../../model/origin.js";
import { DerivedChoice, DerivedNumber, Field, Fields, NumberField, ReferencedBy, Section, Sheet, fieldFromSchema } from "../../ui/field/index.js";
import { LoadingRows } from "../../ui/States.js";
import type { ViewProps } from "../types.js";
import { type CreatureData, type Profile } from "./shared.js";

/*
  The role curve beside the creature: its parameters as a compact grid of number fields (labels,
  units and steps from the profile schema), the behaviour the role implies as read-only curve
  values, the numbers it produces at a few levels, and who uses it. Edits recompute the open
  creature live through `onLive` before they are saved.
*/

/** The schema's `group: "curve"` fields, in schema order. */
const PARAM_KEYS = (Object.keys(CreatureProfileSchema.fields) as (keyof Profile & string)[]).filter(key => fieldPath(CreatureProfileSchema, [key])?.group === "curve");
const BEHAVIOUR_KEYS = ["behaviour", "aggroRadius", "attackStyle", "attackRangeM"] as const;
const TABLE_LEVELS = [1, 5, 10, 20, 30, 50, 70] as const;
const TABLE_FIELDS = ["maxHealth", "attackLevel", "defenceLevel", "accuracy", "armour", "magicArmour", "maxHit", "marks"] as const;

type CombatField = (typeof TABLE_FIELDS)[number];
const combatLabel = (key: string): string => fieldFromSchema(EnemyOverridesSchema, key).label;

function cell(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) ? fmt(value) : "—";
  if (Array.isArray(value)) return value.map(cell).join("–");
  return value === undefined ? "—" : String(value);
}

function safeCombat(level: number, profile: Profile): Record<string, unknown> {
  try { return calculateCreatureCombat(level, profile) as unknown as Record<string, unknown>; } catch { return {}; }
}

/**
 * Level × stat table for one role. `beaten` marks the columns whose value the open creature
 * overrides (a brass dot in the header; the curve value struck on the creature's level row, with
 * the creature's own value from `ownValues` in the title).
 */
export function CurveTable({ profile, levels, fields, highlight, beaten, ownValues, compact = false }: { profile: Profile; levels: readonly number[]; fields: readonly CombatField[]; highlight?: number; beaten?: ReadonlySet<string>; ownValues?: Readonly<Record<string, unknown>>; compact?: boolean }) {
  return <div className="curve-table" data-compact={compact || undefined}>
    <table>
      <thead><tr><th>Level</th>{fields.map(field => <th key={field}>{beaten?.has(field) && <span className="field-dot" data-state="overridden" role="img" aria-label="Overridden on this creature" title="This creature overrides the curve" />}{combatLabel(field)}</th>)}</tr></thead>
      <tbody>{levels.map(level => {
        const combat = safeCombat(level, profile);
        const current = level === highlight;
        return <tr key={level} className={current ? "is-current" : undefined}><td>{level}</td>{fields.map(field => {
          const overridden = current && beaten?.has(field);
          return <td key={field} data-beaten={overridden || undefined} title={overridden ? `Curve ${cell(combat[field])} · this creature ${cell(ownValues?.[field])}` : undefined}>{overridden ? <><s>{cell(combat[field])}</s> {cell(ownValues?.[field])}</> : cell(combat[field])}</td>;
        })}</tr>;
      })}</tbody>
    </table>
  </div>;
}

export function RoleDrawer({ profileId, data, navigate, onClose, onLive }: { profileId: string; data: CreatureData; navigate: ViewProps["navigate"]; onClose: () => void; onLive?: (profile: Profile | undefined) => void }) {
  const draft = useRecordDraft<Profile>("creatureProfiles", profileId);
  const working = draft.draft ?? draft.record;
  const editable = draft.editable;
  const users = data.resolved.filter(entry => entry.row.profileId === profileId).length;
  // The behaviour a role implies, as the same curve-origin chains a creature of this role would show.
  const implied = useMemo(() => working ? deriveCreature({ id: "", availability: "world", level: 1, profileId }, undefined, working).combat : undefined, [working, profileId]);
  useEffect(() => { onLive?.(draft.draft); }, [draft.draft, onLive]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <>
    <div className="drawer-scrim" onClick={onClose} />
    <div className="drawer role-drawer" role="dialog" aria-label={`${working?.name ?? profileId} role`}>
      <header className="drawer-head">
        <h2>{working?.name ?? profileId} <span className="muted">role</span></h2>
        <button type="button" className="icon-button" aria-label="Close role" onClick={onClose}><X size={14} /></button>
      </header>
      <div className="drawer-body">
        {draft.loading && <LoadingRows />}
        {working && implied && <>
          <Sheet compact>
            <Section title="Curve">
              <Fields columns={2}>
                {PARAM_KEYS.map(key => {
                  const spec = fieldFromSchema(CreatureProfileSchema, key);
                  return <Field key={key} compact label={spec.label} hint={spec.hint} unit={spec.unit} disabled={!editable}>
                    <NumberField value={working[key] as number | undefined} unit={spec.unit} integer={spec.integer} min={spec.min} step={spec.step ?? (spec.integer ? 100 : 0.1)} readOnly={!editable} onChange={value => draft.setPath([key], value)} />
                  </Field>;
                })}
              </Fields>
            </Section>
            <Section title="Behaviour" aside={<span>set by the role, not the curve parameters</span>}>
              <Fields columns={2}>
                {BEHAVIOUR_KEYS.map(key => {
                  const spec = fieldFromSchema(EnemyOverridesSchema, key);
                  const resolved = implied[key]!.resolved;
                  return spec.kind === "enum"
                    ? <DerivedChoice key={key} compact readOnly label={spec.label} hint={spec.hint} resolved={resolved as Resolved<string | undefined>} options={spec.choices ?? []} onChange={() => undefined} />
                    : <DerivedNumber key={key} compact readOnly label={spec.label} hint={spec.hint} unit={spec.unit} resolved={resolved as Resolved<number | undefined>} onChange={() => undefined} />;
                })}
              </Fields>
            </Section>
            <Section title="By level">
              <CurveTable profile={working} levels={TABLE_LEVELS} fields={TABLE_FIELDS} />
            </Section>
            <ReferencedBy collection="creatureProfiles" id={profileId} title={`Used by ${users} ${users === 1 ? "creature" : "creatures"}`} navigate={(collection, id) => { onClose(); navigate(collection, id); }} />
          </Sheet>
        </>}
      </div>
    </div>
  </>;
}
