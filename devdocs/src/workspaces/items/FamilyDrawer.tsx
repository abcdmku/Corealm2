import { useEffect, useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { EquipmentBonusesSchema } from "../../../../game/src/content/schema/items.js";
import { EquipmentFamilySchema, ProgressionTierSchema, type EquipmentFamily } from "../../../../game/src/content/schema/progression.js";
import { BONUS_KEYS, deriveEquipmentMember, fmt, type BonusKey } from "../../model/derive.js";
import { getPath, useRecordDraft } from "../../model/draft.js";
import type { Path } from "../../model/origin.js";
import { Facts, Field, Fields, NumberField, ReferencedBy, Section, Sheet } from "../../ui/field/index.js";
import { Thumb } from "../../ui/Thumb.js";
import { Drawer } from "./Drawer.js";
import { BONUS_SHORT, familyMembers, specAt, titleCase, type ItemsData } from "./data.js";

/*
  The curve behind a column of the ladder. Each parameter pair reads as its formula, `base + tier ×
  per level`; the table beneath recomputes every tier member from the draft so the effect of a
  change is visible before it is saved.
*/

function Change({ before, after, digits = 0 }: { before: number; after: number; digits?: number }) {
  if (before === after) return <span className="mono">{fmt(after, digits)}</span>;
  return <span className="mono change"><s>{fmt(before, digits)}</s><ArrowRight size={10} /><strong>{fmt(after, digits)}</strong></span>;
}

const family = (...path: Path[number][]) => specAt(EquipmentFamilySchema, ["parameters", ...path]);
const VALUE = specAt(ProgressionTierSchema, ["equipment", 0, "adjustments", "value"]);
const GATHER = specAt(ProgressionTierSchema, ["equipment", 0, "adjustments", "gatherBonus"]);
const BONUS = Object.fromEntries(BONUS_KEYS.map(key => [key, specAt(EquipmentBonusesSchema, [key])])) as Record<BonusKey, ReturnType<typeof specAt>>;

export function FamilyDrawer({ familyId, data, onClose, onOpenItem, onLive, stacked }: {
  familyId: string; data: Pick<ItemsData, "tiers" | "families" | "item">; onClose: () => void; onOpenItem?: (id: string) => void;
  /** Called with the draft family whenever it changes, so the page behind can recompute live. */
  onLive?: (family: EquipmentFamily | undefined) => void; stacked?: boolean;
}) {
  const draft = useRecordDraft<EquipmentFamily>("equipmentFamilies", familyId);
  const record = draft.draft;
  const saved = draft.record;
  const readOnly = __DEVDOCS_PLAYER__ || !draft.editable;
  useEffect(() => { onLive?.(draft.dirty ? record : undefined); }, [record, draft.dirty, onLive]);
  useEffect(() => () => onLive?.(undefined), [onLive]);

  const members = useMemo(() => familyMembers(data.tiers, familyId), [data.tiers, familyId]);
  const activeKeys = useMemo(() => {
    if (!record) return [] as BonusKey[];
    return BONUS_KEYS.filter(key => record.parameters.bonusesBase[key] !== 0 || record.parameters.bonusesPerLevel[key] !== 0 || (saved && (saved.parameters.bonusesBase[key] !== 0 || saved.parameters.bonusesPerLevel[key] !== 0)));
  }, [record, saved]);

  const at = (path: Path) => getPath(record, path) as number | undefined;
  const number = (label: string, path: Path, step: number | undefined, what: string) => {
    const spec = family(...path.slice(1));
    return <NumberField value={at(path)} min={spec.min ?? 0} step={step} readOnly={readOnly} ariaLabel={`${label} ${what}`} onChange={next => draft.setPath(path, next ?? 0)} />;
  };
  /** `base + tier × perLevel` on one line under one label. */
  const pair = (label: string, base: Path, perLevel: Path, step: number) => <Field compact label={label} key={label}>
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
            {record.category === "tool" && <Field compact label={GATHER.label}>
              <span className="field-unit">tier ×</span>
              {number(GATHER.label, ["parameters", "gatherBonusPerLevel"], 0.1, "per level")}
            </Field>}
            {BONUS_KEYS.map(key => pair(BONUS[key].label, ["parameters", "bonusesBase", key], ["parameters", "bonusesPerLevel", key], 0.05))}
          </Fields>
        </Section>
        <Section title="Members" aside={<span>{members.length} across {new Set(members.map(entry => entry.tier.tier)).size} tiers</span>}>
          <div className="matrix members-table">
            <table>
              <thead><tr><th>Tier</th><th>Item</th><th className="cell-num">Value</th>{record.category === "tool" ? <th className="cell-num">Gather</th> : activeKeys.map(key => <th key={key} className="cell-num" title={BONUS[key].label}>{BONUS_SHORT[key]}</th>)}</tr></thead>
              <tbody>{members.map(({ tier, member }) => {
                const after = deriveEquipmentMember(tier, member, record);
                const before = saved ? deriveEquipmentMember(tier, member, saved) : after;
                return <tr key={member.id}>
                  <td className="cell-num">{tier.tier}</td>
                  <td><button type="button" className="cell" onClick={() => onOpenItem?.(member.id)}><Thumb spec={{ kind: "item", id: member.id }} size="s" /><span>{member.name}</span></button></td>
                  <td className="cell-num"><Change before={before.value.value} after={after.value.value} /></td>
                  {record.category === "tool"
                    ? <td className="cell-num"><Change before={before.gatherBonus.value} after={after.gatherBonus.value} digits={2} /></td>
                    : activeKeys.map(key => <td key={key} className="cell-num"><Change before={before.bonuses[key].value} after={after.bonuses[key].value} /></td>)}
                </tr>;
              })}</tbody>
            </table>
          </div>
        </Section>
        <ReferencedBy collection="equipmentFamilies" id={familyId} />
      </Sheet>
    </>}
  </Drawer>;
}
