import type { EntityId, SemanticEntity, SolidVolume, Vec3 } from "../contracts.js";
import type { Rng } from "../core/rng.js";
import type { GameState, Store } from "../state/store.js";
import { setSkillLevel } from "../state/store.js";
import type { Movement, MovementPathPlan } from "../systems/movement.js";
import type { Navigation, RouteEdge, RouteNode } from "../systems/navigation.js";
import type { QuestSystem } from "../systems/quests.js";
import { sampleTraversal, type TraversalSample } from "../systems/traversalMotion.js";
import { TRAVERSAL_CONTACTS, type ContactTraversalKind } from "../systems/traversalContacts.js";
import { buildWorld, type AssetCenterXZ, type AssetSize } from "../world/regionBuilder.js";
import type { DungeonDoorFixture } from "./dungeonDoors.js";
import type { WorldTerrainSpec } from '../render/scene.js';
import { FAIRY_AGILITY_LINKS } from '../content/fairyAgility.js';
import { FAIRY_COMBAT_PLATEAUS, type FairyLandformSpec } from '../world/fairyLandforms.js';

export type AgilityFixtureId = "root_tunnel" | "sunder_ledge" | `contact_${ContactTraversalKind}` | `${string}_climb`;

export const FAIRY_AGILITY_LAB_PLACEMENTS = FAIRY_AGILITY_LINKS.map((link, index) => {
  const plateau = FAIRY_COMBAT_PLATEAUS.find(candidate => candidate.id === link.landformId)!;
  const entry = [100, -80 + index * 40] as const;
  const exit = [entry[0] + link.obstacle.exitPosition[0] - link.obstacle.position[0],
    entry[1] + link.obstacle.exitPosition[1] - link.obstacle.position[1]] as const;
  return { link, entry, exit, rise: plateau.rise };
});

/** Before terrain construction, stage the real height lattice used by rendering, physics and nav. */
export function configureAgilityLabTerrain(terrain: WorldTerrainSpec): void {
  const supports: FairyLandformSpec[] = FAIRY_AGILITY_LAB_PLACEMENTS.map(({ link, exit, rise }, index) => ({
    id: `feature-lab:${link.obstacle.id}:support`, regionId: link.regionId,
    centre: exit, radius: 6, rise, cliffWidth: 2, clearingRadius: 3, ramps: [],
    shape: { seed: 3030 + index, irregularity: 0, lobes: 1, aspectRatio: 1, rotation: 0 },
  }));
  terrain.metresPerQuad = 1;
  terrain.fairyLandforms = [...(Array.isArray(terrain.fairyLandforms) ? terrain.fairyLandforms : []), ...supports];
  terrain.flats = [...(terrain.flats ?? []), ...FAIRY_AGILITY_LAB_PLACEMENTS.map(({ entry, exit }) => ({
    x: (entry[0] + exit[0]) / 2, z: (entry[1] + exit[1]) / 2,
    radius: 20, halfExtents: [19, 19] as const, blend: 2, height: 0,
  }))];
}

export interface AgilityFixtureLane {
  id: AgilityFixtureId;
  name?: string;
  entry: Vec3;
  exit: Vec3;
  reqLevel: number;
  durationMs: number;
  tier: number;
  contact?: { kind: ContactTraversalKind; width: number; depth: number; rise: number; origin: Vec3 };
}

export interface AgilityFixture {
  entities: SemanticEntity[];
  solids: SolidVolume[];
  routeNodes: RouteNode[];
  routeEdges: RouteEdge[];
  /** Render every wall with the same production masonry used by the dungeon-door fixture. */
  enclosure: DungeonDoorFixture["enclosure"];
  lanes: AgilityFixtureLane[];
}

/**
 * Real authored obstacles in two short west-yard lanes. Only the fixture coordinates change.
 * Tier, skill gate, duration, appearance, composition and traversal rules retain their production
 * sources. The visible 32 m walls and their matching solids make the ordinary walking detour
 * measurable. Root merges these solids before building navigation and draws every enclosure wall.
 */
