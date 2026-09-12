import type { AudioCueId } from "../contracts.js";
import type { AudioCueDefinition } from "./catalog.js";
import { defineAudioCatalog } from "./catalog.js";

const publicBase = import.meta.env?.BASE_URL ?? "/";
const publicAsset = (pathname: string): string => `${publicBase.replace(/\/?$/, "/")}${pathname.replace(/^\/+/, "")}`;
const noxSfx = (name: string): string => publicAsset(`audio/sfx/nox/${name}.ogg`);
const noxAmbience = (name: string): string => publicAsset(`audio/ambience/nox/${name}.ogg`);
const tom = (name: string): string => publicAsset(`audio/sfx/tommusic/${name}.ogg`);
const cow1 = (name: string): string => publicAsset(`audio/sfx/filmcow-v1/${name}.ogg`);
const cow4 = (name: string): string => publicAsset(`audio/sfx/filmcow-v4/${name}.ogg`);
const oga = (name: string): string => publicAsset(`audio/sfx/oga/${name}.ogg`);
const custom = (name: string): string => publicAsset(`audio/sfx/custom/${name}.ogg`);
const music = (name: string): string => publicAsset(`audio/music/${name}.mp3`);
/**
 * Animal voices, all Ogg Vorbis like every other SFX directory.
 *
 * Four frog croaks arrived as mp3 and the two real cow moos as wav; both were transcoded at
 * `-q:a 5` by `tools/animals/stage-audio.py`'s companion step, because `tests/audioCatalog.test.ts`
 * asserts every sfx URL ends in `.ogg` and that convention is worth more than saving one re-encode
 * of an already-lossy source.
 *
 * Routed through `publicAsset` like the rest: the game is served under a base path on Pages, and a
 * hard-coded leading slash would 404 every animal call there.
 */
const animal = (name: string): string => publicAsset(`audio/sfx/animals/${name}.ogg`);

/**
 * Every semantic cue has an explicit grounded-fantasy source. The curation ledgers under `docs/`
 * explain why these files were accepted and which modern, comic, firearm, and electronic sounds
 * were rejected. Variants are intentionally small so the browser decodes only useful material.
 *
 * Gains are measured, not guessed. `runs/corealm-rebuild/checks/audio-file-review.ts` decodes every
 * variant and reports its active RMS; each variant gain here brings a cue's files to the level of
 * its quietest variant, and the cue gain then places that common level at the family target below
 * (dBFS before the bus, active RMS as played). Before this pass the three `combat.melee_hit`
 * variants spanned 18 dB and the frog croaks sat 15 dB under the ambience bed.
 *
 *   footsteps -35, peaks capped at -13.5 · swings/misses -36/-32 · gather and melee impacts -25 · big breaks -22
 *   boss slam -20 · player hurt -24 · UI -36 (error -32, level-up -22) · interactions -27..-38
 *   animal voices -24 (bear) .. -31 (coney), then `CREATURE_CALL_GAIN` and distance falloff.
 *
 * `startOffsetS` skips a recording's pre-roll so its transient lands on the frame that asked for
 * it. The body-impact thuds carried 128-139 ms of room tone; the second sword whoosh 118 ms.
 *
 * Footsteps are the exception to pure RMS matching, and the reason the engine's per-voice gain
 * ceiling moved off 1. Measured in a recorded default-volume session (`audio-actions-browser.ts
 * --case mix`): a running player's own steps cleared the ambience bed's true peak by 3.0 dB, while
 * a UI click cleared it by 10.3 and a sword blow by 13.3. The family had been anchored at -39 dBFS
 * because `footstep-grass-01.ogg` decodes at -39.3 and its cue gain was already at the old ceiling.
 * The family now targets -35 dBFS active RMS with a -13.5 dBFS as-played peak cap, so the six
 * surfaces keep matched bodies without the sharp stone click poking 8 dB over the soft turf one.
 */
