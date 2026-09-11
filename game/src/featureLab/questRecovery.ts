import type { EntityId, InventorySlot, QuestId, QuestSummary, SemanticEntity, SkillId, Vec3 } from "../contracts.js";
import { SKILL_IDS } from "../contracts.js";
import type { GameState, Store } from "../state/store.js";
import { setSkillLevel } from "../state/store.js";
import type { QuestSystem } from "../systems/quests.js";
import { createFeatureLabEntity, FEATURE_LAB_CATALOG } from "./catalog.js";

export interface QuestRecoveryFixtureDeps {
  readonly store: Store;
  readonly quests: QuestSystem;
  readonly entities: {
    add(entity: SemanticEntity): void;
    remove(id: EntityId): boolean;
  };
  /** Load the normal NPC assets before the fixture enters the live entity table. */
  readonly prepareEntities: (entities: readonly SemanticEntity[]) => Promise<void>;
  readonly groundHeightAt: (x: number, z: number) => number;
  readonly baseY: (assetId: string) => number;
}

export interface QuestRecoveryFixtureState {
  readonly scenario: "rewards" | "air-altar" | "trap-line" | "replacement-stone" | null;
  readonly questId: QuestId | null;
  readonly npcId: EntityId | null;
  readonly quest: QuestSummary | null;
  readonly record: GameState["quests"][string] | null;
  readonly inventory: readonly (InventorySlot | null)[];
  readonly currency: number;
  readonly skillXp: Readonly<Record<SkillId, number>>;
  readonly airAltarAwakened: boolean;
  readonly airOrbConsumed: boolean;
  readonly visitLocations: readonly {
    locationId: string;
    name: string;
    position: Vec3;
    visited: boolean;
  }[];
}

export interface QuestRecoveryFixtureApi {
  prepareRewards(): Promise<QuestRecoveryFixtureState>;
  prepareAirAltar(): Promise<QuestRecoveryFixtureState>;
  prepareTrapLine(options?: { preserveProgress?: boolean }): Promise<QuestRecoveryFixtureState>;
  prepareReplacementStone(): Promise<QuestRecoveryFixtureState>;
  getState(): QuestRecoveryFixtureState;
}

/**
 * Setup and observations only. Real dialogue completes the quest, the normal bank frees space,
 * and QuestSystem's ordinary ticks deliver rewards. This never saves into the player's slot.
 */
