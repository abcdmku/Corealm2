import { err, ok, type ActiveUtilityEffect, type EntityId, type ItemId, type Result, type SemanticEntity,
  type TownTeleportId, type TownTeleportPad, type UtilityEffectGroup, type UtilityMagicView, type UtilitySpellId, type Vec3 } from "../contracts.js";
import type { GameState, Store } from "../state/store.js";
import { UTILITY_SPELLS, utilitySpell } from "../content/utilityMagic.js";
import { distanceXZ } from "../core/math.js";
import { INTERACT_RANGE, SPELL_RANGE } from "../app/config.js";
import { sameCombatRealm } from "./combat.js";

export function utilityMagnitude(effects: readonly ActiveUtilityEffect[] | undefined, group: UtilityEffectGroup, atMs: number): number {
  return Math.max(0, ...(effects ?? []).filter(effect => effect.group === group && effect.expiresAtMs > atMs).map(effect => effect.magnitude));
}
export function utilityPlayerSpeed(state: GameState, atMs = state.meta.playSeconds * 1000): number {
  return 1 + utilityMagnitude(state.magic.utilityEffects, "haste", atMs);
}
export function cancelTownTeleport(state: GameState): void { state.magic.teleportCast = null; }
function finite(point: unknown): point is Vec3 { return Array.isArray(point) && point.length === 3 && point.every(Number.isFinite); }
function put(effects: ActiveUtilityEffect[], effect: ActiveUtilityEffect, atMs: number): void {
  const previous = effects.find(e => e.group === effect.group && e.sourceFieldId === effect.sourceFieldId);
  if (previous && previous.magnitude > effect.magnitude && previous.expiresAtMs > atMs) return;
  if (previous) effects.splice(effects.indexOf(previous), 1);
  effects.push(effect);
}
export interface UtilityMagicPorts {
  store: Store;
  fuel: { available(itemId: ItemId): number; spend(costs: readonly {itemId: ItemId; quantity: number}[]): Result<unknown> };
  entities: { get(id: EntityId): SemanticEntity | undefined; all(): SemanticEntity[] };
  now(): number; allies(): GameState[]; pads(): readonly TownTeleportPad[];
  stop(): void; snap(point: Vec3): Vec3 | null;
}
export class UtilityMagicSystem {
  readonly order = 75;
  readonly name = "utilityMagic";
  private sequence = 0;
  constructor(private readonly ports: UtilityMagicPorts) {}
  private blocked(level: number, costs: readonly {itemId: ItemId; quantity: number}[], allowTeleport = false): string | null {
    return utilityBlocked(this.ports.store.get(), level, costs, this.ports.fuel.available.bind(this.ports.fuel), this.ports.now(), allowTeleport);
  }
  cast(spellId: UtilitySpellId, target?: EntityId | Vec3): Result<{spellId: UtilitySpellId}> {
    const spell = utilitySpell(spellId), state = this.ports.store.get(), now = this.ports.now();
    if (!spell) return err("INVALID_ARGUMENT", "Unknown utility spell.");
    const blocked = this.blocked(spell.reqLevel, spell.costs);
    if (blocked) return err("REQUIREMENTS_NOT_MET", blocked);
    let enemy: SemanticEntity | undefined;
    let point = state.player.position;
    if (spell.target === "enemy") {
      enemy = typeof target === "string" ? this.ports.entities.get(target) : undefined;
      if (!enemy || !enemy.combat || !["enemy", "boss"].includes(enemy.archetype) || enemy.state === "dead"
        || enemy.combat.health <= 0 || !sameCombatRealm(state.player.regionId, enemy.regionId)) return err("INVALID_ARGUMENT", "Choose a living enemy in this realm.");
      if (spell.group === "root" && enemy.archetype === "boss") return err("UNAVAILABLE", "Bosses resist binding magic.");
      point = enemy.position;
    } else if (spell.target === "area") {
      if (!finite(target)) return err("INVALID_ARGUMENT", "Choose a finite ground position.");
      const snapped = this.ports.snap(target);
      if (!snapped || !finite(snapped) || distanceXZ(target, snapped) > 1 || Math.abs(snapped[1] - target[1]) > 2) return err("NOT_REACHABLE", "That ground cannot hold a spell field.");
      point = snapped;
    }
    if (!finite(point) || distanceXZ(point, state.player.position) > SPELL_RANGE || Math.abs(point[1] - state.player.position[1]) > SPELL_RANGE) return err("OUT_OF_RANGE", "Target is outside spell range.");
    const paid = this.ports.fuel.spend(spell.costs); if (!paid.ok) return paid;
    if (spell.target === "area") {
      state.magic.utilityFields = state.magic.utilityFields.filter(field => field.spellId !== spellId);
      state.magic.utilityFields.push({id: `${state.player.id}:${now}:${++this.sequence}`, spellId, ownerId: state.player.id,
        position: [...point], regionId: state.player.regionId, radius: spell.radius, startedAtMs: now, expiresAtMs: now + spell.durationMs, lastTickAtMs: now});
    } else if (spell.group !== "healing") {
      const effects = enemy ? this.enemyEffects(enemy) : state.magic.utilityEffects;
      this.prune(effects, now);
      put(effects, {spellId, group: spell.group, magnitude: spell.magnitude, expiresAtMs: now + spell.durationMs}, now);
    }
    this.ports.store.markDirty();
    return ok({spellId});
  }
  activateTeleport(townId: TownTeleportId): Result<{townId: TownTeleportId}> {
    const state = this.ports.store.get(), pad = this.ports.pads().find(p => p.id === townId);
    if (!pad) return err("NOT_FOUND", "Unknown town platform.");
    if (state.player.health <= 0) return err("DEAD", "You are dead.");
    if (pad.regionId !== state.player.regionId || distanceXZ(pad.position, state.player.position) > INTERACT_RANGE
      || Math.abs(pad.position[1] - state.player.position[1]) > 2) return err("OUT_OF_RANGE", "Visit the town platform to activate it.");
    state.magic.unlockedTeleports[townId] = true; this.ports.store.markDirty(); return ok({townId});
  }
  teleport(townId: TownTeleportId): Result<{townId: TownTeleportId; endsAtMs: number}> {
    const state = this.ports.store.get(), pad = this.ports.pads().find(p => p.id === townId);
    if (!pad) return err("NOT_FOUND", "Unknown town platform.");
    if (!state.magic.unlockedTeleports[townId]) return err("REQUIREMENTS_NOT_MET", "Visit and activate that town platform first.");
    const blocked = this.blocked(pad.reqLevel, [{itemId: "temporal_essence", quantity: pad.cost}]);
    if (blocked) return err("REQUIREMENTS_NOT_MET", blocked);
    this.ports.stop();
    const startedAtMs = this.ports.now(), endsAtMs = startedAtMs + 3000;
    state.magic.teleportCast = {townId, startedAtMs, endsAtMs, origin: [...state.player.position], healthAtStart: state.player.health};
    this.ports.store.markDirty(); return ok({townId, endsAtMs});
  }
  private enemyEffects(entity: SemanticEntity): ActiveUtilityEffect[] {
    const runtime = this.ports.store.get().world.enemies[entity.id] ??= {health: entity.combat!.health, state: "idle", spawnPos: [...entity.position], respawnAtMs: null};
    const effects = runtime ? (runtime.utilityEffects ??= []) : (entity.combat!.utilityEffects ??= []);
    entity.combat!.utilityEffects = effects; return effects;
  }
  private prune(effects: ActiveUtilityEffect[], now: number): void {
    for (let i = effects.length - 1; i >= 0; i--) if (effects[i]!.expiresAtMs <= now) effects.splice(i, 1);
  }
  tick(deltaMs: number, atMs: number): void {
    const state = this.ports.store.get();
    if (state.player.health <= 0) { state.magic.utilityEffects = []; state.magic.utilityFields = []; cancelTownTeleport(state); return; }
    this.prune(state.magic.utilityEffects, atMs);
    // Field buffs are rebuilt from position every tick; self enchantments retain their own timer.
    state.magic.utilityEffects = state.magic.utilityEffects.filter(effect => !effect.sourceFieldId);
    let healing = 0;
    for (const ally of this.ports.allies()) {
      if (ally.player.health <= 0) continue;
      for (const field of ally.magic.utilityFields) {
        const spell = utilitySpell(field.spellId);
        if (!spell || field.expiresAtMs < atMs || !sameCombatRealm(field.regionId, state.player.regionId)
          || distanceXZ(field.position, state.player.position) > field.radius || Math.abs(field.position[1] - state.player.position[1]) > 3) continue;
        if (spell.group === "healing") {
          const elapsed = Math.max(0, Math.min(atMs, field.expiresAtMs) - Math.max(atMs - deltaMs, field.startedAtMs));
          healing = Math.max(healing, state.player.maxHealth * spell.magnitude * elapsed / spell.durationMs);
        } else if (spell.group === "ward" && field.expiresAtMs > atMs) put(state.magic.utilityEffects,
          {spellId: spell.id, group: "ward", magnitude: spell.magnitude, expiresAtMs: Math.min(field.expiresAtMs, atMs + 101), sourceFieldId: field.id}, atMs);
      }
    }
    state.player.health = Math.min(state.player.maxHealth, state.player.health + healing);
    const hostileFields = state.magic.utilityFields.filter(field => ["root", "weaken", "slow"].includes(utilitySpell(field.spellId)!.group));
    for (const entity of hostileFields.length ? this.ports.entities.all() : []) {
      if (!entity.combat || !["enemy", "boss"].includes(entity.archetype)) continue;
      const effects = this.enemyEffects(entity); this.prune(effects, atMs);
      for (let i = effects.length - 1; i >= 0; i--) if (effects[i]!.sourceFieldId?.startsWith(`${state.player.id}:`)) effects.splice(i, 1);
      if (entity.state === "dead" || entity.combat.health <= 0) { effects.length = 0; continue; }
      for (const field of state.magic.utilityFields) {
        const spell = utilitySpell(field.spellId)!;
        if (!["root", "weaken", "slow"].includes(spell.group) || (["root", "slow"].includes(spell.group) && entity.archetype === "boss")
          || field.expiresAtMs <= atMs || !sameCombatRealm(field.regionId, entity.regionId)
          || distanceXZ(field.position, entity.position) > field.radius || Math.abs(field.position[1] - entity.position[1]) > 3) continue;
        put(effects, {spellId: spell.id, group: spell.group as UtilityEffectGroup, magnitude: spell.magnitude,
          expiresAtMs: Math.min(field.expiresAtMs, atMs + 101), sourceFieldId: field.id}, atMs);
      }
    }
    state.magic.utilityFields = state.magic.utilityFields.filter(field => field.expiresAtMs >= atMs);
    const cast = state.magic.teleportCast;
    if (cast) {
      if (distanceXZ(cast.origin, state.player.position) > .01 || Math.abs(cast.origin[1] - state.player.position[1]) > .1
        || state.player.health < cast.healthAtStart || state.player.movement.mode !== "idle") cancelTownTeleport(state);
      else if (atMs >= cast.endsAtMs) {
        const pad = this.ports.pads().find(p => p.id === cast.townId);
        const landing = pad && this.ports.snap(pad.position);
        cancelTownTeleport(state);
        if (pad && landing && finite(landing) && distanceXZ(landing, pad.position) <= 1 && Math.abs(landing[1] - pad.position[1]) <= 2
          && !this.blocked(pad.reqLevel, [{itemId: "temporal_essence", quantity: pad.cost}], true)) {
          const paid = this.ports.fuel.spend([{itemId: "temporal_essence", quantity: pad.cost}]);
          if (paid.ok) { this.ports.stop(); state.player.position = [...landing]; state.player.regionId = pad.regionId; }
        }
      }
    }
    this.ports.store.markDirty();
  }
  view(): UtilityMagicView {
    return buildUtilityMagicView(this.ports.store.get(), this.ports.pads(), this.ports.fuel.available.bind(this.ports.fuel), this.ports.now());
  }
}
function utilityBlocked(state: GameState, level: number, costs: readonly {itemId: ItemId; quantity: number}[],
  available: (id: ItemId) => number, atMs: number, allowTeleport = false): string | null {
  if (state.player.health <= 0) return "You are dead.";
  if (state.skills.magic.level < level) return `Requires Magic ${level}.`;
  if (!allowTeleport && state.magic.teleportCast) return "A teleport is already in progress.";
  if (state.activity || (state.combat.castLock && state.combat.castLock.endsMs > atMs)) return "Finish your current action first.";
  const missing = costs.find(cost => available(cost.itemId) < cost.quantity);
  return missing ? `Requires ${missing.quantity} ${missing.itemId.replaceAll("_", " ")}.` : null;
}
export function buildUtilityMagicView(state: GameState, pads: readonly TownTeleportPad[], available: (id: ItemId) => number, atMs: number): UtilityMagicView {
  return {spells: UTILITY_SPELLS.map(spell => { const blockedBy = utilityBlocked(state, spell.reqLevel, spell.costs, available, atMs);
    return {...spell, costs: spell.costs.map(cost => ({...cost, available: available(cost.itemId)})), castable: !blockedBy, blockedBy}; }),
    teleports: pads.map(pad => { const unlocked = !!state.magic.unlockedTeleports[pad.id];
      const blockedBy = unlocked ? utilityBlocked(state, pad.reqLevel, [{itemId: "temporal_essence", quantity: pad.cost}], available, atMs) : "Visit and activate this platform first.";
      return {...pad, unlocked, castable: !blockedBy, blockedBy}; }), effects: structuredClone(state.magic.utilityEffects),
    fields: structuredClone(state.magic.utilityFields), teleportCast: structuredClone(state.magic.teleportCast)};
}
