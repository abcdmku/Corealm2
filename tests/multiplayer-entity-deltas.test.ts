import { expect, it } from "vitest";
import { SKILL_IDS, type SemanticEntity, type SkillId } from "../game/src/contracts.js";
import { EntityStore } from "../game/src/world/entities.js";
import { ReplicatedEntityLayer, upsertReplicatedEntity } from "../game/src/multiplayer/replicatedEntities.js";

const actor = (): SemanticEntity => ({ id: "actor", name: "Actor", archetype: "npc", tier: 1,
  regionId: "fallowmarch", position: [0, 0, 0], state: "alive", interactions: [],
  view: { assetId: "base_male" }, meta: { old: true } });
const store = () => new EntityStore({ skillLevels: () => Object.fromEntries(SKILL_IDS.map(id => [id, 1])) as Record<SkillId, number> });

it("retains actor render references while updating authoritative position and removing stale fields", () => {
  const entities = store(), first = actor(); upsertReplicatedEntity(entities, first);
  const snapshot = entities.renderSnapshot();
  const next = { ...actor(), position: [32, 0, 0] as [number, number, number] }; delete next.meta;
  upsertReplicatedEntity(entities, next);
  expect(entities.get(first.id)).toBe(first);
  expect(entities.renderSnapshot()).toBe(snapshot);
  expect(first.meta).toBeUndefined();
  const nearby: string[] = []; entities.index().forEachInRadius([32, 0, 0], 1, id => { nearby.push(id); });
  expect(nearby).toEqual([first.id]);
});

it("invalidates cached static placement and region membership when a replicated entity changes", () => {
  const entities = store(), first = { ...actor(), archetype: "landmark" as const }; upsertReplicatedEntity(entities, first);
  const before = entities.renderSnapshot();
  upsertReplicatedEntity(entities, { ...first, position: [40, 0, 0] });
  expect(entities.renderSnapshot()).not.toBe(before);
  const inRegion = (row: SemanticEntity) => row.regionId === "fallowmarch";
  const region = entities.renderSnapshot(inRegion);
  upsertReplicatedEntity(entities, { ...first, regionId: "gravelmaw" });
  expect(entities.renderSnapshot(inRegion)).not.toBe(region);
  expect(entities.renderSnapshot(inRegion)).toEqual([]);
  expect(entities.get(first.id)?.regionId).toBe("gravelmaw");
});

it("retains fixed scenery beyond network interest while replacing offline actors and interactables", () => {
  const entities = store();
  const house: SemanticEntity = { ...actor(), id: "distant-house", archetype: "landmark", position: [90, 0, 0], interactions: ["inspect"], view: {assetId: "wall_brick_straight"} };
  const interactive: SemanticEntity = { ...house, id: "interactive-landmark", interactions: ["enter"] };
  const baseline = [house, interactive, actor()]; entities.load(structuredClone(baseline));
  const layer = new ReplicatedEntityLayer(entities, baseline);
  layer.reset(); layer.upsert({ ...actor(), id: "online-actor" });
  expect(entities.all().map(entity => entity.id)).toEqual(["distant-house", "online-actor"]);
  expect(entities.get(house.id)?.view).toEqual(house.view);
  layer.reset();
  expect(entities.all().map(entity => entity.id)).toEqual(["distant-house"]);
});

it("restores unchanged scenery when interest expires without resurrecting dynamic entities", () => {
  const entities = store();
  const house: SemanticEntity = { ...actor(), id: "house", archetype: "landmark", position: [90, 0, 0] };
  const layer = new ReplicatedEntityLayer(entities, [house]); layer.reset();
  layer.upsert({ ...house, position: [80, 0, 0], state: "server-view" });
  layer.upsert({ ...house, position: [81, 0, 0], state: "updated-view" });
  expect(entities.get(house.id)?.position).toEqual([81, 0, 0]);
  expect(house.position).toEqual([90, 0, 0]); expect(house.state).toBe("alive");
  layer.upsert(actor()); layer.remove(house.id); layer.remove("actor");
  expect(entities.get(house.id)?.position).toEqual([90, 0, 0]);
  expect(entities.get("actor")).toBeUndefined();
});

it("keeps scenery snapshots stable between updates and filters other map realms", () => {
  const entities = store();
  const surface: SemanticEntity = { ...actor(), id: "surface", archetype: "landmark" };
  const cave: SemanticEntity = { ...surface, id: "cave", regionId: "gravelmaw" };
  const layer = new ReplicatedEntityLayer(entities, [surface, cave]); layer.reset();
  const view = layer.renderSnapshot("fallowmarch");
  expect(view.map(entity => entity.id)).toEqual(["surface"]);
  expect(layer.renderSnapshot("fallowmarch")).toBe(view);
  expect(layer.renderSnapshot("gravelmaw").map(entity => entity.id)).toEqual(["cave"]);
});
