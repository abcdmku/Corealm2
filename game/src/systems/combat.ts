/**
 * Combat resolution — PRD 2.4, exactly.
 *
 * Two lines cover both directions of every fight in the game:
 *
 *   attackRoll  = (attackLevel  + 9) * (1 + gearAccuracy / 100) * styleFactor
 *   defenceRoll = (defenceLevel + 9) * (1 + gearArmour   / 100)
 *   hitChance   = clamp(attackRoll / (attackRoll + defenceRoll), 0.05, 0.95)
 *
 * There is no Defence skill. Physical defence uses the defender's **Melee** level plus worn
 * `armour`; magical defence uses **Magic** plus `magicArmour`. That is a settled root decision, and
 * it is why an enemy row carries one `defenceLevel` and two armour numbers rather than two levels.
 *
 * Combat is deliberately not an activity. It lives in `state.combat` so movement, targeting, and
 * enemy responses have their own lifecycle. Food rejects an active attack target, and the combat
 * tick also pauses while an already-started eating activity completes. Magic uses the 100 ms
 * simulation tick so a 2.2 s wand stays a 2.2 s wand.
 *
 * Everything random goes through the seeded `combat` stream (hit rolls, damage rolls) and the
 * seeded `loot` stream (drop rolls), so a fight replays identically from a seed and a tick count.
 */
import type {
  EntityId, EquipSlot, EquipmentBonuses, GameErrorCode, ItemId, ItemStack, RegionId, Result,
  SemanticEntity, SkillId, SpellId, Vec3,
} from "../contracts.js";
import { err, ok } from "../contracts.js";
import type { GameState, Store } from "../state/store.js";
import { addSkillXp } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { Rng, RngStreams } from "../core/rng.js";
import { COMBAT_TICK_MS } from "../core/time.js";
import { bearingXZ, clamp, distanceXZ, turnToward } from "../core/math.js";
import {
  HEALTH_REGEN_BLOCKED_MS, MELEE_RANGE, PLAYER_RADIUS, SPELL_RANGE, spellFlightMs,
} from "../app/config.js";
import type { InteractionDispatcher } from "../world/interactions.js";
import type { TickSystem } from "../app/loop.js";
import type { EnemyDef, SpellDef } from "../content/index.js";
import { content } from "../content/index.js";
import { REGIONS } from "../content/regions.js";
import {
  magicLoadout, spellBlockReason, spendSpellFuel, type SpellFuelSpend,
} from "./essence.js";

// ------------------------------------------------------------------ tunables

const DUNGEON_REGIONS = new Set<RegionId>(REGIONS.flatMap((region) => region.dungeon ? [region.dungeon.id] : []));

/** Surface region borders share one world; each authored dungeon occupies a separate floor. */
export function combatRealmOf(regionId: RegionId): RegionId | null {
  return DUNGEON_REGIONS.has(regionId) ? regionId : null;
}

export function sameCombatRealm(a: RegionId, b: RegionId): boolean {
  return combatRealmOf(a) === combatRealmOf(b);
}

/**
 * How fast the player turns to face what they are fighting, in radians per second.
 *
 * Matches `systems/movement.ts`'s walking turn rate. A faster rate here would let the player snap
 * 180 degrees between two swings of a 2.4 s weapon, which reads as the model teleporting its facing;
 * a slower one would leave a caster still coming about when the 3.0 s cast lands.
 */
const COMBAT_TURN_RATE = 7;

/** Metres of reach given up when re-closing on a target, so a step does not restart the approach. */
const RANGED_APPROACH_SLACK = 1.5;

/** PRD 2.4: melee swings at style factor 1.00, magic at 1.15. */
export const MELEE_STYLE_FACTOR = 1.0;
export const MAGIC_STYLE_FACTOR = 1.15;

/** PRD 2.4: 4 XP per point of damage, to whichever skill dealt it. */
export const XP_PER_DAMAGE = 4;

/** PRD 2.4: `round(target.maxHealth * 2.0)` on the kill. */
export const KILL_XP_MULTIPLIER = 2.0;

/** Bare fists swing on the standard 2.4 s cadence, i.e. every 4 combat ticks. */
export const UNARMED_ATTACK_SPEED_MS = 2_400;

/** How far the player will walk to keep an auto-attack alive before giving up. */
export const MAX_PURSUE_METRES = 32;

/**
 * Metres of daylight kept between two bodies' SURFACES when they square up to fight.
 *
 * Melee distances used to be centre-to-centre constants tuned on the smallest animals, and body
 * size never entered them: a Redsill cow is 2.53 m nose to tail (`bodyRadius` 1.27 m), so the old
 * 1.35 m standoff parked its muzzle inside the player, and the player's 1.6 m swing gate could
 * only be satisfied from inside the cow. Reported from play as "they get too close to each other
 * to fight". Every melee range below therefore adds the creature's own measured half-length, so
 * the constants describe the gap between BODIES and mean the same thing for a hen and an aurochs.
 *
 * 0.25 rather than the 0.5 this started at, retuned from the follow-up report: at half a metre of
 * air a big animal stops visibly short and its bite — a head lunge of a few tenths of a metre —
 * lands in the air between the bodies, which reads as the creature refusing to come to you.
 * A quarter metre keeps the muzzle out of the player's capsule and inside the bite's reach.
 */
const MELEE_DAYLIGHT_METRES = 0.25;

/**
 * Where an enemy stops closing, centre to centre, before the body-size term.
 *
 * The floor keeps the smallest animals exactly where they have always stood — a hen's
 * radius-aware standoff (0.35 + 0.2 + 0.25 = 0.8) is under this floor, so nothing tuned against
 * the old constant moves.
 */
const ENEMY_STANDOFF_BASE_METRES = 1.35;

/** Slack past its standoff an enemy may still swing from, absorbing separation shoves. */
const ENEMY_SWING_SLACK_METRES = 0.65;

/**
 * The player stops pursuing this far inside their own reach, so one footstep of the target
 * cannot immediately leave range. The melee analogue of `RANGED_APPROACH_SLACK`, and the number
 * is derived, not chosen: `MELEE_RANGE - PLAYER_RADIUS - MELEE_DAYLIGHT_METRES`
 * (1.6 - 0.35 - 0.25), so reach minus slack is `PLAYER_RADIUS + bodyRadius + daylight` — exactly
 * the ring the enemy's own standoff stops it on. Both parties walk to the same distance and meet
 * with the authored daylight between their bodies. `tests/meleeSpacing.test.ts` pins the identity.
 */
const MELEE_APPROACH_SLACK = 1.0;

/** The half-length the world layer measured for this creature, or 0 when it authored none. */
function bodyRadiusOf(entity: SemanticEntity): number {
  return entity.combat?.bodyRadius ?? 0;
}

/** Where a creature of this half-length stops closing on the player, centre to centre. */
export function enemyStandoffMetres(bodyRadius: number): number {
  return Math.max(ENEMY_STANDOFF_BASE_METRES, PLAYER_RADIUS + bodyRadius + MELEE_DAYLIGHT_METRES);
}

/** An enemy needs to be a little inside melee range to land a swing. */
export function enemyAttackRangeMetres(bodyRadius: number): number {
  return enemyStandoffMetres(bodyRadius) + ENEMY_SWING_SLACK_METRES;
}

/** Authored ranged reach, with the established body-aware melee fallback. */
export function enemyReachMetres(def: EnemyDef, bodyRadius: number): number {
  return def.attackStyle && def.attackStyle !== "melee"
    ? Math.max(2, def.attackRangeM ?? 10) : enemyAttackRangeMetres(bodyRadius);
}

export function enemyHoldMetres(def: EnemyDef, bodyRadius: number): number {
  return def.attackStyle && def.attackStyle !== "melee"
    ? Math.max(1.5, enemyReachMetres(def, bodyRadius) - 1.5) : enemyStandoffMetres(bodyRadius);
}

/** The player's melee reach to THIS creature: sword range to its surface, not its centre. */
export function meleeReachMetres(bodyRadius: number): number {
  return MELEE_RANGE + bodyRadius;
}

/** Enemy corpses come back on a timer. Content carries no respawn field, so these are the default. */
export const ENEMY_RESPAWN_MS = 30_000;
export const BOSS_RESPAWN_MS = 180_000;

/**
 * How long a drop sits on the floor before the world sweeps it.
 *
 * One minute, not the two the PRD (section 3, row 11) asked for: two minutes of crates outlives the
 * 30 s enemy respawn twice over, so a player working one clearing ends up fighting among the boxes
 * from the last four kills. Changed on the owner's call, and recorded here rather than silently,
 * because it is a deliberate departure from the spec and not a transcription slip.
 *
 * A pile that is emptied is removed on the spot by `systems/death.ts loot()`, and a kill that rolls
 * nothing never creates one - `rollDrops` returns before the pile exists. So this timer only ever
 * governs loot the player walked away from.
 */
export const LOOT_DESPAWN_MS = 60_000;

/** Ceiling on catch-up combat ticks in one sim tick, so `advanceGameTime(3600)` cannot hang. */
const MAX_CATCHUP_TICKS = 400;

