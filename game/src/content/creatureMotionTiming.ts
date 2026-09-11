/** Authored attack contact poses from the base motion rebuild and exported creature expansion metadata. */
export const CREATURE_MOTION_TIMING: Record<string, { seconds: number; contactNormalized: number }> = {
  "animal_aurochs": { seconds: 1.8, contactNormalized: 0.575 },
  "animal_bear": { seconds: 2.466667, contactNormalized: 0.15 },
  "animal_boar": { seconds: 0.7, contactNormalized: 0.7 },
  "animal_cattle": { seconds: 1.8, contactNormalized: 0.575 },
  "animal_chicken": { seconds: 0.7, contactNormalized: 0.43 },
  "animal_chicken_speckled": { seconds: 0.7, contactNormalized: 0.43 },
  "animal_coyote": { seconds: 1.4, contactNormalized: 0.525 },
  "animal_crab": { seconds: 0.88, contactNormalized: 0.43 },
  "animal_deer": { seconds: 1.08, contactNormalized: 0.43 },
  "animal_frog": { seconds: 0.68, contactNormalized: 0.43 },
  "animal_frog_green": { seconds: 0.68, contactNormalized: 0.43 },
  "animal_goat": { seconds: 1.466667, contactNormalized: 0.55 },
  "animal_hog": { seconds: 0.86, contactNormalized: 0.43 },
  "animal_ibex": { seconds: 1.533333, contactNormalized: 0.55 },
  "animal_rabbit": { seconds: 0.66, contactNormalized: 0.43 },
  "animal_rabbit_dark": { seconds: 0.66, contactNormalized: 0.43 },
  "animal_rat": { seconds: 0.58, contactNormalized: 0.43 },
  "animal_scorpion": { seconds: 0.8, contactNormalized: 0.45 },
  "animal_viper": { seconds: 1.666667, contactNormalized: 0.525 },
  // Remeasured off the repaired Attack, where the horn actually crosses the target: 0.7 was a
  // third of a second after the strike had already swept past and started back down. Measured
  // offline by `tools/creature-motion/rhino-contact.ts` and confirmed in the production combat
  // lab, where the observed damage lands at normalized 0.392 once the simulation tick quantizes
  // it (test-results/rhino-{air,earth,water}-attack).
  "boss_rhino_air": { seconds: 1.233333, contactNormalized: 0.33229264631653577 },
  "boss_rhino_earth": { seconds: 1.233333, contactNormalized: 0.33229264631653577 },
  "boss_rhino_water": { seconds: 1.233333, contactNormalized: 0.33229264631653577 },
  "creature_redbrush_fox": { seconds: 0.88, contactNormalized: 0.49 },
  "creature_duskoak_lynx": { seconds: 1.02, contactNormalized: 0.43 },
  "creature_rootdelve_badger": { seconds: 1.1, contactNormalized: 0.46 },
  "creature_quillback_porcupine": { seconds: 1.16, contactNormalized: 0.54 },
  "creature_marchwild_horse": { seconds: 1.18, contactNormalized: 0.46 },
  "creature_cairn_bighorn": { seconds: 1.05, contactNormalized: 0.46 },
  "creature_marsh_moose": { seconds: 1.23, contactNormalized: 0.47 },
  "creature_bracken_tapir": { seconds: 0.9, contactNormalized: 0.48 },
  "creature_reedjaw_crocodile": { seconds: 0.833333, contactNormalized: 0.458333 },
  "creature_kiln_salamander": { seconds: 1.08, contactNormalized: 0.43 },
  "creature_slateback_tortoise": { seconds: 1.45, contactNormalized: 0.49 },
  "creature_ashscale_monitor": { seconds: 1.1, contactNormalized: 0.48 },
  "creature_reedbank_goose": { seconds: 1.14, contactNormalized: 0.46 },
  "creature_blackwater_heron": { seconds: 1.05, contactNormalized: 0.455 },
  "creature_scree_bustard": { seconds: 0.8, contactNormalized: 0.455 },
  "creature_marchfield_turkey": { seconds: 0.78, contactNormalized: 0.455 },
  "creature_quarry_snail": { seconds: 1.5, contactNormalized: 0.48 },
  "creature_antler_beetle": { seconds: 1.1, contactNormalized: 0.5 },
  "creature_slag_centipede": { seconds: 0.94, contactNormalized: 0.5 },
  "creature_hollowroot_spider": { seconds: 1.04, contactNormalized: 0.5 },
  "creature_cinder_ravager": { seconds: 2.333333, contactNormalized: 0.235 },
  "creature_basalt_drake": { seconds: 1.6, contactNormalized: 0.65 },
  "creature_gorge_mantis": { seconds: 1, contactNormalized: 0.316667 },
  "creature_quarry_nightmare": { seconds: 1.2, contactNormalized: 0.72 },
};

