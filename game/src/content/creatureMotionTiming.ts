/** Authored attack contact poses from the base motion rebuild and exported creature expansion metadata. */
export const CREATURE_MOTION_TIMING: Record<string, { seconds: number; contactNormalized: number }> = {
  "creature_field_wasp": { seconds: 0.9, contactNormalized: 0.5 },
  "creature_heath_wasp": { seconds: 0.9, contactNormalized: 0.5 },
  "creature_reed_wasp": { seconds: 0.9, contactNormalized: 0.5 },
  "creature_marsh_wasp": { seconds: 0.9, contactNormalized: 0.5 },
  "animal_aurochs": { seconds: 1.8, contactNormalized: 0.575 },
  "animal_bear": { seconds: 2.466667, contactNormalized: 0.15 },
  "animal_boar": { seconds: 0.7, contactNormalized: 0.7 },
  "animal_cattle": { seconds: 1.8, contactNormalized: 0.575 },
  "animal_chicken": { seconds: 0.7, contactNormalized: 0.43 },
  "animal_chicken_speckled": { seconds: 0.7, contactNormalized: 0.43 },
  "animal_coyote": { seconds: 1.4, contactNormalized: 0.525 },
  "animal_crab": { seconds: 0.9, contactNormalized: 0.4666666666666666 },
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
  "creature_quillback_porcupine": { seconds: 1.16, contactNormalized: 0.54 },
  "creature_cairn_bighorn": { seconds: 1.05, contactNormalized: 0.46 },
  "creature_marsh_moose": { seconds: 1.23, contactNormalized: 0.47 },
  "creature_bracken_tapir": { seconds: 0.9, contactNormalized: 0.48 },
  "creature_reedjaw_crocodile": { seconds: 0.833333, contactNormalized: 0.458333 },
  "creature_kiln_salamander": { seconds: 1.08, contactNormalized: 0.43 },
  "creature_slateback_tortoise": { seconds: 1.45, contactNormalized: 0.49 },
  "creature_ashscale_monitor": { seconds: 1.1, contactNormalized: 0.48 },
  "creature_reedbank_goose": { seconds: 1.14, contactNormalized: 0.46 },
  "creature_blackwater_heron": { seconds: 1.05, contactNormalized: 0.455 },
  "creature_scree_bustard": { seconds: 0.82, contactNormalized: 0.46 },
  "creature_marchfield_turkey": { seconds: 0.78, contactNormalized: 0.455 },
  "creature_quarry_snail": { seconds: 1.5, contactNormalized: 0.48 },
  "creature_antler_beetle": { seconds: 1.1, contactNormalized: 0.5 },
  "creature_slag_centipede": { seconds: 0.94, contactNormalized: 0.5 },
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
  "creature_blackwater_heron": 2.262,
  "creature_bracken_tapir": 3.1915,
  "creature_cairn_bighorn": 4.4681,
  "creature_cinder_ravager": 6,
  "creature_duskoak_lynx": 5.0455,
  "creature_goblin_archer": 11.2765,
  "creature_goblin_scout": 11.2787,
  "creature_gorge_mantis": 5.6667,
  "creature_grave_ghoul": 14.1415,
  "creature_iron_golem": 22.5261,
  "creature_kiln_salamander": 0.9316,
  "creature_marchfield_turkey": 1.8285,
  "creature_marsh_moose": 7.0213,
  // creature_marsh_wasp: no measured stride
  "creature_plague_zombie": 4.0891,
  // creature_quarry_snail: stride 0.054 m/s is below the artefact floor
  "creature_quillback_porcupine": 2.6591,
  "creature_redbrush_fox": 2.16,
  "creature_reedbank_goose": 0.6933,
  "creature_reedjaw_crocodile": 2.9833,
  // creature_revenant: no measured stride
  "creature_skeleton_archer": 5.1914,
  "creature_skeleton_mage": 5.1914,
  "creature_skeleton_soldier": 5.1914,
  "creature_slag_centipede": 1.7419,
  "creature_slateback_tortoise": 0.9091,
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
  ["amethyst_spider", "webweaver_spider"],
]) {
  const base = `creature_${source}`, id = `creature_${variant}`;
  if (CREATURE_MOTION_TIMING[base]) CREATURE_MOTION_TIMING[id] = { ...CREATURE_MOTION_TIMING[base] };
  if (CREATURE_PURSUIT_CEILING_MPS[base]) CREATURE_PURSUIT_CEILING_MPS[id] = CREATURE_PURSUIT_CEILING_MPS[base];
}

