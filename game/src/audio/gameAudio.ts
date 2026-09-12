import type {
  AudioCueId, GameEvent, InteractionId, RegionId, Result, SemanticEntity, Vec3,
} from "../contracts.js";
import type { TickSystem } from "../app/loop.js";
import type { Store } from "../state/store.js";
import type { CombatHit } from "../systems/combat.js";
import { sameCombatRealm } from "../systems/combat.js";
import { content } from "../content/index.js";
import {
  cueForActivity, cueForCreature, cueForMovement,
  type ActivityAudioObservation, type AudioDirector, type FootstepSurface,
} from "./director.js";
import type { AudioEngine, PlayCueOptions } from "./engine.js";
import { spellCastSound, spellImpactSound } from "./spellSound.js";
import type { SpellElement, SpellRung } from "../contracts.js";

interface CorealmAudioBridgeDeps {
  listenerForward?: () => Vec3;
  store: Store;
  engine: AudioEngine;
  director: AudioDirector;
  entity: (entityId: string) => SemanticEntity | undefined;
  surfaceAt: (position: Vec3, regionId: RegionId) => FootstepSurface;
  /**
   * Nearest living animal within `radius`, for idle voices. Optional so the bridge still runs in
   * tests and headless harnesses that never build a world.
   */
  nearestCreature?: (position: Vec3, radius: number)
    => { entityId: string; family: string; distance: number } | undefined;
}

/** How far an animal's idle voice carries. Past this the field is silent. */
const CREATURE_CALL_RADIUS_M = 34;
/** Gap between idle calls, plus up to the jitter so a herd does not sound metronomic. */
const CREATURE_CALL_BASE_MS = 4200;
const CREATURE_CALL_JITTER_MS = 3600;
/** Re-check cadence when nothing is in range. Short, so walking into a field is answered quickly. */
const CREATURE_CALL_IDLE_MS = 1200;
/**
 * Master trim on animal idle voices, on top of each cue's own gain in `corealmCatalog.ts`.
 *
 * One number rather than sixteen edits, because the per-cue gains carry the balance between the
 * animals. That balance used to be nominal only: the source packs were never level-matched, so a
 * cow at cue gain 0.36 played 19 dB over a coney at 0.24, and the whole layer was trimmed to 0.45
 * to tame the loud ones. The catalogue now measures each variant, so the trim can sit at 0.7: a
 * bear beside the player lands near -27 dBFS before the bus and fades under the footsteps by 20 m.
 */
const CREATURE_CALL_GAIN = 0.7;

/** Stable 0..1 from an entity id, so per-animal call timing is deterministic across runs. */
function hashToUnit(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 8) / 0x00ffffff;
}

/** Adapts Corealm's semantic state and events to the browser audio runtime. */
export class CorealmAudioBridge implements TickSystem {
  readonly name = "audio";
  readonly order = 500;

  private activityKey: string | null = null;
  private nextCreatureCallMs = 0;
  private activityDeadline: number | null = null;
  private readonly suppressedStarts = new Map<AudioCueId, number>();
  private lastRegion: RegionId | null = null;

  constructor(private readonly deps: CorealmAudioBridgeDeps) {}

  tick(_deltaMs: number, atMs: number): void {
    const state = this.deps.store.get();
    const player = state.player;
    if (this.lastRegion !== null && this.lastRegion !== player.regionId) {
      this.deps.engine.resetOneShots();
      this.nextCreatureCallMs = atMs;
      this.suppressedStarts.clear();
      this.activityKey = null;
      this.activityDeadline = null;
    }
    this.lastRegion = player.regionId;
    this.deps.engine.setListenerPose(player.position as Vec3, this.deps.listenerForward?.());
    this.deps.director.setRegion(player.regionId, player.position);
    if (player.health > 0) this.tickCreatureAmbience(player.position as Vec3, atMs);

    const activity = state.activity;
    const key = activityIdentity(activity);
    if (!activity || !key) {
      this.activityKey = null;
      this.activityDeadline = null;
      return;
    }

    const deadline = activityDeadline(activity);
    if (key !== this.activityKey) {
      this.activityKey = key;
      this.activityDeadline = deadline;
      return;
    }
    if (deadline === null || this.activityDeadline === null || deadline === this.activityDeadline) return;

    this.activityDeadline = deadline;
  }

