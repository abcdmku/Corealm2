import type { EntityId, SemanticEntity, StationKind, Vec3 } from "../contracts.js";
import { RECIPES } from "../content/recipes.js";
import { REGIONS, type StationDef } from "../content/regions.js";
import type { GameState } from "../state/store.js";
import type { CreatureLootFixtureDeps } from "./creatureLootFixture.js";

/** Production stations kept together so a regional recipe shard can exercise every station kind. */
export const REGIONAL_TIER_STATION_KINDS = [
  "furnace", "anvil", "crafting_table", "fletching_bench", "range",
] as const satisfies readonly StationKind[];
export type RegionalTierStationKind = typeof REGIONAL_TIER_STATION_KINDS[number];

const SOURCE_STATION_IDS: Readonly<Record<RegionalTierStationKind, string>> = {
  furnace: "coldbrace_furnace",
  anvil: "coldbrace_anvil",
  crafting_table: "coldbrace_crafting",
  fletching_bench: "coldbrace_fletching",
  range: "coldbrace_range",
};

const STATION_POSITIONS: Readonly<Record<RegionalTierStationKind, readonly [number, number]>> = {
  furnace: [-12, -12],
  anvil: [-6, -12],
  crafting_table: [0, -12],
  fletching_bench: [6, -12],
  range: [12, -12],
};

export const REGIONAL_TIER_STATION_IDS: Readonly<Record<RegionalTierStationKind, EntityId>> = {
  furnace: "feature-lab:regional-tier:furnace",
  anvil: "feature-lab:regional-tier:anvil",
  crafting_table: "feature-lab:regional-tier:crafting_table",
  fletching_bench: "feature-lab:regional-tier:fletching_bench",
  range: "feature-lab:regional-tier:range",
};

export interface RegionalTierFixtureStationState {
  readonly id: EntityId;
  readonly kind: RegionalTierStationKind;
  readonly position: Vec3;
  readonly interactionPosition: Vec3;
  readonly assetId: string;
  readonly recipeCount: number;
}

export interface RegionalTierFixtureState {
  readonly ready: boolean;
  readonly stationIds: Readonly<Record<RegionalTierStationKind, EntityId>>;
  readonly stations: readonly RegionalTierFixtureStationState[];
}

export interface RegionalTierFixtureApi {
  prepare(): Promise<RegionalTierFixtureState>;
  getState(): RegionalTierFixtureState;
}

/**
 * Install a compact row of ordinary production stations into the feature-lab yard.
 *
 * The entities are copies of the authored Coldbrace station definitions. Recipe allowlists come
 * from the assembled production `RECIPES` table, so the fixture follows the same content registry
 * that production stations and the production panel consume. This fixture never seeds inventory,
 * changes skills, or calls a gameplay API; those prerequisites remain the acceptance harness's
 * responsibility.
 */
