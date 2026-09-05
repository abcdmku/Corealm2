/**
 * Source FBX catalogue. Clip names are runtime contracts: Idle, Walk, Run, Attack, Death.
 * Every source walk and run remains distinct. Multi-motion takes use explicit Unity frame ranges.
 * Missing attack takes are recorded below; tools/rebuild-creature-motion.ts replaces them with
 * articulated species clips in a staged review build and supplies Hit/HitLeft/HitRight for combat.
 * The converter never layers root lunges over these source motions.
 */
export const ANIMALS = [
  // ---------------------------------------------------------------- plains, Fallowmarch
  {
    id: "animal_chicken", rig: "Chicken_Rig.fbx", texture: "chicken_col14_unity.png",
    is: "chicken", tags: ["chicken", "hen", "fowl", "bird", "farm", "plains", "animal", "passive"],
    clips: [["Chicken_Idle", "Idle"], ["Chicken_Walk", "Walk"], ["Chicken_Run", "Run"], ["Chicken_Eat", "Attack", [1, 40]], ["Chicken_Die", "Death"]],
    substitutes: { attack: "source feeding placeholder; rebuild supplies articulated peck" },
  },
  {
    id: "animal_chicken_speckled", rig: "Chicken_Rig.fbx", texture: "chicken_col_v3_unity.png",
    is: "chicken", tags: ["chicken", "hen", "fowl", "bird", "farm", "plains", "animal", "variant"],
    clips: [["Chicken_Idle", "Idle"], ["Chicken_Walk", "Walk"], ["Chicken_Run", "Run"], ["Chicken_Eat", "Attack", [1, 40]], ["Chicken_Die", "Death"]],
    substitutes: { attack: "source feeding placeholder; rebuild supplies articulated peck" },
  },
  {
    id: "animal_cattle", rig: "Cattle_Rig.fbx", texture: "iron_age_cattle_col_unity.png",
    is: "cow", tags: ["cow", "cattle", "ox", "bovine", "farm", "plains", "animal", "territorial"],
    clips: [["Cattle_Idle", "Idle"], ["Cattle_Walk", "Walk"], ["Cattle_Run", "Run"], ["Cattle_Attack", "Attack"], ["Cattle_Die", "Death"]],
  },
  {
    id: "animal_aurochs", rig: "Cattle_Rig.fbx", texture: "iron_age_cattle_v2_col3_unity.png",
    is: "aurochs", tags: ["aurochs", "cattle", "bull", "bovine", "highland", "animal", "variant"],
    clips: [["Cattle_Idle", "Idle"], ["Cattle_Walk", "Walk"], ["Cattle_Run", "Run"], ["Cattle_Attack", "Attack"], ["Cattle_Die", "Death"]],
  },
  {
    id: "animal_goat", rig: "Goat_Rig.fbx", texture: "goat_col_v5_unity.png",
    is: "goat", tags: ["goat", "billy", "horned", "farm", "plains", "animal", "aggressive"],
    clips: [["Goat_Idle", "Idle"], ["Goat_Walk", "Walk"], ["Goat_Run", "Run"], ["Goat_Attack", "Attack"], ["Goat_Die", "Death"]],
  },
  {
    id: "animal_rabbit", rig: "WildRabbit_Rig.fbx", texture: "wild_rabbit_col5_unity.png",
    is: "rabbit", tags: ["rabbit", "bunny", "hare", "coney", "plains", "forest", "animal", "passive"],
    clips: [["WildRabbit_Idle", "Idle"], ["WildRabbit_Walk", "Walk"], ["WildRabbit_Run", "Run"], ["WildRabbit_Eat", "Attack", [1, 26]], ["WildRabbit_Die", "Death"]],
    substitutes: { attack: "source feeding placeholder; rebuild supplies articulated nip" },
  },
  {
    id: "animal_rabbit_dark", rig: "WildRabbit_Rig.fbx", texture: "wild_rabbit_col_v3_unity.png",
    is: "rabbit", tags: ["rabbit", "bunny", "hare", "coney", "forest", "animal", "variant"],
    clips: [["WildRabbit_Idle", "Idle"], ["WildRabbit_Walk", "Walk"], ["WildRabbit_Run", "Run"], ["WildRabbit_Eat", "Attack", [1, 26]], ["WildRabbit_Die", "Death"]],
    substitutes: { attack: "source feeding placeholder; rebuild supplies articulated nip" },
  },
  {
    id: "animal_frog", rig: "common_frog_rig_exp.FBX", texture: "common_frog_col_unity.png",
    is: "frog", tags: ["frog", "toad", "amphibian", "water", "marsh", "pond", "animal", "passive"],
    clips: [["common_frog_idle_anim", "Idle"], ["common_frog_walk_anim", "Walk"], ["common_frog_run_anim", "Run"], ["common_frog_run_anim", "Attack"], ["common_frog_die_anim", "Death"]],
    substitutes: { attack: "source hop placeholder; rebuild supplies articulated jaw snap" },
  },
  {
    id: "animal_frog_green", rig: "common_frog_rig_exp.FBX", texture: "common_frog_col_v2_unity.png",
    is: "frog", tags: ["frog", "toad", "amphibian", "water", "marsh", "pool", "animal", "variant"],
    clips: [["common_frog_idle_anim", "Idle"], ["common_frog_walk_anim", "Walk"], ["common_frog_run_anim", "Run"], ["common_frog_run_anim", "Attack"], ["common_frog_die_anim", "Death"]],
    substitutes: { attack: "source hop placeholder; rebuild supplies articulated jaw snap" },
  },

  // ---------------------------------------------------------------- forest, Vellenwood
  {
    id: "animal_deer", rig: "Deer_Rig.fbx", texture: "deer_col6_unity.png",
    is: "deer", tags: ["deer", "stag", "hart", "doe", "antler", "forest", "animal", "territorial"],
    clips: [["Deer_Idle", "Idle"], ["Deer_Walk", "Walk"], ["Deer_Run", "Run"], ["Deer_Eat", "Attack", [1, 34]], ["Deer_Die", "Death"]],
    substitutes: { attack: "source feeding placeholder; rebuild supplies articulated antler thrust" },
  },
  {
    id: "animal_coyote", rig: "Wolf_Rig.fbx", texture: "common_wolf_col2_unity.png",
    is: "coyote", tags: ["coyote", "wolf", "canine", "pack", "forest", "animal", "aggressive"],
    clips: [["Wolf_IdleA", "Idle"], ["Wolf_Walk", "Walk"], ["Wolf_Run", "Run"], ["Wolf_Attack", "Attack"], ["Wolf_Die", "Death"]],
  },
  {
    id: "animal_hog", rig: "iron_age_pig_rig_exp.FBX", texture: "iron_age_pig_col_unity.png",
    is: "hog", tags: ["hog", "pig", "swine", "forest", "bramble", "animal", "aggressive"],
    clips: [["iron_age_pig_idle_anim", "Idle"], ["iron_age_pig_walk_anim", "Walk"], ["iron_age_pig_eat_anim", "Attack", [150, 186]], ["iron_age_pig_die_anim", "Death"]],
    substitutes: { walk: "iron_age_pig_walk (pack ships no run cycle)", attack: "source feeding placeholder; rebuild supplies articulated tusk jab" },
  },
  {
    id: "animal_viper", rig: "Viper_Rig.fbx", texture: "asp_viper_col6_unity.png",
    is: "viper", tags: ["viper", "adder", "snake", "serpent", "venom", "forest", "animal", "territorial"],
    clips: [["Viper_Idle", "Idle"], ["Viper_Glide", "Walk"], ["Viper_FastGlide", "Run"], ["Viper_Attack", "Attack"], ["Viper_Die", "Death"]],
  },

  // ---------------------------------------------------------------- rocky, Karrowmoor
  {
    id: "animal_bear", rig: "Bear_Rig.fbx", texture: "brown_bear_col_v2_unity.png",
    is: "bear", tags: ["bear", "bruin", "predator", "rocky", "cave", "animal", "aggressive"],
    clips: [["Bear_Idle", "Idle"], ["Bear_Walk", "Walk"], ["Bear_Run", "Run"], ["Bear_Attack", "Attack"], ["Bear_Die", "Death"]],
  },
  {
    id: "animal_boar", rig: "WildBoar_Rig.fbx", texture: "wild_boar_col9_unity.png",
    is: "boar", tags: ["boar", "tusk", "swine", "rocky", "scree", "animal", "aggressive"],
    clips: [["WildBoar_Idle", "Idle"], ["WildBoar_Walk", "Walk"], ["WildBoar_Run", "Run"], ["WildBoar_Attack", "Attack"], ["WildBoar_Die", "Death"]],
  },
  {
    id: "animal_ibex", rig: "Ibex_Rig.fbx", texture: "ibex_col16_unity.png",
    is: "ibex", tags: ["ibex", "goat", "horned", "ridge", "rocky", "animal", "territorial"],
    clips: [["Ibex_Idle", "Idle"], ["Ibex_Walk", "Walk"], ["Ibex_Run", "Run"], ["Ibex_Attack", "Attack"], ["Ibex_Die", "Death"]],
  },

  // ---------------------------------------------------------------- dungeon, Gravelmaw
  {
    id: "animal_rat", rig: "rat_rig_exp.FBX", texture: "rat_col13_unity.png",
    is: "rat", tags: ["rat", "rodent", "vermin", "cave", "dungeon", "animal", "aggressive"],
    clips: [["rat_idle_anim", "Idle"], ["rat_walk_anim", "Walk"], ["rat_walk_anim", "Attack", [10, 30]], ["rat_die_anim", "Death"]],
    substitutes: { walk: "rat_walk (pack ships no run cycle)", attack: "source walk placeholder; rebuild supplies articulated nip" },
  },
  {
    id: "animal_scorpion", rig: "Scorpion_Rig.fbx", texture: "scorpion_col15_unity.png",
    is: "scorpion", tags: ["scorpion", "sting", "arachnid", "cave", "dungeon", "animal", "aggressive"],
    clips: [["Scorpion_Idle", "Idle"], ["Scorpion_Walk", "Walk"], ["Scorpion_Run", "Run"], ["Scorpion_Attack", "Attack"], ["Scorpion_Die", "Death"]],
  },
  {
    id: "animal_crab", rig: "crab_rig.FBX", texture: "crab_col12_unity.png",
    is: "crab", tags: ["crab", "shell", "claw", "sump", "cave", "water", "animal", "territorial"],
    clips: [["crab_walk_anim", "Idle"], ["crab_walk_anim", "Walk"], ["crab_run_anim", "Run"], ["crab_run_anim", "Attack"], ["crab_die_anim", "Death"]],
    // Unity records Crab_idle as frames 110-111, a single held pose, and a one-frame clip is
    // degenerate enough that optimization drops it outright - the crab shipped with no Idle at
    // all and fell back to scuttling in place. Widened to eight frames so it survives.
    substitutes: { idle: "crab_walk (the pack ships a single-frame idle, which optimizes to a 0 s clip)", walk: "crab_walk (crab_run does not close its cycle and popped 52 degrees per loop)", attack: "source run placeholder; rebuild supplies articulated pinch" },
  },

  // ---------------------------------------------------------------- water, fishing shoals
  // Fish are shoal dressing for fishing spots, never combatants. The pack ships them with swim
  // cycles only, no idle and no death, so there is nothing to fake and nothing to fight.
  {
    id: "animal_perch", rig: "perch_fish_rig_exp.FBX", texture: "perch_fish_col_unity.png",
    is: "fish", tags: ["fish", "perch", "shoal", "school", "water", "fishing", "animal"],
    clips: [["perch_fish_swim_anim", "Idle"], ["perch_fish_fastswim_anim", "Walk"]],
    substitutes: { idle: "perch_swim (a fish never stops swimming)" },
  },
  {
    id: "animal_pike", rig: "pike_rig_exp.FBX", texture: "pike_col_unity.png",
    is: "fish", tags: ["fish", "pike", "shoal", "school", "water", "fishing", "animal"],
    clips: [["pike_swim_anim", "Idle"], ["pike_fastswim_anim", "Walk"]],
    substitutes: { idle: "pike_swim (a fish never stops swimming)" },
  },
  {
    id: "animal_salmon", rig: "salmon_rig_exp.FBX", texture: "salmon_col13_unity.png",
    is: "fish", tags: ["fish", "salmon", "shoal", "school", "water", "fishing", "animal"],
    clips: [["salmon_swim_anim", "Idle"], ["salmon_fastswim_anim", "Walk"]],
    substitutes: { idle: "salmon_swim (a fish never stops swimming)" },
  },
];
