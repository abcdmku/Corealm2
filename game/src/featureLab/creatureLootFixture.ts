import { JEWELRY_RECIPES, isRetiredJewelry } from '../content/jewelry.js';
import type { EntityId, SemanticEntity, Vec3 } from "../contracts.js";
import { REGIONS } from "../content/regions.js";
import type { GameState, Store } from "../state/store.js";
import { WILDERNESS_LOOT_RECIPES } from '../content/wildernessLoot.js';

export const CREATURE_LOOT_STATION_ID = "feature-lab:creature-loot:crafting-table";

export interface CreatureLootFixtureDeps {
  readonly store: Pick<Store, "get">;
  readonly entities: {
    get(id: EntityId): SemanticEntity | undefined;
    add(entity: SemanticEntity): void;
  };
  /** Load and check the normal station assets before publishing the semantic entity. */
  readonly prepareEntities: (entities: readonly SemanticEntity[]) => Promise<void>;
  readonly groundHeightAt: (x: number, z: number) => number;
  readonly baseY: (assetId: string) => number;
}

export interface CreatureLootFixtureState {
  readonly ready: boolean;
  readonly stationId: EntityId;
  readonly position: Vec3 | null;
  readonly assetId: string;
  readonly woundedTarget: { entityId: EntityId; before: number; maxHealth: number; setupHealth: number } | null;
}

export interface CreatureLootFixtureApi {
  prepare(): Promise<CreatureLootFixtureState>;
  getState(): CreatureLootFixtureState;
  /** Loot-path setup only. A real combat action must still cause death and produce rewards. */
  prepareWoundedTarget(entityId: EntityId): CreatureLootFixtureState;
}

/** A production crafting station only. Ingredients, rewards and equipment stay in their systems. */
export function createCreatureLootFixture(deps: CreatureLootFixtureDeps): CreatureLootFixtureApi {
  const region = REGIONS.find((candidate) => candidate.id === "fallowmarch");
  const source = region?.settlement?.stations.find((station) => station.id === "coldbrace_crafting");
  if (!region || !source || source.kind !== "crafting_table") {
    throw new Error("The creature loot fixture requires the production Coldbrace crafting table.");
  }
  const assetId = source.assetId;
  let station: SemanticEntity | null = null;
  let preparedWorld: GameState | null = null;
  let pending: Promise<CreatureLootFixtureState> | null = null;
  let woundedTarget: CreatureLootFixtureState['woundedTarget'] = null;

  function getState(): CreatureLootFixtureState {
    const ready = station !== null
      && preparedWorld === deps.store.get()
      && deps.entities.get(CREATURE_LOOT_STATION_ID) === station;
    return {
      ready,
      stationId: CREATURE_LOOT_STATION_ID,
      position: ready && station ? [...station.position] as Vec3 : null,
      assetId,
      woundedTarget,
    };
  }

  async function install(): Promise<CreatureLootFixtureState> {
    const world = deps.store.get();
    const previous = deps.entities.get(CREATURE_LOOT_STATION_ID);
    if (previous && previous !== station) {
      throw new Error("Another entity occupies the creature loot station id.");
    }
    const x = -5;
    const z = -2;
    const scale = source!.scale ?? 1;
    const position: Vec3 = [x, deps.groundHeightAt(x, z) - deps.baseY(assetId) * scale, z];
    if (!position.every(Number.isFinite)) throw new Error("The creature loot station has invalid grounding.");
    // The rotated workbench's east edge ends at x = -4.49; leave room for the player capsule.
    const interactionPosition: Vec3 = [-3.5, deps.groundHeightAt(-3.5, -2), -2];
    if (!interactionPosition.every(Number.isFinite)) {
      throw new Error("The creature loot station has an invalid working position.");
    }
    // Match regionBuilder's ordinary station shape and preserve the canonical recipe allowlist.
    const candidate: SemanticEntity = {
      id: CREATURE_LOOT_STATION_ID,
      archetype: "station",
      name: "Feature Lab Crafting Table",
      tier: region!.tier,
      regionId: "fallowmarch",
      position,
      interactionPosition,
      state: "idle",
      interactions: ["inspect", "produce"],
      station: { kind: source!.kind, skill: source!.skill, recipeIds: [...new Set([...source!.recipeIds.filter(id => !isRetiredJewelry(id.replace(/^craft_/, ""))),
        ...JEWELRY_RECIPES.map(recipe => recipe.id),
        ...WILDERNESS_LOOT_RECIPES.filter(recipe => recipe.stations?.includes(source!.kind)).map(recipe => recipe.id)])] },
      view: {
        assetId, rotationY: source!.rotationY, scale: source!.scale, labelHeight: 1.6,
      },
      meta: {
        stationKind: source!.kind,
        settlementId: region!.settlement!.id,
        featureLab: true,
        creatureLootFixture: true,
        sourceStationId: source!.id,
      },
    };
    await deps.prepareEntities([candidate]);
    if (deps.store.get() !== world) {
      throw new Error("The world reset while preparing the creature loot station. Prepare it again.");
    }
    if (deps.entities.get(CREATURE_LOOT_STATION_ID) !== previous) {
      throw new Error("The creature loot station changed during preparation. Prepare it again.");
    }
    deps.entities.add(candidate);
    station = candidate;
    preparedWorld = world;
    return getState();
  }

  return {
    getState,
    prepareWoundedTarget(entityId) {
      const target = deps.entities.get(entityId);
      if (!target?.combat || target.state !== 'alive' || !String(target.meta?.groupId ?? '').startsWith('candidate:')) {
        throw new Error('Wounded-target setup requires a living candidate creature in the lab.');
      }
      woundedTarget = { entityId, before: target.combat.health, maxHealth: target.combat.maxHealth, setupHealth: 1 };
      target.combat.health = 1;
      return getState();
    },
    async prepare() {
      if (getState().ready) return getState();
      if (pending) return pending;
      const task = install();
      pending = task;
      try {
        return await task;
      } finally {
        if (pending === task) pending = null;
      }
    },
  };
}
