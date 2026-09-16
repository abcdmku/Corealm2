import { Suspense, useEffect, useMemo, useState } from "react";
import { lazyComponent } from "../lazyView.js";
import { EquipmentBonusesSchema } from "../../../../game/src/content/schema/items.js";
import { EquipmentFamilySchema, ProgressionTierSchema, type EquipmentFamily } from "../../../../game/src/content/schema/progression.js";
import { ConsequenceCell, ConsequenceNote, movesWith, rowMovement, tally } from "../../dev/formulas/consequences.js";
import { BONUS_KEYS, deriveEquipmentMember, type BonusKey, type Derivation } from "../../model/derive.js";
import { getPath, setPath, useRecordDraft } from "../../model/draft.js";
import type { Path } from "../../model/origin.js";
import { Facts, Field, Fields, NumberField, ReferencedBy, Section, Sheet } from "../../ui/field/index.js";
import { Thumb } from "../../ui/Thumb.js";
import { Drawer } from "./Drawer.js";
import { BONUS_SHORT, familyMembers, specAt, titleCase, type ItemsData } from "./data.js";

/*
  The curve behind a column of the ladder, and what moving it does. Each parameter pair reads as
  its formula, `base + tier x per level`; the table beneath is one row per member, recomputed from
  the draft (and live through an Alt+drag scrub) so every item's before and after is on screen
  before the save. A member with its own adjustment does not move: its cell keeps the member's
  number and wears the brass override dot (docs/devdocs-inputs.md 3.10).
*/

const CompiledCheck = __DEVDOCS_PLAYER__ ? undefined : lazyComponent(() => import("../../dev/formulas/CompiledCheck.js"));

const family = (...path: Path[number][]) => specAt(EquipmentFamilySchema, ["parameters", ...path]);
const VALUE = specAt(ProgressionTierSchema, ["equipment", 0, "adjustments", "value"]);
const GATHER = specAt(ProgressionTierSchema, ["equipment", 0, "adjustments", "gatherBonus"]);
const BONUS = Object.fromEntries(BONUS_KEYS.map(key => [key, specAt(EquipmentBonusesSchema, [key])])) as Record<BonusKey, ReturnType<typeof specAt>>;

/** One number on one member: the curve either side of the edit, and the member's own value when it overrides. */
const consequence = (before: Derivation, after: Derivation) =>
  ({ before: before.computed, after: after.computed, own: after.overridden ? after.value : undefined, ...movesWith(before.computed, after.computed, after.overridden) });

