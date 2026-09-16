import { Suspense, useEffect, useMemo, useState } from "react";
import { lazyComponent } from "../lazyView.js";
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
import { Table, TableBody, TableCell, TableFrame, TableHead, TableHeader, TableLink, TableRow } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
import { Drawer } from "../../ui/Drawer.js";
import { Dot } from "../../ui/field/Field.js";
import { EMPTY } from "../../ui/layout.js";

/*
  The role curve beside the creature, with what it drives (docs/devdocs-inputs.md 3.10). Its
  parameters are a compact grid of number fields (labels, units and steps from the profile schema);
  the behaviour the role implies reads as curve values; the table by level shows the curve's own
  shape; and "Creatures" is one row per creature on this role, at its level, with the number it has
  now and the number the draft gives it. A creature that overrides a stat does not move: its cell
  keeps its own number and wears the brass override dot. An Alt+drag scrub on a parameter label
  updates all of it live, and `onLive` pushes the same draft to the creature behind the drawer.
*/

const CompiledCheck = __DEVDOCS_PLAYER__ ? undefined : lazyComponent(() => import("../../dev/formulas/CompiledCheck.js"), null);

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
  const pad = compact ? "px-1.5 py-0.5" : undefined;
  return <TableFrame className="w-full">
    <Table className="text-[11px]">
      <TableHeader><TableRow><TableHead className={pad}>Level</TableHead>{fields.map(field => <TableHead key={field} numeric className={pad}>
        <span className="inline-flex items-center gap-1">{beaten?.has(field) && <Dot label="Overridden on this creature" />}{combatLabel(field)}</span>
      </TableHead>)}</TableRow></TableHeader>
      <TableBody>{levels.map(level => {
        const combat = safeCombat(level, profile);
        const was = previous ? safeCombat(level, previous) : undefined;
        const current = level === highlight;
        const row = cn(pad, "group-last/tr:border-b-0", current && "font-semibold text-primary");
        return <TableRow key={level}><TableCell className={cn(row, !current && "text-muted-foreground")}>{level}</TableCell>{fields.map(field => {
          const overridden = current && beaten?.has(field);
          if (overridden) return <TableCell key={field} numeric className={row} title={`Curve ${cell(combat[field])} · this creature ${cell(ownValues?.[field])}`}><s className="font-normal text-faint">{cell(combat[field])}</s> {cell(ownValues?.[field])}</TableCell>;
          if (was && !sameValue(was[field], combat[field])) return <TableCell key={field} numeric className={row}><ConsequenceCell before={was[field]} after={combat[field]} label={combatLabel(field)} /></TableCell>;
          return <TableCell key={field} numeric className={row}>{cell(combat[field])}</TableCell>;
        })}</TableRow>;
      })}</TableBody>
    </Table>
  </TableFrame>;
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

  const openCreature = (id: string) => { onClose(); navigate("creatureDefinitions", id); };
  const dirtyAt = (key: string): boolean => draft.dirty && (committed as Record<string, unknown> | undefined)?.[key] !== (saved as Record<string, unknown> | undefined)?.[key];

  return <Drawer label={`${working?.name ?? profileId} role`} title={<>{working?.name ?? profileId} <span className="font-normal text-faint">role</span></>} onClose={onClose}>
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
                ? <TableFrame className="max-h-[46vh] w-full">
                  <Table>
                    <TableHeader><TableRow><TableHead numeric>Level</TableHead><TableHead>Creature</TableHead>{columns.map(field => <TableHead key={field} numeric>{combatLabel(field)}</TableHead>)}</TableRow></TableHeader>
                    <TableBody>{rows.map(({ entry, cells, pinned }) => <TableRow key={entry.id} data-unmoved={pinned || undefined} className="data-unmoved:text-muted-foreground" title={[entry.id, data.regionName(entry.regionId), pinned ? "overrides these stats itself, so this change does not reach it" : ""].filter(Boolean).join(" · ")}>
                      <TableCell numeric>{entry.level}</TableCell>
                      <TableCell><TableLink onClick={() => openCreature(entry.id)}><span>{entry.name}</span>{(repeated.get(entry.name) ?? 0) > 1 && <code className="text-[11px] text-faint">{entry.id}</code>}</TableLink></TableCell>
                      {cells.map(item => <TableCell key={item.field} numeric><ConsequenceCell before={item.before} after={item.after} own={item.own} label={combatLabel(item.field)} /></TableCell>)}
                    </TableRow>)}</TableBody>
                  </Table>
                </TableFrame>
                : <p className={EMPTY}>No creature uses this role yet.</p>}
              {CompiledCheck && <Suspense fallback={null}><CompiledCheck formulaId="creature.combat" profileId={profileId} parameters={working} tier={consumers[0]?.entry.level ?? 1} disabled={!draft.dirty} /></Suspense>}
            </Section>
          </Sheet>
        </>}
  </Drawer>;
}