export function assembleAgilityFixture(
  heightAt: (x: number, z: number) => number,
  baseY: (assetId: string) => number,
  assetSize: (assetId: string) => AssetSize | null,
  assetCenterXZ: (assetId: string) => AssetCenterXZ | null,
): AgilityFixture {
  // Reuse the production builder so composition parts and measured collision never diverge from
  // the authored obstacles. Its discarded world output is plain data, with no renderer or RNG
  // mutation. Ground at zero lets each retained part be translated onto the lab's actual surface.
  const source = buildWorld(2, () => 0, { heightAt: () => 0, baseY, assetSize, assetCenterXZ });
  const result: AgilityFixture = {
    entities: [], solids: [], routeNodes: [], routeEdges: [], enclosure: [], lanes: [],
  };
  const point = (x: number, z: number): Vec3 => [x, heightAt(x, z), z];
  for (const definition of [
    { id: "root_tunnel", z: -22 },
    { id: "sunder_ledge", z: 22 },
  ] as const) {
    const hero = source.entities.find((entity) => entity.id === definition.id);
    if (!hero?.obstacle) throw new Error(`Missing authored Agility obstacle: ${definition.id}`);
    const x = -22;
    // The tunnel's arch is only a few centimetres deep. Keep its whole authored entrance on the
    // visible approach face, rather than burying it inside the continuous masonry behind it.
    const heroX = definition.id === "root_tunnel" ? x - 2 : x;
    const dx = heroX - hero.position[0];
    const dz = definition.z - hero.position[2];
    const belongs = (id: EntityId): boolean => id === definition.id || id.startsWith(`${definition.id}#`);
    const translate = (position: Vec3): Vec3 => {
      const px = position[0] + dx;
      const pz = position[2] + dz;
      return [px, position[1] + heightAt(px, pz), pz];
    };
    const entry = point(x - 5, definition.z);
    const exit = point(x + 5, definition.z);
    const entities = source.entities.filter((entity) => belongs(entity.id));
    for (const entity of entities) {
      const authoredRegionId = entity.regionId;
      entity.position = translate(entity.position);
      entity.regionId = "fallowmarch";
      entity.meta = { ...entity.meta, featureLab: true, agilityFixture: true, authoredRegionId };
      if (entity.id === definition.id) {
        entity.interactionPosition = entry;
        entity.obstacle!.exitPosition = exit;
        entity.meta.traversalKind = definition.id === "root_tunnel" ? "passage" : "climb";
      }
    }
    result.entities.push(...entities);
    result.solids.push(...source.solids.filter((solid) => belongs(solid.id)).map((solid) => ({
      ...solid, position: translate(solid.position),
    })));

    const origin = point(x, definition.z);
    const rotationY = Math.PI / 2;
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    const bottomAt = (localX: number, localZ: number): number => heightAt(
      origin[0] + localX * cos + localZ * sin,
      origin[2] - localX * sin + localZ * cos,
    ) - origin[1] - 0.5;
    const wall = {
      id: `feature-lab:agility-wall:${definition.id}`, origin, rotationY,
      minX: -16, maxX: 16, bottomAt, height: 6,
    };
    result.enclosure.push(wall);
    const samples = [bottomAt(-16, -0.6), bottomAt(-16, 0.6),
      bottomAt(16, -0.6), bottomAt(16, 0.6), bottomAt(0, 0)];
    const bottom = Math.min(...samples);
    result.solids.push({
      kind: "box", id: wall.id,
      position: [x, origin[1] + bottom, definition.z],
      size: [32, Math.max(...samples) + wall.height - bottom, 1.2], rotationY,
    });

    const fromId = `feature-lab:agility:${definition.id}:entry`;
    const toId = `feature-lab:agility:${definition.id}:exit`;
    result.routeNodes.push(
      { id: fromId, name: `${hero.name} entrance`, regionId: "fallowmarch", position: entry },
      { id: toId, name: `${hero.name} exit`, regionId: "fallowmarch", position: exit },
    );
    const durationMs = hero.obstacle.durationMs!;
    result.routeEdges.push(
      { from: fromId, to: toId, kind: "shortcut", obstacleId: hero.id,
        entrance: entry, exit, durationMs, reqLevel: hero.obstacle.reqLevel, cost: durationMs / 1000 },
      { from: toId, to: fromId, kind: "shortcut", obstacleId: hero.id,
        entrance: exit, exit: entry, durationMs, reqLevel: hero.obstacle.reqLevel, cost: durationMs / 1000 },
    );
    result.lanes.push({ id: definition.id, entry, exit, reqLevel: hero.obstacle.reqLevel,
      durationMs, tier: hero.tier });
  }
  for (const [index, kind] of (Object.keys(TRAVERSAL_CONTACTS) as ContactTraversalKind[]).entries()) {
    const d = TRAVERSAL_CONTACTS[kind];
    const id: AgilityFixtureId = `contact_${kind}`;
    const x = -8 + index * 9;
    const z = -32;
    const position = point(x, z);
    const entry = point(x, z - 2.2);
    const exit = point(x, z + 2.2);
    const name = { climb: "Training ledge", vault: "Low vault wall", balance: "Balance timber", slide: "Practice slide" }[kind];
    result.entities.push({ id, name, archetype: "obstacle", tier: 1, regionId: "fallowmarch",
      position, interactionPosition: entry, state: "available", interactions: ["inspect", kind === "vault" ? "vault" : "climb"],
      requirements: { agility: 1 },
      obstacle: { reqLevel: 1, exitPosition: exit, durationMs: d.durationMs, savesMeters: 4 },
      view: { assetId: d.assetId, labelHeight: d.rise + 0.5 },
      meta: { featureLab: true, agilityFixture: true, traversalKind: kind,
        traversalContactDepth: d.depth, traversalContactWidth: d.width, traversalRise: d.rise, oneWay: kind === "slide" },
    });
    result.solids.push({ kind: "box", id, position, size: [d.width, d.rise + (kind === "slide" ? 0.025 : 0), d.depth], rotationY: 0 });
    const from = `${id}:entry`;
    const to = `${id}:exit`;
    result.routeNodes.push({ id: from, name: `${name} entrance`, position: entry, regionId: "fallowmarch" },
      { id: to, name: `${name} exit`, position: exit, regionId: "fallowmarch" });
    result.routeEdges.push({ from, to, kind: "shortcut", obstacleId: id, entrance: entry, exit,
      durationMs: d.durationMs, reqLevel: 1, cost: d.durationMs / 1000 });
    if (kind !== "slide") result.routeEdges.push({ from: to, to: from, kind: "shortcut", obstacleId: id,
      entrance: exit, exit: entry, durationMs: d.durationMs, reqLevel: 1, cost: d.durationMs / 1000 });
    result.lanes.push({ id, entry, exit, reqLevel: 1, durationMs: d.durationMs, tier: 1,
      contact: { kind, width: d.width, depth: d.depth, rise: d.rise, origin: position } });
  }
  for (const { link, entry: entrySpot, exit: exitSpot, rise } of FAIRY_AGILITY_LAB_PLACEMENTS) {
    const id = link.obstacle.id as AgilityFixtureId;
    const hero = source.entities.find(entity => entity.id === id);
    if (!hero?.obstacle) throw Error(`Missing production fairy Agility obstacle: ${id}`);
    const entry = point(...entrySpot), exit = point(...exitSpot);
    if (Math.abs(exit[1] - entry[1] - rise) > .2) throw Error(`Fairy Agility terrain support missing: ${id}`);
    const dx = entrySpot[0] - hero.position[0], dz = entrySpot[1] - hero.position[2];
    const belongs = (candidate: string) => candidate === id || candidate.startsWith(`${id}#`);
    const translate = (position: Vec3): Vec3 => {
      const x = position[0] + dx, z = position[2] + dz;
      return [x, position[1] + heightAt(x, z), z];
    };
    for (const entity of source.entities.filter(candidate => belongs(candidate.id))) {
      const authoredRegionId = entity.regionId;
      entity.position = translate(entity.position);
      entity.regionId = 'fallowmarch';
      entity.meta = { ...entity.meta, featureLab: true, agilityFixture: true, authoredRegionId };
      if (entity.id === id) {
        entity.interactionPosition = entry;
        entity.obstacle!.exitPosition = exit;
      }
      result.entities.push(entity);
    }
    result.solids.push(...source.solids.filter(solid => belongs(solid.id)).map(solid => ({
      ...solid, position: translate(solid.position),
    })));
    const from = link.obstacle.fromLocationId, to = link.obstacle.toLocationId;
    result.routeNodes.push({ id: from, name: `${hero.name} foot`, regionId: 'fallowmarch', position: entry },
      { id: to, name: `${hero.name} top`, regionId: 'fallowmarch', position: exit });
    result.routeEdges.push({ from, to, kind: 'shortcut', obstacleId: id, entrance: entry, exit,
      reqLevel: hero.obstacle.reqLevel, durationMs: hero.obstacle.durationMs, cost: hero.obstacle.durationMs! / 1000 },
    { from: to, to: from, kind: 'shortcut', obstacleId: id, entrance: exit, exit: entry,
      reqLevel: hero.obstacle.reqLevel, durationMs: hero.obstacle.durationMs, cost: hero.obstacle.durationMs! / 1000 });
    result.lanes.push({ id, name: hero.name, entry, exit, reqLevel: hero.obstacle.reqLevel,
      durationMs: hero.obstacle.durationMs!, tier: hero.tier });
  }
  return result;
}