/** How many recent hits the render layer can read back for damage numbers. */
const HIT_LOG_CAPACITY = 32;

// --------------------------------------------------------------- pure maths

export function attackRoll(attackLevel: number, gearAccuracy: number, styleFactor: number): number {
  return (attackLevel + 9) * (1 + gearAccuracy / 100) * styleFactor;
}

export function defenceRoll(defenceLevel: number, gearArmour: number): number {
  return (defenceLevel + 9) * (1 + gearArmour / 100);
}

export function hitChance(attack: number, defence: number): number {
  const total = attack + defence;
  if (total <= 0) return 0.05;
  return clamp(attack / total, 0.05, 0.95);
}

/** PRD 2.4. Melee 1 unarmed is 2; Melee 10 with a +26 Kaldite sword is 10. */
export function meleeMaxHit(meleeLevel: number, gearPower: number): number {
  return Math.floor(2 + (meleeLevel + gearPower) / 4.2);
}

/** PRD 2.4. Voltrend (baseMax 8, divisor 6) at Magic 10 with +26 magic power is 14. */
export function magicMaxHit(magicLevel: number, gearMagicPower: number, spell: SpellDef): number {
  return Math.floor(spell.baseMax + (magicLevel + gearMagicPower) / spell.divisor);
}

/**
 * A melee or enemy weapon's cadence in whole combat ticks. Magic weapons keep their authored
 * millisecond cadence and resolve on the 100 ms simulation tick instead.
 */
export function attackIntervalMs(attackSpeedMs: number): number {
  const ticks = Math.max(1, Math.round(attackSpeedMs / COMBAT_TICK_MS));
  return ticks * COMBAT_TICK_MS;
}

/** Expected damage per swing: `hitChance * mean(1..maxHit)`. A hit always deals at least 1. */
export function expectedDamagePerSwing(chance: number, maxHit: number): number {
  const top = Math.max(1, maxHit);
  return chance * ((1 + top) / 2);
}

export interface TimeToKillInput {
  hitChance: number;
  maxHit: number;
  intervalMs: number;
  targetHealth: number;
}

/**
 * Expected time to kill in milliseconds. Exported because it is the number the PRD's balance table
 * is written in, and because the skill guide and `__gameDebug` both want to quote it.
 */
export function expectedTimeToKillMs(input: TimeToKillInput): number {
  const perSwing = expectedDamagePerSwing(input.hitChance, input.maxHit);
  if (perSwing <= 0) return Number.POSITIVE_INFINITY;
  return (input.targetHealth / perSwing) * input.intervalMs;
}

// ------------------------------------------------------------------- ports

/**
 * The slice of `world/entities.ts` combat needs. Injected, never imported: that file belongs to
 * another owner and this system must stay constructible from a literal object in a test.
 */
export interface CombatEntityPort {
  get(id: EntityId): SemanticEntity | undefined;
  all(): SemanticEntity[];
  /** Optional. Without it, kills still record drops in `state.world.lootPiles`, just unrendered. */
  add?(entity: SemanticEntity): void;
  remove?(id: EntityId): boolean;
  setPosition?(id: EntityId, position: Vec3): boolean;
  setState?(id: EntityId, state: string): boolean;
}

/** Satisfied exactly by `EquipmentSystem` in systems/equipment.ts. */
export interface CombatEquipmentPort {
  totals(): EquipmentBonuses;
  slots(): Record<EquipSlot, ItemStack | null>;
}

/** Satisfied exactly by `InventorySystem` in systems/inventory.ts. */
export interface CombatInventoryPort {
  addItem(itemId: ItemId, quantity: number): Result<number>;
  removeItem(itemId: ItemId, quantity: number): Result<number>;
  countItem(itemId: ItemId): number;
  freeSlots(): number;
  hasRoomFor(itemId: ItemId, quantity: number): boolean;
  /** Optional. Falls back to writing `state.currency` directly. */
  addCurrency?(amount: number): Result<number>;
}

/** Satisfied exactly by `Movement` in systems/movement.ts. Used only to walk back into range. */
export interface CombatMovementPort {
  startPath(
    state: GameState,
    destination: Vec3,
    entityId: EntityId | null,
    atMs: number,
    /** Metres of the tail to leave unwalked, so a caster re-closes only to spell range. */
    options?: { stopDistance?: number },
  ): { pathLength: number; etaMs: number } | null;
  stop(state: GameState, atMs: number, reason?: string): boolean;
}

/**
 * Satisfied exactly by `ActivitySystem` in systems/activity.ts. Combat is not an activity, but
 * starting a fight cancels a gather the way a click on an enemy would.
 */
export interface CombatActivityPort {
  current(): { kind: string } | null;
  cancel(atMs?: number): boolean;
}

/** One resolved swing, for damage numbers and hit sparks. The render layer polls; it never writes. */
export interface CombatHit {
  atMs: number;
  attacker: "player" | "enemy";
  sourceId: EntityId;
  targetId: EntityId;
  damage: number;
  hit: boolean;
  maxHit: number;
  kind: "melee" | "ranged" | "magic" | "special";
  killed: boolean;
  /**
   * Which spell threw it, on a `kind: "magic"` hit only; null on every other kind.
   *
   * The renderer needs the element and the rung to draw the effect and to pick the voice, and this
   * is the only place the pairing of a specific cast with a specific landing survives:
   * `state.combat.activeSpellId` is a live field that a disengage clears, so a hit read one frame
   * later can no longer say what produced it. Carrying the id on the hit rather than the resolved
   * element keeps this struct free of a content import — `render/spellVfx.ts` resolves it through
   * `content.spell()`, which it needs to be able to do anyway.
   */
  spellId: SpellId | null;
}

/** A committed melee action. All timestamps use the simulation clock. */
export interface CombatAttackStart {
  id: number;
  atMs: number;
  contactAtMs: number;
  recoverAtMs: number;
  attacker: "player" | "enemy";
  sourceId: EntityId;
  targetId: EntityId;
  kind: "melee" | "ranged" | "magic";
}

interface PendingMeleeAttack {
  start: CombatAttackStart;
  realm: RegionId | null;
  damage: number;
  hit: boolean;
  maxHit: number;
  contacted: boolean;
}

/** One cast between its roll and its arrival. See `CombatSystem.pendingSpellHits`. */
interface PendingSpellHit {
  landsAtMs: number;
  sourceId: EntityId;
  realm: RegionId | null;
  targetId: EntityId;
  spellId: SpellId;
  damage: number;
  hit: boolean;
  maxHit: number;
}

export interface CombatDeps {
  store: Store;
  events: EventBus;
  rng: RngStreams;
  entities: CombatEntityPort;
  equipment: CombatEquipmentPort;
  inventory: CombatInventoryPort;
  dispatcher: InteractionDispatcher;
  movement?: CombatMovementPort;
  activity?: CombatActivityPort;
  /** View block stamped onto spawned loot piles. Omitted means the pile is state-only. */
  lootView?: SemanticEntity["view"];
  /** Clip contact and recovery offsets from attack start, supplied without a render dependency. */
  meleeTiming?: (
    attacker: "player" | "enemy", sourceId: EntityId, targetId: EntityId,
  ) => { contactMs: number; recoveryMs: number };
}

/** Live enemy runtime, mirroring `state.world.enemies` exactly. */
type EnemyRuntime = NonNullable<GameState["world"]["enemies"][string]>;

// ------------------------------------------------------------------ system

export class CombatSystem implements TickSystem {
  readonly name = "combat";

  /** PRD section 3, row 8 ("Combat"), scaled by ten. After enemy AI (70), before health (90). */
  readonly order = 80;

  private readonly combatRng: Rng;
  private readonly lootRng: Rng;

  /** Enemy swing timers. Runtime scratch; the frozen enemy record has no room for them. */
  private readonly enemyNextAttackAtMs = new Map<EntityId, number>();
  /**
   * Per-enemy stat overrides. `EnemyDef` is frozen and carries no phase field, so a boss phase
   * publishes its armour, cadence and max hit through here rather than through new state.
   */
  private readonly enemyOverrides = new Map<EntityId, Partial<EnemyDef>>();
  private readonly defCache = new Map<EntityId, EnemyDef>();
  private readonly provokeListeners: ((enemyId: EntityId, atMs: number) => void)[] = [];
  private readonly hitLog: CombatHit[] = [];
  private readonly attackStarts: CombatAttackStart[] = [];
  private readonly meleeAttacks = new Map<EntityId, PendingMeleeAttack>();
  private attackSequence = 0;
  /**
   * Spells in the air: rolled, paid for, and not yet arrived.
   *
   * In memory rather than in `GameState`, and that is a real decision. A save taken mid-flight would
   * otherwise restore a bolt with no caster animation and no effect on screen, owing damage to a
   * fight the player has already walked away from. Dropping it on reload costs one cast, which is
   * what a player would expect; `hitLog` is kept out of the save for the same reason.
   */
  private readonly pendingSpellHits: PendingSpellHit[] = [];

