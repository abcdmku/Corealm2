import { SKILL_IDS, type GameCommand, type Result, type SemanticEntity, type SkillId, type Vec3, type WorldDescriptor, type WorldStorageRecord } from "../contracts.js";
import { runtimeTables } from "../content/runtimeCatalog.js";
import { WORLD_LAB_CONTENT_VERSION } from "../contracts.js";
import { content } from "../content/index.js";
import { ENEMIES } from "../content/enemies.js";
import { SimClock } from "../core/time.js";
import { createInitialState, composeSessionState, playerSessionState, type SharedWorldState } from "../state/store.js";
import { EnemyAiSystem } from "../systems/enemyAI.js";
import { sameCombatRealm } from "../systems/combat.js";
import type { MovementPorts } from "../systems/movement.js";
import type { Navigation } from "../systems/navigation.js";
import { EntityStore } from "../world/entities.js";
import { SpatialIndex } from "../world/spatial.js";
import { HeadlessPlayer } from "./headlessPlayer.js";
import { SessionFailure } from "./protocol.js";
import { PublicActions } from "./publicActions.js";
import { WorldSocial } from "./social.js";

export interface HeadlessWorldPorts {
  nav: Navigation;
  entities: SemanticEntity[];
  spawn: Vec3;
  movement: MovementPorts;
  campfirePlacement: import("../systems/campfire.js").CampfirePlacementProbes;
  enemies?: typeof ENEMIES;
  habitats?: readonly import("../content/worldHabitats.js").HabitatDef[];
  knownLocations?: readonly import("../world/entities.js").KnownLocation[];
  doorBarriers?: readonly import("../world/dungeonDoors.js").DungeonDoorBarrier[];
  initialize?(world:HeadlessWorld):void;
  beforeTick?(world:HeadlessWorld):void;
}

