/**
 * Dungeon Mason "Dragon for Boss Monster PBR" bodies. Each ships the studio mesh, rig and takes at
 * one uniform `scale` on the rig node.
 *
 * Bodies without `skin` keep the texture-only skin of their current production file; their scale
 * keeps the previous body's Idle length and height (geometric mean printed by build.mjs `--fit`).
 * Bodies with `skin` wear one of the pack's own colour sets (Texture/<set>) and are sized for their
 * creature's level and role.
 */
export const DRAGON_BODIES = [
  {id: 'creature_baby_red_dragon', lineage: 'DragonTerrorBringer', scale: 0.233},
  {id: 'fairy_garden_drake_gloamgarden', lineage: 'DragonTerrorBringer', scale: 0.233},
  {id: 'fairy_garden_drake_faeholme', lineage: 'DragonTerrorBringer', scale: 0.233},
  {id: 'creature_red_wilderness_dragon', lineage: 'DragonTerrorBringer', scale: 0.624},
  {id: 'creature_baby_black_dragon', lineage: 'DragonUsurper', scale: 0.189},
  {id: 'creature_black_wilderness_dragon', lineage: 'DragonUsurper', scale: 0.463},
  {id: 'creature_amethyst_dragon', lineage: 'DragonUsurper', scale: 0.463},
  {id: 'creature_baby_lava_dragon', lineage: 'DragonTerrorBringer', scale: 0.233},
  {id: 'creature_purple_wilderness_dragon', lineage: 'DragonTerrorBringer', scale: 0.664},
  // Basalt Maw (L58-78): the wingless horned Nightmare in its ochre "Albino" set.
  {id: 'creature_basalt_maw', lineage: 'DragonNightmare', scale: 0.48, skin: {set: 'DragonNightmare/Albino', name: 'basalt_maw_nightmare_albino'},
    is: 'Basalt Maw: a wingless horned four-legged dragon with ochre plates, hooked claws and heavy hind legs.'},
];

/**
 * Per lineage: mesh file stem, animation folder, the native take (file stem) for each shipped
 * state, and how its Unity Standard material stores smoothness (`specular`: _SpecGlossMap alpha,
 * no metal; `metallic`: _MetallicGlossMap R metal and alpha smoothness) with its bump and emission.
 */
export const LINEAGES = {
  DragonTerrorBringer: {mesh: 'DragonTerrorBringerMesh', animations: 'DragonTerrorBringer',
    clips: {Idle: 'idle01', Walk: 'walk', Run: 'Run', Attack: 'Basic Attack', Hit: 'GetHit', Death: 'die', Breath: 'Flame Attack'}},
  DragonUsurper: {mesh: 'DragonUsurperMesh', animations: 'DragonUsurper',
    clips: {Idle: 'idle01', Walk: 'Walk', Run: 'Run', Attack: 'attackMouth', Hit: 'getHit', Death: 'Die', Breath: 'attackFlame'}},
  DragonNightmare: {mesh: 'DragonTheNightmareMesh', animations: 'DragonNightMare',
    clips: {Idle: 'idle01', Walk: 'walk', Run: 'run', Attack: 'Basic Attack', Hit: 'getHit', Death: 'die'},
    material: {workflow: 'metallic', normalScale: 1, emission: 0}},
};