  private nextCombatTickAtMs = -1;
  private lastAtMs = 0;
  private pileSequence = 0;
  private playerCombatRealm: RegionId | null | undefined;

  constructor(private readonly deps: CombatDeps) {
    this.combatRng = deps.rng.get("combat");
    this.lootRng = deps.rng.get("loot");

    // ONE COMBAT VERB. "Attack" means "hit that with what I am holding": a wand or staff casts, a blade
    // swings. The menu used to offer "Attack" and "Cast at" side by side on every enemy, which asked
    // the player to re-state their weapon choice on every click — and got it wrong either way, since
    // "Attack" with a magic weapon in hand still swung it like a club.
    //
    // `cast` stays registered, because it is not the same question. The menu no longer offers it
    // (`ui/contextMenu.ts`), but `GameApi.cast` names a SPECIFIC spell and an agent uses that to
    // pick one deliberately; routing it through `attack` would throw away the spell id.
    // `attack` decides melee-or-cast inside `this.attack`, so the menu, `GameApi.attack` and an
    // agent's `corealm_attack` all resolve the same way.
    deps.dispatcher.registerHandler("attack", (context) =>
      started(this.attack(context.entity.id), `attacking ${context.entity.name}`));

    deps.dispatcher.registerHandler("cast", (context) => {
      const spellId = this.preferredSpellId();
      if (!spellId) {
        return err(
          "REQUIREMENTS_NOT_MET",
          "You have no castable spell. Check your Magic level, weapon, and matching Essence.",
          context.entity.id,
        );
      }
      return started(this.cast(spellId, context.entity.id), `casting ${spellId} at ${context.entity.name}`);
    });
  }

  /** Satisfies `SystemHooks.combat` in api/gameApi.ts. */
  hook(): {
    attack(entityId: EntityId): Result<{ targetId: EntityId; attackSpeedMs: number }>;
    cast(spellId: SpellId, entityId: EntityId): Result<{ targetId: EntityId; castMs: number }>;
    setPreferredSpell(spellId: SpellId | null): void;
  } {
    return {
      attack: (entityId) => this.attack(entityId),
      cast: (spellId, entityId) => this.cast(spellId, entityId),
      setPreferredSpell: (spellId) => { this.setPreferredSpell(spellId); },
    };
  }

  // -------------------------------------------------------------- commands

  /**
   * Attack with whatever is in the main hand: a wand or staff casts, a blade swings.
   *
   * The weapon check lives HERE and not in the dispatcher handler, which is where it started. The
   * handler only covers `interact(entityId, "attack")` — a human clicking the menu — while
   * `GameApi.attack` is its own path used by `corealm_attack` and by anything else holding the API.
   * With the logic in the handler alone, a click cast and an agent's attack swung the magic weapon like a
   * club at the same target. Agent parity is a property this project claims architecturally
   * (`agent/tools.ts` header), so the two cannot be allowed to mean different things.
   */
  attack(entityId: EntityId): Result<{ targetId: EntityId; attackSpeedMs: number }> {
    const state = this.deps.store.get();
    const atMs = this.lastAtMs;
    if (state.player.health <= 0) return err("DEAD", "You are dead.");

    if (this.wieldingMagic()) {
      const spellId = this.preferredSpellId();
      if (!spellId) {
        return err(
          "REQUIREMENTS_NOT_MET",
          "You have no castable spell. Check your Magic level, weapon, and matching Essence.",
          entityId,
        );
      }
      const cast = this.cast(spellId, entityId);
      // `castMs` and `attackSpeedMs` are the same quantity — the interval until the next swing —
      // under two names the frozen contract gives them. Renamed rather than reshaped.
      return cast.ok ? ok({ targetId: cast.value.targetId, attackSpeedMs: cast.value.castMs }) : cast;
    }

    const entity = this.deps.entities.get(entityId);
    if (!entity) return err("NOT_FOUND", `No entity with id ${entityId}`, entityId);

    const problem = this.rejectTarget(entity);
    if (problem) return err(problem.code, problem.message, entity.id);

    const gap = distanceXZ(state.player.position, entity.position);
    if (gap > MAX_PURSUE_METRES) {
      return err(
        "OUT_OF_RANGE",
        `${entity.name} is ${gap.toFixed(1)} m away; walk closer than ${MAX_PURSUE_METRES} m first.`,
        entityId,
      );
    }

    const speedMs = this.weaponSpeedMs();
    this.replaceUnrelatedMovement(state, entity.id, atMs);
    this.engagePlayer(state, entity, null, atMs);
    if (gap > meleeReachMetres(bodyRadiusOf(entity))) this.pursue(state, entity, atMs);
    return ok({ targetId: entity.id, attackSpeedMs: attackIntervalMs(speedMs) });
  }

  cast(spellId: SpellId, entityId: EntityId): Result<{ targetId: EntityId; castMs: number }> {
    const state = this.deps.store.get();
    const atMs = this.lastAtMs;
    if (state.player.health <= 0) return err("DEAD", "You are dead.");

    const spell = content.spell(spellId);
    if (!spell) return err("NOT_FOUND", `No spell with id ${spellId}`);
    const blocked = spellBlockReason(state, spell);
    if (blocked) return err("REQUIREMENTS_NOT_MET", blocked, entityId);
    const loadout = magicLoadout(state);
    if (!loadout) {
      return err("REQUIREMENTS_NOT_MET", "Equip a wand or staff first.", entityId);
    }

    const entity = this.deps.entities.get(entityId);
    if (!entity) return err("NOT_FOUND", `No entity with id ${entityId}`, entityId);

    const problem = this.rejectTarget(entity);
    if (problem) return err(problem.code, problem.message, entity.id);

    const gap = distanceXZ(state.player.position, entity.position);
    if (gap > MAX_PURSUE_METRES) {
      return err(
        "OUT_OF_RANGE",
        `${entity.name} is ${gap.toFixed(1)} m away; ${spell.name} reaches ${SPELL_RANGE} m.`,
        entityId,
      );
    }

    this.replaceUnrelatedMovement(state, entity.id, atMs);
    this.engagePlayer(state, entity, spell.id, atMs);
    if (gap > SPELL_RANGE) this.pursue(state, entity, atMs);
    return ok({ targetId: entity.id, castMs: loadout.castMs });
  }

  /** The player-facing disengage. `GameApi.stop()` has its own copy; both are safe. */
  disengagePlayer(reason: string, atMs = this.lastAtMs): boolean {
    const state = this.deps.store.get();
    const targetId = state.combat.targetId;
    this.playerCombatRealm = undefined;
    this.cancelMeleeAttack(state.player.id);
    if (!targetId) return false;
    state.combat.targetId = null;
    state.combat.activeSpellId = null;
    this.deps.store.markDirty();
    this.deps.events.emit("combat.ended", { reason }, targetId, atMs);
    return true;
  }

  // ------------------------------------------------------------------ tick

  tick(deltaMs: number, atMs: number): void {
    this.lastAtMs = atMs;
    if (this.nextCombatTickAtMs < 0) this.nextCombatTickAtMs = atMs;

    // Arrivals are checked on the 100 ms SIM tick, not the 600 ms combat tick.
    //
    // A bolt lands when it lands; it is not a swing and it has no cadence to wait for. Resolving it
    // on the combat tick made the damage up to 600 ms late — measured at 1300 ms against a 695 ms
    // flight — so the bolt visibly struck and the health bar moved half a second afterwards. On the
    // sim tick the worst case is 100 ms, which is under a frame at any playable rate.
    const state = this.deps.store.get();
    const target = state.combat.targetId ? this.deps.entities.get(state.combat.targetId) : undefined;
    if (target && (!sameCombatRealm(state.player.regionId, target.regionId)
      || (this.playerCombatRealm !== undefined && combatRealmOf(state.player.regionId) !== this.playerCombatRealm))) {
      this.disengagePlayer("different-realm", atMs);
    }
    this.landSpellHits(state, atMs);

    // Magic cannot share the 600 ms swing clock: 2200 ms rounds up to 2400 ms there. Both shipped
    // magic cadences are exact multiples of the fixed 100 ms simulation step, so an active spell
    // gets one due check per simulation tick. The combat-tick path below skips it to prevent a
    // double launch on ticks where the two clocks coincide.
    if (state.player.health > 0 && state.combat.activeSpellId !== null) {
      this.resolvePlayerSwing(state, atMs, deltaMs);
    }

    let guard = 0;
    while (atMs >= this.nextCombatTickAtMs && guard < MAX_CATCHUP_TICKS) {
      // Catch-up keeps contact before the next swing; a time jump cannot overwrite an unpaid hit.
      this.advanceMeleeAttacks(state, this.nextCombatTickAtMs);
      this.resolveCombatTick(this.nextCombatTickAtMs);
      this.nextCombatTickAtMs += COMBAT_TICK_MS;
      guard += 1;
    }
    // A debug time jump larger than the catch-up budget resyncs rather than accumulating debt.
    if (atMs > this.nextCombatTickAtMs) this.nextCombatTickAtMs = atMs + COMBAT_TICK_MS;
    // Contact and recovery use the 100 ms simulation step, not the slower cadence clock.
    this.advanceMeleeAttacks(state, atMs);
  }