export interface AgilityWorkbenchState {
  lanes: (AgilityFixtureLane & { groundEntry: Vec3; groundExit: Vec3; walking: MovementPathPlan | null })[];
  playerPosition: Vec3;
  activity: GameState["activity"];
  movement: GameState["player"]["movement"];
  agility: GameState["skills"]["agility"];
  health: number;
  uses: Record<AgilityFixtureId, number>;
  quest: GameState["quests"][string] | null;
  miscState: number;
  setup: { seed: number; miscState: number };
  traversal: TraversalSample | null;
}

export interface AgilityWorkbenchApi {
  prepare(): AgilityWorkbenchState;
  setLevel(level: number): AgilityWorkbenchState;
  getState(): AgilityWorkbenchState;
  setLandingAvailable(id: `contact_${ContactTraversalKind}`, available: boolean): AgilityWorkbenchState;
}

/**
 * Diagnostic prerequisites and observations only. The browser uses GameApi for every attempted
 * traversal, plan, cancellation and ground move. It never advances a clock or calls a driver.
 *
 * Seed 2's untouched misc stream is 2 XOR 0x6666 = 26212. Its first three draws are
 * .5909073413, .5266612365, .8335758832. At levels 8/10 these give Root success, Sunder success,
 * Sunder failure; the fourth draw .2582406835 gives three damage. No outcome is injected.
 * Pass the same Rng object Agility received at construction. RngStreams.reseed replaces objects
 * and must not be called during this fixture. Do not complete cooking while this sequence runs.
 */
