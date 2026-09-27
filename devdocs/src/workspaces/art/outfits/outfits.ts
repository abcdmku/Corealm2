import type { ProgressionTier } from "../../../../../game/src/content/schema/progression.js";
import { SET_SLOTS, type SetRecord, type SetSlot } from "../../items/data.js";

/*
  The outfit ladder: every armour set placed by tier and column (crafted melee, crafted magic, boss
  melee, boss magic), and the weapons the tier puts in the wearer's hands.
*/

export type HandSlot = "mainHand" | "offHand";
export type PieceKey = SetSlot | HandSlot;
export const HAND_SLOTS: readonly HandSlot[] = ["mainHand", "offHand"];

export interface OutfitColumn { key: string; label: string; style: string; boss: boolean }
export const COLUMNS: readonly OutfitColumn[] = [
  { key: "melee", label: "Melee", style: "melee", boss: false },
  { key: "magic", label: "Magic", style: "magic", boss: false },
  { key: "boss-melee", label: "Boss melee", style: "melee", boss: true },
  { key: "boss-magic", label: "Boss magic", style: "magic", boss: true },
];
export const columnOf = (set: SetRecord): OutfitColumn | undefined =>
  COLUMNS.find(column => column.style === set.style && column.boss === (set.acquisition === "boss"));

/** Sets ordered as the list shows them: tier, then column. */
export function orderSets(sets: readonly SetRecord[]): SetRecord[] {
  const rank = (set: SetRecord) => { const column = columnOf(set); return column ? COLUMNS.indexOf(column) : COLUMNS.length; };
  return [...sets].sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The same style's sets up the ladder, crafted before boss within a tier: what `[` and `]` walk. */
export function styleLadder(sets: readonly SetRecord[], style: string | undefined): SetRecord[] {
  return orderSets(sets.filter(set => set.style === style));
}

export const setPieces = (set: SetRecord): { slot: SetSlot; id: string }[] =>
  SET_SLOTS.flatMap(slot => set.members?.[slot] ? [{ slot, id: set.members[slot]! }] : []);

/** The piece that stands for a set in a one-icon row: its body, else its first piece. */
export const setIcon = (set: SetRecord): string | undefined => set.members?.body ?? setPieces(set)[0]?.id;

/**
 * The tier's own weapons for a style: sword and shield for melee, staff (and wand, off-screen) for
 * magic. The tier's first member of the family is its own; later ones are regional variants.
 */
export function tierHands(tier: ProgressionTier | undefined, style: string | undefined): Partial<Record<HandSlot, string>> {
  if (!tier) return {};
  const first = (familyId: string, suffix?: string) => tier.equipment.find(member => member.familyId === familyId && (!suffix || member.id.endsWith(suffix)))?.id;
  if (style === "melee") return { mainHand: first("gear_mainHand_melee_2400", "_sword"), offHand: first("gear_offHand_melee_0") };
  if (style === "magic") return { mainHand: first("gear_mainHand_magic_staff_3000") };
  return {};
}

/** Every weapon and tool the tier makes for a style, for the index's hands toggle. */
export function tierHandIcons(tier: ProgressionTier | undefined, style: string): string[] {
  if (!tier) return [];
  const families = style === "melee" ? ["gear_mainHand_melee_2400", "gear_offHand_melee_0"] : ["gear_mainHand_magic_staff_3000", "gear_mainHand_magic_wand_2200"];
  const own = families.flatMap(familyId => {
    const members = tier.equipment.filter(member => member.familyId === familyId);
    // The melee main-hand family holds the dagger and the sword; regional swords come after.
    return familyId === "gear_mainHand_melee_2400" ? members.filter(member => /_(dagger|sword)$/.test(member.id)).slice(0, 2) : members.slice(0, 1);
  });
  return own.map(member => member.id);
}

export const PIECE_LABEL: Readonly<Record<PieceKey, string>> = { head: "Head", body: "Body", legs: "Legs", hands: "Hands", feet: "Feet", mainHand: "Main hand", offHand: "Off hand" };
export const tintHex = (tint: number | undefined): string | undefined => tint === undefined ? undefined : `#${tint.toString(16).padStart(6, "0")}`;