export function createRegionalTierFixture(deps: CreatureLootFixtureDeps): RegionalTierFixtureApi {
  const region = REGIONS.find((candidate) => candidate.id === "fallowmarch");
  const settlement = region?.settlements.find((town) => town.id === "coldbrace");
  if (!settlement) throw new Error("The regional tier fixture requires Coldbrace.");

  const sources = new Map<RegionalTierStationKind, StationDef>();
  for (const kind of REGIONAL_TIER_STATION_KINDS) {
    const sourceId = SOURCE_STATION_IDS[kind];
    const source = settlement.stations.find((station) => station.id === sourceId && station.kind === kind);
    if (!source) throw new Error(`The regional tier fixture requires authored station ${sourceId}.`);
    sources.set(kind, source);
  }

  let stations: SemanticEntity[] | null = null;
  let preparedWorld: GameState | null = null;
  let pending: Promise<RegionalTierFixtureState> | null = null;

  function getState(): RegionalTierFixtureState {
    const ready = stations !== null
      && preparedWorld === deps.store.get()
      && stations.every((station) => deps.entities.get(station.id) === station);
    const stationState = stations
      ? REGIONAL_TIER_STATION_KINDS.map((kind) => {
        const candidate = stations!.find((station) => station.id === REGIONAL_TIER_STATION_IDS[kind]);
        if (!candidate) throw new Error(`The regional tier fixture lost its ${kind} station.`);
        return makeState(sources.get(kind)!, kind, candidate, candidate.station?.recipeIds.length ?? 0);
      })
      : REGIONAL_TIER_STATION_KINDS.map((kind) => makeState(sources.get(kind)!, kind, null, null));
    return {
      ready,
      stationIds: REGIONAL_TIER_STATION_IDS,
      stations: stationState,
    };
  }

  async function install(): Promise<RegionalTierFixtureState> {
    const world = deps.store.get();
    const previous = new Map<EntityId, SemanticEntity | undefined>(
      REGIONAL_TIER_STATION_KINDS.map((kind) => {
        const id = REGIONAL_TIER_STATION_IDS[kind];
        return [id, deps.entities.get(id)];
      }),
    );
    if ([...previous].some(([id, entity]) => entity && entity !== stations?.find((candidate) => candidate.id === id))) {
      throw new Error("Another entity occupies a regional tier fixture station id.");
    }

    const candidates = REGIONAL_TIER_STATION_KINDS.map((kind) => makeStation(sources.get(kind)!, kind));
    await deps.prepareEntities(candidates);
    if (deps.store.get() !== world) {
      throw new Error("The world reset while preparing the regional tier fixture. Prepare it again.");
    }
    for (const candidate of candidates) {
      if (deps.entities.get(candidate.id) !== previous.get(candidate.id)) {
        throw new Error(`The regional tier fixture station ${candidate.id} changed during preparation. Prepare it again.`);
      }
    }
    for (const candidate of candidates) deps.entities.add(candidate);
    stations = candidates;
    preparedWorld = world;
    return getState();
  }

  return {
    getState,
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

  function makeStation(source: StationDef, kind: RegionalTierStationKind): SemanticEntity {
    const [x, z] = STATION_POSITIONS[kind];
    const scale = source.scale ?? 1;
    const position: Vec3 = [x, deps.groundHeightAt(x, z) - deps.baseY(source.assetId) * scale, z];
    // Station definitions face their working side along local +Z. Keep the player on that side,
    // inside production's range while leaving the five assets a readable six-metre row apart.
    const offset = 2;
    const ix = x + Math.sin(source.rotationY) * offset;
    const iz = z + Math.cos(source.rotationY) * offset;
    const interactionPosition: Vec3 = [ix, deps.groundHeightAt(ix, iz), iz];
    if (![...position, ...interactionPosition].every(Number.isFinite)) {
      throw new Error(`The regional tier fixture station ${kind} has invalid grounding.`);
    }
    const recipeIds = RECIPES
      .filter((recipe) => recipe.stations?.includes(kind))
      .map((recipe) => recipe.id);
    return {
      id: REGIONAL_TIER_STATION_IDS[kind],
      archetype: "station",
      name: `Feature Lab ${source.name}`,
      tier: region!.tier,
      regionId: "fallowmarch",
      position,
      interactionPosition,
      state: "idle",
      interactions: ["inspect", "produce"],
      station: { kind, skill: source.skill, recipeIds: [...new Set(recipeIds)] },
      view: {
        assetId: source.assetId,
        rotationY: source.rotationY,
        scale: source.scale,
        labelHeight: 1.6,
      },
      meta: {
        stationKind: kind,
        featureLab: true,
        regionalTierFixture: true,
        sourceStationId: source.id,
      },
    };
  }

  function makeState(
    source: StationDef,
    kind: RegionalTierStationKind,
    candidate: SemanticEntity | null,
    recipeCount: number | null,
  ): RegionalTierFixtureStationState {
    const position = candidate?.position ?? [STATION_POSITIONS[kind][0], 0, STATION_POSITIONS[kind][1]] as Vec3;
    const interactionPosition = candidate?.interactionPosition ?? position;
    return {
      id: REGIONAL_TIER_STATION_IDS[kind], kind,
      position: [...position] as Vec3,
      interactionPosition: [...interactionPosition] as Vec3,
      assetId: source.assetId,
      recipeCount: recipeCount ?? RECIPES.filter((recipe) => recipe.stations?.includes(kind)).length,
    };
  }
}
