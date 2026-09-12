import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUDIO_CUE_IDS } from "../game/src/contracts.js";
import { ENEMIES } from "../game/src/content/enemies.js";
import type { GroundSurfaceSample } from "../game/src/contracts.js";
import {
  COREALM_AUDIO_CATALOG, FUTURE_REGION_MUSIC_FILES, cueForActivity, cueForCreature,
  cueForGameEvent, cueForMovement, cuesForCombatHit, footstepSurfaceAt, isCreatureFamily,
  loopsForRegion,
} from "../game/src/audio/index.js";
import type { AudioVariant } from "../game/src/audio/index.js";

describe("Corealm audio catalog", () => {
  it("maps every frozen semantic cue to at least one local curated asset", async () => {
    expect(Object.keys(COREALM_AUDIO_CATALOG.cues).sort()).toEqual([...AUDIO_CUE_IDS].sort());

    const urls = new Set<string>();
    for (const definition of Object.values(COREALM_AUDIO_CATALOG.cues)) {
      expect(definition.variants.length).toBeGreaterThan(0);
      for (const variant of definition.variants as readonly (string | AudioVariant)[]) {
        const url = typeof variant === "string" ? variant : variant.url;
        expect(url).toMatch(/^\/audio\/sfx\/[a-z0-9-/]+\.ogg$/);
        urls.add(url);
      }
    }
    for (const definition of Object.values(COREALM_AUDIO_CATALOG.loops)) {
      expect(definition.url).toMatch(/^\/audio\/(?:music|ambience)\/[a-z0-9-/]+\.(?:mp3|ogg)$/);
      urls.add(definition.url);
    }

    await Promise.all([...urls].map((url) => access(fileURLToPath(
      new URL(`../game/public${url}`, import.meta.url),
    ))));
  });

  it("ships music only for current regions and leaves Gravelmaw without a fallback", () => {
    expect(loopsForRegion("fallowmarch", COREALM_AUDIO_CATALOG.regions, 0)).toEqual({
      music: "music.starter-plains",
      ambient: "ambient.open-plains",
    });
    expect(loopsForRegion("fallowmarch", COREALM_AUDIO_CATALOG.regions, 1).music)
      .toBe("music.distant-plains");
    expect(loopsForRegion("vellenwood", COREALM_AUDIO_CATALOG.regions).music)
      .toBe("music.deep-woodland");
    expect(loopsForRegion("karrowmoor", COREALM_AUDIO_CATALOG.regions).music)
      .toBe("music.stone-city");
    expect(loopsForRegion("gravelmaw", COREALM_AUDIO_CATALOG.regions)).toEqual({
      music: null,
      ambient: "ambient.cave",
    });

    const catalogText = JSON.stringify(COREALM_AUDIO_CATALOG).toLowerCase();
    for (const filename of FUTURE_REGION_MUSIC_FILES) expect(catalogText).not.toContain(filename);
    expect(catalogText).not.toContain("c:\\users\\");
  });

  it("keeps ambiguous smelting, consumption, and traversal selections explicit", () => {
    expect(cueForActivity({ kind: "production", skill: "smithing", op: "smelt", phase: "started" })).toBeNull();
    expect(cueForActivity({ kind: "production", skill: "smithing", op: "smelt", phase: "completed" })).toBe("production.smelt");
    expect(cueForActivity({ kind: "production", skill: "smithing", op: "smith", phase: "completed" })).toBe("production.smith");
    expect(cueForActivity({ kind: "eating" })).toBe("interaction.consume");
    expect(cueForActivity({ kind: "traversing", op: "climb" })).toBe("interaction.climb");
    expect(cueForActivity({ kind: "traversing", op: "vault" })).toBe("interaction.vault");
  });

  it("plays the catch cue on each successful fishing receipt", () => {
    expect(cueForGameEvent({
      seq: 1,
      type: "item.received",
      atMs: 1_800,
      entityId: "fish_node_1",
      data: { itemId: "silt_minnow", quantity: 1, source: "gather", skill: "fishing" },
    })).toBe("gather.fishing_catch");
  });

  it("maps visible ground materials to distinct footstep cues", () => {
    const ground = (surface: keyof GroundSurfaceSample): GroundSurfaceSample => ({
      grass: 0, dry: 0, rock: 0, gravel: 0, dirt: 0, mud: 0, cobble: 0, wet: 0,
      [surface]: 1,
    });

    expect(cueForMovement({
      regionId: "fallowmarch",
      surface: footstepSurfaceAt("fallowmarch", [-240, 0, -150], ground("grass")),
    })).toBe("movement.footstep_grass");
    expect(cueForMovement({
      regionId: "fallowmarch",
      surface: footstepSurfaceAt("fallowmarch", [-160, 0, -118], ground("dirt")),
    })).toBe("movement.footstep_dirt");
    expect(cueForMovement({
      regionId: "fallowmarch",
      surface: footstepSurfaceAt("fallowmarch", [-160, 0, -80], ground("dirt")),
    })).toBe("movement.footstep_stone");
    expect(cueForMovement({
      regionId: "vellenwood",
      surface: footstepSurfaceAt("vellenwood", [60, 0, 120], ground("grass")),
    })).toBe("movement.footstep_wood");
    expect(cueForMovement({
      regionId: "vellenwood",
      surface: footstepSurfaceAt("vellenwood", [20, 0, 120], ground("grass")),
    })).toBe("movement.footstep_forest");
    expect(cueForMovement({
      regionId: "karrowmoor",
      surface: footstepSurfaceAt("karrowmoor", [140, 0, -60], ground("grass")),
    })).toBe("movement.footstep_stone");
    expect(cueForMovement({
      regionId: "karrowmoor",
      surface: footstepSurfaceAt("karrowmoor", [230, 0, 80], ground("grass")),
    })).toBe("movement.footstep_grass");
    expect(cueForMovement({
      regionId: "gravelmaw",
      surface: footstepSurfaceAt("gravelmaw", [170, 12, 20], ground("grass")),
    })).toBe("movement.footstep_cave");
  });

  it("keeps footsteps level-matched from measured file loudness and dirt free of the sharp source", () => {
    // Values come from runs/corealm-rebuild/checks/audio-file-review.ts: each surface's variants are
    // matched on active RMS to a -35 dBFS family target, then capped so no as-played peak passes
    // -13.5 dBFS. Grass and forest need a gain above 1 to reach that target, which is the reason
    // AudioEngine's per-voice ceiling is no longer unity.
    const grass = COREALM_AUDIO_CATALOG.cues["movement.footstep_grass"];
    const dirt = COREALM_AUDIO_CATALOG.cues["movement.footstep_dirt"];
    const stone = COREALM_AUDIO_CATALOG.cues["movement.footstep_stone"];
    const wood = COREALM_AUDIO_CATALOG.cues["movement.footstep_wood"];
    const forest = COREALM_AUDIO_CATALOG.cues["movement.footstep_forest"];

    expect(grass.gain).toBe(1.64);
    expect(forest.gain).toBe(1.26);
    expect(dirt).toMatchObject({ gain: 0.47, playbackRate: 0.82 });
    expect(stone.gain).toBe(0.66);
    expect(dirt.variants.map((variant) => typeof variant === "string" ? variant : variant.url))
      .toEqual([
        "/audio/sfx/oga/footstep-ground-01.ogg",
        "/audio/sfx/oga/footstep-ground-02.ogg",
      ]);
    expect(dirt.variants[1]).toMatchObject({ url: "/audio/sfx/oga/footstep-ground-02.ogg", gain: 0.57 });
    // The second wood step is 7.5 dB hotter than the first in the file; the variant gain closes that.
    expect(wood.variants[1]).toMatchObject({ url: "/audio/sfx/nox/footstep-wood-02.ogg", gain: 0.42 });
    // The sharp stone heel click has a 27 dB crest. RMS matching alone would put its peak 8 dB over
    // the soft turf step, so the peak cap pulls it down instead.
    expect(stone.variants[0]).toMatchObject({ url: "/audio/sfx/nox/footstep-stone-01.ogg", gain: 0.59 });
  });

  it("keeps every non-footstep cue at or under unity gain", () => {
    // The raised ceiling exists for one measured reason. Anything else drifting over unity is a
    // level decision that never went through the file review, and should show up here first.
    const over: string[] = [];
    for (const [cue, definition] of Object.entries(COREALM_AUDIO_CATALOG.cues)) {
      if (cue.startsWith("movement.footstep_")) continue;
      if ((definition.gain ?? 1) > 1) over.push(`${cue} ${definition.gain}`);
      for (const variant of definition.variants as readonly (string | AudioVariant)[]) {
        if (typeof variant !== "string" && (variant.gain ?? 1) > 1) over.push(`${cue} ${variant.url} ${variant.gain}`);
      }
    }
    expect(over).toEqual([]);
  });

  it("trims contact pre-roll only where the recording has it, never on an animal voice", () => {
    const offsets: Array<[string, number]> = [];
    for (const [cue, definition] of Object.entries(COREALM_AUDIO_CATALOG.cues)) {
      for (const variant of definition.variants as readonly (string | AudioVariant)[]) {
        if (typeof variant !== "string" && variant.startOffsetS) offsets.push([cue, variant.startOffsetS]);
      }
    }
    expect(offsets.length).toBeGreaterThan(20);
    for (const [cue, offset] of offsets) {
      expect(cue).not.toMatch(/^creature\./);
      expect(offset).toBeGreaterThan(0.03);
      expect(offset).toBeLessThan(0.25);
    }
    const playerHit = COREALM_AUDIO_CATALOG.cues["combat.player_hit"].variants[0];
    expect(playerHit).toMatchObject({ startOffsetS: 0.139 });
  });
});

