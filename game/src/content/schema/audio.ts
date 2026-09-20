/** Schemas for the shipped audio catalogue. */
import type { AudioBus, AudioCueId, RegionId } from "../../contracts.js";
import {
  arr, enumOf, id, int, num, obj, opt, rec, ref, refine, str, tuple, union,
} from "./core.js";

/** Keep the editor vocabulary aligned with the frozen runtime contract without importing it. */
export const audioCueIds = [
  "ui.click", "ui.confirm", "ui.cancel", "ui.error", "ui.level_up",
  "movement.footstep_grass", "movement.footstep_dirt", "movement.footstep_forest",
  "movement.footstep_stone", "movement.footstep_wood", "movement.footstep_cave",
  "gather.mining_swing", "gather.mining_impact", "gather.rock_break",
  "gather.wood_swing", "gather.wood_impact", "gather.tree_fall",
  "gather.fishing_cast", "gather.fishing_reel", "gather.fishing_catch",
  "production.smith", "production.smelt", "production.craft",
  "production.cook", "production.fletch",
  "combat.melee_swing", "combat.melee_hit", "combat.melee_miss",
  "combat.magic_cast", "combat.magic_hit", "combat.special",
  "combat.player_hit", "combat.enemy_death", "combat.player_death",
  "interaction.door_open", "interaction.portal", "interaction.climb",
  "interaction.vault", "interaction.loot", "interaction.loot_item", "interaction.loot_coins",
  "interaction.equip", "interaction.consume",
  "interaction.bank", "interaction.trade", "interaction.dialogue_open",
  "interaction.dialogue_close", "interaction.activity_stop",
  "creature.hen_cluck", "creature.frog_croak", "creature.goat_bleat", "creature.cow_low",
  "creature.coney_squeak", "creature.viper_hiss", "creature.stag_bell", "creature.hog_grunt",
  "creature.coyote_howl", "creature.bear_roar", "creature.chitin_click",
] as const satisfies readonly AudioCueId[];

export const audioBusIds = ["music", "ambient", "sfx"] as const satisfies readonly AudioBus[];

export const audioRegionIds = [
  "fallowmarch", "vellenwood", "karrowmoor", "kilnhalt", "wilderness", "gravelmaw",
  "crownward", "gloamgarden", "faeholme",
] as const satisfies readonly RegionId[];

/** Relative path stored in JSON; the loader adds Vite's public base at runtime. */
export const audioUrlSchema = str({
  nonEmpty: true,
  pattern: /^audio\/(?:sfx|music|ambience)\/[a-z0-9][a-z0-9\/_-]*\.(?:ogg|mp3)$/,
}, { ref: "asset", label: "Audio file", role: "Audio file for" });

const gain = num({ min: 0 }, { label: "Gain" });
const playbackRate = union([
  num({ exclusiveMin: 0 }, { label: "Playback rate" }),
  refine(
    tuple([num({ exclusiveMin: 0 }), num({ exclusiveMin: 0 })] as const),
    ([min, max]) => min <= max,
    "minimum playback rate must be <= maximum",
  ),
] as const);

export const audioVariantSchema = union([
  audioUrlSchema,
  obj({
    url: audioUrlSchema,
    gain: opt(gain),
    startOffsetS: opt(num({ min: 0 }, { unit: "s", label: "Start offset" })),
  }),
] as const);

export const audioCueSchema = obj({
  variants: arr(audioVariantSchema, { minLength: 1 }, { label: "Variants", role: "Audio file for" }),
  gain: opt(gain),
  maxConcurrent: opt(int({ min: 1 }, { label: "Max concurrent voices" })),
  minIntervalMs: opt(int({ min: 0 }, { unit: "ms", label: "Minimum interval" })),
  playbackRate: opt(playbackRate),
});

export const audioLoopSchema = obj({
  url: audioUrlSchema,
  bus: enumOf(audioBusIds, { label: "Bus" }),
  gain: opt(gain),
  fadeMs: opt(int({ min: 0 }, { unit: "ms", label: "Fade" })),
  loopStart: opt(num({ min: 0 }, { unit: "s", label: "Loop start" })),
  loopEnd: opt(num({ min: 0 }, { unit: "s", label: "Loop end" })),
});

export const musicAreaSchema = obj({
  id: id({ label: "Area id" }),
  music: ref("audio", { label: "Music loop", role: "Plays in" }),
  centre: tuple([num(), num()] as const, { unit: "m", label: "Centre" }),
  radius: num({ exclusiveMin: 0 }, { unit: "m", label: "Radius" }),
  exitPadding: opt(num({ min: 0 }, { unit: "m", label: "Exit padding" })),
});

export const regionAudioSchema = obj({
  music: opt(union([
    ref("audio", { label: "Music loop", role: "Plays in" }),
    arr(ref("audio", { label: "Music loop", role: "Plays in" }), {}, { label: "Music loop pool", role: "Plays in" }),
  ] as const, { label: "Music", role: "Plays in" })),
  ambient: opt(union([
    ref("audio", { label: "Ambient loop", role: "Ambience of" }),
    arr(ref("audio", { label: "Ambient loop", role: "Ambience of" }), {}, { label: "Ambient loop pool", role: "Ambience of" }),
  ] as const, { label: "Ambient", role: "Ambience of" })),
  musicAreas: opt(arr(musicAreaSchema, {}, { label: "Music areas", role: "Plays in" })),
});

export const audioCatalogSchema = obj({
  cues: rec(audioCueSchema, enumOf(audioCueIds, { ref: "audio" }), { label: "Cues" }),
  loops: rec(audioLoopSchema, str({ nonEmpty: true }, { ref: "audio" }), { label: "Loops" }),
  regions: rec(regionAudioSchema, enumOf(audioRegionIds, { ref: "region" }), { label: "Regions" }),
});
