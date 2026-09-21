import { CorealmGameApi } from "../api/gameApi.js";
import { INTERACT_RANGE } from "../app/config.js";
import { LOOT_PILE_VIEW, RECOVERY_CACHE_VIEW } from "../persistence/worldContainers.js";
import { SKILL_IDS, err, ok, type GameCommand, type Result, type SkillId, type Vec3 } from "../contracts.js";
import { EventBus } from "../core/events.js";
import { distanceXZ } from "../core/math.js";
import { RngStreams } from "../core/rng.js";
import type { SimClock } from "../core/time.js";
import { Store, addSkillXp, type GameState } from "../state/store.js";
import { ActivitySystem } from "../systems/activity.js";
import { BankSystem } from "../systems/bank.js";
import { CombatSystem } from "../systems/combat.js";
import { sameCombatRealm } from "../systems/combat.js";
import { DeathSystem } from "../systems/death.js";
import { DialogueSystem } from "../systems/dialogue.js";
import { EatingSystem } from "../systems/eating.js";
import { EconomySystem } from "../systems/economy.js";
import { EquipmentSystem } from "../systems/equipment.js";
import { EssenceSystem } from "../systems/essence.js";
import { GatheringSystem } from "../systems/gathering.js";
import { HealthSystem } from "../systems/health.js";
import { InventorySystem } from "../systems/inventory.js";
import { Movement, type MovementPorts } from "../systems/movement.js";
import type { Navigation } from "../systems/navigation.js";
import { ProductionSystem } from "../systems/production.js";
import { QuestSystem } from "../systems/quests.js";
import { CampfireSystem, campfireFuelLookup, type CampfirePlacementProbes } from "../systems/campfire.js";
import { GATHERING_PRODUCTION_TIERS } from "../content/gatheringProductionTiers.js";
import { AgilitySystem } from "../systems/agility.js";
import { TravelSystem } from "../systems/travel.js";
import { DiscoverySystem, type DiscoverableLocation } from "../systems/discovery.js";
import { HuntContractsSystem } from "../systems/huntContracts.js";
import { deriveHuntTargets } from "../content/huntContracts.js";
import { content } from "../content/index.js";
import { getRegion } from "../content/regions.js";
import { DungeonDoors, type DungeonDoorBarrier } from "../world/dungeonDoors.js";
import { RespawnAnchorSystem, buildSettlementRespawnAnchors } from "../systems/respawnAnchors.js";
import type { EntityStore } from "../world/entities.js";
import { InteractionDispatcher } from "../world/interactions.js";
import type { CommandExecutor } from "./localSession.js";

export interface HeadlessPlayerPorts {
  state: GameState;
  clock: SimClock;
  nav: Navigation;
  entities: EntityStore;
  movement: MovementPorts;
  spawn: Vec3;
  ownsEnemy(id: string): boolean;
  shareKill?: import("../systems/combat.js").CombatDeps["shareKill"];
  assignLoot?: import("../systems/combat.js").CombatDeps["assignLoot"];
  transferLoot?: import("../systems/death.js").DeathDeps["transferLoot"];
  campfirePlacement: CampfirePlacementProbes;
  knownLocations?: readonly DiscoverableLocation[];
  doorBarriers?: readonly DungeonDoorBarrier[];
  /** Seed the player's random streams with the world seed alone, as the single-player lab page always did. */
  sharedRandomSeed?: boolean;
}

/** Production player rules composed without DOM, renderer, browser storage, or frame callbacks. */
export class HeadlessPlayer implements CommandExecutor {
  readonly store: Store;
  readonly events = new EventBus();
  readonly random: RngStreams;
  readonly movement: Movement;
  readonly api: CorealmGameApi;
  readonly combat: CombatSystem;
  readonly inventory: InventorySystem;
  /** For the lab worker, which equips into a named slot and re-reads altars after a structure changes. */
  readonly equipment: EquipmentSystem;
  readonly essence: EssenceSystem;
  readonly quests: QuestSystem;
  readonly gathering: GatheringSystem;
  readonly activity: ActivitySystem;
  readonly questEntities = new Map<string, import("../contracts.js").SemanticEntity>();
  private readonly systems: { order: number; tick(deltaMs: number, atMs: number): void }[];
  private lastSteerAt = -Infinity;
  private readonly maintenance: { tick(deltaMs:number,atMs:number):void }[];
  private readonly sharedLootTick:(atMs:number)=>void;
  private readonly doors: DungeonDoors;
  get tick(): number { return this.ports.clock.tick; }