/** One entity table, navmesh, clock, resource schedule, and enemy AI per world. */
export class HeadlessWorld {
  readonly social: WorldSocial;
  readonly actions = new PublicActions();
  readonly clock = new SimClock();
  readonly entities: EntityStore;
  readonly players = new Map<string, HeadlessPlayer>();
  readonly active = new Set<string>();
  membershipVersion = 0;
  readonly spatial = new SpatialIndex(32);
  readonly shared: SharedWorldState;
  readonly ai: EnemyAiSystem;
  private readonly targets = new Map<string, string>();
  private readonly sentinel: HeadlessPlayer;
  private selected: HeadlessPlayer;
  private persistedEntities = new Map<string, string>();
  private readonly pendingEntitySnapshots = new WeakMap<WorldStorageRecord, Map<string, string>>();
  constructor(readonly descriptor: WorldDescriptor, readonly ports: HeadlessWorldPorts, saved?: WorldStorageRecord | null) {
    if (saved && (saved.contentVersion !== descriptor.contentVersion || saved.seed !== descriptor.seed)) {
      throw new SessionFailure("INCOMPATIBLE", "Stored world content or seed does not match configuration");
    }
    const catalog = runtimeTables(descriptor.contentVersion === WORLD_LAB_CONTENT_VERSION);
    content.register({ ...catalog, enemies: [...new Map([...catalog.enemies, ...(ports.enemies ?? [])].map(enemy => [enemy.id, enemy])).values()] });
    this.entities = new EntityStore({ skillLevels: () => Object.fromEntries(SKILL_IDS.map((id) => [id, 99])) as Record<SkillId, number> });
    this.entities.load(saved?.entities ?? structuredClone(ports.entities));
    // Seed from the durable baseline before initialization can remove resident entities.
    for (const entity of saved?.entities ?? []) this.persistedEntities.set(entity.id, JSON.stringify(entity));
    this.shared = saved?.world ?? { nodes: {}, enemies: {}, lootPiles: {} };
    this.clock.skipMs((saved?.tick ?? 0) * 100);
    this.social = new WorldSocial(this, saved?.parties);
    this.sentinel = this.makePlayer("world", undefined);
    if(saved?.random)this.sentinel.random.restore(saved.random.world);
    this.sentinel.store.get().player.health = 0;
    this.sentinel.store.get().player.position = [1_000_000, 0, 1_000_000];
    this.selected = this.sentinel;
    const world = this;
    this.ai = new EnemyAiSystem({
      get store() { return world.selected.store; }, get events() { return world.selected.events; }, get combat() { return world.selected.combat; },
      entities: this.entities, nav: ports.nav,
      groundHeightAt: (x, z) => ports.movement.heightAt?.(world.selected.store.get().player.regionId, x, z) ?? 0,
      habitatForEntity: entity => ports.habitats?.find(habitat => habitat.groupId === entity.meta?.groupId) ?? null,
      selectPlayerForEnemy(entity) {
        const oldId = world.targets.get(entity.id);
        let player = oldId ? world.players.get(oldId) : undefined;
        // An idle observer is only a simulation context, not a claim on future combat.
        // Active aggro stays stable while valid; otherwise notice the nearest player now.
        if (world.shared.enemies[entity.id]?.state !== "aggro" || !world.eligibleEnemyTarget(player, entity)) {
          let best = Infinity; let selectedId = "";
          world.spatial.forEachInRadius(entity.position, 60, (id, distance) => {
            const candidate = world.players.get(id);
            if (world.eligibleEnemyTarget(candidate, entity) && (distance < best || (distance === best && id < selectedId))) {
              selectedId = id; best = distance;
            }
          });
          player = world.players.get(selectedId);
        }
        world.selectEnemyTarget(entity.id, player, world.clock.elapsedMs);
        return player !== undefined;
      },
    });
    for (const [id, player] of Object.entries(saved?.players ?? {})) {
      const restored = this.makePlayer(id, player); restored.suspend(); this.players.set(id, restored);
      if(saved?.random?.players[id])restored.random.restore(saved.random.players[id]);
    }
    this.entities.registerLocations(ports.knownLocations??[]);
    ports.initialize?.(this);
  }
  private makePlayer(id: string, saved?: WorldStorageRecord["players"][string]): HeadlessPlayer {
    const initial = createInitialState(this.descriptor.seed);
    initial.player.id = id; initial.player.position = this.ports.spawn;
    const state = composeSessionState(saved ?? playerSessionState(initial), this.shared, initial.settings);
    const player = new HeadlessPlayer({ ...this.ports, state, clock: this.clock, entities: this.entities,
      ownsEnemy: (enemyId) => this.targets.get(enemyId) === id,
      shareKill: (enemy, skill, xp, atMs) => this.social.shareKill(id, enemy, skill, xp, atMs),
      assignLoot: (_enemy, items) => this.social.tagLoot(id, items),
      transferLoot: (stack, pile) => this.social.collect(id, stack, pile) });
    player.events.subscribe(event => {
      this.actions.event(player.store.get(), event);
      // Death restores health and placement before events flush, so next tick cannot detect it
      // from health alone. Release the old fight at its actual death boundary.
      if (event.type === "player.died") this.releaseEnemyTargets(id, event.atMs);
    });
    player.combat.onEnemyProvoked((enemyId, at) => {
      const entity = this.entities.get(enemyId);
      if (!entity || !this.eligibleEnemyTarget(player, entity) || this.shared.enemies[enemyId]?.state === "dead") return;
      const currentId = this.targets.get(enemyId);
      const current = currentId ? this.players.get(currentId) : undefined;
      const owner = this.shared.enemies[enemyId]?.state === "aggro" && this.eligibleEnemyTarget(current, entity) ? current : player;
      // provoke is synchronous and reads the AI's selected player. Never let a previous
      // enemy's context receive this enemy's engagement or incoming attack.
      this.selectEnemyTarget(enemyId, owner, at);
      this.ai?.provoke(enemyId, at);
    });
    return player;
  }
  private eligibleEnemyTarget(player: HeadlessPlayer | undefined, entity: SemanticEntity): player is HeadlessPlayer {
    if (!player) return false;
    const state = player.store.get().player;
    return this.active.has(state.id) && state.health > 0 && sameCombatRealm(state.regionId, entity.regionId)
      && Math.hypot(state.position[0] - entity.position[0], state.position[2] - entity.position[2]) <= 60;
  }
  private selectEnemyTarget(enemyId: string, player: HeadlessPlayer | undefined, atMs: number): void {
    const oldId = this.targets.get(enemyId), nextId = player?.store.get().player.id;
    if (oldId !== nextId) {
      const previous = oldId ? this.players.get(oldId) : undefined;
      previous?.combat.disengageEnemy(previous.store.get(), enemyId, atMs);
      if (nextId) this.targets.set(enemyId, nextId); else this.targets.delete(enemyId);
      if (player && this.shared.enemies[enemyId]?.state === "aggro") player.combat.engageEnemy(enemyId, atMs);
    }
    this.selected = player ?? this.sentinel;
  }
  private releaseEnemyTargets(playerId: string, atMs: number): void {
    for (const [enemyId, target] of this.targets) if (target === playerId) this.selectEnemyTarget(enemyId, undefined, atMs);
  }
  join(id: string): HeadlessPlayer {
    let player = this.players.get(id);
    if (!player) { player = this.makePlayer(id); this.players.set(id, player); }
    if (!this.active.has(id)) this.membershipVersion++;
    this.active.add(id); this.spatial.insert(id, player.store.get().player.position);
    this.social.join(id);
    return player;
  }
  restorePlayer(id:string,saved:import("../contracts.js").StoredWorldPlayer):void {
    if(this.players.has(id))return;
    const player=this.makePlayer(id,saved.state);if(saved.random)player.random.restore(saved.random);
    player.suspend();this.players.set(id,player);
  }
  evictInactive():string[] {
    const removed:string[]=[];
    for(const [id,player]of this.players)if(!this.active.has(id)&&!player.store.get().world.campfire&&!player.store.get().world.recoveryCache){
      this.players.delete(id);removed.push(id);
    }
    return removed;
  }
  leave(id: string): void {
    this.social.disconnect(id);
    const leaving = this.players.get(id); if (leaving) this.actions.leave(leaving.store.get());
    this.players.get(id)?.suspend(); if (this.active.delete(id)) this.membershipVersion++; this.spatial.remove(id);
    this.releaseEnemyTargets(id, this.clock.elapsedMs);
  }
  execute(id: string, command: GameCommand): Result<unknown> {
    const player = this.players.get(id);
    if (!player || !this.active.has(id)) throw new SessionFailure("SESSION_EXPIRED", "Player is not connected");
    if (command.method === "chat") return this.social.chat(id, ...command.args);
    if (command.method === "party") return this.social.command(id, ...command.args);
    if (command.method === "who") return this.social.who(id);
    return player.execute(command);
  }
  tick(): void {
    this.social.tick();
    this.ports.beforeTick?.(this);
    for (const id of this.active) { const player = this.players.get(id)!; player.move(); this.spatial.move(id, player.store.get().player.position); }
    this.ai.tick(100, this.clock.elapsedMs);
    for (const id of this.active) {
      const player = this.players.get(id)!;
      // Death may restore placement in this tick. Combat cues belong to the original scene.
      const origin = {player:{...player.store.get().player,position:[...player.store.get().player.position] as [number,number,number]}};
      player.advance();
      this.actions.combat(origin, player.combat);
    }
    for (const [id,player] of this.players) if(!this.active.has(id))player.advanceInactive();
    this.sentinel.advanceShared();
    this.clock.commitTick();
  }
  snapshot(receipts: WorldStorageRecord["receipts"] = {}, entityPatches = false): WorldStorageRecord {
    let entities: SemanticEntity[];
    const nextEntities = new Map<string, string>();
    const removedEntityIds: string[] = [];
    if (entityPatches) {
      entities = [];
      for (const entity of this.entities.all()) {
        const json = JSON.stringify(entity);
        nextEntities.set(entity.id, json);
        if (this.persistedEntities.get(entity.id) !== json) {
          entities.push(structuredClone(entity));
        }
      }
      for (const id of this.persistedEntities.keys()) if (!nextEntities.has(id)) {
        removedEntityIds.push(id);
      }
    } else entities = structuredClone(this.entities.all());
    const snapshot: WorldStorageRecord = {
      parties: this.social.snapshot(),
      schemaVersion: 1, key: { providerId: this.descriptor.providerId, worldId: this.descriptor.worldId },
      contentVersion: this.descriptor.contentVersion, seed: this.descriptor.seed, tick: this.clock.tick,
      world: structuredClone(this.shared), entities, receipts,
      ...(entityPatches ? { entityWrites: "patch" as const, removedEntityIds } : {}),
      players: Object.fromEntries([...this.players].map(([id, player]) => [id, playerSessionState(player.store.get())])),
      random:{world:this.sentinel.random.snapshot(),players:Object.fromEntries([...this.players].map(([id,player])=>[id,player.random.snapshot()]))},
    };
    if (entityPatches) this.pendingEntitySnapshots.set(snapshot, nextEntities);
    return snapshot;
  }
  /** Advance the delta baseline only after this exact snapshot commits durably. */
  committed(snapshot: WorldStorageRecord): void {
    const baseline = this.pendingEntitySnapshots.get(snapshot);
    if (baseline) { this.persistedEntities = baseline; this.pendingEntitySnapshots.delete(snapshot); }
  }
}
