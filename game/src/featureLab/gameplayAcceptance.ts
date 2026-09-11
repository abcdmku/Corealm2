import type { EntityId, SemanticEntity, Vec3 } from "../contracts.js";
import { REGIONAL_ESSENCE_ALTARS } from "../content/regions.js";
import type { Store, GameState } from "../state/store.js";
import { createFeatureLabEntity, FEATURE_LAB_CATALOG } from "./catalog.js";

export interface GameplayAcceptanceDeps {
  store: Store;
  entities: { get(id: EntityId): SemanticEntity | undefined; add(entity: SemanticEntity): void; remove(id: EntityId): boolean };
  prepareEntities(entities: readonly SemanticEntity[]): Promise<void>;
  groundHeightAt(x: number, z: number): number;
  baseY(assetId: string): number;
  assetSize?(assetId: string): { x: number; y: number; z: number } | null;
}
export type GameplayAcceptanceScenario = "altar" | "storm-rhino" | "gate";

/** Compact production actors/station. Preparation sets prerequisites only, never kills, grants
 * final rewards, awakens an altar, or opens a gate. Each scenario requires a fresh lab document.
 * Gate uses the existing ?doors=1 fixture's physical Quarry Warden gate.
 */
export function createGameplayAcceptanceFixture(deps: GameplayAcceptanceDeps) {
  let scenario: GameplayAcceptanceScenario | null = null;
  let world: GameState | null = null;
  let installed: string[] = [];
  let preparing = false;
  const ground = (x: number, z: number): Vec3 => [x, deps.groundHeightAt(x, z), z];
  const actor = (presetId: string, id: string, x: number, z: number) => {
    const preset = FEATURE_LAB_CATALOG.targets.creature.find((entry) => entry.id === presetId);
    if (!preset) throw new Error(`Missing production creature preset ${presetId}`);
    const entity = createFeatureLabEntity(preset, { entityId: id, groundPosition: ground(x, z),
      baseY: deps.baseY, assetSize: deps.assetSize });
    entity.regionId = "fallowmarch";
    entity.meta = { ...entity.meta, featureLab: true, gameplayAcceptance: true };
    return entity;
  };
  const getState = () => {
    const state = deps.store.get();
    return { ready: world === state && scenario !== null, scenario: world === state ? scenario : null,
      actors: installed.map((id) => deps.entities.get(id)).filter((entity) => entity !== undefined)
        .map((entity) => ({ id: entity.id, state: entity.state, position: entity.position,
          health: entity.combat?.health ?? null, maxHealth: entity.combat?.maxHealth ?? null })),
      gate: deps.entities.get("ordrun_gate")?.state ?? null,
      quests: state.quests, awakenedAltars: state.magic.awakenedAltars, consumedOrbs: state.magic.consumedOrbs };
  };
  return {
    getState,
    async prepare(next: GameplayAcceptanceScenario) {
      if (!["altar", "storm-rhino", "gate"].includes(next)) throw new Error(`Unknown gameplay scenario ${next}`);
      const state = deps.store.get();
      if (preparing || scenario !== null) throw new Error("Reload the lab before preparing another gameplay scenario");
      if (state.activity || state.combat.targetId || state.combat.engagedBy.length) throw new Error("Leave combat and stop activities first");
      if (next === "gate" && deps.entities.get("ordrun_gate")?.state !== "sealed") {
        throw new Error("Gate acceptance needs a fresh ?mode=combat&doors=1 lab");
      }
      preparing = true;
      try {
        const entities: SemanticEntity[] = [];
        if (next === "altar") {
          const source = REGIONAL_ESSENCE_ALTARS.fallowmarch;
          const position: Vec3 = [-5, deps.groundHeightAt(-5, -2) - deps.baseY(source.assetId) * source.scale, -2];
          entities.push({ id: source.id, name: source.name, archetype: "station", tier: 1,
            regionId: "fallowmarch", position, interactionPosition: ground(-3, -2), state: "dormant",
            interactions: ["inspect", "awaken"],
            station: { kind: source.kind, skill: source.skill, recipeIds: [...source.recipeIds] },
            view: { assetId: source.assetId, scale: source.scale, rotationY: source.rotationY, labelHeight: 1.6 },
            meta: { stationKind: source.kind, essenceAltar: true, essenceElement: source.essenceElement,
              featureLab: true, gameplayAcceptance: true } });
        } else if (next === "storm-rhino") {
          entities.push(actor("tempest_roc", "tempest_roc", 3, -5));
        } else {
          entities.push(actor("gravelmaw:gravelmaw_ch3_bears", "gravelmaw_ch3_bears_0", 33, -12),
            actor("gravelmaw:gravelmaw_ch3_bears", "gravelmaw_ch3_bears_1", 39, -12),
            actor("gravelmaw:ordrun", "ordrun", 36, -25));
          entities.push({ id: "gravelmaw_chamber3_marker", name: "The Cairn Hall", archetype: "landmark", tier: 1,
            regionId: "fallowmarch", position: ground(36, -12), state: "lit", interactions: ["inspect"],
            meta: { locationId: "gravelmaw_chamber3", featureLab: true, gameplayAcceptance: true } });
        }
        for (const entity of entities) if (deps.entities.get(entity.id)) throw new Error(`Fixture id already occupied: ${entity.id}`);
        await deps.prepareEntities(entities);
        if (deps.store.get() !== state) throw new Error("World changed while preparing gameplay assets");
        state.quests = {};
        state.dialogue = null;
        state.inventory.slots.fill(null);
        if (next === "altar") {
          delete state.magic.awakenedAltars.fallowmarch_air_altar;
          delete state.magic.consumedOrbs.air_orb;
          state.inventory.slots[0] = { slotIndex: 0, itemId: "air_orb", quantity: 1 };
          state.inventory.slots[1] = { slotIndex: 1, itemId: "palewood_staff", quantity: 1 };
          state.inventory.slots[2] = { slotIndex: 2, itemId: "air_essence", quantity: 100 };
          state.quests.sparking_stone = { status: "active", stage: 2, counters: {}, flags: {} };
        } else if (next === "storm-rhino") {
          delete state.magic.awakenedAltars.fallowmarch_air_altar;
          delete state.magic.consumedOrbs.air_orb;
          state.quests.sparking_stone = { status: "active", stage: 0,
            counters: { "@base:kill:tempest_roc": 0 }, flags: {} };
        } else {
          state.inventory.slots[0] = { slotIndex: 0, itemId: "cairn_garnet", quantity: 1 };
          state.quests.long_cairn = { status: "active", stage: 6,
            counters: { "@base:kill:vault_custodian": 0 },
            flags: { lever_order_known: true, "@reacted:4:lever_order_known": true, door_open: true, has_keeping_stone: true } };
        }
        for (const entity of entities) deps.entities.add(entity);
        installed = entities.map((entity) => entity.id);
        world = state;
        scenario = next;
        deps.store.markDirty();
        return getState();
      } finally { preparing = false; }
    },
  };
}

export type GameplayAcceptanceFixtureApi = ReturnType<typeof createGameplayAcceptanceFixture>;