  private resolveCombatTick(atMs: number): void {
    const state = this.deps.store.get();
    if (state.player.health <= 0) {
      if (state.combat.targetId) this.disengagePlayer("dead", atMs);
      return;
    }
    if (state.combat.activeSpellId === null) this.resolvePlayerSwing(state, atMs, COMBAT_TICK_MS);
    this.resolveEnemySwings(state, atMs);
  }

  // --------------------------------------------------------- player swings

  private resolvePlayerSwing(state: GameState, atMs: number, turnDeltaMs: number): void {
    const targetId = state.combat.targetId;
    if (!targetId) return;

    const entity = this.deps.entities.get(targetId);
    if (!entity || entity.archetype === "loot" || entity.archetype === "recovery_cache") {
      this.disengagePlayer("target-gone", atMs);
      return;
    }
    if (!sameCombatRealm(state.player.regionId, entity.regionId)) {
      this.disengagePlayer("different-realm", atMs);
      return;
    }
    const runtime = this.runtimeFor(state, entity);
    if (runtime.state === "dead" || runtime.health <= 0 || entity.state === "dead") {
      this.disengagePlayer("target-dead", atMs);
      return;
    }

    const committed = this.meleeAttacks.get(state.player.id);
    if (committed && atMs < committed.start.recoverAtMs
      && this.meleeAttackActive(state, committed)) return;

    const spellId = state.combat.activeSpellId;
    const spell = spellId ? content.spell(spellId) : undefined;
    const range = spell ? SPELL_RANGE : meleeReachMetres(bodyRadiusOf(entity));
    const gap = distanceXZ(state.player.position, entity.position);

    if (gap > range) {
      if (!this.pursue(state, entity, atMs)) this.disengagePlayer("out-of-range", atMs);
      return;
    }

    // FACE THE TARGET, but only while STANDING. A caster stood at range firing sideways, and a
    // swordsman who arrived from behind kept swinging at the horizon, because nothing wrote
    // `facingRad` outside of walking.
    //
    // The `mode === "idle"` guard is the other half, and it matters more than it looks. While the
    // player is moving, `systems/movement.ts` is already turning them along their path; writing a
    // second desired facing during attack checks made the two fight each other, and a player
    // running AWAY from something that was hitting them got spun back round to face it over and
    // over. Whoever is moving owns the facing: walk away and you look where you are going.
    //
    // Turned at the same capped rate walking uses (`turnToward` is shared from `core/math.ts`)
    // rather than snapped, and done BEFORE the swing, because the animation and the effect are both
    // oriented off this frame's facing.
    if (state.player.movement.mode === "idle") {
      state.player.facingRad = turnToward(
        state.player.facingRad,
        bearingXZ(state.player.position, entity.position),
        COMBAT_TURN_RATE,
        turnDeltaMs,
      );
    }

    // Eating blocks attacks for its 1.8 s, per PRD 2.7. The engagement survives it.
    if (state.activity?.kind === "eating") return;
    if (!spell && state.player.movement.mode !== "idle"
      && state.player.movement.destinationEntityId !== entity.id) return;
    if (atMs < state.combat.nextAttackAtMs) return;

    const def = this.defFor(entity);
    const gear = this.deps.equipment.totals();

    let chance: number;
    let maxHit: number;
    let intervalMs: number;
    let castFuel: SpellFuelSpend | null = null;

    if (spell) {
      const loadout = magicLoadout(state);
      const paid = spendSpellFuel(state, spell, this.deps.inventory);
      if (!loadout || !paid.ok) {
        this.disengagePlayer("spell-blocked", atMs);
        return;
      }
      castFuel = paid.value;
      chance = hitChance(
        attackRoll(state.skills.magic.level, gear.magicAccuracy, MAGIC_STYLE_FACTOR),
        defenceRoll(def.defenceLevel, def.magicArmour),
      );
      maxHit = magicMaxHit(state.skills.magic.level, gear.magicPower, spell);
      intervalMs = loadout.castMs;
      // PRD 2.4: a cast awards its base XP hit or miss.
      this.awardXp(state, "magic", spell.baseXp, atMs);
    } else {
      chance = hitChance(
        attackRoll(state.skills.melee.level, gear.accuracy, MELEE_STYLE_FACTOR),
        defenceRoll(def.defenceLevel, def.armour),
      );
      maxHit = meleeMaxHit(state.skills.melee.level, gear.power);
      intervalMs = attackIntervalMs(this.weaponSpeedMs());
    }

    state.combat.nextAttackAtMs = atMs + intervalMs;
    this.markInCombat(state, atMs);

    const landed = this.combatRng.chance(chance);
    const damage = landed ? Math.max(1, this.combatRng.int(1, Math.max(1, maxHit))) : 0;

    // A SPELL DOES NOT HURT ANYTHING UNTIL IT ARRIVES.
    //
    // The roll happens here, at the cast, and so does everything the cast itself costs: weapon
    // charge or carried Essence is spent, base XP is paid, and the next-cast timer starts. What waits is the part that
    // belongs to the bolt: the damage, death, damage XP, flinch and number. Previously all of
    // it landed the instant the cast resolved and only the NUMBER was delayed by the render layer,
    // so a target could take the hit, die and drop its loot while the bolt was still crossing the
    // ground toward it.
    //
    // Rolling now and applying later, rather than deferring the roll, is deliberate: the seeded
    // `combat` stream is drawn in exactly the order it always was, so a fight still replays
    // identically from a seed and a tick count.
    if (spell) {
      const flightMs = spellFlightMs(spell.rung, distanceXZ(state.player.position, entity.position));
      this.pendingSpellHits.push({
        landsAtMs: atMs + flightMs,
        sourceId: state.player.id,
        realm: combatRealmOf(state.player.regionId),
        targetId: entity.id,
        spellId: spell.id,
        damage,
        hit: landed,
        maxHit,
      });
      // The renderer's cue to start the bolt. It cannot use the hit log any more: that entry is now
      // written when the spell LANDS, which is exactly when the projectile should already be gone.
      this.deps.events.emit(
        "spell.launched",
        {
          spellId: spell.id,
          targetId: entity.id,
          element: spell.element,
          rung: spell.rung,
          flightMs,
          hit: landed,
          fuelSource: castFuel!.source,
          weaponItemId: castFuel!.source === "weapon" ? castFuel!.weaponItemId : null,
          remainingCharges: castFuel!.source === "weapon" ? castFuel!.remainingCharges : null,
          essenceItemId: castFuel!.source === "essence" ? castFuel!.essenceItemId : null,
          remainingEssence: castFuel!.source === "essence" ? castFuel!.remainingEssence : null,
        },
        entity.id,
        atMs,
      );
      this.deps.store.markDirty();
      return;
    }

    if (state.player.movement.mode !== "idle"
      && state.player.movement.destinationEntityId === entity.id) {
      // Cancel the approach deliberately; its remaining path must not slide through the strike.
      this.deps.movement?.stop(state, atMs, "cancelled");
    }
    this.beginMeleeAttack("player", state.player.id, entity.id, atMs, intervalMs, damage, landed, maxHit);
    this.deps.store.markDirty();
  }

  /**
   * Lands every spell whose bolt has arrived.
   *
   * Runs on the 100 ms SIM tick, not the 600 ms combat tick. A bolt lands when it lands; it is not
   * a swing and has no cadence to wait for. Resolving it on the combat tick made the damage up to
   * 600 ms late - measured at 1300 ms against a 695 ms flight - so the bolt visibly struck and the
   * health bar moved half a second afterwards.
   *
   * A bolt in flight is independent of the engagement that threw it: the caster may have disengaged,
   * walked away or died in the meantime, and the spell still lands - it was already in the air. The
   * target dying first cancels it. Crossing a dungeon boundary also cancels it: a bolt belongs to
   * the world in which it was launched, even if both participants later enter another one.
   */
  private landSpellHits(state: GameState, atMs: number): void {
    for (let index = 0; index < this.pendingSpellHits.length;) {
      const pending = this.pendingSpellHits[index]!;
      const entity = this.deps.entities.get(pending.targetId);
      // Check before the arrival deadline so leaving and returning cannot revive a cancelled bolt.
      if (!entity || state.player.id !== pending.sourceId
        || combatRealmOf(state.player.regionId) !== pending.realm
        || combatRealmOf(entity.regionId) !== pending.realm) {
        this.pendingSpellHits.splice(index, 1);
        continue;
      }
      if (atMs < pending.landsAtMs) {
        index += 1;
        continue;
      }
      this.pendingSpellHits.splice(index, 1);

      const runtime = this.runtimeFor(state, entity);
      if (runtime.state === "dead" || runtime.health <= 0) continue;

      let killed = false;
      if (pending.damage > 0) {
        this.awardXp(state, "magic", pending.damage * XP_PER_DAMAGE, atMs);
        killed = this.applyEnemyDamage(state, entity, runtime, pending.damage, "magic", atMs);
      }

      this.record({
        atMs,
        attacker: "player",
        sourceId: pending.sourceId,
        targetId: entity.id,
        damage: pending.damage,
        hit: pending.hit,
        maxHit: pending.maxHit,
        kind: "magic",
        killed,
        spellId: pending.spellId,
      });

      // Provoked on ARRIVAL, the same rule melee follows: a creature reacts to being hit, not to
      // being aimed at.
      for (const listener of this.provokeListeners) listener(entity.id, atMs);
      this.deps.store.markDirty();
    }
  }