// Complete-body reshaping changes the stride length; retiming changes contact duration.
CREATURE_PURSUIT_CEILING_MPS["creature_hollow_bough"] = 3.4299;

// Accepted biome bodies: measured final weighted-sole run cadence.
CREATURE_PURSUIT_CEILING_MPS["creature_briar_harrow"] = 3.8976;
CREATURE_MOTION_TIMING["creature_fen_crawler"] = { seconds: 0.86, contactNormalized: 0.5 };
CREATURE_PURSUIT_CEILING_MPS["creature_grave_lantern"] = 14.1415;
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
CREATURE_PURSUIT_CEILING_MPS["creature_baby_red_dragon"] = 1.2841;
CREATURE_PURSUIT_CEILING_MPS["creature_baby_black_dragon"] = 3.2393;
CREATURE_PURSUIT_CEILING_MPS["creature_baby_lava_dragon"] = 1.2582;
CREATURE_PURSUIT_CEILING_MPS["creature_red_wilderness_dragon"] = 3.5593;
CREATURE_PURSUIT_CEILING_MPS["creature_rift_carapace"] = 4.0333;
CREATURE_PURSUIT_CEILING_MPS["creature_basalt_maw"] = 6;
CREATURE_PURSUIT_CEILING_MPS["creature_black_wilderness_dragon"] = 7.8385;
CREATURE_PURSUIT_CEILING_MPS["creature_furnace_grazer"] = 6.3498;
CREATURE_PURSUIT_CEILING_MPS["creature_purple_wilderness_dragon"] = 3.6817;

// Dedicated regional boss and keeper bodies. Their strides carry the shared run speed, so the
// ceiling never binds; `creature_boss_galeskin` (1.294 m per run cycle) and
// `creature_boss_rootheart` (1.291 m) do not, and are deliberately absent: pinning them would
// drop both under the shared speed a boss has to keep. Their run cycles need the longer stride,
// not a lower ceiling.
CREATURE_PURSUIT_CEILING_MPS["creature_boss_mossbound"] = 6.6059;
CREATURE_PURSUIT_CEILING_MPS["creature_hollow_star"] = 10.8546;

CREATURE_PURSUIT_CEILING_MPS["creature_ivory_castellan"] = 31.7487;

CREATURE_PURSUIT_CEILING_MPS["creature_amethyst_dragon"] = 7.8385;

CREATURE_MOTION_TIMING["creature_basalt_maw"] = { seconds: 2.3333332538604736, contactNormalized: 0.235 };

CREATURE_PURSUIT_CEILING_MPS["creature_grave_ghoul"] = 14.1415;

CREATURE_MOTION_TIMING["creature_grave_ghoul"] = { seconds: 1.7999999523162842, contactNormalized: 0.33 };

CREATURE_MOTION_TIMING["creature_grave_lantern"] = { seconds: 1.7999999523162842, contactNormalized: 0.33 };

CREATURE_MOTION_TIMING["creature_furnace_grazer"] = { seconds: 1.600000023841858, contactNormalized: 0.65 };


CREATURE_MOTION_TIMING["creature_furnace_regent"] = { seconds: 2, contactNormalized: 0.52 };

CREATURE_MOTION_TIMING["creature_chainbound_archon"] = { seconds: 0.5, contactNormalized: 0.42 };

CREATURE_MOTION_TIMING["creature_hollow_star"] = { seconds: 1, contactNormalized: 0.316667 };


CREATURE_MOTION_TIMING["creature_kiln_marrow"] = { seconds: 2, contactNormalized: 0.52 };

CREATURE_MOTION_TIMING["creature_ivory_castellan"] = { seconds: 1.1266666650772095, contactNormalized: 0.38 };

// Fairy and Crownward skins retain source geometry and every animation channel. Keep this
// static alias table independent of the species catalogue, which imports the combat registry.
for (const [variant, source] of [
  ['creature_crown_hart', 'animal_deer'],
  ['creature_moonpetal_stalker', 'creature_heath_jack'],
  ['creature_bloomheart_matriarch', 'creature_boss_rootheart'],
  ['creature_starroot_guardian', 'creature_briar_harrow'],
  ['creature_amethyst_sovereign', 'creature_hollow_star'],
] as const) {
  if (CREATURE_MOTION_TIMING[source]) CREATURE_MOTION_TIMING[variant] = { ...CREATURE_MOTION_TIMING[source] };
  if (CREATURE_PURSUIT_CEILING_MPS[source]) CREATURE_PURSUIT_CEILING_MPS[variant] = CREATURE_PURSUIT_CEILING_MPS[source];
}

