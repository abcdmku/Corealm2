import { useEffect } from "react";
import { X } from "lucide-react";
import { calculateCreatureCombat } from "../../../../game/src/content/formulas/creature.js";
import { COMBAT_LABELS, fmt } from "../../model/derive.js";
import { useRecordDraft } from "../../model/draft.js";
import { RefChip } from "../../ui/RefChip.js";
import { NumberInput, Row, Section, Sheet, Static } from "../../ui/Sheet.js";
import { LoadingRows } from "../../ui/States.js";
import type { ViewProps } from "../types.js";
import { type CreatureData, type Profile } from "./shared.js";

/*
  The role curve beside the creature: its ten parameters as inputs, the numbers they produce at a
  few levels, and who uses it. Edits recompute the open creature live through `onLive` before
  they are saved.
*/

const PARAMS: readonly { key: keyof Profile & string; label: string; unit?: string; step?: number; integer?: boolean }[] = [
  { key: "healthBase", label: "Health base", step: 1 },
  { key: "healthPerLevel", label: "Health per level", step: 0.1 },
  { key: "attackMultiplier", label: "Attack ×", step: 0.05 },
  { key: "defenceMultiplier", label: "Defence ×", step: 0.05 },
  { key: "accuracyPerLevel", label: "Accuracy per level", step: 0.1 },
  { key: "armourPerLevel", label: "Armour per level", step: 0.5 },
  { key: "magicArmourPerLevel", label: "Magic armour per level", step: 0.5 },
  { key: "hitPerLevel", label: "Max hit per level", step: 0.05 },
  { key: "attackSpeedMs", label: "Attack speed", unit: "ms", step: 100, integer: true },
  { key: "marksPerLevel", label: "Marks per level", step: 0.5 },
];
const TABLE_LEVELS = [1, 5, 10, 20, 30, 50, 70] as const;
const TABLE_FIELDS = ["maxHealth", "attackLevel", "defenceLevel", "accuracy", "armour", "magicArmour", "maxHit", "marks"] as const;

type CombatField = (typeof TABLE_FIELDS)[number];

function cell(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) ? fmt(value) : "—";
  if (Array.isArray(value)) return value.map(cell).join("–");
  return value === undefined ? "—" : String(value);
}

function safeCombat(level: number, profile: Profile): Record<string, unknown> {
  try { return calculateCreatureCombat(level, profile) as unknown as Record<string, unknown>; } catch { return {}; }
}

/** Level × stat table for one role. */
export function CurveTable({ profile, levels, fields, highlight, compact = false }: { profile: Profile; levels: readonly number[]; fields: readonly CombatField[]; highlight?: number; compact?: boolean }) {
  return <div className="curve-table" data-compact={compact || undefined}>
    <table>
      <thead><tr><th>Level</th>{fields.map(field => <th key={field}>{COMBAT_LABELS[field]}</th>)}</tr></thead>
      <tbody>{levels.map(level => {
        const combat = safeCombat(level, profile);
        return <tr key={level} className={level === highlight ? "is-current" : undefined}><td>{level}</td>{fields.map(field => <td key={field}>{cell(combat[field])}</td>)}</tr>;
      })}</tbody>
    </table>
  </div>;
}

export function RoleDrawer({ profileId, data, navigate, onClose, onLive }: { profileId: string; data: CreatureData; navigate: ViewProps["navigate"]; onClose: () => void; onLive?: (profile: Profile | undefined) => void }) {
  const draft = useRecordDraft<Profile>("creatureProfiles", profileId);
  const working = draft.draft ?? draft.record;
  const editable = draft.editable;
  const users = data.resolved.filter(entry => entry.row.profileId === profileId);
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
        {working && <>
          <Sheet compact>
            <Section title="Curve">
              {PARAMS.map(param => <Row key={param.key} label={param.label}>
                {editable
                  ? <NumberInput value={working[param.key] as number | undefined} onChange={value => draft.setPath([param.key], value)} unit={param.unit} step={param.step} integer={param.integer} min={0} ariaLabel={param.label} />
                  : <Static mono>{cell(working[param.key])}{param.unit ? ` ${param.unit}` : ""}</Static>}
              </Row>)}
              <Row label="Behaviour"><Static muted>{working.role === "grazer" ? "passive, aggro 5 m" : "aggressive, aggro 10 m"} · {working.role === "caster" ? "magic, range 9 m" : "melee, range 2 m"}</Static></Row>
            </Section>
            <Section title="By level">
              <CurveTable profile={working} levels={TABLE_LEVELS} fields={TABLE_FIELDS} />
            </Section>
            <Section title={`Used by ${users.length} ${users.length === 1 ? "creature" : "creatures"}`}>
              {users.length
                ? <div className="ref-list">{users.slice(0, 12).map(user => <RefChip key={user.id} collection="creatureDefinitions" id={user.id} record={user.row} ctx={data.ctx} onOpen={(_collection, target) => { onClose(); navigate("creatureDefinitions", target); }} detail={`L${user.level}`} />)}{users.length > 12 && <span className="empty-inline">and {users.length - 12} more</span>}</div>
                : <p className="empty-inline">No creature uses this role.</p>}
            </Section>
          </Sheet>
        </>}
      </div>
    </div>
  </>;
}