  /**
   * Walks the player back into range so an auto-attack survives a step. Returns false when the
   * engagement should end: no movement port, the target ran too far, or the player issued another
   * command (which is exactly "moving somewhere that is not the target").
   */
  /**
   * Walks the player back into range of a target that has moved, and no further.
   *
   * The stop distance is the reach of what is actually in hand, so a caster re-closes to the edge of
   * SPELL_RANGE and a swordsman closes to the target's body. Without it a spell that lost its target by a
   * step walked the caster the full fifteen metres onto it, which threw away the whole advantage of
   * a ranged attack every time an enemy repositioned — and enemies reposition constantly.
   *
   * The slack matches `api/gameApi.ts`'s: stopping exactly on the boundary leaves the player one
   * footstep from being out of range again, which turns a fight into a walk cycle.
   */
  private pursue(state: GameState, entity: SemanticEntity, atMs: number): boolean {
    const move = this.deps.movement;
    if (!move) return false;

    const movement = state.player.movement;
    if (movement.mode !== "idle") return movement.destinationEntityId === entity.id;
    if (distanceXZ(state.player.position, entity.position) > MAX_PURSUE_METRES) return false;

    // Melee no longer closes all the way onto the target's CENTRE: reach minus the approach slack
    // is the same ring the enemy's own standoff puts it on, so the two meet with daylight between
    // their bodies instead of the player standing inside a cow.
    const melee = state.combat.activeSpellId === null;
    const reach = melee ? meleeReachMetres(bodyRadiusOf(entity)) : SPELL_RANGE;
    const stopDistance = Math.max(0, reach - (melee ? MELEE_APPROACH_SLACK : RANGED_APPROACH_SLACK));
    return move.startPath(state, entity.position, entity.id, atMs, { stopDistance }) !== null;
  }

  // ---------------------------------------------------------- enemy swings

  private resolveEnemySwings(state: GameState, atMs: number): void {
    if (state.combat.engagedBy.length === 0) return;

    for (const enemyId of [...state.combat.engagedBy]) {
      const entity = this.deps.entities.get(enemyId);
      if (!entity || !sameCombatRealm(state.player.regionId, entity.regionId)) {
        this.disengageEnemy(state, enemyId, atMs);
        continue;
      }
      const runtime = this.runtimeFor(state, entity);
      if (runtime.state === "dead" || runtime.health <= 0 || entity.state === "dead") {
        this.disengageEnemy(state, enemyId, atMs);
        continue;
      }

      const def = this.defFor(entity);
      const gap = distanceXZ(state.player.position, entity.position);

      // Being hunted blocks regeneration even while the enemy is still closing (PRD 2.3).
      this.markInCombat(state, atMs);
      if (gap > enemyReachMetres(def, bodyRadiusOf(entity))) continue;

      const intervalMs = attackIntervalMs(def.attackSpeedMs);
      const due = this.enemyNextAttackAtMs.get(enemyId);
      if (due === undefined) {
        // The first windup begins one cadence after arrival. Later starts keep that cadence.
        this.enemyNextAttackAtMs.set(enemyId, atMs + intervalMs);
        continue;
      }
      if (atMs < due) continue;
      this.enemyNextAttackAtMs.set(enemyId, atMs + intervalMs);

      const gear = this.deps.equipment.totals();
      const chance = hitChance(
        attackRoll(def.attackLevel, def.accuracy, def.attackStyle === "magic" ? MAGIC_STYLE_FACTOR : MELEE_STYLE_FACTOR),
        defenceRoll(def.attackStyle === "magic" ? state.skills.magic.level : state.skills.melee.level,
          def.attackStyle === "magic" ? gear.magicArmour : gear.armour),
      );
      const landed = this.combatRng.chance(chance);
      const damage = landed ? Math.max(1, this.combatRng.int(1, Math.max(1, def.maxHit))) : 0;

      this.beginMeleeAttack("enemy", enemyId, state.player.id, atMs, intervalMs, damage, landed, def.maxHit, def.attackStyle ?? "melee");
    }
  }

  private beginMeleeAttack(
    attacker: "player" | "enemy", sourceId: EntityId, targetId: EntityId,
    atMs: number, intervalMs: number, damage: number, hit: boolean, maxHit: number,
    kind: CombatAttackStart["kind"] = "melee",
  ): void {
    const timing = this.deps.meleeTiming?.(attacker, sourceId, targetId);
    const contactMs = clamp(
      timing && Number.isFinite(timing.contactMs) ? timing.contactMs : 350,
      1, intervalMs - 1,
    );
    const recoveryMs = clamp(
      timing && Number.isFinite(timing.recoveryMs) ? timing.recoveryMs : 900,
      contactMs + 1, intervalMs,
    );
    const start: CombatAttackStart = {
      id: ++this.attackSequence,
      atMs,
      contactAtMs: atMs + contactMs,
      recoverAtMs: atMs + recoveryMs,
      attacker,
      sourceId,
      targetId,
      kind,
    };
    this.meleeAttacks.set(sourceId, {
      start, realm: combatRealmOf(this.deps.store.get().player.regionId), damage, hit, maxHit, contacted: false,
    });
    this.attackStarts.push(start);
    if (this.attackStarts.length > HIT_LOG_CAPACITY) {
      this.attackStarts.splice(0, this.attackStarts.length - HIT_LOG_CAPACITY);
    }
  }

  /** Stop/switch/death cancel the action; leaving reach produces a miss at contact instead. */
  private meleeAttackActive(state: GameState, attack: PendingMeleeAttack): boolean {
    const start = attack.start;
    if (state.player.health <= 0) return false;
    const enemyId = start.attacker === "player" ? start.targetId : start.sourceId;
    const entity = this.deps.entities.get(enemyId);
    if (!entity || entity.state === "dead") return false;
    if (combatRealmOf(state.player.regionId) !== attack.realm || combatRealmOf(entity.regionId) !== attack.realm) return false;
    const runtime = state.world.enemies[enemyId];
    if (!runtime || runtime.state === "dead" || runtime.health <= 0) return false;
    if (start.attacker === "enemy") return state.combat.engagedBy.includes(enemyId);
    if (state.player.id !== start.sourceId || state.combat.targetId !== enemyId
      || state.combat.activeSpellId !== null || state.activity?.kind === "eating") return false;
    const movement = state.player.movement;
    return movement.mode === "idle" || movement.destinationEntityId === enemyId;
  }

  private advanceMeleeAttacks(state: GameState, atMs: number): void {
    if (this.meleeAttacks.size === 0) return;
    const due: PendingMeleeAttack[] = [];
    for (const [sourceId, attack] of this.meleeAttacks) {
      if (!this.meleeAttackActive(state, attack)) {
        this.cancelMeleeAttack(sourceId);
        continue;
      }
      if (!attack.contacted && atMs >= attack.start.contactAtMs) due.push(attack);
    }
    // Unequal clip windups can cross in a catch-up step. The earlier strike must get the kill.
    due.sort((a, b) => a.start.contactAtMs - b.start.contactAtMs || a.start.id - b.start.id);
    for (const attack of due) {
      const start = attack.start;
      const sourceId = start.sourceId;
      if (this.meleeAttacks.get(sourceId) !== attack || !this.meleeAttackActive(state, attack)) {
        this.cancelMeleeAttack(sourceId);
        continue;
      }
      // Mark before applying damage: death and provocation can synchronously disengage an actor.
      attack.contacted = true;
      const enemyId = start.attacker === "player" ? start.targetId : start.sourceId;
      const entity = this.deps.entities.get(enemyId)!;
      const reach = start.attacker === "player"
        ? meleeReachMetres(bodyRadiusOf(entity))
        : enemyReachMetres(this.defFor(entity), bodyRadiusOf(entity));
      const inRange = distanceXZ(state.player.position, entity.position) <= reach;
      const damage = inRange ? attack.damage : 0;
      const contactAtMs = start.contactAtMs;
      if (start.attacker === "enemy") {
        this.damagePlayer(damage, sourceId, contactAtMs, start.kind, attack.maxHit);
      } else {
        let killed = false;
        if (damage > 0) {
          this.awardXp(state, "melee", damage * XP_PER_DAMAGE, contactAtMs);
          killed = this.applyEnemyDamage(
            state, entity, state.world.enemies[enemyId]!, damage, "melee", contactAtMs,
          );
        }
        this.record({
          atMs: contactAtMs, attacker: "player", sourceId, targetId: enemyId,
          damage, hit: inRange && attack.hit, maxHit: attack.maxHit, kind: "melee", killed,
          spellId: null,
        });
        // A nearby swing provokes even if its roll misses. A target that escaped reach is safe.
        if (inRange && !killed) {
          for (const listener of this.provokeListeners) listener(enemyId, contactAtMs);
        }
        this.deps.store.markDirty();
      }
    }
    for (const [sourceId, attack] of this.meleeAttacks) {
      if (atMs >= attack.start.recoverAtMs) this.meleeAttacks.delete(sourceId);
    }
  }