export function createAgilityWorkbench(fixture: AgilityFixture, deps: {
  store: Store;
  quests: Pick<QuestSystem, "setStage" | "evaluateNow">;
  navigation: Pick<Navigation, "closestPoint">;
  movement: Pick<Movement, "planPath">;
  rng: Rng;
  elapsedMs?(): number;
  getEntity?(id: EntityId): SemanticEntity | undefined;
}): AgilityWorkbenchApi {
  const setup = { seed: 2, miscState: 26212 };
  const idle = (): GameState => {
    const state = deps.store.get();
    if (state.activity || state.player.movement.mode !== "idle" || state.combat.targetId
      || state.combat.engagedBy.length > 0) {
      throw new Error("Stop movement and activity and leave combat before preparing Agility prerequisites.");
    }
    return state;
  };
  function getState(): AgilityWorkbenchState {
    const state = deps.store.get();
    const traversal = state.activity?.kind === "traversing" ? state.activity : null;
    const entity = traversal ? fixture.entities.find((candidate) => candidate.id === traversal.obstacleId) : undefined;
    return {
      traversal: traversal && entity ? sampleTraversal(entity, state.player.position,
        traversal.exitPosition ?? entity.obstacle!.exitPosition,
        deps.elapsedMs ? 1 - (traversal.endsAtMs - deps.elapsedMs()) / entity.obstacle!.durationMs : 0) : null,
      lanes: fixture.lanes.map((lane) => {
        const entry = deps.navigation.closestPoint(lane.entry) ?? lane.entry;
        const exit = deps.navigation.closestPoint(lane.exit) ?? lane.exit;
        // Navigation may lift a point above the ground through voxelization or triangulation
        // beside the marker. Keep the actual terrain endpoints available for geometry proof.
        return { ...lane, groundEntry: [...lane.entry] as Vec3, groundExit: [...lane.exit] as Vec3, entry, exit,
          walking: deps.movement.planPath(entry, exit, null, { arrivalAllowance: 0 }) };
      }),
      playerPosition: [...state.player.position],
      activity: structuredClone(state.activity),
      movement: structuredClone(state.player.movement),
      agility: { ...state.skills.agility }, health: state.player.health,
      uses: Object.fromEntries(fixture.lanes.map((lane) => [lane.id, state.world.obstaclesUsed[lane.id] ?? 0])) as Record<AgilityFixtureId, number>,
      quest: structuredClone(state.quests.bad_ground ?? null),
      miscState: deps.rng.getState(), setup: { ...setup },
    };
  }
  return {
    getState,
    setLandingAvailable(id, available) {
      const fixtureEntity = fixture.entities.find((entity) => entity.id === id && entity.meta?.traversalContactDepth !== undefined);
      const live = deps.getEntity?.(id);
      if (!fixtureEntity?.obstacle || !live?.obstacle) throw new Error("The compact landing fixture is unavailable.");
      // Controlled invalid-navigation setup. Gameplay still enters through the real dispatcher.
      live.obstacle.exitPosition = available ? [...fixtureEntity.obstacle.exitPosition] : [999999, 0, 999999];
      return getState();
    },
    prepare() {
      const state = idle();
      setSkillLevel(state, "agility", 8);
      setSkillLevel(state, "mining", 10);
      state.player.health = state.player.maxHealth;
      delete state.world.obstaclesUsed.root_tunnel;
      delete state.world.obstaclesUsed.sunder_ledge;
      for (const lane of fixture.lanes) delete state.world.obstaclesUsed[lane.id];
      state.bank.slots = state.bank.slots.filter((slot) => slot.itemId !== "kaldite_ore");
      const quest = deps.quests.setStage("bad_ground", 1);
      if (!quest.ok) throw new Error(quest.error.message);
      deps.quests.evaluateNow();
      deps.rng.setState(setup.miscState);
      deps.store.markDirty();
      return getState();
    },
    setLevel(level) {
      if (!Number.isInteger(level) || level < 1 || level > 99) throw new Error("Agility fixture level must be between 1 and 99.");
      setSkillLevel(idle(), "agility", level);
      deps.store.markDirty();
      return getState();
    },
  };
}