// Imported fairy source clips and authored trial-pack contact poses.
CREATURE_MOTION_TIMING["fantasy_monster_01"] = { seconds: 2, contactNormalized: 0.4 };
CREATURE_MOTION_TIMING["fantasy_monster_02"] = { seconds: 2, contactNormalized: 0.4 };
CREATURE_MOTION_TIMING["fantasy_monster_03"] = { seconds: 0.866666675, contactNormalized: 0.275 };
CREATURE_MOTION_TIMING["fantasy_monster_04"] = { seconds: 2.3333332538604736, contactNormalized: 0.4 };
CREATURE_MOTION_TIMING["fantasy_monster_05"] = { seconds: 2.3333332538604736, contactNormalized: 0.4 };
CREATURE_MOTION_TIMING["fantasy_monster_06"] = { seconds: 2.3333332538604736, contactNormalized: 0.4 };
CREATURE_MOTION_TIMING["fantasy_monster_07"] = { seconds: 2, contactNormalized: 0.4 };
CREATURE_MOTION_TIMING["fantasy_monster_08"] = { seconds: 1, contactNormalized: 0.4 };
CREATURE_MOTION_TIMING["fantasy_monster_09"] = { seconds: 1, contactNormalized: 0.4 };
CREATURE_MOTION_TIMING["fairy_monster_11"] = { seconds: 1.1, contactNormalized: 0.5 };
CREATURE_MOTION_TIMING["fairy_monster_14"] = { seconds: 1.1, contactNormalized: 0.5 };
CREATURE_MOTION_TIMING["fairy_monster_16"] = { seconds: 1.1, contactNormalized: 0.5 };
CREATURE_MOTION_TIMING["fairy_monster_21"] = { seconds: 0.86, contactNormalized: 0.5 };
CREATURE_MOTION_TIMING["fairy_monster_27"] = { seconds: 1.1, contactNormalized: 0.5 };
CREATURE_MOTION_TIMING["fairy_monster_30"] = { seconds: 1.1, contactNormalized: 0.5 };
// Maximum three run cycles per second for the planted trial-pack locomotion.
CREATURE_PURSUIT_CEILING_MPS["fairy_monster_16"] = 3.3342;
CREATURE_PURSUIT_CEILING_MPS["fairy_monster_27"] = 5.0565;
CREATURE_PURSUIT_CEILING_MPS["fairy_monster_30"] = 5.0988;
// Garden wardling: 3 Hz * 0.5312404920607205 m/s * 2 s, from the shipped run metadata.
// Gecko 10 has no measured stride. Hovering imp 19 measures 0.0923 m/s, below the
// existing 0.15 m/s artefact floor, so neither receives a planted-foot pursuit cap.
CREATURE_PURSUIT_CEILING_MPS["fairy_monster_34"] = 3.1874;
CREATURE_PURSUIT_CEILING_MPS["fairy_monster_28"] = 2.2757;
CREATURE_PURSUIT_CEILING_MPS["fairy_monster_31"] = 2.03;

// Garden skins retain these source clips. Keep aliases independent of the combat catalogue.
for (const region of ['gloamgarden', 'faeholme']) {
  for (const [form, source] of [
    ['spriggle', 'fairy_monster_10'], ['sporekin', 'creature_goblin_shaman'], ['frog', 'animal_frog'],
    ['imp', 'fairy_monster_19'], ['snail', 'creature_quarry_snail'], ['reliquary', 'fairy_monster_28'],
    ['hart', 'animal_deer'], ['veilspirit', 'creature_wraith'], ['sapling', 'creature_briar_harrow'],
    ['drake', 'creature_baby_red_dragon'], ['wardling', 'fairy_monster_34'], ['petalguard', 'fairy_monster_31'],
  ] as const) {
    const id = `fairy_garden_${form}_${region}`;
    if (form === 'petalguard' || form === 'reliquary' || id === 'fairy_garden_sporekin_gloamgarden' || id === 'fairy_garden_frog_faeholme') continue;
    // These imports use their own recovered native rigs and a retargeted jab.
    if (id === 'fairy_garden_sporekin_faeholme' || id === 'fairy_garden_sapling_gloamgarden' || id === 'fairy_garden_sapling_faeholme') {
      CREATURE_MOTION_TIMING[id] = { seconds: 0.866666675, contactNormalized: 0.26 };
      continue;
    }
    const timing = source.startsWith('fairy_monster_') ? { seconds: 1.1, contactNormalized: .5 } : CREATURE_MOTION_TIMING[source];
    if (timing) CREATURE_MOTION_TIMING[id] = { ...timing };
    const ceiling = CREATURE_PURSUIT_CEILING_MPS[source];
    if (ceiling) CREATURE_PURSUIT_CEILING_MPS[id] = ceiling;
  }
  for (const number of ['02', '03', '06', '07', '08', '09']) {
    CREATURE_MOTION_TIMING[`fairy_guardian_${number}_${region}`] = { ...CREATURE_MOTION_TIMING[`fantasy_monster_${number}`]! };
  }
}

