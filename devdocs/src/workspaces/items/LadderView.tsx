import { Fragment, useCallback, useMemo, useState, type ReactNode } from "react";
import type { EquipmentFamily, ProgressionTier } from "../../../../game/src/content/schema/progression.js";
import type { AppProps } from "../../model/contracts.js";
import { equipmentSource, fmt } from "../../model/derive.js";
import { noContext, summarize } from "../../model/summaries.js";
import { HoverCard } from "../../ui/RefChip.js";
import { LoadingRows, ErrorState } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import type { ViewProps } from "../types.js";
import { Drawer } from "../../ui/Drawer.js";
import { FamilyDrawer } from "./FamilyDrawer.js";
import { ItemPage } from "./ItemPage.js";
import { keyNumber, thresholdText, titleCase, useItemsData, type ItemsData, type SetRecord, type SetSlot } from "./data.js";
import { Button, EmptyCell, Segmented, Table, TableBody, TableCell, TableFrame, TableHead, TableHeader, TableLink, TableRow } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
import { PAGE, PAGE_ACTIONS, PAGE_HEADING } from "../../ui/layout.js";

/*
  The ladder: tiers down, roles across. A cell is the item that fills that role at that tier.
  Hover for its numbers, click to inspect it in a drawer, click a column header to open the curve
  behind the column and watch the column recompute as the curve changes.
*/