const cues = {
  "ui.click": { variants: [{ url: cow1("ui-button-press-01"), startOffsetS: 0.038 }], gain: 0.34, minIntervalMs: 70, maxConcurrent: 2 },
  "ui.confirm": { variants: [tom("lock-unlock")], gain: 0.46, playbackRate: [1.02, 1.08] },
  "ui.cancel": { variants: [{ url: cow1("door-latch-01"), startOffsetS: 0.108 }], gain: 0.2, playbackRate: 0.9 },
  "ui.error": { variants: [{ url: cow4("shield-metal-strike-01"), startOffsetS: 0.038 }], gain: 0.08, playbackRate: 0.82 },
  "ui.level_up": {
    variants: [custom("starter-plains-drums")],
    gain: 0.4,
    playbackRate: 1,
    minIntervalMs: 180,
    maxConcurrent: 1,
  },

  "movement.footstep_grass": { variants: [noxSfx("footstep-grass-01"), { url: noxSfx("footstep-grass-02"), gain: 0.93 }], gain: 1.64, playbackRate: [0.96, 1.04], maxConcurrent: 2 },
  "movement.footstep_dirt": { variants: [{ url: oga("footstep-ground-01"), startOffsetS: 0.081 }, { url: oga("footstep-ground-02"), gain: 0.57, startOffsetS: 0.076 }], gain: 0.47, playbackRate: 0.82, maxConcurrent: 2 },
  "movement.footstep_forest": { variants: [{ url: noxSfx("footstep-forest-01"), gain: 0.74 }, noxSfx("footstep-forest-02")], gain: 1.26, playbackRate: [0.96, 1.04], maxConcurrent: 2 },
  "movement.footstep_stone": { variants: [{ url: noxSfx("footstep-stone-01"), gain: 0.59, startOffsetS: 0.032 }, noxSfx("footstep-stone-02")], gain: 0.66, playbackRate: [0.96, 1.04], maxConcurrent: 2 },
  "movement.footstep_wood": { variants: [noxSfx("footstep-wood-01"), { url: noxSfx("footstep-wood-02"), gain: 0.42 }], gain: 0.92, playbackRate: [0.96, 1.04], maxConcurrent: 2 },
  "movement.footstep_cave": { variants: [{ url: noxSfx("footstep-cave-01"), gain: 0.64 }, noxSfx("footstep-cave-02")], gain: 1.05, playbackRate: [0.95, 1.03], maxConcurrent: 2 },

  "gather.mining_swing": { variants: [{ url: tom("sword-swing-01"), startOffsetS: 0.053 }, { url: tom("sword-swing-02"), startOffsetS: 0.118 }], gain: 0.35, playbackRate: [0.72, 0.8], minIntervalMs: 240 },
  "gather.mining_impact": { variants: [{ url: cow4("mining-rock-impact-01"), gain: 0.45, startOffsetS: 0.039 }, { url: cow4("mining-rock-impact-02"), gain: 0.52, startOffsetS: 0.061 }, oga("mining-impact-stone-01")], gain: 0.54, playbackRate: [0.94, 1.04], minIntervalMs: 240 },
  "gather.rock_break": { variants: [oga("rock-break")], gain: 0.4, maxConcurrent: 1 },
  "gather.wood_swing": { variants: [{ url: tom("sword-swing-01"), startOffsetS: 0.053 }, { url: tom("sword-swing-02"), startOffsetS: 0.118 }], gain: 0.35, playbackRate: [0.84, 0.92], minIntervalMs: 240 },
  "gather.wood_impact": { variants: [{ url: cow4("wood-chop-impact-01"), gain: 0.84 }, { url: cow4("wood-chop-impact-02"), gain: 0.75, startOffsetS: 0.053 }, cow1("wood-hit-light-01")], gain: 0.43, playbackRate: [0.94, 1.04], minIntervalMs: 240 },
  // tree-chop-fall decodes 15 dB over full scale with a 24 dB crest; at its old gain it clipped the bus.
  "gather.tree_fall": { variants: [{ url: oga("tree-chop-fall"), gain: 0.24, startOffsetS: 0.044 }, { url: cow4("tree-wood-break-01"), startOffsetS: 0.1 }], gain: 0.66, maxConcurrent: 1 },
  "gather.fishing_cast": { variants: [{ url: cow1("fishing-splash-small-01"), startOffsetS: 0.169 }], gain: 0.46, maxConcurrent: 1 },
  "gather.fishing_reel": { variants: [tom("fishing-splash-01"), { url: tom("fishing-splash-02"), gain: 0.76 }], gain: 0.59, playbackRate: [0.96, 1.04], minIntervalMs: 240 },
  "gather.fishing_catch": { variants: [{ url: cow1("fishing-fish-flop-01"), startOffsetS: 0.07 }], gain: 0.28, maxConcurrent: 1 },

  "production.smith": { variants: [{ url: oga("smithing-anvil"), gain: 0.86 }, { url: oga("smithing-metal-hit-01"), gain: 0.62 }, oga("smithing-metal-hit-02")], gain: 0.32, playbackRate: [0.96, 1.03], minIntervalMs: 220 },
  "production.smelt": { variants: [oga("metal-sheet"), { url: oga("smithing-metal-hit-01"), gain: 0.67 }], gain: 0.3, playbackRate: [0.9, 0.98], minIntervalMs: 320 },
  "production.craft": { variants: [{ url: oga("building-hammer-01"), gain: 0.64 }, { url: oga("building-hammer-02"), gain: 0.9 }, oga("craft-hammer")], gain: 0.38, playbackRate: [0.96, 1.04], minIntervalMs: 220 },
  "production.cook": { variants: [noxSfx("campfire-crackle-01")], gain: 1, minIntervalMs: 320 },
  "production.fletch": { variants: [{ url: cow1("wood-hit-light-01"), gain: 0.59 }, { url: cow1("cloth-ruffle-01"), startOffsetS: 0.143 }], gain: 0.41, playbackRate: [1.02, 1.1], minIntervalMs: 220 },

  "combat.melee_swing": { variants: [{ url: tom("sword-swing-01"), startOffsetS: 0.053 }, { url: tom("sword-swing-02"), startOffsetS: 0.118 }], gain: 0.56, playbackRate: [0.96, 1.04], minIntervalMs: 180 },
  "combat.melee_hit": { variants: [tom("sword-impact-01"), { url: tom("sword-impact-02"), gain: 0.64 }, { url: cow4("armour-hit-01"), gain: 0.12, startOffsetS: 0.044 }], gain: 1, playbackRate: [0.95, 1.04], minIntervalMs: 180 },
  "combat.melee_miss": { variants: [{ url: tom("sword-swing-01"), startOffsetS: 0.053 }, { url: tom("sword-swing-02"), startOffsetS: 0.118 }], gain: 0.35, playbackRate: [1.08, 1.16], minIntervalMs: 180 },
  // Cast and hit gains feed `spellSound.ts`, whose per-play multipliers reach 1.452; 0.58 x 1.452 stays under the clamp.
  "combat.magic_cast": { variants: [{ url: tom("magic-ember-cast-01"), gain: 0.85 }, tom("magic-ember-cast-02"), { url: tom("magic-stone-cast-01"), gain: 0.98 }, { url: tom("magic-stone-cast-02"), gain: 0.89 }], gain: 0.58, playbackRate: [0.97, 1.04], minIntervalMs: 180 },
  "combat.magic_hit": { variants: [tom("magic-impact-01"), { url: tom("magic-impact-02"), gain: 0.89 }], gain: 0.58, playbackRate: [0.96, 1.05], minIntervalMs: 180 },
  "combat.special": { variants: [{ url: cow4("boss-ground-impact-01"), startOffsetS: 0.068 }], gain: 0.49, maxConcurrent: 1 },
  "combat.player_hit": { variants: [{ url: cow4("damage-body-impact-01"), startOffsetS: 0.139 }, { url: cow4("damage-body-impact-02"), gain: 0.92, startOffsetS: 0.128 }, { url: cow4("armour-hit-01"), gain: 0.52, startOffsetS: 0.044 }], gain: 0.29, playbackRate: [0.94, 1.03], minIntervalMs: 160 },
  "combat.enemy_death": { variants: [{ url: cow4("melee-body-impact-01"), startOffsetS: 0.083 }, { url: cow4("damage-body-impact-02"), gain: 0.8, startOffsetS: 0.128 }], gain: 0.29, playbackRate: [0.82, 0.92], maxConcurrent: 2 },
  "combat.player_death": { variants: [{ url: cow4("damage-body-impact-01"), startOffsetS: 0.139 }], gain: 0.36, playbackRate: 0.72, maxConcurrent: 1 },

  "interaction.door_open": { variants: [{ url: tom("door-open-01"), gain: 0.95, startOffsetS: 0.032 }, { url: tom("door-open-02"), startOffsetS: 0.214 }, { url: cow1("door-open-wood-01"), gain: 0.44, startOffsetS: 0.032 }], gain: 0.87, playbackRate: [0.97, 1.03], maxConcurrent: 1 },
  "interaction.portal": { variants: [tom("magic-stone-cast-01"), { url: tom("magic-stone-cast-02"), gain: 0.91 }], gain: 0.47, playbackRate: [0.78, 0.86], maxConcurrent: 1 },
  "interaction.climb": { variants: [cow1("cloth-movement-01")], gain: 0.51, playbackRate: 0.94, maxConcurrent: 1 },
  "interaction.vault": { variants: [{ url: cow1("cloth-ruffle-01"), startOffsetS: 0.143 }], gain: 0.29, playbackRate: 1.08, maxConcurrent: 1 },
  "interaction.loot": { variants: [{ url: cow1("loot-rocks-handle-01"), startOffsetS: 0.041 }, { url: cow1("loot-metal-drop-01"), gain: 0.46 }], gain: 0.49, playbackRate: [0.97, 1.04], maxConcurrent: 1 },
  "interaction.equip": { variants: [{ url: tom("weapon-unsheathe-01"), gain: 0.49, startOffsetS: 0.046 }, { url: tom("weapon-sheathe-01"), gain: 0.79, startOffsetS: 0.059 }, cow1("cloth-movement-01")], gain: 0.72, playbackRate: [0.98, 1.04], maxConcurrent: 1 },
  "interaction.consume": { variants: [oga("apple-bite")], gain: 0.57, playbackRate: [0.96, 1.04], maxConcurrent: 1 },
  "interaction.bank": { variants: [{ url: cow1("chest-open-wood-01"), gain: 0.76, startOffsetS: 0.047 }, { url: tom("chest-open-01"), gain: 0.77, startOffsetS: 0.102 }, { url: tom("chest-open-02"), startOffsetS: 0.034 }], gain: 0.69, playbackRate: [0.97, 1.03], maxConcurrent: 1 },
  "interaction.trade": { variants: [{ url: cow1("loot-metal-drop-01"), gain: 0.22 }, { url: cow1("parchment-handle-01"), startOffsetS: 0.131 }], gain: 0.82, playbackRate: [1.0, 1.06], maxConcurrent: 1 },
  "interaction.dialogue_open": { variants: [{ url: cow1("parchment-handle-01"), startOffsetS: 0.131 }], gain: 0.33, playbackRate: 1.05, maxConcurrent: 1 },
  "interaction.dialogue_close": { variants: [{ url: cow1("parchment-handle-01"), startOffsetS: 0.131 }], gain: 0.33, playbackRate: 0.92, maxConcurrent: 1 },
  "interaction.activity_stop": { variants: [{ url: cow1("cloth-ruffle-01"), startOffsetS: 0.143 }], gain: 0.16, playbackRate: 0.88, minIntervalMs: 180 },

  // Animal voices. Sources and CC0 evidence are in docs/audio-source-animals.md.
  //
  // Every one carries a long `minIntervalMs` and a low `maxConcurrent` on purpose: a nine-strong
  // shoal or a seven-strong flock would otherwise all call on the same frame the player walks into
  // aggro range, and thirteen simultaneous voices is a wall of noise rather than a place with
  // animals in it. The rate ranges pull individuals apart in pitch so a flock does not sound like
  // one bird played seven times.
  //
  // The variant gains matter more here than anywhere else: the packs these came from were never
  // level-matched, so before measurement the third boar grunt was 10 dB over the other two and the
  // second serpent breath 14 dB over the first. The cue gains now carry the intended balance, a bear
  // at -24 against a coney at -31, instead of whatever the recordist's meter happened to read.
  "creature.hen_cluck": { variants: [animal("hen-cluck-01"), { url: animal("hen-cluck-02"), gain: 0.93 }], gain: 0.3, playbackRate: [1.06, 1.18], minIntervalMs: 900, maxConcurrent: 2 },
  // The four frog files shipped 15-23 dB quieter than every other animal (peaks near -35 dBFS) and
  // were inaudible under the plains wind. They were re-encoded with a level boost; see the ledger.
  "creature.frog_croak": { variants: [animal("frog-croak-01"), animal("frog-croak-02"), animal("frog-croak-03"), animal("frog-ribbit-01")], gain: 0.79, playbackRate: [0.94, 1.08], minIntervalMs: 700, maxConcurrent: 3 },
  "creature.goat_bleat": { variants: [animal("goat-bleat-01")], gain: 0.65, playbackRate: [0.92, 1.06], minIntervalMs: 1100, maxConcurrent: 2 },
  // The cow clips are the two real moos in an otherwise sci-fi CC0 pack. Slowed slightly, because
  // an aurochs is the same voice one size down in pitch.
  "creature.cow_low": { variants: [{ url: animal("cow-moo-01"), gain: 0.64 }, animal("cow-moo-02")], gain: 0.25, playbackRate: [0.86, 0.96], minIntervalMs: 1400, maxConcurrent: 2 },
  "creature.coney_squeak": { variants: [animal("rodent-squeak-01"), { url: animal("rodent-squeak-02"), gain: 0.51 }], gain: 0.53, playbackRate: [1.1, 1.25], minIntervalMs: 800, maxConcurrent: 2 },
  "creature.viper_hiss": { variants: [animal("serpent-hiss-01"), { url: animal("serpent-hiss-02"), gain: 0.2 }], gain: 0.74, playbackRate: [0.94, 1.05], minIntervalMs: 1000, maxConcurrent: 2 },
  "creature.stag_bell": { variants: [{ url: animal("stag-bellow-01"), gain: 0.72 }, animal("stag-bellow-02")], gain: 0.25, playbackRate: [0.9, 1.0], minIntervalMs: 1600, maxConcurrent: 1 },
  "creature.hog_grunt": { variants: [animal("boar-grunt-01"), { url: animal("boar-grunt-02"), gain: 0.84 }, { url: animal("boar-grunt-03"), gain: 0.31 }], gain: 0.33, playbackRate: [0.9, 1.04], minIntervalMs: 900, maxConcurrent: 2 },
  "creature.coyote_howl": { variants: [{ url: animal("coyote-howl-01"), gain: 0.79 }, animal("coyote-bark-01"), { url: animal("coyote-bark-02"), gain: 0.84 }], gain: 0.23, playbackRate: [0.98, 1.1], minIntervalMs: 1200, maxConcurrent: 2 },
  // The loudest voice in the game after the boss slam, and the only one that should carry across a
  // valley. Two real bear growls plus one pack roar for the aggro moment.
  "creature.bear_roar": { variants: [{ url: animal("bear-growl-01"), gain: 0.8 }, animal("bear-growl-02"), { url: animal("bear-roar-01"), gain: 0.75 }], gain: 0.46, playbackRate: [0.88, 0.98], minIntervalMs: 1600, maxConcurrent: 1 },
  "creature.chitin_click": { variants: [{ url: animal("chitin-click-01"), gain: 0.83 }, animal("chitin-click-02"), { url: animal("chitin-click-03"), gain: 0.79 }], gain: 0.28, playbackRate: [0.96, 1.12], minIntervalMs: 700, maxConcurrent: 3 },
} satisfies Record<AudioCueId, AudioCueDefinition>;