export function createQuestRecoveryFixture(deps: QuestRecoveryFixtureDeps): QuestRecoveryFixtureApi {
  let scenario: QuestRecoveryFixtureState["scenario"] = null;
  let questId: QuestId | null = null;
  let npcId: EntityId | null = null;
  let visitMarkers: SemanticEntity[] = [];
  let preparedWorld: GameState | null = null;

  async function prepare(
    next: "rewards" | "air-altar" | "trap-line" | "replacement-stone",
    preserveProgress = false,
  ): Promise<QuestRecoveryFixtureState> {
    const state = deps.store.get();
    if (state.activity || state.combat.targetId || state.combat.engagedBy.length > 0) {
      throw new Error("Stop the current activity and leave combat before preparing the quest fixture.");
    }
    const nextNpcId = next === "rewards" ? "npc_carter_bel"
      : next === "air-altar" ? "npc_quarrier_vess"
      : next === "trap-line" ? "npc_trapper_mott" : "npc_cairnkeeper_ode";
    const preset = FEATURE_LAB_CATALOG.targets.npc.find((candidate) => candidate.id === nextNpcId);
    if (!preset) throw new Error(`Missing production NPC ${nextNpcId}`);
    const x = state.player.position[0] - 2;
    const z = state.player.position[2];
    const actor = createFeatureLabEntity(preset, {
      entityId: nextNpcId,
      groundPosition: [x, deps.groundHeightAt(x, z), z],
      baseY: deps.baseY,
      rotationY: Math.PI / 2,
    });
    actor.regionId = state.player.regionId;
    actor.meta = { ...actor.meta, featureLab: true, questRecoveryFixture: true };
    // Fixed, separated stops survive document reload setup and fit the lab's central pad.
    // Their canonical marker IDs let the production quest measure actual player movement.
    const stops = [
      ["blackwater_pools", "Blackwater Pools", -30, -30],
      ["gorge_head", "Gorge Head", 30, -30],
      ["thornline_camp", "The Thicket", 30, 30],
      ["gorge_ford", "Gorge Ford", -30, 30],
    ] as const;
    const nextMarkers: SemanticEntity[] = next !== "trap-line" ? [] : stops.map(([id, name, mx, mz]) => ({
      id: `${id}_marker`, archetype: "landmark", name, tier: 1, regionId: state.player.regionId,
      position: [mx, deps.groundHeightAt(mx, mz) - deps.baseY("torch"), mz],
      state: "lit", interactions: ["inspect"],
      view: { assetId: "torch", scale: 1, labelHeight: 2.4 },
      meta: { featureLab: true, questRecoveryFixture: true, locationId: id },
    }));
    await deps.prepareEntities([actor, ...nextMarkers]);
    if (deps.store.get() !== state) throw new Error("The world changed while preparing the quest fixture.");

    if (npcId) deps.entities.remove(npcId);
    for (const marker of visitMarkers) deps.entities.remove(marker.id);
    deps.entities.add(actor);
    for (const marker of nextMarkers) deps.entities.add(marker);
    visitMarkers = nextMarkers;
    preparedWorld = state;
    scenario = next;
    npcId = nextNpcId;
    questId = next === "rewards" ? "the_carters_wager"
      : next === "air-altar" ? "sparking_stone"
      : next === "trap-line" ? "eleven_empty_days" : "long_cairn";

    state.dialogue = null;
    if (preserveProgress) {
      deps.store.markDirty();
      return getState();
    }
    state.quests = {};
    state.inventory.slots.fill(null);
    state.bank.slots = [];
    state.currency = 0;
    if (next === "rewards") {
      setSkillLevel(state, "agility", 8);
      state.quests[questId] = { status: "active", stage: 2, counters: {}, flags: {} };
      for (let slotIndex = 0; slotIndex < state.inventory.slots.length; slotIndex += 1) {
        state.inventory.slots[slotIndex] = { slotIndex, itemId: "grithe_ore", quantity: 1 };
      }
    } else if (next === "trap-line") {
      setSkillLevel(state, "agility", 8);
    } else if (next === "air-altar") {
      // The player used their only Air Orb before meeting Vess. Accept through her normal
      // dialogue, then kill a production Roc in the combat workbench to exercise the transition.
      state.magic.awakenedAltars.fallowmarch_air_altar = true;
      state.magic.consumedOrbs.air_orb = true;
      state.equipment.mainHand = { itemId: "basic_wooden_wand", quantity: 1 };
      setSkillLevel(state, "mining", 10);
    } else if (next === "replacement-stone") {
      // Diagnostic starting state: Ode's original stone was earned and then lost. This setup
      // does not claim a play-through; the browser must prove every replacement attempt itself.
      state.quests[questId] = {
        status: "active", stage: 6,
        counters: { stones_given: 0, "@base:kill:vault_custodian": 0 },
        flags: {
          lever_order_known: true, "@reacted:4:lever_order_known": true,
          door_open: true, has_keeping_stone: true,
        },
      };
      // Eating the single food through the normal inventory API frees exactly one slot.
      for (let slotIndex = 0; slotIndex < state.inventory.slots.length; slotIndex += 1) {
        state.inventory.slots[slotIndex] = {
          slotIndex, itemId: slotIndex === 0 ? "seared_minnow" : "grithe_ore", quantity: 1,
        };
      }
    }
    deps.store.markDirty();
    return getState();
  }

  function getState(): QuestRecoveryFixtureState {
    const state = deps.store.get();
    const prepared = preparedWorld === state;
    const currentQuestId = prepared ? questId : null;
    const record = currentQuestId ? state.quests[currentQuestId] : undefined;
    return {
      scenario: prepared ? scenario : null,
      questId: currentQuestId,
      npcId: prepared ? npcId : null,
      quest: currentQuestId ? deps.quests.summary(currentQuestId) ?? null : null,
      record: record ? { ...record, counters: { ...record.counters }, flags: { ...record.flags } } : null,
      inventory: state.inventory.slots.map((slot) => slot ? { ...slot } : null),
      currency: state.currency,
      skillXp: Object.fromEntries(SKILL_IDS.map((id) => [id, state.skills[id].xp])) as Record<SkillId, number>,
      airAltarAwakened: state.magic.awakenedAltars.fallowmarch_air_altar === true,
      airOrbConsumed: state.magic.consumedOrbs.air_orb === true,
      visitLocations: (prepared ? visitMarkers : []).map((marker) => {
        const locationId = String(marker.meta?.locationId);
        return {
          locationId,
          name: marker.name,
          position: [...marker.position] as Vec3,
          visited: record?.flags[`@visit:${JSON.stringify([0, locationId])}`] === true,
        };
      }),
    };
  }

  return {
    prepareRewards: () => prepare("rewards"),
    prepareAirAltar: () => prepare("air-altar"),
    prepareTrapLine: (options) => prepare("trap-line", options?.preserveProgress),
    prepareReplacementStone: () => prepare("replacement-stone"),
    getState,
  };
}