// These skins still use the earlier rigs; replacement bodies have independent clips.
CREATURE_PURSUIT_CEILING_MPS["creature_moonpetal_stalker"] = 11.2787;
CREATURE_MOTION_TIMING["creature_rootdelve_badger"] = { seconds: 0.95, contactNormalized: 0.45263157894736844 };
CREATURE_MOTION_TIMING["creature_marchwild_horse"] = { seconds: 0.966666639, contactNormalized: 0.46 };
CREATURE_MOTION_TIMING["creature_heath_jack"] = { seconds: 0.660000026, contactNormalized: 0.43 };
CREATURE_MOTION_TIMING["creature_boss_tempest_roc"] = { seconds: 0.86, contactNormalized: 0.5 };
CREATURE_MOTION_TIMING["creature_hollowroot_spider"] = { seconds: 0.879999995, contactNormalized: 0.47727272727272724 };
CREATURE_MOTION_TIMING["creature_webweaver_spider"] = { seconds: 0.879999995, contactNormalized: 0.47727272727272724 };
CREATURE_MOTION_TIMING["creature_blind_cave_weaver"] = { seconds: 0.879999995, contactNormalized: 0.47727272727272724 };
CREATURE_MOTION_TIMING["creature_thorn_maw"] = { seconds: 0.85, contactNormalized: 0.5 };
CREATURE_MOTION_TIMING["creature_mossback_sentinel"] = { seconds: 0.866666675, contactNormalized: 0.275 };
CREATURE_MOTION_TIMING["creature_stone_golem"] = { seconds: 0.866666675, contactNormalized: 0.275 };
CREATURE_PURSUIT_CEILING_MPS["creature_heath_jack"] = 2.9071;
CREATURE_MOTION_TIMING["creature_gloam_fox"] = { seconds: 0.82, contactNormalized: 0.60975609756 };
CREATURE_MOTION_TIMING["creature_pearl_knight"] = { seconds: 0.78, contactNormalized: 0.358974358974359 };
CREATURE_MOTION_TIMING["creature_revenant"] = { seconds: 0.9, contactNormalized: 0.466666666666667 };

CREATURE_MOTION_TIMING["creature_slag_crawler"] = { seconds: 0.7799999713897705, contactNormalized: 0.3974358974358974 };

CREATURE_MOTION_TIMING["creature_cinderback_crag"] = { seconds: 0.9749999642372131, contactNormalized: 0.3974358974358974 };

CREATURE_MOTION_TIMING["creature_banshee"] = { seconds: 0.96, contactNormalized: 0.5 };

CREATURE_MOTION_TIMING["creature_moonweave_spider"] = { seconds: 0.8799999952316284, contactNormalized: 0.4772727298588792 };

CREATURE_MOTION_TIMING["creature_amethyst_spider"] = { seconds: 0.8799999952316284, contactNormalized: 0.4772727298588792 };

CREATURE_MOTION_TIMING["creature_dewglass_weaver"] = { seconds: 0.8799999952316284, contactNormalized: 0.4772727298588792 };

CREATURE_MOTION_TIMING["creature_lantern_sprite"] = { seconds: 0.8999999761581421, contactNormalized: 0.4 };

CREATURE_MOTION_TIMING["creature_orchid_reaper"] = { seconds: 0.8600000143051147, contactNormalized: 0.5 };

CREATURE_MOTION_TIMING["fairy_garden_imp_faeholme"] = { seconds: 0.9, contactNormalized: 0.5 };

CREATURE_MOTION_TIMING["fairy_garden_imp_gloamgarden"] = { seconds: 0.9, contactNormalized: 0.5 };

