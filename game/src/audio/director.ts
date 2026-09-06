import type {
  AudioCueId, GameEvent, RegionId, SkillId, Vec3,
} from "../contracts.js";
import type { AudioCatalog } from "./catalog.js";
import type { AudioEngine } from "./engine.js";

export interface CombatAudioObservation {
  attacker: "player" | "enemy";
  damage: number;
  hit: boolean;
  kind: "melee" | "ranged" | "magic" | "special";
  killed: boolean;
}

export interface ActivityAudioObservation {
  kind: string;
  skill?: SkillId | string | null;
  op?: string | null;
  phase?: "started" | "impact" | "completed" | "stopped";
  depleted?: boolean;
}

export type FootstepSurface = "grass" | "dirt" | "forest" | "stone" | "wood" | "cave";

export interface MovementAudioObservation {
  atMs: number;
  regionId: RegionId;
  moving: boolean;
  position?: Vec3;
  speedMps?: number;
  surface?: FootstepSurface;
}

export interface AudioDirectorOptions {
  regionFadeMs?: number;
  stepDistance?: number;
  minimumStepIntervalMs?: number;
}

/** Selects region loops without inventing defaults for an absent music or ambience entry. */
export function loopsForRegion(
  regionId: RegionId,
  regions: AudioCatalog["regions"],
  selectionIndex = 0,
): Readonly<{ music: string | null; ambient: string | null }> {
  const definition = regions?.[regionId];
  return {
    music: selectLoop(definition?.music, selectionIndex),
    ambient: selectLoop(definition?.ambient, selectionIndex),
  };
}

/**
 * One animal family's voice.
 *
 * Keyed on `EnemyDef.family`, which `world/regionBuilder.ts` stamps onto every spawned entity and
 * `content/enemies.ts` owns. Several families share a throat and therefore a cue: cattle and
 * aurochs both low, goats and ibex both bleat, coneys and rats both squeak, scorpions and crabs
 * both click. That is a deliberate saving of eleven recordings, not a gap.
 *
 * `reaver` and `quarrykeeper` are absent and return null. They are the two humanoid families, and
 * a raider that bellows like a stag would be worse than a raider that says nothing.
 */
const CREATURE_VOICE: Readonly<Record<string, AudioCueId>> = {
  hen: "creature.hen_cluck",
  frog: "creature.frog_croak",
  goat: "creature.goat_bleat",
  ibex: "creature.goat_bleat",
  cattle: "creature.cow_low",
  aurochs: "creature.cow_low",
  coney: "creature.coney_squeak",
  rat: "creature.coney_squeak",
  viper: "creature.viper_hiss",
  deer: "creature.stag_bell",
  hog: "creature.hog_grunt",
  boar: "creature.hog_grunt",
  coyote: "creature.coyote_howl",
  bear: "creature.bear_roar",
  scorpion: "creature.chitin_click",
  crab: "creature.chitin_click",
};

/**
 * The idle voice of an animal family, and the ONLY thing an animal's own voice is used for.
 *
 * Being hit and dying used to layer `creature.beast_hurt` and `creature.beast_death` under the
 * weapon. That is gone. Those two cues came from a generic creature-SFX pack and were picked by
 * filename rather than by ear, so the flinch that played under a cow was a bird call - "a cow will
 * crow like a bird on hit". A shared cue was always going to be wrong for something; the fix is to
 * not have one. Combat already sounds a landed blow (`combat.melee_hit`) and a kill
 * (`combat.enemy_death`), and those carry the whole event on their own.
 */
export function cueForCreature(family: string | null | undefined): AudioCueId | null {
  return CREATURE_VOICE[normalise(family)] ?? null;
}

/** Whether a family has an animal voice at all. The two humanoid families do not. */
export function isCreatureFamily(family: string | null | undefined): boolean {
  return CREATURE_VOICE[normalise(family)] !== undefined;
}