const GROUPS: readonly { key: string; label: string; roles: readonly string[]; setStyle?: string }[] = [
  { key: "melee", label: "Melee", roles: ["dagger", "sword", "shield", "helm", "body", "legs", "boots", "gloves"], setStyle: "melee" },
  { key: "magic", label: "Magic", roles: ["staff", "wand", "hood", "robe", "magicLegs", "magicBoots", "wraps"], setStyle: "magic" },
  { key: "tools", label: "Tools", roles: ["pickaxe", "hatchet", "rod"] },
  { key: "materials", label: "Materials", roles: ["ore", "flux", "gem", "bar", "log", "shaft", "handle", "hide", "thread", "rawFish", "cookedFish", "rawMeat", "cookedMeat"] },
];
const GROUP_KEY = "devdocs.ladder.group";
function loadGroup(): string { try { const stored = localStorage.getItem(GROUP_KEY); if (stored && GROUPS.some(group => group.key === stored)) return stored; } catch { /* fresh default */ } return GROUPS[0]!.key; }
const ROLE_LABELS: Readonly<Record<string, string>> = { magicLegs: "Legs", magicBoots: "Boots", rawFish: "Raw fish", cookedFish: "Cooked fish", rawMeat: "Raw meat", cookedMeat: "Cooked meat" };
const roleLabel = (role: string): string => ROLE_LABELS[role] ?? titleCase(role);
/** The family each gear role is expanded through. Higher tiers fill roles from `equipment` without a `materials` entry. */
const ROLE_FAMILY: Readonly<Record<string, string>> = {
  dagger: "gear_mainHand_melee_2400", sword: "gear_mainHand_melee_2400", shield: "gear_offHand_melee_0", helm: "gear_head_melee_0", body: "gear_body_melee_0", legs: "gear_legs_melee_0", boots: "gear_feet_melee_0", gloves: "gear_hands_melee_0",
  staff: "gear_mainHand_magic_staff_3000", wand: "gear_mainHand_magic_wand_2200", hood: "gear_head_magic_0", robe: "gear_body_magic_0", magicLegs: "gear_legs_magic_0", magicBoots: "gear_feet_magic_0", wraps: "gear_hands_magic_0",
  pickaxe: "gear_mining", hatchet: "gear_woodcutting", rod: "gear_fishing",
};
/** Armour roles map onto set slots, so a set whose pieces are the row's own items is named beside the row instead of repeated. */
const SLOT_FOR_ROLE: Readonly<Record<string, SetSlot>> = { helm: "head", hood: "head", body: "body", robe: "body", legs: "legs", magicLegs: "legs", boots: "feet", magicBoots: "feet", gloves: "hands", wraps: "hands" };
type Mode = "icons" | "numbers";
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
  const [mode, setMode] = useState<Mode>("icons");
  const [groupKey, setGroupKey] = useState(loadGroup);
  const group = GROUPS.find(candidate => candidate.key === groupKey) ?? GROUPS[0]!;
  const chooseGroup = (key: string) => { setGroupKey(key); try { localStorage.setItem(GROUP_KEY, key); } catch { /* optional */ } };
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
  if (data.loading) return <div className={PAGE}><LoadingRows /></div>;
  const openItem = (id: string) => navigate("items/ladder", id);
  const closeItem = () => navigate("items/ladder");

  const icons = mode === "icons";
  return <div className={cn(PAGE, "max-w-none")}>
    <div className={PAGE_HEADING}>
      <h1>Ladder</h1>
      <Segmented aria-label="Column group">
        {GROUPS.map(candidate => <Button variant="segment" size="xs" key={candidate.key} aria-pressed={candidate.key === group.key} onClick={() => chooseGroup(candidate.key)}>{candidate.label}</Button>)}
      </Segmented>
      <div className={PAGE_ACTIONS}>
        <Segmented aria-label="Cell content">
          <Button variant="segment" size="xs" aria-pressed={mode === "icons"} onClick={() => setMode("icons")}>Icons</Button>
          <Button variant="segment" size="xs" aria-pressed={mode === "numbers"} onClick={() => setMode("numbers")}>Numbers</Button>
        </Segmented>
      </div>
    </div>
    {/* The table hugs its content: icon cells stay icon-sized whatever the window width. */}
    <TableFrame className="max-h-[calc(100dvh-110px)]" data-mode={mode}>
      <Table className="w-auto min-w-0">
        <TableHeader>
          <TableRow>
            <TableHead pin className="w-16 min-w-16 px-2.5">Tier</TableHead>
            {group.roles.map(role => {
              const family = familyForRole.get(role);
              const live = liveFamily && family && liveFamily.id === family.id;
              return <TableHead key={role} className={cn("px-2.5", icons && "text-center", live && "text-primary")}>{family
                ? <button type="button" title={`${family.name} · open the curve`} aria-label={`${roleLabel(role)} family`} onClick={() => setFamilyId(family.id)}>{roleLabel(role)}</button>
                : <span>{roleLabel(role)}</span>}</TableHead>;
            })}
            {group.setStyle && <TableHead className="border-l border-border-subtle px-2.5">Set</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.tiers.map(tier => {
            const rowItems = new Map(group.roles.map(role => [role, cellItemId(tier, role)] as const));
            const sets = (setsByTier.get(tier.tier) ?? []).filter(set => set.style === group.setStyle);
            // A set built from the row's own pieces is named beside the row; any other set gets a row of its own pieces.
            const ownSet = (set: SetRecord) => Object.entries(set.members ?? {}).every(([slot, id]) => group.roles.some(role => SLOT_FOR_ROLE[role] === slot && rowItems.get(role) === id));
            const named = sets.filter(ownSet);
            const extra = sets.filter(set => !ownSet(set));
            const setText = (set: SetRecord) => <TableLink key={set.id} className="flex-col items-start gap-px py-0.5" onClick={() => navigate("equipmentSets", set.id)}>
              <span className="text-xs">{set.name}</span><small className="font-mono text-[11px] text-muted-foreground">{thresholdText(set.thresholds) || "no set bonuses"}</small>
            </TableLink>;
            /** `joined`: the next row continues this tier, so no rule between them. `alt`: a set's own row under the tier's first. */
            const rowCell = (joined: boolean, alt: boolean) => cn("px-2.5 py-1", joined && "border-b-0", alt && "pt-0");
            const cell = (role: string, itemId: string | undefined, slotless: boolean, joined: boolean, alt: boolean) => <TableCell key={role} className={cn(rowCell(joined, alt), icons && "text-center")}>{itemId
              ? <ItemCell id={itemId} data={data} mode={mode} active={itemId === recordId} liveFamily={liveFamily} onOpen={openItem} />
              : slotless ? null : <EmptyCell />}</TableCell>;
            const setCell = (joined: boolean, alt: boolean, children: ReactNode) => <TableCell className={cn(rowCell(joined, alt), "border-l border-border-subtle")}>{children}</TableCell>;
            return <Fragment key={tier.id}>
              <TableRow>
                <TableHead scope="row" pin rowSpan={1 + extra.length} className="z-10! px-2.5 group-hover/tr:bg-accent">
                  <span className="flex flex-col py-0.5 leading-tight"><strong className="text-[15px] text-foreground">{tier.tier}</strong><small className="text-[11px] font-normal text-faint">level {tier.reqLevel}</small></span>
                </TableHead>
                {group.roles.map(role => cell(role, rowItems.get(role), false, extra.length > 0, false))}
                {group.setStyle && setCell(extra.length > 0, false, named.length ? <div className="flex flex-col items-start gap-1">{named.map(setText)}</div> : <EmptyCell />)}
              </TableRow>
              {extra.map((set, index) => <TableRow key={set.id}>
                {group.roles.map(role => { const slot = SLOT_FOR_ROLE[role]; return cell(role, slot ? set.members?.[slot] : undefined, !slot, index < extra.length - 1, true); })}
                {setCell(index < extra.length - 1, true, setText(set))}
              </TableRow>)}
            </Fragment>;
          })}
        </TableBody>
      </Table>
    </TableFrame>
    {recordId && <Drawer title={data.item(recordId)?.name ?? recordId} onClose={closeItem} wide>
      <ItemPage id={recordId} navigate={navigate} data={data} variant="drawer" liveFamily={liveFamily} onOpenFamily={setFamilyId} />
    </Drawer>}
    {familyId && <FamilyDrawer familyId={familyId} data={data} onClose={() => setFamilyId(undefined)} onLive={onLive} onOpenItem={openItem} stacked={Boolean(recordId)} />}
  </div>;
}