/**
 * An animal being hit should sound like a weapon landing on it, and nothing else.
 *
 * There were two shared cues for this - `creature.beast_hurt` layered under the weapon and
 * `creature.beast_death` under the kill - and both are gone. The recordings behind them came out of
 * a generic creature pack picked by filename rather than by ear, so what actually played under a cow
 * being hit was a bird call. One shared cue across sixteen families was always going to be wrong for
 * most of them, and the combat layer already carries the event.
 */
describe("creature voices", () => {
  it("gives a family an idle voice and nothing else", () => {
    expect(cueForCreature("cattle")).toBe("creature.cow_low");
    expect(cueForCreature("bear")).toBe("creature.bear_roar");
    // Aliases and casing resolve the same way they always did.
    expect(cueForCreature("HEN")).toBe(cueForCreature("hen"));
  });

  it("has no cue at all for being hit or dying", () => {
    // Stated against the frozen id list rather than against the map, so re-adding a per-creature
    // hurt sound has to come back through this test.
    for (const cue of AUDIO_CUE_IDS) {
      expect(cue).not.toMatch(/^creature\.(beast_)?(hurt|death|die)/);
    }
  });

  it("names every voiceless family, and every one of them against actual content", () => {
    expect(cueForCreature(null)).toBeNull();
    expect(isCreatureFamily("bear")).toBe(true);

    // Counted against `content/enemies.ts`, not against a hand-written list, because the director's
    // own comment drifted: it called the silent set "the two humanoid families" while the roster
    // grew to sixty-nine, and one of the two it named is the Quarry Warden.
    const families = [...new Set(ENEMIES.map((enemy) => enemy.family))].sort();
    const voiced = families.filter((family) => isCreatureFamily(family));
    expect(voiced).toEqual([
      "aurochs", "bear", "boar", "cattle", "coney", "coyote", "crab", "deer",
      "frog", "goat", "hen", "hog", "ibex", "rat", "scorpion", "viper",
    ]);
    // Named, not counted. This assertion used to be `families.length - voiced.length === 83`, and
    // the Deep Wilderness expansion moved it to 100 without recording which families arrived or
    // whether anyone had listened to them. The seventeen additions are the six dragons
    // (baby_red/black/lava_dragon, red/black/purple_wilderness_dragon), the six deep bodies
    // (cinderback_crag, furnace_grazer, basalt_maw, rift_carapace, voidstone_colossus,
    // gloam_wraith) and the five rune keepers (ashseal_warden, furnace_regent, chainbound_archon,
    // nightforge_marshal, hollow_star). All seventeen stay silent on purpose: every bank the
    // catalogue ships is a field recording of a real animal — hen, frog, goat, cow, rodent,
    // serpent, stag, boar, coyote, bear, chitin — and none of those is a lava construct, a void
    // apparition or a dragon. Pointing a dragon at `creature.bear_roar` would be the same mistake
    // that once put a bird call under a cow being hit. It is a listening judgement, and it needs a
    // recording rather than a reassignment. Naming the set instead of counting it means the next
    // family to land has to be classified here rather than absorbed into a number.
    const voiceless = families.filter((family) => !isCreatureFamily(family));
    // Crownward and fairy reskins have no reviewed voice recordings. The existing
    // amethyst dragon also remains silent rather than borrowing an animal recording.
    expect(voiceless).toEqual([
      "amethyst_dragon", "amethyst_sovereign", "amethyst_spider", "antler_beetle", "ashscale_monitor",
      "ashseal_warden", "baby_black_dragon", "baby_lava_dragon", "baby_red_dragon", "banshee",
      "basalt_drake", "basalt_maw", "beetle_golem", "black_wilderness_dragon", "blackwater_heron",
      "blind_cave_weaver", "bloomheart_matriarch", "bracken_tapir", "briar_harrow", "briar_spider",
      "cairn_bighorn", "cairn_treader", "chainbound_archon", "chalk_warden", "cinder_penitent",
      "cinder_ravager", "cinderback_crag", "cindercrest_salamander", "cinderwake", "creek_crab",
      "crown_hart", "dewglass_weaver", "duskoak_lynx", "fen_crawler", "field_wasp",
      "fire_golem", "flint_mandible", "furnace_grazer", "furnace_regent", "galeskin",
      "gloam_fox", "gloam_wraith", "goblin_archer", "goblin_scout", "goblin_shaman",
      "gorge_mantis", "granary_rat", "grass_viper", "grave_ghoul", "grave_lantern",
      "heath_jack", "heath_wasp", "hollow_bough", "hollow_star", "hollowroot_spider",
      "iron_golem", "ivory_castellan", "kiln_marrow", "kiln_salamander", "lantern_sprite",
      "lava_golem", "marchfield_turkey", "marchwild_horse", "marsh_moose", "marsh_wasp",
      "moonpetal_stalker", "moonweave_spider", "mossback_sentinel", "mossbound", "nightforge_marshal",
      "orchid_reaper", "pallid_shade", "pearl_knight", "plague_zombie", "prismatic_sprite",
      "purple_wilderness_dragon", "quarry_nightmare", "quarry_snail", "quarrykeeper", "quillback_porcupine",
      "reaver", "red_wilderness_dragon", "redbrush_fox", "reed_strider", "reed_wasp",
      "reedbank_goose", "reedjaw_crocodile", "revenant", "rift_carapace", "rimeback_tortoise",
      "rootdelve_badger", "rootheart", "scree_bustard", "scree_watcher", "shale_elemental",
      "silverthorn_harrow", "skeleton_archer", "skeleton_mage", "skeleton_soldier", "slag_centipede",
      "slag_crawler", "slateback_tortoise", "starroot_guardian", "stone_golem", "tempest_roc",
      "thorn_maw", "tideworn", "vault_custodian", "veil_reaper", "voidstone_colossus",
      "webweaver_spider", "wraith", "zombie",
    ]);
    for (const family of voiceless) expect(cueForCreature(family)).toBeNull();

    // Every family that does have a voice resolves to a cue the catalogue actually ships.
    for (const family of voiced) {
      const cue = cueForCreature(family)!;
      expect(COREALM_AUDIO_CATALOG.cues[cue]?.variants.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("still sounds a landed blow and a kill through the combat cues", () => {
    const killing = cuesForCombatHit({
      attacker: "player", kind: "melee", hit: true, killed: true, damage: 9,
    });
    expect(killing).toContain("combat.melee_hit");
    expect(killing).toContain("combat.enemy_death");
    expect(killing.every((cue) => !cue.startsWith("creature."))).toBe(true);
  });
});