/**
 * The fastest a creature may be asked to CHASE, in metres per second, before its own run cycle
 * has to play faster than the ceiling.
 *
 * Solved from the clip the chase actually plays, which is the run:
 *
 *     3 Hz * impliedRunMps * runClipSeconds
 *
 * The distinction matters. `EnemyDef.moveSpeedMps` is solved the same way off the WALK cycle, and
 * capping a chase with it measures a cadence nothing plays - it would put a goblin scout at 1.6 m/s
 * against a player who runs at 5.2, so no monster in the bestiary could ever catch anyone. Off the
 * run cycle the same goblin solves to 11.28, a stone golem to 22.53 and a skeleton to 5.19: the
 * ceiling never binds them at all, while a goose still comes down from 20.3 Hz of leg cycling to
 * its real 0.69 m/s.
 *
 * Assets with no measured stride are omitted and fall back to the shared speed, for the same
 * reason in every case: there is no planted foot whose contact could slide. That is the floating
 * undead, the viper, and the humanoid raiders, who wear `outfit_*` assets with no animations of
 * their own and borrow the player's jog. Rigs whose measurement is an artefact of a bad clip
 * sub-range rather than a fact about the animal - the rat and the snail, below 0.15 m/s - are
 * omitted on the same footing `tests/creature-gait.test.ts` excludes them on.
 *
 * Regenerated and pinned against the manifest by `tests/creature-gait.test.ts`, so a stale entry
 * fails rather than silently slowing something down.
 */