export function FamilyDrawer({ familyId, data, onClose, onOpenItem, onLive, stacked }: {
  familyId: string; data: Pick<ItemsData, "tiers" | "families" | "item">; onClose: () => void; onOpenItem?: (id: string) => void;
  /** Called with the draft family whenever it changes, so the page behind can recompute live. */
  onLive?: (family: EquipmentFamily | undefined) => void; stacked?: boolean;
}) {
  const draft = useRecordDraft<EquipmentFamily>("equipmentFamilies", familyId);
  const committed = draft.draft;
  const saved = draft.record;
  // Alt+drag reports every step through `onPreview` and commits once on release, so the table has
  // to follow the scrub rather than the draft. The commit clears it.
  const [scrub, setScrub] = useState<EquipmentFamily>();
  useEffect(() => setScrub(undefined), [committed]);
  const record = scrub ?? committed;
  const readOnly = __DEVDOCS_PLAYER__ || !draft.editable;
  useEffect(() => { onLive?.(scrub ?? (draft.dirty ? committed : undefined)); }, [committed, scrub, draft.dirty, onLive]);
  useEffect(() => () => onLive?.(undefined), [onLive]);

  const members = useMemo(() => familyMembers(data.tiers, familyId), [data.tiers, familyId]);
  const activeKeys = useMemo(() => {
    if (!record) return [] as BonusKey[];
    return BONUS_KEYS.filter(key => record.parameters.bonusesBase[key] !== 0 || record.parameters.bonusesPerLevel[key] !== 0 || (saved && (saved.parameters.bonusesBase[key] !== 0 || saved.parameters.bonusesPerLevel[key] !== 0)));
  }, [record, saved]);

  const rows = useMemo(() => !record ? [] : members.map(({ tier, member }) => {
    const after = deriveEquipmentMember(tier, member, record);
    const before = deriveEquipmentMember(tier, member, saved ?? record);
    const value = consequence(before.value, after.value);
    const gather = consequence(before.gatherBonus, after.gatherBonus);
    const bonuses = Object.fromEntries(BONUS_KEYS.map(key => [key, consequence(before.bonuses[key]!, after.bonuses[key]!)])) as Record<BonusKey, ReturnType<typeof consequence>>;
    const cells = record.category === "tool" ? [value, gather] : [value, ...activeKeys.map(key => bonuses[key])];
    return { tier, member, value, gather, bonuses, ...rowMovement(cells) };
  }), [members, record, saved, activeKeys]);
  const counts = useMemo(() => tally(rows), [rows]);

  const at = (path: Path) => getPath(record, path) as number | undefined;
  const dirtyAt = (...paths: Path[]) => draft.dirty && paths.some(path => getPath(committed, path) !== getPath(saved, path));
  const number = (label: string, path: Path, step: number | undefined, what: string) => {
    const spec = family(...path.slice(1));
    return <NumberField value={at(path)} min={spec.min ?? 0} step={step} readOnly={readOnly} ariaLabel={`${label} ${what}`}
      onPreview={next => { if (committed) setScrub(setPath(committed, path, next)); }}
      onChange={next => draft.setPath(path, next ?? 0)} />;
  };
  /** `base + tier x perLevel` on one line under one label. */
  const pair = (label: string, base: Path, perLevel: Path, step: number) => <Field compact label={label} key={label} dirty={dirtyAt(base, perLevel)}>
    {number(label, base, undefined, "base")}
    <span className="field-unit">+ tier ×</span>
    {number(label, perLevel, step, "per level")}
  </Field>;

  return <Drawer title={record ? record.name : "Family"} onClose={onClose} stacked={stacked}>
    {draft.loading && <p className="empty-inline">Loading…</p>}
    {draft.error && <p className="empty-inline">{draft.error}</p>}
    {record && <>
      <Sheet compact>
        <Section title="Curve" aside={<code>{record.id}</code>}>
          <Facts className="kv-facts" items={[
            record.category === "tool" ? `${titleCase(record.skill)} tool` : `${titleCase(record.slot ?? "mainHand")} · ${titleCase(record.skill)}`,
            record.attackSpeedMs !== undefined && <span className="mono">{record.attackSpeedMs} ms per attack</span>,
          ]} />
          <Fields columns={2}>
            {pair(VALUE.label, ["parameters", "valueBase"], ["parameters", "valuePerLevel"], 0.5)}
            {record.category === "tool" && <Field compact label={GATHER.label} dirty={dirtyAt(["parameters", "gatherBonusPerLevel"])}>
              <span className="field-unit">tier ×</span>
              {number(GATHER.label, ["parameters", "gatherBonusPerLevel"], 0.1, "per level")}
            </Field>}
            {BONUS_KEYS.map(key => pair(BONUS[key].label, ["parameters", "bonusesBase", key], ["parameters", "bonusesPerLevel", key], 0.05))}
          </Fields>
        </Section>
        <Section title="Members" aside={<ConsequenceNote tally={counts} noun="items" idle={<span>{members.length} across {new Set(members.map(entry => entry.tier.tier)).size} tiers</span>} />}>
          <div className="matrix consequences">
            <table>
              <thead><tr><th>Tier</th><th>Item</th><th className="cell-num">{VALUE.label}</th>{record.category === "tool" ? <th className="cell-num">{GATHER.label}</th> : activeKeys.map(key => <th key={key} className="cell-num" title={BONUS[key].label}>{BONUS_SHORT[key]}</th>)}</tr></thead>
              <tbody>{rows.map(({ tier, member, value, gather, bonuses, pinned }) => <tr key={member.id} data-unmoved={pinned || undefined} title={pinned ? `${member.name} keeps its own adjustment, so this change does not reach it` : undefined}>
                <td className="cell-num">{tier.tier}</td>
                <td><button type="button" className="cell" onClick={() => onOpenItem?.(member.id)}><Thumb spec={{ kind: "item", id: member.id }} size="s" /><span>{member.name}</span></button></td>
                <td className="cell-num"><ConsequenceCell {...value} label={VALUE.label} /></td>
                {record.category === "tool"
                  ? <td className="cell-num"><ConsequenceCell {...gather} digits={2} label={GATHER.label} /></td>
                  : activeKeys.map(key => <td key={key} className="cell-num"><ConsequenceCell {...bonuses[key]} label={BONUS[key].label} /></td>)}
              </tr>)}</tbody>
            </table>
          </div>
          {CompiledCheck && <Suspense fallback={null}><CompiledCheck formulaId="equipment.linear" profileId={familyId} parameters={record.parameters} tier={members[0]?.tier.tier ?? 1} disabled={!draft.dirty} /></Suspense>}
        </Section>
        <ReferencedBy collection="equipmentFamilies" id={familyId} />
      </Sheet>
    </>}
  </Drawer>;
}
