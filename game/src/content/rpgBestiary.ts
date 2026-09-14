import { rpgCreatureRows } from './creatureData.js';
import type { CreatureSpeciesDef } from "./creatureSpecies.js";
import { enemyCombatLevel } from "./index.js";

export type RpgBodyFamily = "goblin" | "orc" | "skeleton" | "zombie" | "wraith" | "golem" | "harpy" | "gargoyle" | "gnoll" | "lizardman" | "minotaur" | "demon" | "spider" | "wasp" | "forest_creature" | "elemental" | "roach" | "troll" | "rat";
export interface RpgBestiaryEntry extends CreatureSpeciesDef {
  readonly bodyFamily: RpgBodyFamily;
  readonly rigFamily: string;
  readonly movement: "biped" | "hover" | "arthropod" | "flying" | "quadruped";
  readonly habitat: string;
  readonly respawnMs: number;
  readonly nativeSize: readonly [number, number, number];
  readonly nativeBase: readonly [number, number, number];
  readonly nativeVisualRadius: number;
  readonly nativeBodyRadius: number;
  /** Intentional animation actions. Projectile/special mechanics need the shared combat owner. */
  readonly attack: { readonly action: string; readonly proposedMechanic: "melee" | "projectile" | "spell"; readonly recoveryMs: number };
  readonly source: { readonly author: string; readonly license: string; readonly generator: string };
  readonly acceptance: "candidate";
}


export const RPG_BESTIARY: readonly RpgBestiaryEntry[] = rpgCreatureRows('world');
export const RPG_BESTIARY_BY_ID: ReadonlyMap<string, RpgBestiaryEntry> = new Map(RPG_BESTIARY.map(row => [row.id, row]));
/** Explicit lab-only candidates. */
export const RPG_BESTIARY_STAGED: readonly RpgBestiaryEntry[] = rpgCreatureRows('lab');
export const RPG_BESTIARY_STAGED_BY_ID: ReadonlyMap<string,RpgBestiaryEntry> = new Map(RPG_BESTIARY_STAGED.map(row=>[row.id,row]));
/** Historical explicit candidate aliases remain available after accepted content activation. */
export const RPG_BESTIARY_REVIEW_BY_ID: ReadonlyMap<string,RpgBestiaryEntry> = new Map([...RPG_BESTIARY, ...RPG_BESTIARY_STAGED].map(row=>[row.id,row]));
/** Call on demand so content registration never reads partially initialized shared tables. */
export function rpgBestiaryLevel(id: string): number | undefined {
  const row = RPG_BESTIARY_BY_ID.get(id);
  return row ? enemyCombatLevel(row.stats) : undefined;
}
