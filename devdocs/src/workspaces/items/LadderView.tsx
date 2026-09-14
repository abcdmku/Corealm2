import { useCallback, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { EquipmentFamily, ProgressionTier } from "../../../../game/src/content/schema/progression.js";
import type { AppProps } from "../../model/contracts.js";
import { equipmentSource, fmt } from "../../model/derive.js";
import { noContext, summarize } from "../../model/summaries.js";
import { HoverCard } from "../../ui/RefChip.js";
import { LoadingRows, ErrorState } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import type { ViewProps } from "../types.js";
import { Drawer } from "./Drawer.js";
import { FamilyDrawer } from "./FamilyDrawer.js";
import { ItemPage } from "./ItemPage.js";
import { SET_SLOTS, keyNumber, thresholdText, titleCase, useItemsData, type ItemsData, type SetRecord } from "./data.js";
import "./items.css";

/*
  The ladder: tiers down, roles across. A cell is the item that fills that role at that tier.
  Hover for its numbers, click to inspect it in a drawer, click a column header to open the curve
  behind the column and watch the column recompute as the curve changes.
*/

const GROUPS: readonly { label: string; roles: readonly string[] }[] = [
  { label: "Melee", roles: ["dagger", "sword", "shield", "helm", "body", "legs", "boots", "gloves"] },
  { label: "Magic", roles: ["staff", "wand", "hood", "robe", "magicLegs", "magicBoots", "wraps"] },
  { label: "Tools", roles: ["pickaxe", "hatchet", "rod"] },
  { label: "Materials", roles: ["ore", "flux", "gem", "bar", "log", "shaft", "handle", "hide", "thread", "rawFish", "cookedFish", "rawMeat", "cookedMeat"] },
];
const ROLE_LABELS: Readonly<Record<string, string>> = { magicLegs: "Legs", magicBoots: "Boots", rawFish: "Raw fish", cookedFish: "Cooked fish", rawMeat: "Raw meat", cookedMeat: "Cooked meat" };
const roleLabel = (role: string): string => ROLE_LABELS[role] ?? titleCase(role);
const COLUMN_COUNT = GROUPS.reduce((sum, group) => sum + group.roles.length, 0);
/** The family each gear role is expanded through. Higher tiers fill roles from `equipment` without a `materials` entry. */
const ROLE_FAMILY: Readonly<Record<string, string>> = {
  dagger: "gear_mainHand_melee_2400", sword: "gear_mainHand_melee_2400", shield: "gear_offHand_melee_0", helm: "gear_head_melee_0", body: "gear_body_melee_0", legs: "gear_legs_melee_0", boots: "gear_feet_melee_0", gloves: "gear_hands_melee_0",
  staff: "gear_mainHand_magic_staff_3000", wand: "gear_mainHand_magic_wand_2200", hood: "gear_head_magic_0", robe: "gear_body_magic_0", magicLegs: "gear_legs_magic_0", magicBoots: "gear_feet_magic_0", wraps: "gear_hands_magic_0",
  pickaxe: "gear_mining", hatchet: "gear_woodcutting", rod: "gear_fishing",
};
/** The item filling a role at a tier: the material slot when named, otherwise the tier member of the role's family. */
function cellItemId(tier: ProgressionTier, role: string): string | undefined {
  const named = tier.materials[role];
  if (named) return named;
  const familyId = ROLE_FAMILY[role];
  if (!familyId) return undefined;
  const shared = role === "dagger" || role === "sword";
  return tier.equipment.find(member => member.familyId === familyId && (!shared || member.id.endsWith(`_${role}`)))?.id;
}

export default function LadderView({ recordId, navigate }: ViewProps) {
  const data = useItemsData();
  const [mode, setMode] = useState<"names" | "numbers">("names");
  const [familyId, setFamilyId] = useState<string>();
  const [liveFamily, setLiveFamily] = useState<EquipmentFamily>();
  const onLive = useCallback((family: EquipmentFamily | undefined) => setLiveFamily(family), []);

  /** The family behind a role column, found through any tier that fills it. */
  const familyForRole = useMemo(() => {
    const out = new Map<string, EquipmentFamily>();
    for (const group of GROUPS) for (const role of group.roles) {
      const known = ROLE_FAMILY[role] ? data.families.find(family => family.id === ROLE_FAMILY[role]) : undefined;
      if (known) { out.set(role, known); continue; }
      for (const tier of data.tiers) {
        const itemId = cellItemId(tier, role);
        const source = itemId ? equipmentSource(itemId, data.tiers, data.families) : undefined;
        if (source) { out.set(role, source.family); break; }
      }
    }
    return out;
  }, [data.tiers, data.families]);
  const setsByTier = useMemo(() => {
    const out = new Map<number, SetRecord[]>();
    for (const set of data.sets) { const list = out.get(set.tier ?? 0) ?? []; list.push(set); out.set(set.tier ?? 0, list); }
    for (const list of out.values()) list.sort((a, b) => (a.style ?? "").localeCompare(b.style ?? "") || a.name.localeCompare(b.name));
    return out;
  }, [data.sets]);

  if (data.error) return <ErrorState message={data.error} />;
  if (data.loading) return <div className="ws-page"><LoadingRows /></div>;
  const openItem = (id: string) => navigate("items/ladder", id);
  const closeItem = () => navigate("items/ladder");

  return <div className="ws-page ladder-page">
    <div className="ws-heading">
      <h1>Ladder</h1>
      <span className="facts"><span>{data.tiers.length} tiers</span><span>{COLUMN_COUNT} roles</span></span>
      <div className="ws-heading-actions">
        <div className="segmented" role="group" aria-label="Cell content">
          <button type="button" className={mode === "names" ? "is-active" : ""} aria-pressed={mode === "names"} onClick={() => setMode("names")}>Names</button>
          <button type="button" className={mode === "numbers" ? "is-active" : ""} aria-pressed={mode === "numbers"} onClick={() => setMode("numbers")}>Numbers</button>
        </div>
      </div>
    </div>
    <div className="matrix ladder" data-mode={mode}>
      <table>
        <thead>
          <tr className="ladder-groups"><th rowSpan={2}>Tier</th>{GROUPS.map(group => <th key={group.label} colSpan={group.roles.length} className="ladder-group">{group.label}</th>)}</tr>
          <tr className="ladder-roles">{GROUPS.flatMap(group => group.roles.map(role => {
            const family = familyForRole.get(role);
            const live = liveFamily && family && liveFamily.id === family.id;
            return <th key={role} className={live ? "is-live" : ""}>{family
              ? <button type="button" title={`${family.name} · open the curve`} aria-label={`${roleLabel(role)} family`} onClick={() => setFamilyId(family.id)}>{roleLabel(role)}</button>
              : <span>{roleLabel(role)}</span>}</th>;
          }))}</tr>
        </thead>
        <tbody>
          {data.tiers.map(tier => {
            const sets = setsByTier.get(tier.tier) ?? [];
            return [
              <tr key={tier.id} className="ladder-tier">
                <th scope="row"><span className="ladder-tier-head"><strong>{tier.tier}</strong><span>{tier.name}</span><small>level {tier.reqLevel}</small></span></th>
                {GROUPS.flatMap(group => group.roles.map(role => {
                  const itemId = cellItemId(tier, role);
                  return <td key={role}>{itemId ? <ItemCell id={itemId} data={data} mode={mode} active={itemId === recordId} liveFamily={liveFamily} onOpen={openItem} /> : <span className="cell-empty">—</span>}</td>;
                }))}
              </tr>,
              ...sets.map(set => <tr key={set.id} className="ladder-set">
                <th scope="row"><button type="button" className="cell ladder-set-name" onClick={() => navigate("equipmentSets", set.id)}><span>{set.name}</span><small>{set.style}</small></button></th>
                <td colSpan={COLUMN_COUNT}>
                  <button type="button" className="cell ladder-set-row" onClick={() => navigate("equipmentSets", set.id)}>
                    <span className="ladder-set-pieces">{SET_SLOTS.map(slot => set.members?.[slot] ? <Thumb key={slot} spec={{ kind: "item", id: set.members[slot]! }} size="s" alt={slot} /> : <span key={slot} className="thumb ladder-slot-empty" data-size="s" title={`No ${slot}`} />)}</span>
                    <span className="ladder-set-thresholds mono">{thresholdText(set.thresholds) || "no set bonuses"}</span>
                    <ArrowRight size={11} className="muted" />
                  </button>
                </td>
              </tr>),
            ];
          })}
        </tbody>
      </table>
    </div>
    {recordId && <Drawer title={data.item(recordId)?.name ?? recordId} onClose={closeItem} wide>
      <ItemPage id={recordId} navigate={navigate} data={data} variant="drawer" liveFamily={liveFamily} onOpenFamily={setFamilyId} />
    </Drawer>}
    {familyId && <FamilyDrawer familyId={familyId} data={data} onClose={() => setFamilyId(undefined)} onLive={onLive} onOpenItem={openItem} stacked={Boolean(recordId)} />}
  </div>;
}

function ItemCell({ id, data, mode, active, liveFamily, onOpen }: { id: string; data: ItemsData; mode: "names" | "numbers"; active: boolean; liveFamily?: EquipmentFamily; onOpen: (id: string) => void }) {
  const [hover, setHover] = useState<{ x: number; y: number }>();
  const record = data.item(id);
  const summary = useMemo(() => record ? summarize("items", record, noContext) : undefined, [record]);
  const number = mode === "numbers" ? keyNumber(id, data, liveFamily) : undefined;
  const saved = mode === "numbers" && liveFamily ? keyNumber(id, data) : undefined;
  const changed = number && saved && number.value !== saved.value;
  return <>
    <button type="button" className={`cell${active ? " is-active" : ""}${record ? "" : " is-missing"}`} onClick={() => onOpen(id)}
      onMouseEnter={event => setHover({ x: event.clientX, y: event.clientY })} onMouseMove={event => hover && setHover({ x: event.clientX, y: event.clientY })} onMouseLeave={() => setHover(undefined)}>
      <Thumb spec={{ kind: "item", id }} size="s" alt="" />
      {mode === "names"
        ? <span className="cell-name">{record?.name ?? id}</span>
        : <span className={`cell-number mono${changed ? " is-changed" : ""}`}>{number ? <><strong>{fmt(number.value)}</strong><small>{number.label}</small></> : "—"}</span>}
    </button>
    {hover && summary && <HoverCard summary={summary} collection="items" id={id} at={hover} />}
  </>;
}

export type LadderNavigate = AppProps["navigate"];