  handleEvent(event: GameEvent): void {
    const data = event.data;
    switch (event.type) {
      case "spell.launched": {
        // The CAST voice fires here, at the launch, and nowhere else.
        //
        // It used to ride the rig's swing marker. Then spell damage moved to projectile arrival, so
        // a magic hit reaches `handlePlayerCombatMotion` already on time and is presented in one
        // phase — which played the cast and the impact stacked on the same frame, a second after
        // the caster actually threw it. The launch event is the only thing that happens at the
        // moment of casting, so it is what the cast sound hangs off.
        const element = data["element"] as SpellElement | undefined;
        const rung = data["rung"] as SpellRung | undefined;
        this.play("combat.magic_cast", element && rung ? spellCastSound(element, rung) : undefined);
        break;
      }
      case "activity.started": {
        const kind = stringField(data, "kind");
        const skill = stringField(data, "skill");
        let operation = stringField(data, "op") || stringField(data, "via");
        if (kind === "traversing" && operation !== "portal" && operation !== "shortcut") {
          const obstacle = event.entityId ? this.deps.entity(event.entityId) : undefined;
          operation = obstacle?.interactions.includes("vault") ? "vault" : "climb";
        }
        // Mining and woodcutting start, swing, and impact cues come from measured rig markers.
        // Fishing has no matching body contact clip, so it stays event-driven.
        if (kind === "gathering" && (skill === "mining" || skill === "woodcutting")) return;
        this.emitActivity({ kind, skill, op: operation, phase: "started" }, true);
        return;
      }
      case "activity.stopped": {
        const reason = stringField(data, "reason");
        if (reason !== "completed" && reason !== "depleted") {
          this.deps.director.observeActivity({ kind: stringField(data, "kind"), phase: "stopped" });
        }
        return;
      }
      case "production.completed": {
        const recipe = content.recipe(stringField(data, "recipeId"));
        if (!recipe) return;
        this.deps.director.observeActivity({
          kind: "production", skill: recipe.skill, op: recipe.kind, phase: "completed",
        });
        return;
      }
      case "campfire.built":
        // The existing Cooking cue is the authored campfire crackle. Replacements also emit a
        // built event, so one completion produces one crackle instead of stacking two sounds.
        this.play("production.cook");
        return;
      case "resource.depleted": {
        const entity = event.entityId ? this.deps.entity(event.entityId) : undefined;
        if (entity?.archetype === "ore") {
          this.deps.director.observeActivity({ kind: "gathering", skill: "mining", depleted: true, phase: "completed" });
        } else if (entity?.archetype === "tree") {
          this.deps.director.observeActivity({ kind: "gathering", skill: "woodcutting", depleted: true, phase: "completed" });
        }
        return;
      }
      case "item.received":
        if (stringField(data, "source") === "gather" && stringField(data, "skill") === "fishing") {
          this.deps.director.observeActivity({ kind: "gathering", skill: "fishing", phase: "completed" });
        }
        return;
      case "combat.started":
        if (stringField(data, "event") === "boss.slam") this.play("combat.special");
        return;
      case "player.died":
        // The one canonical death edge, and the reason a lethal blow does not sound twice.
        //
        // The killing hit reaches `handlePlayerCombatMotion` first, as "combined", and the
        // director's `cuesForCombatHit` selects `combat.player_hit` AND `combat.player_death` for
        // it. Events flush last in the frame, so by the time this runs those two are still awaiting
        // their buffers; `resetOneShots` bumps the generation and both are dropped before they
        // start. One death voice, measured on hardware in
        // `audio-actions-browser.ts --case death`. Reordering the flush, or removing this reset,
        // would double it.
        this.deps.engine.resetOneShots();
        this.nextCreatureCallMs = 0;
        this.play("combat.player_death");
        return;
      case "level.gained":
      case "inventory.full":
      case "quest.updated":
      case "dialogue.opened":
      case "dialogue.closed":
      case "item.equipped":
      case "item.unequipped":
        this.deps.director.observeGameEvent(event);
        return;
      default:
        return;
    }
  }

  /** Emits one footstep at the exact left/right contact frame selected by CharacterRig. */
  handleFootstep(): void {
    const player = this.deps.store.get().player;
    const position = [...player.position] as Vec3;
    this.play(cueForMovement({
      regionId: player.regionId,
      surface: this.deps.surfaceAt(position, player.regionId),
    }));
  }

  /** Mining and woodcutting now follow the tool swing, rather than the 10 Hz audio tick. */
  handleGatherMotion(pose: "mine" | "chop", phase: "swing" | "impact"): void {
    this.deps.director.observeActivity({
      kind: "gathering",
      skill: pose === "mine" ? "mining" : "woodcutting",
      phase: phase === "swing" ? "started" : "impact",
    });
  }