export function cueForGameEvent(event: GameEvent): AudioCueId | null {
  switch (event.type) {
    case "player.died": return "combat.player_death";
    case "level.gained": return "ui.level_up";
    case "inventory.full": return "ui.error";
    case "quest.updated": return "ui.confirm";
    case "dialogue.opened": return "interaction.dialogue_open";
    case "dialogue.closed": return "interaction.dialogue_close";
    case "item.equipped":
    case "item.unequipped": return "interaction.equip";
    case "item.received": {
      const data = event.data as Record<string, unknown>;
      if (data["source"] === "gather" && data["skill"] === "fishing") {
        return "gather.fishing_catch";
      }
      return null;
    }
    case "activity.started":
      return cueForActivity(dataAsActivity(event.data, "started"));
    case "activity.stopped":
      return cueForActivity(dataAsActivity(event.data, "stopped"));
    case "production.completed":
      return cueForActivity(dataAsActivity(event.data, "completed"));
    case "resource.depleted":
      return cueForActivity({ ...dataAsActivity(event.data, "completed"), depleted: true });
    default:
      return null;
  }
}

export function cueForActivity(observation: ActivityAudioObservation): AudioCueId | null {
  const kind = normalise(observation.kind);
  const skill = normalise(observation.skill);
  const op = normalise(observation.op);
  const phase = observation.phase ?? "started";

  if (phase === "stopped") return "interaction.activity_stop";
  if (kind === "eating" || op === "eat" || op === "consume" || op === "use") {
    return "interaction.consume";
  }
  if (kind === "traversing") {
    if (op === "portal" || op === "enter") return "interaction.portal";
    if (op === "vault") return "interaction.vault";
    if (op === "climb" || op === "shortcut") return "interaction.climb";
    return null;
  }
  if (kind === "gathering" || GATHER_SKILLS.has(skill)) {
    switch (skill) {
      case "mining":
        return observation.depleted ? "gather.rock_break"
          : phase === "started" ? "gather.mining_swing" : "gather.mining_impact";
      case "woodcutting":
        return observation.depleted ? "gather.tree_fall"
          : phase === "started" ? "gather.wood_swing" : "gather.wood_impact";
      case "fishing":
        return phase === "started" ? "gather.fishing_cast"
          : phase === "impact" ? "gather.fishing_reel" : "gather.fishing_catch";
      default: return null;
    }
  }

  if (kind === "production" || PRODUCTION_SKILLS.has(skill)) {
    // Workshop cues describe the finished operation. Activity start is silent so a single recipe
    // does not sound once when work begins and again when it completes.
    if (phase !== "completed") return null;
    if (op.includes("smelt") || kind.includes("smelt")) return "production.smelt";
    switch (skill) {
      case "smithing": return op.includes("smith") ? "production.smith" : null;
      case "crafting": return "production.craft";
      case "cooking": return "production.cook";
      case "fletching": return "production.fletch";
      default: return null;
    }
  }

  switch (kind || op) {
    case "door":
    case "open": return "interaction.door_open";
    case "portal":
    case "enter": return "interaction.portal";
    case "vault": return "interaction.vault";
    case "climb": return "interaction.climb";
    case "loot":
    case "take": return "interaction.loot";
    case "bank": return "interaction.bank";
    case "trade":
    case "shop": return "interaction.trade";
    default: return null;
  }
}

/** A resolved combat record can legitimately select a swing, an impact, and a death cue. */
export function cuesForCombatHit(observation: CombatAudioObservation): readonly AudioCueId[] {
  const cues: AudioCueId[] = [];
  if (observation.attacker === "enemy") {
    if (observation.hit && observation.damage > 0) cues.push("combat.player_hit");
    if (observation.killed) cues.push("combat.player_death");
    return cues;
  }

  if (observation.kind === "melee") {
    cues.push("combat.melee_swing", observation.hit ? "combat.melee_hit" : "combat.melee_miss");
  } else if (observation.kind === "magic") {
    cues.push("combat.magic_cast");
    if (observation.hit) cues.push("combat.magic_hit");
  } else {
    cues.push("combat.special");
  }
  if (observation.killed) cues.push("combat.enemy_death");
  return cues;
}

export function cueForMovement(observation: Pick<MovementAudioObservation, "regionId" | "surface">): AudioCueId {
  const surface = observation.surface ?? defaultSurface(observation.regionId);
  return `movement.footstep_${surface}`;
}