CREATURE_MOTION_TIMING["creature_boss_tideworn"] = { seconds: 0.8666666746139526, contactNormalized: 0.26666666666666666 };

CREATURE_MOTION_TIMING["creature_boss_cinderwake"] = { seconds: 0.8666666746139526, contactNormalized: 0.26666666666666666 };

CREATURE_MOTION_TIMING["creature_boss_ordrun"] = { seconds: 1.02, contactNormalized: 0.4215686274509804 };

CREATURE_MOTION_TIMING["creature_voidstone_colossus"] = {"seconds":1.2400000095367432,"contactNormalized":0.5};

CREATURE_MOTION_TIMING["creature_ashseal_warden"] = {"seconds":1.2400000095367432,"contactNormalized":0.5};

CREATURE_MOTION_TIMING["creature_nightforge_marshal"] = {"seconds":0.9200000166893005,"contactNormalized":0.5434782608695652};

CREATURE_MOTION_TIMING["fairy_garden_petalguard_faeholme"] = {"seconds":0.9,"contactNormalized":0.5};

CREATURE_MOTION_TIMING["fairy_garden_petalguard_gloamgarden"] = {"seconds":0.9,"contactNormalized":0.5};

CREATURE_MOTION_TIMING["fairy_garden_reliquary_gloamgarden"] = {"seconds":0.8600000143051147,"contactNormalized":0.5};

CREATURE_MOTION_TIMING["fairy_garden_reliquary_faeholme"] = {"seconds":0.8600000143051147,"contactNormalized":0.5};

CREATURE_MOTION_TIMING["creature_veil_reaper"] = {"seconds":0.78,"contactNormalized":0.5897435897435898};

// Recovered woodland bodies have independent clips and uncalibrated strides.
CREATURE_MOTION_TIMING["creature_boss_rootheart"] = { seconds: 0.8666666746139526, contactNormalized: 0.5 };
CREATURE_MOTION_TIMING["fairy_garden_sporekin_gloamgarden"] = { seconds: 1, contactNormalized: 0.55 };

CREATURE_MOTION_TIMING["creature_vault_custodian"] = { seconds: 0.8666666746139526, contactNormalized: 0.48 };
CREATURE_MOTION_TIMING["fairy_guardian_06_faeholme"] = { seconds: 0.8500000238418579, contactNormalized: 0.5647058823529412 };

CREATURE_MOTION_TIMING["creature_flint_mandible"] = { seconds: 0.8600000143051147, contactNormalized: 0.5 };

CREATURE_MOTION_TIMING["creature_silverthorn_harrow"] = { seconds: 0.8666666746139526, contactNormalized: 0.5 };

CREATURE_MOTION_TIMING["creature_beetle_golem"] = { seconds: 1.14, contactNormalized: 0.56 / 1.14 };

// Accepted polish clips with authored contact frames.
CREATURE_MOTION_TIMING["creature_goblin_shaman"] = { seconds: 0.5, contactNormalized: 0.42 };
CREATURE_MOTION_TIMING["creature_lava_golem"] = { seconds: 0.92, contactNormalized: 0.5 };
CREATURE_MOTION_TIMING["fairy_garden_snail_gloamgarden"] = { seconds: 0.78, contactNormalized: 0.52 };
CREATURE_MOTION_TIMING["fairy_garden_frog_faeholme"] = { seconds: 0.68, contactNormalized: 0.48 };

CREATURE_MOTION_TIMING["creature_cindercrest_salamander"] = { seconds: 0.8799999952316284, contactNormalized: 0.41 };

CREATURE_MOTION_TIMING["creature_reed_strider"] = { seconds: 0.95, contactNormalized: 0.53 };

CREATURE_MOTION_TIMING["creature_cairn_treader"] = { seconds: 0.699999988079071, contactNormalized: 0.3095238147949687 };

CREATURE_MOTION_TIMING["creature_chalk_warden"] = { seconds: 0.7250000238418579, contactNormalized: 0.45 };

CREATURE_MOTION_TIMING["creature_shale_elemental"] = { seconds: 0.8399999737739563, contactNormalized: 0.58 };

CREATURE_MOTION_TIMING["fairy_garden_snail_faeholme"] = { seconds: 1.5, contactNormalized: 0.48 };

CREATURE_MOTION_TIMING["creature_rimeback_tortoise"] = { seconds: 1.25, contactNormalized: 0.5 };