  private cancelMeleeAttack(sourceId: EntityId): void {
    const attack = this.meleeAttacks.get(sourceId);
    if (!attack) return;
    this.meleeAttacks.delete(sourceId);
    const queued = this.attackStarts.findIndex((start) => start.id === attack.start.id);
    if (queued >= 0) this.attackStarts.splice(queued, 1);
  }

  // --------------------------------------------------------- damage, death

  /**
   * The one path player damage takes. `systems/enemyAI.ts` uses it for Ordrun's ground slam, so a
   * special attack and an ordinary swing hit the same clamps, the same in-combat stamp, and the
   * same hit log.
   */
  damagePlayer(
    amount: number,
    sourceId: EntityId,
    atMs: number,
    kind: CombatHit["kind"] = "melee",
    maxHit = amount,
  ): void {
    const state = this.deps.store.get();
    this.markInCombat(state, atMs);
    const damage = Math.max(0, Math.floor(amount));

    if (damage > 0) {
      state.player.health = Math.max(0, state.player.health - damage);
      this.deps.store.markDirty();
    }
    this.record({
      atMs,
      attacker: "enemy",
      sourceId,
      targetId: state.player.id,
      damage,
      hit: damage > 0,
      maxHit,
      kind,
      killed: state.player.health <= 0,
      // Enemy spell actions use their authored attack, not a player spell or Essence cost.
      spellId: null,
    });
  }

  /** Public so a quest script or a debug hook can hurt an enemy without duplicating the death path. */
  damageEnemy(entityId: EntityId, amount: number, atMs: number, skill: SkillId | null = null): boolean {
    const state = this.deps.store.get();
    const entity = this.deps.entities.get(entityId);
    if (!entity) return false;
    const runtime = this.runtimeFor(state, entity);
    if (runtime.state === "dead") return false;
    return this.applyEnemyDamage(state, entity, runtime, Math.max(0, Math.floor(amount)), skill, atMs);
  }

  /** Returns true when this blow killed the target. */
  private applyEnemyDamage(
    state: GameState,
    entity: SemanticEntity,
    runtime: EnemyRuntime,
    damage: number,
    skill: SkillId | null,
    atMs: number,
  ): boolean {
    if (damage <= 0) return false;
    runtime.health = Math.max(0, runtime.health - damage);
    if (entity.combat) entity.combat.health = runtime.health;
    this.deps.store.markDirty();
    if (runtime.health > 0) return false;
    this.killEnemy(state, entity, runtime, skill, atMs);
    return true;
  }

  private killEnemy(
    state: GameState,
    entity: SemanticEntity,
    runtime: EnemyRuntime,
    skill: SkillId | null,
    atMs: number,
  ): void {
    const def = this.defFor(entity);
    const maxHealth = entity.combat?.maxHealth ?? def.maxHealth;

    runtime.health = 0;
    runtime.state = "dead";
    runtime.respawnAtMs = atMs + (entity.archetype === "boss" ? BOSS_RESPAWN_MS : ENEMY_RESPAWN_MS);
    runtime.diedAtMs = atMs;
    entity.state = "dead";
    // Published on the view as well as held in the runtime: the renderer fades the corpse out from
    // this instant, and it may not read world state to find it. `systems/enemyAI.ts` clears both on
    // respawn, so a body that comes back is not still carrying the moment it fell.
    if (entity.view) entity.view.diedAtMs = atMs;
    if (entity.combat) entity.combat.health = 0;
    this.deps.entities.setState?.(entity.id, "dead");

    if (skill) this.awardXp(state, skill, Math.round(maxHealth * KILL_XP_MULTIPLIER), atMs);

    this.enemyNextAttackAtMs.delete(entity.id);
    this.enemyOverrides.delete(entity.id);
    this.disengageEnemy(state, entity.id, atMs, false);

    this.rollDrops(state, entity, def, atMs);

    const killSerial = skill ? ++state.huntContracts.killSerial : null;

    this.deps.events.emit(
      "combat.ended",
      { reason: "killed", enemyId: entity.id, name: entity.name, xp: skill ? Math.round(maxHealth * KILL_XP_MULTIPLIER) : 0,
        creditedPlayerId: skill ? state.player.id : null, killSerial },
      entity.id,
      atMs,
    );
    if (state.combat.targetId === entity.id) {
      state.combat.targetId = null;
      state.combat.activeSpellId = null;
    }
    this.deps.store.markDirty();
  }

  /** Drop rolls run on the seeded `loot` stream so a kill never shifts the next hit roll. */
  private rollDrops(state: GameState, entity: SemanticEntity, def: EnemyDef, atMs: number): void {
    const items: ItemStack[] = [];
    for (const drop of def.drops) {
      // An Orb used to awaken its altar is permanently accounted for by `consumedOrbs`. Before use, custody in
      // equipment, storage, inventory, recovery, or ground loot suppresses duplicate boss drops.
      if (
        content.item(drop.itemId)?.orb
        && (state.magic.consumedOrbs[drop.itemId] || ownsPhysicalItem(state, drop.itemId, items))
      ) continue;
      if (!this.lootRng.chance(drop.chance)) continue;
      const quantity = this.lootRng.int(drop.quantity[0], drop.quantity[1]);
      if (quantity > 0) items.push({ itemId: drop.itemId, quantity });
    }

    if (def.marks) {
      const marks = this.lootRng.int(def.marks[0], def.marks[1]);
      if (marks > 0) {
        const added = this.deps.inventory.addCurrency?.(marks);
        if (!added || !added.ok) state.currency += marks;
        this.deps.events.emit("item.received", { currency: marks, from: entity.id }, entity.id, atMs);
      }
    }

    if (items.length === 0) return;

    // A restored save can already contain this enemy's first pile. Sequence counters are runtime
    // scratch, so advance until both canonical state and the semantic store agree the id is free.
    // Otherwise the first post-load kill overwrites the saved pile and can erase a singleton orb.
    let pileId: EntityId;
    do {
      this.pileSequence += 1;
      pileId = `loot_${entity.id}_${this.pileSequence}`;
    } while (state.world.lootPiles[pileId] || this.deps.entities.get(pileId));
    state.world.lootPiles[pileId] = {
      position: cloneVec3(entity.position),
      items,
      expiresAtMs: atMs + LOOT_DESPAWN_MS,
      ownerOnly: true,
    };

    const view = this.deps.lootView;
    this.deps.entities.add?.({
      id: pileId,
      archetype: "loot",
      name: `${entity.name}'s drop`,
      tier: entity.tier,
      regionId: entity.regionId,
      position: cloneVec3(entity.position),
      state: "available",
      interactions: ["inspect", "loot"],
      ...(view ? { view } : {}),
      meta: { droppedBy: entity.id, expiresAtMs: state.world.lootPiles[pileId]?.expiresAtMs ?? 0 },
    });

    this.deps.events.emit(
      "item.received",
      { pileId, items: items.map((row) => ({ itemId: row.itemId, quantity: row.quantity })) },
      pileId,
      atMs,
    );
  }

  // ------------------------------------------------------ engagement state

  /** Adds an enemy to `state.combat.engagedBy`. `systems/enemyAI.ts` is the only real caller. */
  engageEnemy(enemyId: EntityId, atMs: number): void {
    const state = this.deps.store.get();
    const current = this.deps.activity?.current();
    if (current && current.kind !== "eating") this.deps.activity?.cancel(atMs);
    if (!state.combat.engagedBy.includes(enemyId)) {
      state.combat.engagedBy.push(enemyId);
      this.deps.events.emit("combat.started", { by: enemyId, initiator: "enemy" }, enemyId, atMs);
      this.deps.store.markDirty();
    }
    this.markInCombat(state, atMs);
  }

  disengageEnemy(state: GameState, enemyId: EntityId, atMs: number, emit = true): void {
    this.cancelMeleeAttack(enemyId);
    const index = state.combat.engagedBy.indexOf(enemyId);
    if (index >= 0) {
      state.combat.engagedBy.splice(index, 1);
      if (emit) this.deps.events.emit("combat.ended", { reason: "disengaged", enemyId }, enemyId, atMs);
      this.deps.store.markDirty();
    }
    this.enemyNextAttackAtMs.delete(enemyId);
  }

  isEngaged(enemyId: EntityId): boolean {
    return this.deps.store.get().combat.engagedBy.includes(enemyId);
  }

  playerTargetId(): EntityId | null {
    return this.deps.store.get().combat.targetId;
  }

