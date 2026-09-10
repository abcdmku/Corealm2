import type { ElementalSpellId } from "./elementalSpells.js";
import { elementalGameplayTime } from "./elementalTiming.js";

/** Authored finale beats. elementalTiming maps these to the shared live combat clock. */
export const FINALE = {
  skybreaker: { contact:2400, fronts:[3000,3650,4300], release:4650, windEnd:5400, end:7200 },
  deluge: { contact:2400, rowGap:450, end:6700 },
  mountainfall: { contact:1900, outcrops:2350, gap:135, collapse:4300, end:6800 },
  starfall: { contact:3000, end:6200 },
} as const;

export function elementalDuration(id:ElementalSpellId,lastImpact:number):number {
  return id in FINALE ? elementalGameplayTime(id,FINALE[id as keyof typeof FINALE].end) : lastImpact+1100;
}
export function elementalChoreographyDuration(id:ElementalSpellId,lastImpact:number):number {
  return id in FINALE ? FINALE[id as keyof typeof FINALE].end : lastImpact+1100;
}