export const CREATURE_PURSUIT_CEILING_MPS: Record<string, number> = {
  "animal_aurochs": 6.2288,
  "animal_bear": 8.7634,
  "animal_boar": 3.59,
  "animal_cattle": 6.2288,
  "animal_chicken": 1.7626,
  "animal_chicken_speckled": 1.7626,
  "animal_coyote": 7.3224,
  "animal_crab": 0.3957,
  "animal_deer": 6.5502,
  "animal_frog": 0.69,
  "animal_frog_green": 0.69,
  "animal_goat": 4.4859,
  "animal_hog": 1.673,
  "animal_ibex": 4.0096,
  "animal_rabbit": 1.7055,
  "animal_rabbit_dark": 1.7055,
  // animal_rat: stride 0.122 m/s is below the artefact floor
  "animal_scorpion": 0.589,
  // animal_viper: no measured stride
  "boss_rhino_air": 4.9258,
  "boss_rhino_earth": 4.9258,
  "boss_rhino_water": 4.9258,
  "creature_antler_beetle": 2.9474,
  "creature_ashscale_monitor": 3.6429,
  // creature_banshee: no measured stride
  "creature_basalt_drake": 8.8191,
  "creature_beetle_golem": 6.5016,
  "creature_blackwater_heron": 2.262,
  "creature_bracken_tapir": 3.1915,
  "creature_cairn_bighorn": 4.4681,
  "creature_cinder_ravager": 6,
  "creature_duskoak_lynx": 5.0455,
  "creature_goblin_archer": 11.2765,
  "creature_goblin_scout": 11.2787,
  "creature_goblin_shaman": 11.2634,
  "creature_gorge_mantis": 5.6667,
  "creature_grave_ghoul": 14.1415,
  "creature_hollowroot_spider": 3.5357,
  "creature_iron_golem": 22.5261,
  "creature_kiln_salamander": 0.9316,
  "creature_lava_golem": 9.1254,
  "creature_marchfield_turkey": 1.8285,
  "creature_marchwild_horse": 7.0213,
  "creature_marsh_moose": 7.0213,
  // creature_marsh_wasp: no measured stride
  "creature_mossback_sentinel": 3.8976,
  "creature_plague_zombie": 4.0891,
  "creature_quarry_nightmare": 7.6323,
  // creature_quarry_snail: stride 0.054 m/s is below the artefact floor
  "creature_quillback_porcupine": 2.6591,
  "creature_redbrush_fox": 2.16,
  "creature_reedbank_goose": 0.6933,
  "creature_reedjaw_crocodile": 2.9833,
  // creature_revenant: no measured stride
  "creature_rootdelve_badger": 2.8636,
  "creature_scree_bustard": 2.184,
  "creature_shale_elemental": 9.4107,
  "creature_skeleton_archer": 5.1914,
  "creature_skeleton_mage": 5.1914,
  "creature_skeleton_soldier": 5.1914,
  "creature_slag_centipede": 1.7419,
  "creature_slateback_tortoise": 0.9091,
  "creature_stone_golem": 22.5261,
  "creature_webweaver_spider": 2.7324,
  // creature_wraith: no measured stride
  "creature_zombie": 4.0849,
  "miniboss_cinderwake": 19.0918,
  "miniboss_galeskin": 19.0918,
  "miniboss_mossbound": 19.0918,
  "miniboss_tideworn": 19.0918,
  // outfit_female_ranger: no measured stride
  // outfit_male_peasant: no measured stride
  // outfit_male_ranger: no measured stride
};

// Material variants retain their source animation samples and cadence limits.
for (const [variant, source] of [
  ["gloam_fox", "redbrush_fox"], ["moonweave_spider", "webweaver_spider"],
  ["rimeback_tortoise", "slateback_tortoise"], ["cindercrest_salamander", "kiln_salamander"],
  ["amethyst_spider", "webweaver_spider"],
]) {
  const base = `creature_${source}`, id = `creature_${variant}`;
  if (CREATURE_MOTION_TIMING[base]) CREATURE_MOTION_TIMING[id] = { ...CREATURE_MOTION_TIMING[base] };
  if (CREATURE_PURSUIT_CEILING_MPS[base]) CREATURE_PURSUIT_CEILING_MPS[id] = CREATURE_PURSUIT_CEILING_MPS[base];
}

// Complete-body reshaping changes the stride length; retiming changes contact duration.
CREATURE_PURSUIT_CEILING_MPS["creature_chalk_warden"] = 10.6341;
CREATURE_PURSUIT_CEILING_MPS["creature_hollow_bough"] = 3.4299;

// Accepted biome bodies: measured final weighted-sole run cadence.
CREATURE_PURSUIT_CEILING_MPS["creature_briar_harrow"] = 3.8976;
CREATURE_PURSUIT_CEILING_MPS["creature_fen_crawler"] = 2.8964;
CREATURE_PURSUIT_CEILING_MPS["creature_reed_strider"] = 3.3336;
CREATURE_PURSUIT_CEILING_MPS["creature_thorn_maw"] = 6.5016;
CREATURE_PURSUIT_CEILING_MPS["creature_heath_jack"] = 11.2787;
CREATURE_PURSUIT_CEILING_MPS["creature_kiln_marrow"] = 9.1254;
CREATURE_PURSUIT_CEILING_MPS["creature_slag_crawler"] = 2.7324;
CREATURE_PURSUIT_CEILING_MPS["creature_grave_lantern"] = 14.1415;
CREATURE_PURSUIT_CEILING_MPS["creature_cairn_treader"] = 8.1089;
CREATURE_PURSUIT_CEILING_MPS["creature_flint_mandible"] = 5.9942;
CREATURE_PURSUIT_CEILING_MPS["creature_vault_custodian"] = 9.8903;
CREATURE_PURSUIT_CEILING_MPS["creature_blind_cave_weaver"] = 3.1556;
CREATURE_PURSUIT_CEILING_MPS["creature_scree_watcher"] = 26.5850;

