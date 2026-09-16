import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { calculateCreatureCombat } from "../../../../game/src/content/formulas/creature.js";
import { CreatureProfileSchema } from "../../../../game/src/content/schema/creatureDefinitions.js";
import { EnemyOverridesSchema } from "../../../../game/src/content/schema/enemies.js";
import { ConsequenceCell, ConsequenceNote, movesWith, rowMovement, sameValue, tally } from "../../dev/formulas/consequences.js";
import { deriveCreature, fmt } from "../../model/derive.js";
import { setPath, useRecordDraft } from "../../model/draft.js";
import { fieldPath } from "../../model/fields.js";
import type { Resolved } from "../../model/origin.js";
import { DerivedChoice, DerivedNumber, Field, Fields, NumberField, Section, Sheet, fieldFromSchema } from "../../ui/field/index.js";
import { LoadingRows } from "../../ui/States.js";
import type { ViewProps } from "../types.js";
import { type CreatureData, type Profile } from "./shared.js";

/*
  The role curve beside the creature, with what it drives (docs/devdocs-inputs.md 3.10). Its
  parameters are a compact grid of number fields (labels, units and steps from the profile schema);
  the behaviour the role implies reads as curve values; the table by level shows the curve's own
  shape; and "Creatures" is one row per creature on this role, at its level, with the number it has
  now and the number the draft gives it. A creature that overrides a stat does not move: its cell
  keeps its own number and wears the brass override dot. An Alt+drag scrub on a parameter label
  updates all of it live, and `onLive` pushes the same draft to the creature behind the drawer.
*/

const CompiledCheck = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../../dev/formulas/CompiledCheck.js"));

/** The schema's `group: "curve"` fields, in schema order. */
const PARAM_KEYS = (Object.keys(CreatureProfileSchema.fields) as (keyof Profile & string)[]).filter(key => fieldPath(CreatureProfileSchema, [key])?.group === "curve");
const BEHAVIOUR_KEYS = ["behaviour", "aggroRadius", "attackStyle", "attackRangeM"] as const;
const TABLE_LEVELS = [1, 5, 10, 20, 30, 50, 70] as const;
const TABLE_FIELDS = ["maxHealth", "attackLevel", "defenceLevel", "accuracy", "armour", "magicArmour", "maxHit", "marks"] as const;
/*
  The stats a consumer row can show. Attack speed is off the level table (it is the same at every
  level) but belongs here: most creatures override it, so a change to the role's attack speed is the
  clearest case of a curve that moves while its creatures do not.
*/
const CONSUMER_FIELDS = [...TABLE_FIELDS, "attackSpeedMs"] as const;
/** What a consumer row shows while nothing has moved yet: the four numbers the creature rail leads with. */
const RESTING_FIELDS = ["maxHealth", "attackLevel", "defenceLevel", "maxHit"] as const;

type CombatField = (typeof TABLE_FIELDS)[number];
type ConsumerField = (typeof CONSUMER_FIELDS)[number];
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
 * the creature's own value from `ownValues` in the title). `previous` is the saved curve: where
 * the draft moves a number, the cell shows the one it replaces.
 */
export function CurveTable({ profile, previous, levels, fields, highlight, beaten, ownValues, compact = false }: { profile: Profile; previous?: Profile; levels: readonly number[]; fields: readonly CombatField[]; highlight?: number; beaten?: ReadonlySet<string>; ownValues?: Readonly<Record<string, unknown>>; compact?: boolean }) {
  return <div className="curve-table" data-compact={compact || undefined}>
    <table>
      <thead><tr><th>Level</th>{fields.map(field => <th key={field}>{beaten?.has(field) && <span className="field-dot" data-state="overridden" role="img" aria-label="Overridden on this creature" title="This creature overrides the curve" />}{combatLabel(field)}</th>)}</tr></thead>
      <tbody>{levels.map(level => {
        const combat = safeCombat(level, profile);
        const was = previous ? safeCombat(level, previous) : undefined;
        const current = level === highlight;
        return <tr key={level} className={current ? "is-current" : undefined}><td>{level}</td>{fields.map(field => {
          const overridden = current && beaten?.has(field);
          if (overridden) return <td key={field} data-beaten title={`Curve ${cell(combat[field])} · this creature ${cell(ownValues?.[field])}`}><s>{cell(combat[field])}</s> {cell(ownValues?.[field])}</td>;
          if (was && !sameValue(was[field], combat[field])) return <td key={field}><ConsequenceCell before={was[field]} after={combat[field]} label={combatLabel(field)} /></td>;
          return <td key={field}>{cell(combat[field])}</td>;
        })}</tr>;
      })}</tbody>
    </table>
  </div>;
}