  constructor(private readonly ports: HeadlessPlayerPorts) {
    const { state, clock, nav, entities } = ports;
    const store = this.store = new Store(state.meta.seed);
    store.replace(state);
    const events = this.events;
    // A lab is one player and a deterministic script, written against the streams the world seed gives. Everywhere else each player gets their own.
    const playerSeed=ports.sharedRandomSeed?state.meta.seed:[...state.player.id].reduce((hash,char)=>Math.imul(hash^char.charCodeAt(0),16777619)>>>0,state.meta.seed);
    const rng = this.random = new RngStreams(playerSeed);
    const now = () => clock.elapsedMs;
    const skillLevels = () => Object.fromEntries(SKILL_IDS.map((id) => [id, store.get().skills[id].level])) as Record<SkillId, number>;
    const localEntity = (id: string) => this.questEntities.get(id) ?? entities.get(id);
    this.doors=new DungeonDoors(ports.doorBarriers??[],localEntity);
    const dispatcher = new InteractionDispatcher({ get: localEntity, playerPosition: () => store.get().player.position, skillLevels });
    this.movement = new Movement(nav, events, {...ports.movement, entities});
    this.movement.setPorts({solids:{
      resolve:(position,from,radius)=>this.doors.resolve(ports.movement.solids?.resolve(position,from,radius)??position,from,radius),
    }});
    this.api = new CorealmGameApi(store, events, nav, this.movement, clock);
    events.subscribe((event) => {
      if (event.type === "navigation.completed") this.api.resumePending();
      if (event.type === "navigation.failed") this.api.clearPending();
    });
    let equipment: EquipmentSystem; let eating: EatingSystem;
    const inventory = this.inventory = new InventorySystem({ store, events, now,
      equip: (id) => equipment.equip(id), beginEating: (id, duration, at) => eating.beginEating(id, duration, at) });
    equipment = this.equipment = new EquipmentSystem({ store, events, inventory, now });
    const activity = this.activity = new ActivitySystem(store, events);
    eating = new EatingSystem({ store, activity, inventory });
    const campfire = new CampfireSystem({ store, events, activity, inventory, entities, now,
      entityId: `campfire:${state.player.id}`, placement: ports.campfirePlacement, fuelFor: campfireFuelLookup(GATHERING_PRODUCTION_TIERS) });
    const agility = new AgilitySystem({ store, events, clock, rng, entities: { get: localEntity }, activity, dispatcher, nav,
      isLandingSafe: (point) => !ports.movement.solids || distanceXZ(point, ports.movement.solids.resolve(point, point, 0.35)) < 0.01 });
    this.movement.setPorts({ shortcuts: { begin: (id, entry, exit) => agility.beginRoute(id, entry, exit), cancel: (at, reason) => agility.cancelTraversal(at, reason) } });
    const near = (kind: string) => entities.all().some((entity) => entity.archetype === kind
      && entity.regionId === store.get().player.regionId && distanceXZ(entity.position, store.get().player.position) <= INTERACT_RANGE * 2.2);
    const bank = new BankSystem({ store, events, inventory, dispatcher, now, inRangeOfBank: () => near("bank") });
    const shop = new EconomySystem({ store, events, inventory, dispatcher, now, resolveShop: (id) => {
      const matches = entities.all().filter((entity) => entity.archetype === "shop" && (!id || entity.id === id));
      matches.sort((a, b) => distanceXZ(a.position, store.get().player.position) - distanceXZ(b.position, store.get().player.position));
      const entity = matches[0];
      return entity ? { entityId: entity.id, contentShopId: String(entity.meta?.shopId ?? entity.id),
        inRange: entity.regionId === store.get().player.regionId && distanceXZ(entity.position, store.get().player.position) <= INTERACT_RANGE * 2.2 } : undefined;
    } });
    this.gathering = new GatheringSystem({ store, events, clock, rng, entities, inventory, activity, dispatcher });
    for (const entity of entities.all()) if (entity.meta?.essenceAltar || entity.meta?.essenceAltarRuins) {
      this.questEntities.set(entity.id, structuredClone(entity));
    }
    this.essence = new EssenceSystem({ store, events, inventory, dispatcher,
      entities: { get: localEntity, all: () => entities.all().map((entity) => localEntity(entity.id)!) }, now });
    this.combat = new CombatSystem({ store, events, rng, entities, equipment, inventory, dispatcher,
      activity, movement: this.movement, ownsEnemy: ports.ownsEnemy, lootView:LOOT_PILE_VIEW,
      shareKill: ports.shareKill, assignLoot: ports.assignLoot });
    const health = new HealthSystem({ store, events, equipment });
    const respawnAnchors=new RespawnAnchorSystem({store,anchors:()=>buildSettlementRespawnAnchors(id=>nav.routeNode(id))});
    respawnAnchors.update();
    const death = new DeathSystem({ store, events, entities, inventory, dispatcher, health, combat: this.combat,
      sharedLootTimers:false,
      transferLoot: ports.transferLoot,
      cacheView: RECOVERY_CACHE_VIEW,
      onLootOpened:container=>events.emit("loot.opened",{container},container.entityId,now()),
      recoveryCacheId: `recovery:${state.player.id}`,
      activity, movement: this.movement, respawn: { resolve: (id,regionId) => {
        const anchor=respawnAnchors.resolve(id); if(anchor)return anchor;
        const node=nav.routeNode(id); if(node)return {position:node.position,regionId:node.regionId};
        const region=getRegion(regionId),spot=region?.spawnPoint;
        return spot&&ports.knownLocations?.length ? {position:[spot[0],ports.movement.heightAt?.(regionId,spot[0],spot[1])??0,spot[1]],regionId}
          : {position:ports.spawn,regionId:"fallowmarch"};
      } },
      snapToGround: (point) => nav.nearestWalkable(point) });
    this.sharedLootTick=atMs=>death.tickSharedLoot(atMs);
    this.maintenance = [campfire, death];
    // A station a player has changed for themselves (an altar they awakened) is their private copy, as the essence system and the dispatcher see it.
    // Through the shared table the altar is dormant for ever, and nothing can be made at it.
    const production = new ProductionSystem({ store, events, rng, inventory, activity, dispatcher,
      entities: { get: localEntity, all: () => entities.all().map((entity) => localEntity(entity.id)!) } });
    activity.register(production.driver);
    const xp = { award: (skill: SkillId, amount: number) => {
      const result = addSkillXp(store.get(), skill, amount); store.markDirty();
      if (result.levelsGained) events.emit("level.gained", { skill, level: result.newLevel, levelsGained: result.levelsGained }, undefined, now());
    } };
    const questEntities = { get: localEntity, setState: (id: string, value: string, lockedReason?: string) => {
      const source = localEntity(id); if (!source) return false;
      const entity = structuredClone(source); entity.state = value;
      if (lockedReason !== undefined) entity.meta = { ...entity.meta, lockedReason };
      this.questEntities.set(id, entity); return true;
    } };
    const quests = this.quests = new QuestSystem({ store, events, clock, entities: questEntities, inventory, xp, dispatcher });
    const hunts = new HuntContractsSystem({ state: () => store.get().huntContracts,
      markDirty: () => store.markDirty(), events, playerId: () => store.get().player.id,
      targets: () => deriveHuntTargets(entities.all(), (id) => content.enemy(id), (id) => getRegion(id)?.name ?? "Gravelmaw",
        (entity) => entity.regionId === store.get().player.regionId && nav.pathDistance(store.get().player.position, entity.position) !== null,
        { stopAfterReachable: true }),
      eligibility: () => ({ regions: [store.get().player.regionId], combatLevel: Math.max(store.get().skills.melee.level,store.get().skills.magic.level) }),
      entity: localEntity, awardXp: xp.award });
    this.api.register("hunts", hunts);
    if (store.get().huntContracts.offerSerial === 0) this.withNavigation(()=>hunts.refreshOffers());
    quests.rehydrateWorldState();
    const dialogue = new DialogueSystem({ store, events, clock, entities: { get: localEntity }, inventory, xp, quests, dispatcher });
    new TravelSystem({ store, events, clock, entities: { get: localEntity, all: () => entities.all().map((entity) => localEntity(entity.id)!) },
      nav, dispatcher, traverseObstacle: (context) => agility.begin(context), activity,
      place: (position, regionId) => {
        this.movement.stop(store.get(), now(), "portal");
        store.get().player.position = nav.closestPoint(position) ?? position; store.get().player.regionId = regionId;
        store.markDirty();
      } });
    const discovery = new DiscoverySystem({ store, events, locations: () => ports.knownLocations ?? [] });
    discovery.sweep(now());
    this.api.register("inventory", inventory); this.api.register("equipment", equipment);
    this.api.register("bank", bank); this.api.register("shop", shop); this.api.register("combat", this.combat.hook());
    this.api.register("activity", activity.hook()); this.api.register("production", production.hook());
    this.api.register("campfire", campfire.hook());
    this.api.register("quests", quests); this.api.register("dialogue", dialogue);
    this.api.register("loot", { take: (id, index, stackId) => death.take(id, index, stackId) });
    this.api.register("entities", { get: localEntity, all: () => entities.all().map((entity) => localEntity(entity.id)!), observe: (filter, from) => entities.observe(filter, from) });
    this.api.register("interactions", dispatcher);
    this.systems = [activity, production, campfire, agility, this.combat, health, death, quests, discovery,respawnAnchors].sort((a, b) => a.order - b.order);
  }
  private withNavigation<T>(action:()=>T):T {return this.ports.nav.withPathConstraint(path=>this.doors.clipPath(path),action);}
  execute(input: GameCommand): Result<unknown> {
    return this.withNavigation(()=>this.executeIntent(input));
  }
  private executeIntent(input: GameCommand): Result<unknown> {
    if (input.method === "chat" || input.method === "party" || input.method === "who") return err("UNAVAILABLE", "Social commands require a world.");
    const target = ["interact","takeLoot","attack","produceAt"].includes(input.method) ? input.args[0]
      : input.method === "cast" ? input.args[1] : undefined;
    if (typeof target === "string") {
      const entity = this.ports.entities.get(target);
      if (entity && !sameCombatRealm(entity.regionId,this.store.get().player.regionId)) return err("NOT_FOUND","Target is not accessible in this realm");
    }
    if (input.method === "steer") {
      this.lastSteerAt = this.ports.clock.elapsedMs;
      this.movement.setDirectInput({ strafe: input.args[0], forward: -input.args[1], cameraYaw: 0 });
      return ok({ steering: true });
    }
    // The protocol has already selected and validated an explicitly listed method.
    const fn = this.api[input.method] as (...args: unknown[]) => Result<unknown>;
    if (typeof fn !== "function") return err("UNAVAILABLE", "Command is unavailable");
    return fn.apply(this.api, input.args);
  }
  move(): void {
    const at = this.ports.clock.elapsedMs;
    if (at - this.lastSteerAt > 500) this.movement.setDirectInput({ forward: 0, strafe: 0, cameraYaw: 0 });
    // Match the collision steps used by main's frame-driven offline movement.
    this.withNavigation(()=>{ for (let elapsed = 0; elapsed < 100; elapsed += 20) this.movement.update(this.store.get(), 20, at + elapsed); });
  }
  advance(): void {
    this.withNavigation(()=>{
    for (const system of this.systems) system.tick(100, this.ports.clock.elapsedMs);
    this.store.get().combat.castLock = this.combat.currentCastLock();
    this.store.get().meta.playSeconds = (this.ports.clock.elapsedMs + 100) / 1000;
    this.store.markDirty(); this.events.flush();
    });
  }
  advanceInactive(): void {
    this.store.get().meta.playSeconds = this.ports.clock.elapsedMs / 1000;
    for (const system of this.maintenance) system.tick(100,this.ports.clock.elapsedMs);
    this.events.flush();
  }
  advanceShared():void {
    this.store.get().meta.playSeconds=this.ports.clock.elapsedMs/1000;
    this.gathering.tick(100,this.ports.clock.elapsedMs);this.sharedLootTick(this.ports.clock.elapsedMs);
  }
  suspend(): void {
    this.api.stop(); this.movement.setDirectInput({ forward: 0, strafe: 0, cameraYaw: 0 });
  }
}