/**
 * Thin stateful adapter around the pure selectors. It accepts semantic observations and never
 * imports or reaches into a gameplay system.
 */
export class AudioDirector {
  private readonly regionFadeMs: number;
  private readonly stepDistance: number;
  private readonly minimumStepIntervalMs: number;
  private readonly regionVisits = new Map<RegionId, number>();
  private readonly transitionTokens = { music: 0, ambient: 0 };
  private readonly activeRegionLoops: { music: string | null; ambient: string | null } = {
    music: null,
    ambient: null,
  };
  private region: RegionId | null = null;
  private regionLoops: { music: string | null; ambient: string | null } = { music: null, ambient: null };
  private previousPosition: Vec3 | null = null;
  private distanceSinceStep = 0;
  private lastStepAtMs = -Infinity;
  private disposed = false;

  constructor(
    private readonly engine: AudioEngine,
    private readonly catalog: AudioCatalog,
    options: AudioDirectorOptions = {},
  ) {
    this.regionFadeMs = nonNegative(options.regionFadeMs, 1200);
    this.stepDistance = positive(options.stepDistance, 1.7);
    this.minimumStepIntervalMs = nonNegative(options.minimumStepIntervalMs, 180);
  }

  setRegion(regionId: RegionId): void {
    if (this.disposed || regionId === this.region) return;
    const visit = this.regionVisits.get(regionId) ?? 0;
    this.regionVisits.set(regionId, visit + 1);
    const next = loopsForRegion(regionId, this.catalog.regions, visit);
    const previous = this.regionLoops;
    this.region = regionId;
    this.regionLoops = next;
    this.switchRegionLoop("music", previous.music, next.music);
    this.switchRegionLoop("ambient", previous.ambient, next.ambient);
    this.resetMovement(false);
  }

  /** Starts a new world with repeatable region pools and movement cadence. */
  reset(regionId: RegionId): void {
    if (this.disposed) return;
    this.regionVisits.clear();
    this.region = null;
    this.setRegion(regionId);
    this.resetMovement();
  }

  observeGameEvent(event: GameEvent): void {
    if (this.disposed) return;
    const cue = cueForGameEvent(event);
    if (cue) void this.engine.playCue(cue);
  }

  observeActivity(observation: ActivityAudioObservation): void {
    if (this.disposed) return;
    const cue = cueForActivity(observation);
    if (cue) void this.engine.playCue(cue);
  }

  observeCombatHit(observation: CombatAudioObservation): void {
    if (this.disposed) return;
    for (const cue of cuesForCombatHit(observation)) void this.engine.playCue(cue);
  }

  /** Emits by distance when positions are supplied, with a cadence fallback for speed-only callers. */
  observeMovement(observation: MovementAudioObservation): void {
    if (this.disposed) return;
    if (!observation.moving || (observation.speedMps !== undefined && observation.speedMps <= 0.05)) {
      this.previousPosition = observation.position ?? null;
      this.distanceSinceStep = this.stepDistance;
      return;
    }

    if (observation.position && this.previousPosition) {
      this.distanceSinceStep += distanceXZ(this.previousPosition, observation.position);
    }
    this.previousPosition = observation.position ?? this.previousPosition;

    const elapsed = observation.atMs - this.lastStepAtMs;
    const cadenceMs = cadenceForSpeed(observation.speedMps);
    const distanceReady = !observation.position || this.distanceSinceStep >= this.stepDistance;
    if (!distanceReady || elapsed < Math.max(this.minimumStepIntervalMs, cadenceMs)) return;

    this.distanceSinceStep %= this.stepDistance;
    this.lastStepAtMs = observation.atMs;
    void this.engine.playCue(cueForMovement(observation));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.transitionTokens.music += 1;
    this.transitionTokens.ambient += 1;
    for (const name of new Set([
      this.regionLoops.music,
      this.regionLoops.ambient,
      this.activeRegionLoops.music,
      this.activeRegionLoops.ambient,
    ])) {
      if (name) this.engine.stopLoop(name, 0);
    }
    this.activeRegionLoops.music = null;
    this.activeRegionLoops.ambient = null;
    this.region = null;
    this.regionLoops = { music: null, ambient: null };
    this.resetMovement();
  }