/**
 * Deep Wilderness expansion bodies, solved off the same run clip every other entry above is: the
 * manifest's `3 * impliedRunMps * runClipSeconds`.
 *
 * These shipped without ceilings, so `enemyPursuitSpeedMps` had nothing to bring them under and
 * every one of them chased at the full shared 4.68 m/s over a stride its own run cycle never
 * covers. A rift carapace cycled its legs at 3.48 Hz and a red hatchling - whose run cycle travels
 * 0.414 m, a third of what its black and lava clutchmates cover - at 11.30 Hz, which is not a fast
 * animal but a blur. Pinned here they come down to the same ~2.8 Hz every other ceiling-bound
 * resident in this file runs at.
 *
 * The long-strided bodies below the first group are pinned at a ceiling that never binds, exactly
 * as the golems and ghouls above are: their stride already carries the shared speed. They are
 * listed so a later remeasurement of the rig fails this file's pin rather than silently changing
 * how fast they may be asked to move.
 */
CREATURE_PURSUIT_CEILING_MPS["creature_baby_red_dragon"] = 1.242;
CREATURE_PURSUIT_CEILING_MPS["creature_baby_black_dragon"] = 3.2393;
CREATURE_PURSUIT_CEILING_MPS["creature_baby_lava_dragon"] = 3.8645;
CREATURE_PURSUIT_CEILING_MPS["creature_cinderback_crag"] = 3.679;
CREATURE_PURSUIT_CEILING_MPS["creature_red_wilderness_dragon"] = 3.4584;
CREATURE_PURSUIT_CEILING_MPS["creature_rift_carapace"] = 4.0333;
CREATURE_PURSUIT_CEILING_MPS["creature_basalt_maw"] = 5.5562;
CREATURE_PURSUIT_CEILING_MPS["creature_voidstone_colossus"] = 6.1573;
CREATURE_PURSUIT_CEILING_MPS["creature_black_wilderness_dragon"] = 7.8385;
CREATURE_PURSUIT_CEILING_MPS["creature_furnace_grazer"] = 9.0837;
CREATURE_PURSUIT_CEILING_MPS["creature_purple_wilderness_dragon"] = 10.5415;

// Dedicated regional boss and keeper bodies. Their strides carry the shared run speed, so the
// ceiling never binds; `creature_boss_galeskin` (1.294 m per run cycle) and
// `creature_boss_rootheart` (1.291 m) do not, and are deliberately absent: pinning them would
// drop both under the shared speed a boss has to keep. Their run cycles need the longer stride,
// not a lower ceiling.
CREATURE_PURSUIT_CEILING_MPS["creature_boss_tideworn"] = 5.5693;
CREATURE_PURSUIT_CEILING_MPS["creature_boss_tempest_roc"] = 5.7844;
CREATURE_PURSUIT_CEILING_MPS["creature_boss_mossbound"] = 6.6059;
CREATURE_PURSUIT_CEILING_MPS["creature_boss_cinderwake"] = 9.6872;
CREATURE_PURSUIT_CEILING_MPS["creature_boss_ordrun"] = 9.7581;
CREATURE_PURSUIT_CEILING_MPS["creature_furnace_regent"] = 16.0608;
CREATURE_PURSUIT_CEILING_MPS["creature_hollow_star"] = 17.1;
CREATURE_PURSUIT_CEILING_MPS["creature_chainbound_archon"] = 30.24;
CREATURE_PURSUIT_CEILING_MPS["creature_ashseal_warden"] = 43.8197;
CREATURE_PURSUIT_CEILING_MPS["creature_nightforge_marshal"] = 47.7586;
