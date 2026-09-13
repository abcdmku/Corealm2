/**
 * Health: the derived maximum, out-of-combat regeneration, and the low-health warning.
 *
 * PRD 2.3, in full:
 *
 *   vitalityLevel = max(1, floor((melee + magic) / 2))
 *   maxHealth     = 20 + 3 * vitalityLevel + sum(equipped.health)
 *
 * There is no Health skill and no Health XP. Max health moves when Melee or Magic moves, or when
 * gear changes, which is why this system recomputes it every tick instead of trusting anyone to
 * remember. The formula itself lives in `computeMaxHealth` in state/store.ts and is called, not
 * copied: two copies of a derived stat is how a save ends up disagreeing with the HUD.
 *
 * Regeneration is 1 point every 6.0 s out of combat, and stops entirely while any hostile has
 * targeted the player within the last 8 s. Both windows are `state.combat.inCombatUntilMs`, which
 * `systems/combat.ts` stamps on every swing, every hit taken, and every enemy that engages.
 */
import type { EntityId, EquipmentBonuses } from "../contracts.js";
import type { GameState, Store } from "../state/store.js";
import { computeMaxHealth } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { TickSystem } from "../app/loop.js";
import { HEALTH_REGEN_INTERVAL_MS, LOW_HEALTH_FRACTION } from "../app/config.js";

/** Satisfied exactly by `EquipmentSystem` in systems/equipment.ts. */
export interface HealthEquipmentPort {
  totals(): EquipmentBonuses;
}

export interface HealthDeps {
  store: Store;
  events: EventBus;
  equipment: HealthEquipmentPort;
}

export class HealthSystem implements TickSystem {
  readonly name = "health";

  /** PRD section 3, row 9 ("Health"), scaled by ten. After combat (80), before death (100). */
  readonly order = 90;

  /** Milliseconds banked toward the next regenerated point. Reset by any combat contact. */
  private regenAccumulatorMs = 0;
  /** Latch, so `health.low` fires on the crossing rather than every tick below the line. */
  private lowLatched = false;
  private lastAtMs = 0;

  constructor(private readonly deps: HealthDeps) {}

  tick(deltaMs: number, atMs: number): void {
    this.lastAtMs = atMs;
    const state = this.deps.store.get();

    this.refreshMaxHealth(state);

    if (state.player.health <= 0) {
      // Death is `systems/death.ts`'s row. Here it only means: bank nothing, warn nothing.
      this.regenAccumulatorMs = 0;
      return;
    }

    this.regenerate(state, deltaMs, atMs);
    this.checkLowHealth(state, atMs);
  }

  // ---------------------------------------------------------------- derived

  /**
   * Recomputes the cap and clamps current health into it. Returns the cap.
   *
   * Cheap enough to run every tick (two level reads and an equipment sum) and it removes a whole
   * class of bug: no caller has to remember to refresh after a level-up, an equip, or a load.
   */
  refreshMaxHealth(state: GameState): number {
    const max = computeMaxHealth(state, this.deps.equipment.totals().health);
    if (max === state.player.maxHealth && state.player.health <= max) return max;

    state.player.maxHealth = max;
    if (state.player.health > max) state.player.health = max;
    this.deps.store.markDirty();
    return max;
  }

  // ------------------------------------------------------------ regeneration

  private regenerate(state: GameState, deltaMs: number, _atMs: number): void {
    const max = state.player.maxHealth;
    if (state.player.health >= max) {
      this.regenAccumulatorMs = 0;
      return;
    }

    // PRD 2.3: "Regeneration stops while any hostile has targeted the player within the last 8 s."
    // `inCombatUntilMs` is that window, stamped by combat on contact in either direction.
    if (this.lastAtMs < state.combat.inCombatUntilMs) {
      this.regenAccumulatorMs = 0;
      return;
    }

    this.regenAccumulatorMs += deltaMs;
    let healed = 0;
    while (this.regenAccumulatorMs >= HEALTH_REGEN_INTERVAL_MS && state.player.health + healed < max) {
      this.regenAccumulatorMs -= HEALTH_REGEN_INTERVAL_MS;
      healed += 1;
    }
    if (healed === 0) return;

    state.player.health = Math.min(max, state.player.health + healed);
    if (state.player.health >= max) this.regenAccumulatorMs = 0;
    this.deps.store.markDirty();
  }

  // ------------------------------------------------------------- low health

  private checkLowHealth(state: GameState, atMs: number): void {
    const fraction = state.player.maxHealth > 0 ? state.player.health / state.player.maxHealth : 0;

    if (fraction < LOW_HEALTH_FRACTION) {
      if (this.lowLatched) return;
      this.lowLatched = true;
      this.deps.events.emit(
        "health.low",
        {
          health: state.player.health,
          maxHealth: state.player.maxHealth,
          fraction: Math.round(fraction * 1000) / 1000,
          threshold: LOW_HEALTH_FRACTION,
        },
        undefined,
        atMs,
      );
      return;
    }
    this.lowLatched = false;
  }

  // ----------------------------------------------------------------- public

  /**
   * The one healing path. Food, a quest reward and a respawn all land here so the cap, the dirty
   * flag and the low-health latch are handled once.
   *
   * Returns the health actually restored; healing above `maxHealth` is wasted, per PRD 2.7.
   */
  heal(amount: number, _atMs: number = this.lastAtMs): number {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const state = this.deps.store.get();
    if (state.player.health <= 0) return 0;

    const max = state.player.maxHealth;
    const before = state.player.health;
    state.player.health = Math.min(max, before + Math.floor(amount));
    const restored = state.player.health - before;
    if (restored > 0) {
      this.deps.store.markDirty();
      if (state.player.health / max >= LOW_HEALTH_FRACTION) this.lowLatched = false;
    }
    return restored;
  }

  /** Restores to full and re-arms the warning. `systems/death.ts` calls this on respawn. */
  restoreFull(): number {
    const state = this.deps.store.get();
    state.player.health = this.refreshMaxHealth(state);
    this.regenAccumulatorMs = 0;
    this.lowLatched = false;
    this.deps.store.markDirty();
    return state.player.health;
  }

  /** True while the eight-second no-regen window is open. Same source as `PlayerView.inCombat`. */
  isInCombat(atMs: number = this.lastAtMs): boolean {
    return atMs < this.deps.store.get().combat.inCombatUntilMs;
  }

  /** Seconds until the next regenerated point, or null when regeneration is blocked or capped. */
  secondsToNextRegen(): number | null {
    const state = this.deps.store.get();
    if (state.player.health >= state.player.maxHealth) return null;
    if (this.isInCombat()) return null;
    return (HEALTH_REGEN_INTERVAL_MS - this.regenAccumulatorMs) / 1000;
  }

  /** For `__gameDebug` and the acceptance checks: who, if anyone, is currently hunting the player. */
  hostileIds(): readonly EntityId[] {
    return this.deps.store.get().combat.engagedBy;
  }
}