export function RoleDrawer({ profileId, data, navigate, onClose, onLive }: { profileId: string; data: CreatureData; navigate: ViewProps["navigate"]; onClose: () => void; onLive?: (profile: Profile | undefined) => void }) {
  const draft = useRecordDraft<Profile>("creatureProfiles", profileId);
  const committed = draft.draft ?? draft.record;
  // Alt+drag reports every step through `onPreview` and commits once on release, so the consequence
  // view has to follow the scrub rather than the draft. The commit clears it.
  const [scrub, setScrub] = useState<Profile>();
  useEffect(() => setScrub(undefined), [draft.draft]);
  const working = scrub ?? committed;
  const saved = draft.record;
  const editable = draft.editable;
  // The behaviour a role implies, as the same curve-origin chains a creature of this role would show.
  const implied = useMemo(() => working ? deriveCreature({ id: "", availability: "world", level: 1, profileId }, undefined, working).combat : undefined, [working, profileId]);

  const consumers = useMemo(() => {
    if (!working) return [];
    const previous = saved ?? working;
    return data.resolved
      .filter(entry => entry.row.profileId === profileId)
      .map(entry => ({ entry, before: deriveCreature(entry.definition, entry.base, previous), after: deriveCreature(entry.definition, entry.base, working) }))
      .sort((a, b) => a.entry.level - b.entry.level || a.entry.name.localeCompare(b.entry.name));
  }, [data.resolved, profileId, working, saved]);

  const columns = useMemo(() => {
    const changed = CONSUMER_FIELDS.filter(field => consumers.some(row => !sameValue(row.before.combat[field]?.computed, row.after.combat[field]?.computed)));
    return (changed.length ? changed : RESTING_FIELDS) as readonly ConsumerField[];
  }, [consumers]);

  // Variants take their base's name, so a role's list is full of repeats. The id disambiguates them.
  const repeated = useMemo(() => {
    const seen = new Map<string, number>();
    for (const row of consumers) seen.set(row.entry.name, (seen.get(row.entry.name) ?? 0) + 1);
    return seen;
  }, [consumers]);

  const rows = useMemo(() => consumers.map(({ entry, before, after }) => {
    const cells = columns.map(field => {
      const was = before.combat[field];
      const now = after.combat[field];
      return { field, before: was?.computed, after: now?.computed, own: now?.overridden ? now.value : undefined, ...movesWith(was?.computed, now?.computed, Boolean(now?.overridden)) };
    });
    return { entry, cells, ...rowMovement(cells) };
  }), [consumers, columns]);
  const counts = useMemo(() => tally(rows), [rows]);

  useEffect(() => { onLive?.(scrub ?? draft.draft); }, [draft.draft, scrub, onLive]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const openCreature = (id: string) => { onClose(); navigate("creatureDefinitions", id); };
  const dirtyAt = (key: string): boolean => draft.dirty && (committed as Record<string, unknown> | undefined)?.[key] !== (saved as Record<string, unknown> | undefined)?.[key];

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
                  return <Field key={key} compact label={spec.label} hint={spec.hint} unit={spec.unit} dirty={dirtyAt(key)} disabled={!editable}>
                    <NumberField value={working[key] as number | undefined} unit={spec.unit} integer={spec.integer} min={spec.min} step={spec.step ?? (spec.integer ? 100 : 0.1)} readOnly={!editable}
                      onPreview={next => { if (committed) setScrub(setPath(committed, [key], next)); }}
                      onChange={value => draft.setPath([key], value)} />
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
            <Section title="By level" aside={<span>the curve's own shape</span>}>
              <CurveTable profile={working} previous={draft.dirty || scrub ? saved : undefined} levels={TABLE_LEVELS} fields={TABLE_FIELDS} />
            </Section>
            <Section title="Creatures" aside={<ConsequenceNote tally={counts} noun="creatures" idle={<span>{rows.length} on this role</span>} />}>
              {rows.length
                ? <div className="matrix consequences">
                  <table>
                    <thead><tr><th className="cell-num">Level</th><th>Creature</th>{columns.map(field => <th key={field} className="cell-num">{combatLabel(field)}</th>)}</tr></thead>
                    <tbody>{rows.map(({ entry, cells, pinned }) => <tr key={entry.id} data-unmoved={pinned || undefined} title={[entry.id, data.regionName(entry.regionId), pinned ? "overrides these stats itself, so this change does not reach it" : ""].filter(Boolean).join(" · ")}>
                      <td className="cell-num">{entry.level}</td>
                      <td><button type="button" className="cell" onClick={() => openCreature(entry.id)}><span>{entry.name}</span>{(repeated.get(entry.name) ?? 0) > 1 && <code>{entry.id}</code>}</button></td>
                      {cells.map(item => <td key={item.field} className="cell-num"><ConsequenceCell before={item.before} after={item.after} own={item.own} label={combatLabel(item.field)} /></td>)}
                    </tr>)}</tbody>
                  </table>
                </div>
                : <p className="empty-inline">No creature uses this role yet.</p>}
              {CompiledCheck && <Suspense fallback={null}><CompiledCheck formulaId="creature.combat" profileId={profileId} parameters={working} tier={consumers[0]?.entry.level ?? 1} disabled={!draft.dirty} /></Suspense>}
            </Section>
          </Sheet>
        </>}
      </div>
    </div>
  </>;
}
