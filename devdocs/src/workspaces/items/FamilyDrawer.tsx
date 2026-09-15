import { useEffect, useMemo } from "react";
import { ArrowRight } from "lucide-react";
import type { EquipmentFamily } from "../../../../game/src/content/schema/progression.js";
import { BONUS_KEYS, BONUS_LABELS, deriveEquipmentMember, fmt, type BonusKey } from "../../model/derive.js";
import { useRecordDraft } from "../../model/draft.js";
import { NumberInput, Row, Section, Sheet, Static } from "../../ui/Sheet.js";
import { Thumb } from "../../ui/Thumb.js";
import { Drawer } from "./Drawer.js";
import { BONUS_SHORT, familyMembers, type ItemsData } from "./data.js";

/*
  The curve behind a column of the ladder. Parameters are inputs; the table beneath recomputes every
  tier member from the draft so the effect of a change is visible before it is saved.
*/

function Change({ before, after, digits = 0 }: { before: number; after: number; digits?: number }) {
  if (before === after) return <span className="mono">{fmt(after, digits)}</span>;
  return <span className="mono change"><s>{fmt(before, digits)}</s><ArrowRight size={10} /><strong>{fmt(after, digits)}</strong></span>;
}

export function FamilyDrawer({ familyId, data, onClose, onOpenItem, onLive, stacked }: {
  familyId: string; data: Pick<ItemsData, "tiers" | "families" | "item">; onClose: () => void; onOpenItem?: (id: string) => void;
  /** Called with the draft family whenever it changes, so the page behind can recompute live. */
  onLive?: (family: EquipmentFamily | undefined) => void; stacked?: boolean;
}) {
  const draft = useRecordDraft<EquipmentFamily>("equipmentFamilies", familyId);
  const family = draft.draft;
  const saved = draft.record;
  const readOnly = __DEVDOCS_PLAYER__ || !draft.editable;
  useEffect(() => { onLive?.(draft.dirty ? family : undefined); }, [family, draft.dirty, onLive]);
  useEffect(() => () => onLive?.(undefined), [onLive]);

  const members = useMemo(() => familyMembers(data.tiers, familyId), [data.tiers, familyId]);
  const activeKeys = useMemo(() => {
    if (!family) return [] as BonusKey[];
    return BONUS_KEYS.filter(key => family.parameters.bonusesBase[key] !== 0 || family.parameters.bonusesPerLevel[key] !== 0 || (saved && (saved.parameters.bonusesBase[key] !== 0 || saved.parameters.bonusesPerLevel[key] !== 0)));
  }, [family, saved]);

  const param = (path: readonly (string | number)[], integer = false, step?: number) => {
    const value = path.reduce<unknown>((cursor, key) => (cursor as Record<string, unknown> | undefined)?.[key as string], family) as number | undefined;
    return <NumberInput value={value} integer={integer} step={step} min={0} disabled={readOnly} ariaLabel={path.join(".")} onChange={next => draft.setPath(path, next ?? 0)} />;
  };

  return <Drawer title={family ? family.name : "Family"} onClose={onClose} stacked={stacked}>
    {draft.loading && <p className="empty-inline">Loading…</p>}
    {draft.error && <p className="empty-inline">{draft.error}</p>}
    {family && <>
      <Sheet compact>
        <Section title="Curve" aside={<code>{family.id}</code>}>
          <Row label="Slot"><Static>{family.category === "tool" ? `${family.skill} tool` : `${family.slot ?? "mainHand"} · ${family.skill}`}</Static></Row>
          <Row label="Value"><span className="param-pair">{param(["parameters", "valueBase"])}<span className="muted">+ tier ×</span>{param(["parameters", "valuePerLevel"], false, 0.5)}</span></Row>
          {BONUS_KEYS.map(key => <Row key={key} label={BONUS_LABELS[key]}><span className="param-pair">{param(["parameters", "bonusesBase", key])}<span className="muted">+ tier ×</span>{param(["parameters", "bonusesPerLevel", key], false, 0.05)}</span></Row>)}
          {family.category === "tool" && <Row label="Gather bonus"><span className="param-pair"><span className="muted">tier ×</span>{param(["parameters", "gatherBonusPerLevel"], false, 0.1)}</span></Row>}
          {family.attackSpeedMs !== undefined && <Row label="Attack speed"><Static mono>{family.attackSpeedMs} ms</Static></Row>}
        </Section>
        <Section title="Members" aside={<span>{members.length} across {new Set(members.map(entry => entry.tier.tier)).size} tiers</span>}>
          <div className="matrix members-table">
            <table>
              <thead><tr><th>Tier</th><th>Item</th><th className="cell-num">Value</th>{family.category === "tool" ? <th className="cell-num">Gather</th> : activeKeys.map(key => <th key={key} className="cell-num" title={BONUS_LABELS[key]}>{BONUS_SHORT[key]}</th>)}</tr></thead>
              <tbody>{members.map(({ tier, member }) => {
                const after = deriveEquipmentMember(tier, member, family);
                const before = saved ? deriveEquipmentMember(tier, member, saved) : after;
                return <tr key={member.id}>
                  <td className="cell-num">{tier.tier}</td>
                  <td><button type="button" className="cell" onClick={() => onOpenItem?.(member.id)}><Thumb spec={{ kind: "item", id: member.id }} size="s" /><span>{member.name}</span></button></td>
                  <td className="cell-num"><Change before={before.value.value} after={after.value.value} /></td>
                  {family.category === "tool"
                    ? <td className="cell-num"><Change before={before.gatherBonus.value} after={after.gatherBonus.value} digits={2} /></td>
                    : activeKeys.map(key => <td key={key} className="cell-num"><Change before={before.bonuses[key].value} after={after.bonuses[key].value} /></td>)}
                </tr>;
              })}</tbody>
            </table>
          </div>
        </Section>
      </Sheet>
    </>}
  </Drawer>;
}