  /**
   * Splits the attack sound across the clip's swing and contact markers.
   *
   * Magic goes through `spellSound.ts` for its per-play gain and pitch, because the two magic cues
   * point at the same six ember/stone files for all sixteen spells; without the modulation a
   * Squallsurge and an Emberlash are byte-identical. Melee and special are untouched — they have
   * distinct recordings per outcome already.
   */
  handlePlayerCombatMotion(hit: CombatHit, phase: "swing" | "impact" | "combined"): void {
    if (phase === "combined") {
      // The no-rig path: `app/loop.ts` flushes here when a flinch outranks the attack pose, or when
      // the player rig has not built. It used to hand every case to the director, whose
      // `cuesForCombatHit` plays a bare `combat.magic_cast` with no per-play shape and emits nothing
      // at all on a magic miss — so a spell routed this way lost both its element and its fizzle,
      // and the flush path is the one that fires during a boss's opening exchange. Magic is handled
      // here instead; everything else still goes to the director unchanged.
      const combined = hit.kind === "magic" && hit.spellId !== null ? content.spell(hit.spellId) : undefined;
      if (!combined) {
        this.deps.director.observeCombatHit(hit);
        return;
      }
      // Impact only. The cast already sounded when `spell.launched` fired, a whole flight ago —
      // playing it again here would double it, and a magic hit no longer arrives through this path
      // in normal play anyway (`app/loop.ts` presents it as "impact").
      this.play("combat.magic_hit", spellImpactSound(combined.element, combined.rung, hit.hit));
      if (hit.killed) this.play("combat.enemy_death");
      return;
    }

    // `spellId` is null on every melee and special hit, and can also be null on a magic hit whose
    // content row went missing across a reload. Both fall back to the flat pre-ladder voice below:
    // a spell that sounds generic is a far smaller bug than a spell that is silent.
    const spell = hit.kind === "magic" && hit.spellId !== null ? content.spell(hit.spellId) : undefined;

    if (phase === "swing") {
      // Magic never reaches this branch any more: its cast voice belongs to `spell.launched`, which
      // fires at the moment the spell leaves rather than at a rig marker that a deferred hit has
      // long since passed. Guarded rather than removed, so a future caller cannot resurrect a
      // double cast sound by routing magic back through the swing phase.
      if (hit.kind === "magic") return;
      this.play(hit.kind === "melee" ? "combat.melee_swing" : "combat.special");
      return;
    }

    if (hit.kind === "melee") this.play(hit.hit ? "combat.melee_hit" : "combat.melee_miss");
    else if (hit.kind === "magic") {
      // A missed cast used to be silent: this branch was `hit.kind === "magic" && hit.hit`, while
      // melee has always had `combat.melee_miss`. Three seconds of cast time ending in nothing at
      // all reads as a dropped input, so a miss now plays the impact cue at the quieter, lower,
      // duller miss shape. The `hit.hit` guard survives only on the unresolved-spell path, which
      // has to reproduce today's behaviour exactly.
      if (spell) this.play("combat.magic_hit", spellImpactSound(spell.element, spell.rung, hit.hit));
      else if (hit.hit) this.play("combat.magic_hit");
    }
    if (hit.killed) this.play("combat.enemy_death");
  }

  /**
   * The idle voices of whatever animal is nearest, so a field with cattle in it sounds like one.
   *
   * The nearest creature only, not every creature in range. A herd is three to nine animals and a
   * shoal is nine; calling them all would be a wall, and the engine's `maxConcurrent` would throw
   * most of it away anyway. One voice at a time, from whichever animal is closest, is what a field
   * actually sounds like from a hundred paces.
   *
   * HRTF panning follows the camera listener. A gentle source trim and linear distance falloff keep distant calls quiet.
   *
   * The interval is deterministic. `Math.random()` is banned in world generation and the audio
   * engine already resolves its rate ranges to a fixed midpoint, so this follows the same rule and
   * derives its jitter from the entity id instead.
   */
  private tickCreatureAmbience(position: Vec3, atMs: number): void {
    if (atMs < this.nextCreatureCallMs) return;
    const near = this.deps.nearestCreature?.(position, CREATURE_CALL_RADIUS_M);
    if (!near) {
      // Nothing in range: check again soon rather than sitting out a whole interval, so walking
      // into a field is answered within a second rather than within six.
      this.nextCreatureCallMs = atMs + CREATURE_CALL_IDLE_MS;
      return;
    }
    const source = this.deps.entity(near.entityId);
    if (!source || !sameCombatRealm(source.regionId, this.deps.store.get().player.regionId)) {
      this.nextCreatureCallMs = atMs + CREATURE_CALL_IDLE_MS;
      return;
    }
    const cue = cueForCreature(near.family);
    if (cue) {
      const falloff = Math.max(0, 1 - near.distance / CREATURE_CALL_RADIUS_M);
      // Source trim combines with the panner attenuation without a loud distance floor.
      this.play(cue, { gain: CREATURE_CALL_GAIN * (0.12 + 0.88 * falloff),
        position: source.position, maxDistance: CREATURE_CALL_RADIUS_M });
    }
    this.nextCreatureCallMs = atMs + CREATURE_CALL_BASE_MS
      + (hashToUnit(near.entityId) * CREATURE_CALL_JITTER_MS);
  }