  private switchRegionLoop(bus: "music" | "ambient", current: string | null, next: string | null): void {
    if (current === next) return;
    const token = ++this.transitionTokens[bus];
    if (!next) {
      if (current) this.engine.stopLoop(current, this.regionFadeMs);
      const active = this.activeRegionLoops[bus];
      if (active && active !== current) this.engine.stopLoop(active, this.regionFadeMs);
      this.activeRegionLoops[bus] = null;
      return;
    }
    void this.transitionRegionLoop(bus, current, next, token);
  }

  private async transitionRegionLoop(
    bus: "music" | "ambient",
    current: string | null,
    next: string,
    token: number,
  ): Promise<void> {
    const active = this.activeRegionLoops[bus] ?? this.findActiveRegionLoop(bus) ?? current;
    // Start first, then validate the transition token, then stop the old loop. Calling the
    // engine's convenience crossfade here would let a slow, stale request stop a loop restored by
    // a newer A -> B -> A transition before the director had a chance to reject it.
    const started = await this.engine.startLoop(next, {
      fadeInMs: active && active !== next ? this.regionFadeMs : active ? 0 : this.regionFadeMs,
    });

    if (this.disposed || token !== this.transitionTokens[bus] || this.regionLoops[bus] !== next) {
      // A -> B -> A can leave an older A request completing after the newest A request. Only stop
      // a stale result when the current region no longer wants that same loop name.
      if (this.disposed || this.regionLoops[bus] !== next) this.engine.stopLoop(next, this.regionFadeMs);
      return;
    }
    if (!started) return;

    this.activeRegionLoops[bus] = next;
    for (const previous of new Set([active, current])) {
      if (previous && previous !== next) this.engine.stopLoop(previous, this.regionFadeMs);
    }
  }

  private findActiveRegionLoop(bus: "music" | "ambient"): string | null {
    for (const name of this.engine.snapshot().activeLoops) {
      if (this.catalog.loops?.[name]?.bus === bus) return name;
    }
    return null;
  }

  private resetMovement(resetCadence = true): void {
    this.previousPosition = null;
    this.distanceSinceStep = resetCadence ? this.stepDistance : 0;
    if (resetCadence) this.lastStepAtMs = -Infinity;
  }
}

const GATHER_SKILLS = new Set(["mining", "woodcutting", "fishing"]);
const PRODUCTION_SKILLS = new Set(["smithing", "crafting", "cooking", "fletching"]);

function dataAsActivity(data: Record<string, unknown>, phase: ActivityAudioObservation["phase"]): ActivityAudioObservation {
  const operation = [data.op, data.interaction, data.via].find((value) => typeof value === "string");
  return {
    kind: typeof data.kind === "string" ? data.kind : "",
    skill: typeof data.skill === "string" ? data.skill : null,
    op: typeof operation === "string" ? operation : null,
    phase,
  };
}

function defaultSurface(regionId: RegionId): FootstepSurface {
  switch (regionId) {
    case "vellenwood": return "forest";
    case "karrowmoor": return "stone";
    // Warm ash and soil underfoot, not turf: the ember foothills default to the dirt family.
    case "kilnhalt": return "dirt";
    case "gravelmaw": return "cave";
    default: return "grass";
  }
}

function normalise(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/[ .-]+/g, "_") ?? "";
}

function selectLoop(value: string | readonly string[] | undefined, selectionIndex: number): string | null {
  const options = (typeof value === "string" ? [value] : value ?? [])
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (options.length === 0) return null;
  const index = Number.isFinite(selectionIndex) ? Math.max(0, Math.floor(selectionIndex)) : 0;
  return options[index % options.length]!;
}

function distanceXZ(from: Vec3, to: Vec3): number {
  return Math.hypot(to[0] - from[0], to[2] - from[2]);
}

function cadenceForSpeed(speedMps: number | undefined): number {
  if (speedMps === undefined || !Number.isFinite(speedMps) || speedMps <= 0) return 0;
  return 1000 * 1.7 / speedMps;
}

function nonNegative(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}