function ItemCell({ id, data, mode, active, liveFamily, onOpen }: { id: string; data: ItemsData; mode: Mode; active: boolean; liveFamily?: EquipmentFamily; onOpen: (id: string) => void }) {
  const [hover, setHover] = useState<{ x: number; y: number }>();
  const record = data.item(id);
  const name = record?.name ?? id;
  const summary = useMemo(() => record ? summarize("items", record, noContext) : undefined, [record]);
  const number = mode === "numbers" ? keyNumber(id, data, liveFamily) : undefined;
  const saved = mode === "numbers" && liveFamily ? keyNumber(id, data) : undefined;
  const changed = number && saved && number.value !== saved.value;
  return <>
    <TableLink className="gap-2 p-0.5" onClick={() => onOpen(id)} aria-label={name} title={summary ? undefined : name}
      onMouseEnter={event => setHover({ x: event.clientX, y: event.clientY })} onMouseMove={event => hover && setHover({ x: event.clientX, y: event.clientY })} onMouseLeave={() => setHover(undefined)}>
      <Thumb spec={{ kind: "item", id }} size="s" alt="" className={cn("size-8", !record && "outline outline-destructive", active && "outline-2 outline-offset-1 outline-primary")} />
      {mode === "numbers" && <span className="inline-flex items-baseline gap-1 font-mono text-xs whitespace-nowrap">{number ? <><strong className={cn("font-semibold", changed && "text-primary")}>{fmt(number.value)}</strong><small className="text-[11px] text-faint">{number.label}</small></> : "—"}</span>}
    </TableLink>
    {hover && summary && <HoverCard summary={summary} collection="items" id={id} at={hover} />}
  </>;
}

export type LadderNavigate = AppProps["navigate"];