  handleInteraction(interaction: InteractionId, result: Result<unknown>): void {
    if (!result.ok) {
      this.play("ui.error");
      return;
    }
    const cue = interactionCue(interaction);
    if (cue) {
      this.play(cue);
      if (activityBackedInteraction(interaction)) {
        this.suppressedStarts.set(cue, performance.now() + 1000);
      }
    }
  }

  handleInventoryUse(result: Result<{ effect: string }>): void {
    if (!result.ok) {
      this.play("ui.error");
      return;
    }
    if (result.value.effect.startsWith("ate ")) this.play("interaction.consume");
    // Equipping emits `item.equipped`, which is the canonical sound edge.
  }

  handleBank(op: "list" | "deposit" | "withdraw" | "depositAll", ok: boolean): void {
    if (!ok) this.play("ui.error");
    else if (op !== "list") this.play("interaction.bank");
  }

  handleTrade(op: "list" | "buy" | "sell", ok: boolean): void {
    if (!ok) this.play("ui.error");
    else if (op !== "list") this.play("interaction.trade");
  }

  playUi(cue: "ui.click" | "ui.cancel"): void {
    this.play(cue);
  }

  reset(): void {
    this.deps.engine.resetOneShots();
    this.activityKey = null;
    this.activityDeadline = null;
    this.suppressedStarts.clear();
    this.nextCreatureCallMs = 0;
    this.lastRegion = this.deps.store.get().player.regionId;
    const player = this.deps.store.get().player;
    this.deps.director.reset(player.regionId, player.position);
  }

  private emitActivity(observation: ActivityAudioObservation, canBeImmediate = false): void {
    const cue = cueForActivity(observation);
    if (!cue) return;
    if (canBeImmediate) {
      const expiry = this.suppressedStarts.get(cue);
      this.suppressedStarts.delete(cue);
      if (expiry !== undefined && expiry >= performance.now()) return;
    }
    this.play(cue);
  }

  /** Sends semantic cues through the shared mixer. */
  private play(cue: AudioCueId, options?: PlayCueOptions): void {
    void this.deps.engine.playCue(cue, options);
  }
}

function interactionCue(interaction: InteractionId): AudioCueId | null {
  switch (interaction) {
    case "mine":
    case "chop": return null;
    case "fish": return "gather.fishing_cast";
    case "open": return "interaction.door_open";
    case "enter": return "interaction.portal";
    case "climb": return "interaction.climb";
    case "vault": return "interaction.vault";
    case "loot":
    case "take": return "interaction.loot";
    case "bank": return "interaction.bank";
    case "trade": return "interaction.trade";
    // Activity, combat, dialogue, and equipment have canonical event edges.
    default: return null;
  }
}

function activityBackedInteraction(interaction: InteractionId): boolean {
  return interaction === "mine" || interaction === "chop" || interaction === "fish"
    || interaction === "climb" || interaction === "vault";
}

function activityIdentity(activity: ReturnType<Store["get"]>["activity"]): string | null {
  if (!activity) return null;
  switch (activity.kind) {
    case "gathering": return `gathering:${activity.entityId}:${activity.startedAtMs}`;
    case "production": return `production:${activity.recipeId}:${activity.nextCompleteAtMs - activity.completed}`;
    case "traversing": return `traversing:${activity.obstacleId}:${activity.endsAtMs}`;
    case "eating": return `eating:${activity.itemId}:${activity.endsAtMs}`;
    case "building_campfire": return `building_campfire:${activity.logItemId}:${activity.endsAtMs}`;
  }
}

function activityDeadline(activity: NonNullable<ReturnType<Store["get"]>["activity"]>): number | null {
  if (activity.kind === "gathering") return activity.nextRollAtMs;
  return null;
}

function stringField(data: Record<string, unknown>, field: string): string {
  return typeof data[field] === "string" ? data[field] : "";
}