  /**
   * Overrides part of an enemy's stat block for as long as it lives. `systems/enemyAI.ts` uses it
   * to apply `ORDRUN_PHASES`, whose phase 2 drops the boss's armour from 62 to 50, its cadence
   * from 3.0 s to 2.4 s, and raises its max hit from 12 to 14.
   */
  setEnemyOverride(enemyId: EntityId, override: Partial<EnemyDef> | null): void {
    if (!override) this.enemyOverrides.delete(enemyId);
    else this.enemyOverrides.set(enemyId, override);
  }

  /** `systems/enemyAI.ts` subscribes so a territorial enemy retaliates when struck. */
  onEnemyProvoked(listener: (enemyId: EntityId, atMs: number) => void): () => void {
    this.provokeListeners.push(listener);
    return () => {
      const index = this.provokeListeners.indexOf(listener);
      if (index >= 0) this.provokeListeners.splice(index, 1);
    };
  }

  /** Stamps the eight-second no-regen window in PRD 2.3. Also what `PlayerView.inCombat` reads. */
  markInCombat(state: GameState, atMs: number): void {
    const until = atMs + HEALTH_REGEN_BLOCKED_MS;
    if (until > state.combat.inCombatUntilMs) {
      state.combat.inCombatUntilMs = until;
      this.deps.store.markDirty();
    }
  }

  /** Called by `systems/death.ts` on respawn: nothing survives a death. */
  resetOnDeath(atMs: number): void {
    const state = this.deps.store.get();
    this.playerCombatRealm = undefined;
    for (const enemyId of [...state.combat.engagedBy]) this.disengageEnemy(state, enemyId, atMs, false);
    state.combat.engagedBy.length = 0;
    state.combat.targetId = null;
    state.combat.activeSpellId = null;
    state.combat.nextAttackAtMs = 0;
    state.combat.inCombatUntilMs = 0;
    this.enemyNextAttackAtMs.clear();
    this.enemyOverrides.clear();
    // Bolts in the air die with the caster. This method's promise is that nothing survives a death,
    // and a spell that landed afterwards would break it in a way the player could see: it would
    // damage and re-PROVOKE a creature that the death had just released, seconds after the screen
    // said the fight was over.
    this.pendingSpellHits.length = 0;
    this.meleeAttacks.clear();
    this.attackStarts.length = 0;
    this.deps.store.markDirty();
  }

  /**
   * Drops everything this system is holding outside `GameState`.
   *
   * Called when the canonical world is REPLACED rather than merely changed — a new game, a debug
   * `resetWorld`, a save load. `pendingSpellHits` and `hitLog` are process-local, so without this
   * they survive the swap: a bolt rolled against the old world would land in the new one, on an
   * entity id that now belongs to a different creature or to nothing at all.
   */
  resetForNewWorld(): void {
    this.playerCombatRealm = undefined;
    this.pendingSpellHits.length = 0;
    this.meleeAttacks.clear();
    this.attackStarts.length = 0;
    this.hitLog.length = 0;
    this.enemyNextAttackAtMs.clear();
    this.enemyOverrides.clear();
    this.defCache.clear();
    this.nextCombatTickAtMs = -1;
  }

  // ------------------------------------------------------------ read-only

  /** Recent swings, newest last. `render/vfx.ts` polls this for damage numbers. */
  hits(): readonly CombatHit[] {
    return this.hitLog;
  }

  /** Drains the hit log. A renderer that has consumed the frame's hits calls this. */
  consumeHits(): CombatHit[] {
    return this.hitLog.splice(0, this.hitLog.length);
  }

  /** The render layer starts the attack pose at windup, before any damage is paid. */
  consumeAttackStarts(): CombatAttackStart[] {
    return this.attackStarts.splice(0, this.attackStarts.length);
  }

  /** AI holds its feet during windup and recovery; explicit player movement still cancels. */
  isAttackCommitted(entityId: EntityId): boolean {
    const attack = this.meleeAttacks.get(entityId);
    return attack !== undefined && this.lastAtMs < attack.start.recoverAtMs
      && this.meleeAttackActive(this.deps.store.get(), attack);
  }

  /**
   * What the player would do to this enemy right now, and it to them. The skill guide, the UI
   * "danger" readout, and the balance checks all want the same four numbers.
   */
  forecast(entityId: EntityId, spellId?: SpellId): {
    hitChance: number;
    maxHit: number;
    intervalMs: number;
    timeToKillMs: number;
    incomingDps: number;
  } | undefined {
    const state = this.deps.store.get();
    const entity = this.deps.entities.get(entityId);
    if (!entity) return undefined;
    const def = this.defFor(entity);
    const gear = this.deps.equipment.totals();
    const spell = spellId ? content.spell(spellId) : undefined;

    const chance = spell
      ? hitChance(
        attackRoll(state.skills.magic.level, gear.magicAccuracy, MAGIC_STYLE_FACTOR),
        defenceRoll(def.defenceLevel, def.magicArmour),
      )
      : hitChance(
        attackRoll(state.skills.melee.level, gear.accuracy, MELEE_STYLE_FACTOR),
        defenceRoll(def.defenceLevel, def.armour),
      );
    const maxHit = spell
      ? magicMaxHit(state.skills.magic.level, gear.magicPower, spell)
      : meleeMaxHit(state.skills.melee.level, gear.power);
    const intervalMs = spell
      ? (magicLoadout(state)?.castMs ?? 3_000)
      : attackIntervalMs(this.weaponSpeedMs());
    const health = entity.combat?.maxHealth ?? def.maxHealth;

    const enemyChance = hitChance(
      attackRoll(def.attackLevel, def.accuracy, MELEE_STYLE_FACTOR),
      defenceRoll(state.skills.melee.level, gear.armour),
    );
    const incomingDps = expectedDamagePerSwing(enemyChance, def.maxHit)
      / (attackIntervalMs(def.attackSpeedMs) / 1000);

    return {
      hitChance: chance,
      maxHit,
      intervalMs,
      timeToKillMs: expectedTimeToKillMs({ hitChance: chance, maxHit, intervalMs, targetHealth: health }),
      incomingDps,
    };
  }

  /**
   * The content row behind a spawned enemy, with any live override folded in. Public so enemy AI,
   * the forecast and the bestiary all read one resolution.
   */
  defFor(entity: SemanticEntity): EnemyDef {
    let base = this.defCache.get(entity.id);
    if (!base) {
      base = resolveEnemyDef(entity);
      this.defCache.set(entity.id, base);
    }
    const override = this.enemyOverrides.get(entity.id);
    return override ? { ...base, ...override } : base;
  }

  /** The stat block as content authored it, ignoring boss phases. */
  baseDefFor(entity: SemanticEntity): EnemyDef {
    const cached = this.defCache.get(entity.id);
    if (cached) return cached;
    const resolved = resolveEnemyDef(entity);
    this.defCache.set(entity.id, resolved);
    return resolved;
  }

  /** Ensures `state.world.enemies[id]` exists, seeded from the entity's authored spawn. */
  runtimeFor(state: GameState, entity: SemanticEntity): EnemyRuntime {
    const existing = state.world.enemies[entity.id];
    if (existing) return existing;
    const created: EnemyRuntime = {
      health: entity.combat?.health ?? entity.combat?.maxHealth ?? this.defFor(entity).maxHealth,
      state: "idle",
      spawnPos: spawnPositionOf(entity),
      respawnAtMs: null,
    };
    state.world.enemies[entity.id] = created;
    this.deps.store.markDirty();
    return created;
  }

  // ------------------------------------------------------------- internals

  private rejectTarget(entity: SemanticEntity): { code: GameErrorCode; message: string } | undefined {
    if (entity.archetype !== "enemy" && entity.archetype !== "boss") {
      return { code: "INVALID_ARGUMENT", message: `${entity.name} is not something you can attack.` };
    }
    if (entity.state === "dead") {
      return { code: "INVALID_ARGUMENT", message: `${entity.name} is already dead.` };
    }
    if (!sameCombatRealm(this.deps.store.get().player.regionId, entity.regionId)) {
      return { code: "OUT_OF_RANGE", message: `${entity.name} is on another floor. Enter that area first.` };
    }
    return undefined;
  }

  /** Only a validated explicit command replaces movement; combat ticks never claim this authority. */
  private replaceUnrelatedMovement(state: GameState, targetId: EntityId, atMs: number): void {
    const movement = state.player.movement;
    if (movement.mode === "path" && movement.destinationEntityId === targetId) return;
    // A portal can be semantically idle after placement while its curtain still owns a queued
    // route continuation. Stop also invalidates that private token before the new command starts.
    this.deps.movement?.stop(state, atMs, "combat-command");
  }