export const COREALM_AUDIO_CATALOG = defineAudioCatalog({
  cues,
  // Beds are level-matched the same way. The four music tracks measure -13 to -13.8 LUFS integrated,
  // which at the old 0.62 put them 8 dB above a landed sword blow; 0.22 places them near -27 LUFS
  // before the music bus. The ambience files span 13 dB (cave room tone -27 LUFS, upland wind -40),
  // so their gains land every bed close to -40 LUFS, with the enclosed cave a little forward.
  //
  // The four music beds carry lead-in and run-out silence from their masters, measured by the file
  // review: 0.12/0.87 s around `starter-plains`, 0.84/0.97 s around `deep-woodland`, 0.65/2.47 s
  // around `distant-plains`, 0.54/0.02 s around `stone-city`. Each repeat therefore has a one- to
  // three-second hole in it, roughly every two minutes.
  //
  // `loopStart`/`loopEnd` exist for exactly this and were tried here. Set to the measured silence
  // boundaries they made the seam worse, not better: 0.12 s into `starter-plains` is still inside
  // the fade-in, so the loop jumped from a full-level bar back to a near-silent one and the
  // measured seam went from 9.6 dB to 23.9 dB. A loop point that works has to fall on a musical
  // boundary as well as a level match, and picking one is a listening decision, not a measurement.
  // Left looping end to end until someone can hear the candidates; the gap is recorded in
  // runs/corealm-rebuild/SLICE-12-AUDIO.md as a human-listening item. The ambience beds measure
  // 0 ms of edge silence and need nothing.
  loops: {
    "music.starter-plains": { url: music("starter-plains"), bus: "music", gain: 0.22, fadeMs: 1800 },
    "music.distant-plains": { url: music("distant-plains"), bus: "music", gain: 0.22, fadeMs: 1800 },
    "music.deep-woodland": { url: music("deep-woodland"), bus: "music", gain: 0.22, fadeMs: 1800 },
    "music.stone-city": { url: music("stone-city"), bus: "music", gain: 0.22, fadeMs: 1800 },
    "ambient.open-plains": { url: noxAmbience("open-plains-wind"), bus: "ambient", gain: 1, fadeMs: 1400 },
    "ambient.deep-woodland": { url: noxAmbience("deep-woodland-birds"), bus: "ambient", gain: 0.5, fadeMs: 1400 },
    "ambient.rocky-highlands": { url: noxAmbience("rocky-highlands-wind"), bus: "ambient", gain: 1, fadeMs: 1400 },
    "ambient.cave": { url: noxAmbience("cave-room-tone"), bus: "ambient", gain: 0.3, fadeMs: 1400 },
  },
  regions: {
    fallowmarch: {
      music: ["music.starter-plains", "music.distant-plains"],
      ambient: "ambient.open-plains",
    },
    vellenwood: { music: "music.deep-woodland", ambient: "ambient.deep-woodland" },
    karrowmoor: { music: "music.stone-city", ambient: "ambient.rocky-highlands" },
    // The supplied music library names no ember-foothills theme, so Kilnhalt ships ambience only,
    // exactly like the Gravelmaw. Dry upland wind is the closest rights-traced ambience family.
    kilnhalt: { ambient: "ambient.rocky-highlands" },
    gravelmaw: { ambient: "ambient.cave" },
    crownward: { music: "music.stone-city", ambient: "ambient.open-plains" },
    gloamgarden: { music: "music.deep-woodland", ambient: "ambient.cave" },
    faeholme: { music: "music.deep-woodland", ambient: "ambient.cave" },
  },
});

export const FUTURE_REGION_MUSIC_FILES = [
  "desert.mp3", "jungle.mp3", "goblin-village.mp3", "mire-swamp.mp3", "swamp.mp3",
] as const;
