import { SKILL_IDS, type GameCommand, type PlayerCharacter, type PlayerClaim, type Result, type SemanticEntity, type SkillId, type Vec3, type WorldDescriptor, type WorldStorageRecord } from "../contracts.js";
import { runtimeTables } from "../content/runtimeCatalog.js";
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
import { spawnGroupOf, spawnSignature, type SpawnPlan } from "./spawnPlan.js";
import type { CompiledWorld } from "../content/worldData.js";
import type { HabitatDef } from "../content/worldHabitats.js";

export interface HeadlessWorldPorts {
  nav: Navigation;
  entities: SemanticEntity[];
  spawn: Vec3;
  movement: MovementPorts;
  campfirePlacement: import("../systems/campfire.js").CampfirePlacementProbes;
  enemies?: typeof ENEMIES;
  habitats?: readonly HabitatDef[];
  /**
   * Build the named spawn groups again from a newly published world table, spaced among `residents`.
   * Pure with respect to the running world: the server calls it before it activates a publish, and a
   * throw refuses the publish. Absent on a scene whose creatures do not come from placements.
   */
  planSpawns?(world: CompiledWorld, groupIds: ReadonlySet<string>, residents: readonly SemanticEntity[]): SpawnPlan;
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
  /** The current habitat of each spawn group. A publish replaces the entries of the groups it rebuilt. */
  private readonly habitats = new Map<string, HabitatDef>();
  /** A creature that outlived the habitat of its group keeps the one it was spawned into until it dies. */
  private readonly heldHabitats = new Map<string, HabitatDef | null>();
  /** The spawn each living creature takes at its next respawn, and the creatures that will not respawn at all. */
  private readonly pendingSpawns = new Map<string, SemanticEntity>();
  private readonly retiring = new Set<string>();
  private readonly pendingEntitySnapshots = new WeakMap<WorldStorageRecord, Map<string, string>>();
  constructor(readonly descriptor: WorldDescriptor, readonly ports: HeadlessWorldPorts, saved?: WorldStorageRecord | null) {
    // Content changes while a world lives, so a save loads under any catalog revision. The scene it was built for cannot change.
    if (saved && (saved.fixture !== descriptor.fixture || saved.seed !== descriptor.seed)) {
      throw new SessionFailure("INCOMPATIBLE", "Stored world fixture or seed does not match configuration");
    }
    const catalog = runtimeTables(descriptor.fixture === "lab");
    content.register({ ...catalog, enemies: [...new Map([...catalog.enemies, ...(ports.enemies ?? [])].map(enemy => [enemy.id, enemy])).values()] });
    this.entities = new EntityStore({ skillLevels: () => Object.fromEntries(SKILL_IDS.map((id) => [id, 99])) as Record<SkillId, number> });
    this.entities.load(saved?.entities ?? structuredClone(ports.entities));
    // A creature's model and scale are stamped from the catalog when the world is built, and a save keeps
    // what it was built with. `ports` was built from the catalog this server runs on now, so a model
    // an admin changed reaches the saved creature here, and the client through its replicated view.
    if (saved) {
      const built = new Map(ports.entities.map(entity => [entity.id, entity]));
      for (const entity of this.entities.all()) {
        const fresh = entity.archetype === "enemy" || entity.archetype === "boss" ? built.get(entity.id)?.view : undefined;
        if (fresh && entity.view) Object.assign(entity.view, { assetId: fresh.assetId, scale: fresh.scale, materialTier: fresh.materialTier, labelHeight: fresh.labelHeight });
      }
    }
    for (const habitat of ports.habitats ?? []) this.habitats.set(habitat.groupId, habitat);
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
      habitatForEntity: entity => world.heldHabitats.has(entity.id) ? world.heldHabitats.get(entity.id)! : world.habitats.get(String(entity.meta?.groupId)) ?? null,
      beforeRespawn: (entity, runtime) => world.respawning(entity, runtime),
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
    // A save keeps the creatures it was written with. Spawns that content moved, added or removed since then
    // reach it the way a live publish does: through the next respawn. `ports` is the fresh build.
    if (saved) this.applySpawns({ groupIds: null, spawns: ports.entities.filter(entity => entity.archetype === "enemy" || entity.archetype === "boss"), habitats: [] });
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
  /**
   * Take the spawns a content publish produced. Nothing alive moves: a living creature whose spawn
   * changed takes the new one when it next respawns and keeps its old habitat until then, a dead one
   * takes it now, a creature the plan no longer names finishes its life and is then removed for good,
   * and a creature that is new to the world appears at once. Removals reach storage as entity deletes.
   */
  applySpawns(plan: SpawnPlan): { added: number; pending: number; retiring: number; removed: number } {
    const fresh = new Map(plan.spawns.map(entity => [entity.id, entity]));
    const previous = new Map(this.habitats);
    for (const habitat of plan.habitats) this.habitats.set(habitat.groupId, habitat);
    if (plan.groupIds) for (const id of plan.groupIds) if (!plan.habitats.some(habitat => habitat.groupId === id)) this.habitats.delete(id);
    const counts = { added: 0, pending: 0, retiring: 0, removed: 0 };
    for (const entity of this.entities.all()) {
      if ((entity.archetype !== "enemy" && entity.archetype !== "boss") || (plan.groupIds && !plan.groupIds.has(spawnGroupOf(entity)))) continue;
      const next = fresh.get(entity.id), dead = this.shared.enemies[entity.id]?.state === "dead";
      fresh.delete(entity.id);
      if (next && spawnSignature(next) === spawnSignature(entity)) { this.pendingSpawns.delete(entity.id); this.retiring.delete(entity.id); this.heldHabitats.delete(entity.id); continue; }
      if (!this.heldHabitats.has(entity.id)) this.heldHabitats.set(entity.id, previous.get(spawnGroupOf(entity)) ?? null);
      if (next) { this.pendingSpawns.set(entity.id, structuredClone(next)); this.retiring.delete(entity.id); counts.pending++; }
      else { this.pendingSpawns.delete(entity.id); this.retiring.add(entity.id); counts.retiring++; }
      // The dead have no position to keep. A retired one goes now; the rest take the new spawn and wait out their timer.
      if (dead && !this.respawning(entity, this.shared.enemies[entity.id]!)) { counts.retiring--; counts.removed++; }
    }
    for (const entity of fresh.values()) { this.entities.add(structuredClone(entity)); counts.added++; }
    if (counts.added || counts.removed) this.ai?.rescan();
    return counts;
  }
  /** The `beforeRespawn` hook: hand a creature the spawn it was waiting for. False when it was retired, and is now gone. */
  private respawning(entity: SemanticEntity, runtime: NonNullable<SharedWorldState["enemies"][string]>): boolean {
    if (this.retiring.delete(entity.id)) {
      this.heldHabitats.delete(entity.id); this.targets.delete(entity.id);
      this.entities.remove(entity.id); delete this.shared.enemies[entity.id];
      return false;
    }
    const next = this.pendingSpawns.get(entity.id);
    if (!next) return true;
    this.pendingSpawns.delete(entity.id); this.heldHabitats.delete(entity.id);
    Object.assign(entity, { name: next.name, tier: next.tier, regionId: next.regionId, archetype: next.archetype,
      ...(next.combat ? { combat: next.combat } : {}), ...(next.view ? { view: next.view } : {}), ...(next.meta ? { meta: next.meta } : {}) });
    runtime.spawnPos = [...next.position];
    // The creature may now be another definition entirely.
    for (const player of this.players.values()) player.combat.invalidateDefinitions(entity.id);
    this.sentinel.combat.invalidateDefinitions(entity.id);
    return true;
  }
  /** Content was republished: every player's combat resolves enemy rows again at the next read. */
  invalidateDefinitions(): void {
    for (const player of this.players.values()) player.combat.invalidateDefinitions();
    this.sentinel.combat.invalidateDefinitions();
  }
  /** Who and what holds any of these items in this world right now: players here or resident, their recovery caches, and piles on the ground. Plain data, so a world on its own thread can answer it. */
  itemHolders(itemIds: ReadonlySet<string>): ({ heldBy: "player"; id: string; place: string; accountId: string; name: string } | { heldBy: "loot-pile"; id: string; pileId: string })[] {
    const found: ReturnType<HeadlessWorld["itemHolders"]> = [];
    for (const [accountId, player] of this.players) {
      const state = player.store.get();
      const places: [string, readonly ({ itemId: string } | null)[]][] = [["inventory", state.inventory.slots], ["bank", state.bank.slots],
        ["equipment", Object.values(state.equipment)], ["recovery-cache", state.world.recoveryCache?.items ?? []]];
      for (const [place, slots] of places) for (const id of new Set(slots.flatMap(slot => slot && itemIds.has(slot.itemId) ? [slot.itemId] : [])))
        found.push({ heldBy: "player", id, place, accountId, name: state.player.name });
    }
    for (const [pileId, pile] of Object.entries(this.shared.lootPiles)) for (const id of new Set(pile.items.map(stack => stack.itemId))) if (itemIds.has(id)) found.push({ heldBy: "loot-pile", id, pileId });
    return found;
  }
  /** Living creatures by definition id, for the publish that wants to remove a definition. */
  livingCreatures(): Map<string, number> {
    const alive = new Map<string, number>();
    for (const entity of this.entities.all()) {
      if ((entity.archetype !== "enemy" && entity.archetype !== "boss") || this.shared.enemies[entity.id]?.state === "dead") continue;
      const id = String(entity.meta?.enemyDefId ?? entity.id);
      alive.set(id, (alive.get(id) ?? 0) + 1);
    }
    return alive;
  }

  /**
   * Put a player in the world. With a claim the character is the server's stored one, never the
   * copy this world kept for an offline owner; what the player owns here and their random cursor
   * stay this world's. Without a claim a player already here is reused.
   */
  join(id: string, claim?: PlayerClaim): HeadlessPlayer {
    let player = this.players.get(id);
    if (!player || claim) {
      const owned = player ? playerSessionState(player.store.get()).ownedWorld : claim?.world?.ownedWorld;
      const random = player ? player.random.snapshot() : claim?.world?.random;
      const here = claim?.lastWorld?.providerId === this.descriptor.providerId && claim.lastWorld.worldId === this.descriptor.worldId;
      player = this.makePlayer(id, claim?.character ? { ...(here ? claim.character : this.arrive(claim.character)),
        ownedWorld: owned ?? { recoveryCache: null, campfire: null, obstaclesUsed: {} } } : undefined);
      if (random) player.random.restore(random);
      this.players.set(id, player);
    }
    if (!this.active.has(id)) this.membershipVersion++;
    this.active.add(id); this.spatial.insert(id, player.store.get().player.position);
    this.social.join(id);
    return player;
  }
  /** A character from another world keeps what it carries and starts at this world's safe spawn, with nothing timed by the other world's clock. */
  private arrive(character: PlayerCharacter): PlayerCharacter {
    const initial = createInitialState(this.descriptor.seed);
    return { ...character, meta: { ...character.meta, seed: this.descriptor.seed }, activity: null, dialogue: null,
      combat: { ...initial.combat, preferredSpellId: character.combat.preferredSpellId },
      player: { ...character.player, position: this.ports.spawn, regionId: initial.player.regionId, movement: initial.player.movement } };
  }
  /** Drop offline players who own nothing here. `keep` spares one whose final save has not committed yet. */
  evictInactive(keep:(id:string)=>boolean=()=>false):string[] {
    const removed:string[]=[];
    for(const [id,player]of this.players)if(!this.active.has(id)&&!keep(id)&&!player.store.get().world.campfire&&!player.store.get().world.recoveryCache){
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
      fixture: this.descriptor.fixture, catalogRevision: this.descriptor.catalogRevision ?? null, seed: this.descriptor.seed, tick: this.clock.tick,
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
