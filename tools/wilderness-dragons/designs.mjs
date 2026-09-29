/**
 * Dungeon Mason "Dragon for Boss Monster PBR" bodies. Each ships the studio mesh, rig and takes at
 * one uniform `scale` on the rig node, chosen so the Idle length and height
 * stay close to the previous (sculpted) production body: the geometric mean of the length and
 * height ratios printed by build.mjs `--fit`.
 */
export const DRAGON_BODIES = [
  {id: 'creature_baby_red_dragon', lineage: 'DragonTerrorBringer', scale: 0.233},
  {id: 'fairy_garden_drake_gloamgarden', lineage: 'DragonTerrorBringer', scale: 0.233},
  {id: 'fairy_garden_drake_faeholme', lineage: 'DragonTerrorBringer', scale: 0.233},
  {id: 'creature_baby_lava_dragon', lineage: 'DragonTerrorBringer', scale: 0.233},
  {id: 'creature_red_wilderness_dragon', lineage: 'DragonTerrorBringer', scale: 0.624},
  {id: 'creature_purple_wilderness_dragon', lineage: 'DragonTerrorBringer', scale: 0.664},
  {id: 'creature_baby_black_dragon', lineage: 'DragonUsurper', scale: 0.189},
  {id: 'creature_black_wilderness_dragon', lineage: 'DragonUsurper', scale: 0.463},
  {id: 'creature_amethyst_dragon', lineage: 'DragonUsurper', scale: 0.463},
];

/** Native take (file stem under Animations/<lineage>/) for each shipped state. Breath is native too. */
export const SOURCE_CLIPS = {
  DragonTerrorBringer: {Idle: 'idle01', Walk: 'walk', Run: 'Run', Attack: 'Basic Attack', Hit: 'GetHit', Death: 'die', Breath: 'Flame Attack'},
  DragonUsurper: {Idle: 'idle01', Walk: 'Walk', Run: 'Run', Attack: 'attackMouth', Hit: 'getHit', Death: 'Die', Breath: 'attackFlame'},
};