  private engagePlayer(
    state: GameState,
    entity: SemanticEntity,
    spellId: SpellId | null,
    atMs: number,
  ): void {
    // A new command replaces the old target; the previous target's `combat.ended` still fires.
    // The attack timer belongs to the player and survives that replacement. Otherwise alternating
    // two living targets turns every command into an immediately-due attack and bypasses cadence.
    if (state.combat.targetId && state.combat.targetId !== entity.id) {
      this.disengagePlayer("switched-target", atMs);
    }

    const current = this.deps.activity?.current();
    if (current && current.kind !== "eating") this.deps.activity?.cancel(atMs);

    state.combat.targetId = entity.id;
    state.combat.activeSpellId = spellId;
    this.playerCombatRealm = combatRealmOf(state.player.regionId);
    // Neither re-clicking nor switching targets restarts cadence. A fresh character has a due time
    // of zero, and an idle character's old due time is already in the past, so a genuine first
    // attack remains immediate without writing the timer here.
    this.runtimeFor(state, entity);
    this.markInCombat(state, atMs);
    this.deps.store.markDirty();

    this.deps.events.emit(
      "combat.started",
      { targetId: entity.id, name: entity.name, initiator: "player", spellId },
      entity.id,
      atMs,
    );

    // TARGETING IS NOT PROVOCATION. This used to notify the provoke listeners right here, so a
    // passive or territorial creature broke into a charge on the CLICK — before the player had
    // swung at it, and for a caster, from up to fifteen metres before the first cast could even
    // resolve. That made the whole ranged opening pointless: the thing was already on top of you.
    //
    // Provocation now happens where the fiction says it does, in `resolvePlayerAttack`, on a swing
    // or a cast actually being thrown. An `aggressive` creature still notices the player on its own
    // through `aggroRadius` in `systems/enemyAI.ts` — that is its behaviour, not a reaction — and a
    // `passive` or `territorial` one waits to be attacked, which is what those words mean.
  }

  /**
   * True when the main hand is a magic weapon, which is what makes "attack" cast.
   *
   * Content marks magic weapons explicitly. That keeps a basic wand magical even when it grants no
   * power, and it prevents an enchanted blade from silently changing Attack into Cast. Bare hands
   * stay melee because there is no main-hand item.
   */
  private wieldingMagic(): boolean {
    const worn = this.deps.equipment.slots().mainHand;
    if (!worn) return false;
    return content.item(worn.itemId)?.magicWeapon !== undefined;
  }

  /** The equipped main-hand's cadence, or bare fists at 2.4 s. */
  private weaponSpeedMs(): number {
    const worn = this.deps.equipment.slots().mainHand;
    if (!worn) return UNARMED_ATTACK_SPEED_MS;
    return content.item(worn.itemId)?.equip?.attackSpeedMs ?? UNARMED_ATTACK_SPEED_MS;
  }

  /**
   * The player's standing spell choice, or null for "pick the best one for me".
   *
   * Persisted in `state.combat` rather than in `ui/settings.ts` because it is a fact about the
   * CHARACTER, not about the client: a save carried to another browser should still cast fire, and
   * "New Game" must reset it, which is exactly the line `ui/settings.ts` draws between the two.
   * Setting a spell the player cannot currently cast is allowed and deliberate — they may be one
   * level short, and silently refusing the click would read as a broken button. `preferredSpellId`
   * falls back to the automatic pick until it becomes castable.
   */
  setPreferredSpell(spellId: SpellId | null): void {
    const state = this.deps.store.get();
    if (state.combat.preferredSpellId === spellId) return;
    state.combat.preferredSpellId = spellId;
    // A live engagement re-reads its spell from `activeSpellId`, so switching mid-fight has to move
    // that too, or the change does not take effect until the target dies.
    if (state.combat.activeSpellId !== null) {
      const next = this.preferredSpellId();
      if (next) state.combat.activeSpellId = next;
    }
    this.deps.store.markDirty();
  }

  preferredSpell(): SpellId | null {
    return this.deps.store.get().combat.preferredSpellId ?? null;
  }

  /**
   * Which spell a "cast" verb throws: the player's standing choice when they can pay for it,
   * otherwise the strongest thing they can.
   *
   * The standing choice wins while it is castable. If it is not, automatic selection starts fresh
   * instead of retaining a weaker spell from an old engagement.
   *
   * `tier` is no longer the ranking key. It was, and with sixteen spells it stopped working: the
   * ladder maps several reqLevels onto one `content/xp.ts` tier — Skirlbolt (17) and Sleetbolt (23)
   * are both tier 20 — so a tier-first comparison called them equal and fell through to a reqLevel
   * tiebreak that only worked by luck. reqLevel IS the ladder here; it is what the whole table is
   * ordered by and what `baseMax` climbs with, so rank on it directly.
   */
  private preferredSpellId(): SpellId | undefined {
    const state = this.deps.store.get();
    const castable = (spell: SpellDef | undefined): spell is SpellDef =>
      spell !== undefined
      && spellBlockReason(state, spell) === null;

    const chosenId = state.combat.preferredSpellId;
    const chosen = chosenId ? content.spell(chosenId) : undefined;
    if (castable(chosen)) return chosen.id;

    let best: SpellDef | undefined;
    for (const spell of content.allSpells()) {
      if (!castable(spell)) continue;
      if (!best || spell.reqLevel > best.reqLevel) best = spell;
    }
    return best?.id;
  }

  /** XP always goes through `addSkillXp` so the level curve and `level.gained` stay honest. */
  private awardXp(state: GameState, skill: SkillId, amount: number, atMs: number): void {
    if (amount <= 0) return;
    const result = addSkillXp(state, skill, amount);
    if (result.levelsGained > 0) {
      this.deps.events.emit(
        "level.gained",
        { skill, level: result.newLevel, levelsGained: result.levelsGained },
        undefined,
        atMs,
      );
    }
  }

  private record(hit: CombatHit): void {
    this.hitLog.push(hit);
    if (this.hitLog.length > HIT_LOG_CAPACITY) this.hitLog.splice(0, this.hitLog.length - HIT_LOG_CAPACITY);
  }
}

// ---------------------------------------------------------------- helpers

function ownsPhysicalItem(state: GameState, itemId: ItemId, pending: readonly ItemStack[]): boolean {
  const contains = (stacks: readonly (ItemStack | null)[]): boolean =>
    stacks.some((stack) => stack?.itemId === itemId && stack.quantity > 0);
  if (contains(pending) || contains(state.inventory.slots) || contains(state.bank.slots)) return true;
  if (contains(Object.values(state.equipment))) return true;
  if (state.world.recoveryCache && contains(state.world.recoveryCache.items)) return true;
  return Object.values(state.world.lootPiles).some((pile) => contains(pile.items));
}

function started(
  result: Result<{ targetId: EntityId }>,
  message: string,
): Result<{ started: string }> {
  if (!result.ok) return result;
  return ok({ started: message });
}

export function cloneVec3(value: Vec3): Vec3 {
  return [value[0], value[1], value[2]];
}

/** The authored spawn point, from `meta.spawnX/spawnZ` when the region builder recorded it. */
export function spawnPositionOf(entity: SemanticEntity): Vec3 {
  const meta = entity.meta;
  const x = meta?.spawnX;
  const z = meta?.spawnZ;
  if (typeof x === "number" && typeof z === "number") return [x, entity.position[1], z];
  return cloneVec3(entity.position);
}

export function behaviourOf(entity: SemanticEntity): EnemyDef["behaviour"] {
  const raw = entity.meta?.behaviour;
  if (raw === "passive" || raw === "aggressive" || raw === "territorial") return raw;
  return entity.archetype === "boss" ? "territorial" : "aggressive";
}

/**
 * Maps a spawned entity onto its content row.
 *
 * The region builder names instances `${groupId}_${index}` and stashes `groupId` and `family` in
 * `meta`, so several ids are plausible and content is authored by a different worker. Every
 * candidate is tried before falling back to a row synthesised from the entity's own combat block,
 * which keeps a content gap a balance problem rather than a crash.
 */
export function resolveEnemyDef(entity: SemanticEntity): EnemyDef {
  for (const candidate of enemyDefCandidates(entity)) {
    const def = content.enemy(candidate);
    if (def) return def;
  }
  return synthesiseEnemyDef(entity);
}

function enemyDefCandidates(entity: SemanticEntity): string[] {
  const out: string[] = [];
  const meta = entity.meta;
  if (meta) {
    for (const key of ["enemyId", "enemyDefId", "defId", "groupId", "family"]) {
      const value = meta[key];
      if (typeof value === "string" && value.length > 0) out.push(value);
    }
  }
  out.push(entity.id);
  out.push(entity.id.replace(/_\d+$/, ""));
  out.push(slug(entity.name));
  return out;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** A believable row for an enemy content has not authored yet. Never wins over a real row. */
function synthesiseEnemyDef(entity: SemanticEntity): EnemyDef {
  const level = entity.combat?.level ?? Math.max(1, entity.tier);
  const maxHealth = entity.combat?.maxHealth ?? 10 + level * 2;
  return {
    id: entity.id,
    name: entity.name,
    family: typeof entity.meta?.family === "string" ? entity.meta.family : "unknown",
    tier: entity.tier,
    maxHealth,
    attackLevel: level,
    defenceLevel: level,
    accuracy: level * 2,
    armour: level * 2,
    magicArmour: level * 2,
    maxHit: Math.max(1, Math.floor(1 + level / 3)),
    attackSpeedMs: UNARMED_ATTACK_SPEED_MS,
    aggroRadius: entity.combat?.aggroRadius ?? 6,
    behaviour: behaviourOf(entity),
    drops: [],
  };
}
