import { readFileSync } from "node:fs";
import { beforeAll, expect, it } from "vitest";
import { WORLD_PROTOCOL_VERSION, type Vec3, type WorldDescriptor } from "../game/src/contracts.js";
import { HeadlessWorld } from "../game/src/multiplayer/headlessWorld.js";
import type { HeadlessPlayer } from "../game/src/multiplayer/headlessPlayer.js";
import { createPackedWorld } from "../game/src/multiplayer/worldPack.js";
import { buildSettlementRespawnAnchors, type RespawnAnchor } from "../game/src/systems/respawnAnchors.js";
import { assertServerWorldPack } from "../tools/build-server-world-pack.js";

/**
 * Every settlement respawn, walked out of on the shipped server pack, the world the host moves the
 * player over: a walk the navmesh plans must not end as `stuck`.
 */
let world: HeadlessWorld, player: HeadlessPlayer, anchors: RespawnAnchor[];
const outcomes: string[] = [];
let navigationFailure = "";
const authoredRegions = JSON.parse(readFileSync(new URL("../game/content/data/worldRegions.json", import.meta.url), "utf8")) as {
  settlements: { id: string; buildings: { id: string; position: [number, number]; rotationY: number }[] }[];
}[];

function outsideSouthGate(townId: string): [number, number] {
  const town = authoredRegions.flatMap((region) => region.settlements).find((settlement) => settlement.id === townId);
  const gate = town?.buildings.find((building) => building.id === `${townId}_gatehouse`);
  if (!gate) throw new Error(`Missing ${townId} gatehouse`);
  return [gate.position[0] + Math.sin(gate.rotationY) * 10, gate.position[1] + Math.cos(gate.rotationY) * 10];
}

beforeAll(async () => {
  const ports = await createPackedWorld(await assertServerWorldPack(), 1337);
  const descriptor: WorldDescriptor = { providerId: "local", worldId: "respawn-walks", name: "Respawn walks", endpoint: "local:worker",
    protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity: 1, availability: "available" };
  world = new HeadlessWorld(descriptor, ports, null);
  player = world.join("walker");
  player.events.subscribe(event => {
    if (event.type === "navigation.completed" || event.type === "navigation.failed" || event.type === "dialogue.opened") outcomes.push(event.type);
    if (event.type === "navigation.failed") navigationFailure = String(event.data.reason);
  });
  anchors = buildSettlementRespawnAnchors(id => ports.nav.routeNode(id));
}, 120_000);

function respawnAt(anchorId: string): Vec3 {
  const state = player.store.get();
  state.player.respawnPointId = anchorId;
  state.player.health = 0;
  world.tick();
  world.tick();
  expect(state.player.health).toBe(state.player.maxHealth);
  return [...state.player.position];
}

/** Walks to `goal` and returns the outcome, or null when the planner refuses the walk up front. */
function walk(goal: Vec3): string | null {
  outcomes.length = 0;
  if (!world.execute("walker", { method: "moveTo", args: [{ position: goal }] }).ok) return null;
  for (let tick = 0; tick < 400 && outcomes.length === 0; tick++) world.tick();
  return outcomes[0] ?? "timeout";
}

function moveAndWait(args: { entityId: string } | { position: Vec3 }): string {
  outcomes.length = 0;
  navigationFailure = "";
  const start = [...player.store.get().player.position] as Vec3;
  const target = "position" in args ? args.position : world.ports.entities.find((entity) => entity.id === args.entityId)?.position;
  const result = world.execute("walker", { method: "moveTo", args: [args] });
  if (!result.ok) return `refused ${result.error.code} from ${start} to ${target}`;
  for (let tick = 0; tick < 600 && outcomes.length === 0; tick++) world.tick();
  const outcome = outcomes[0] ?? "timeout";
  if (outcome === "navigation.completed") return outcome;
  const at = player.store.get().player.position;
  const near = world.ports.entities.map((entity) => ({ id: entity.id, metres: Math.hypot(entity.position[0] - at[0], entity.position[2] - at[2]) }))
    .filter((entity) => entity.metres < 8).sort((a, b) => a.metres - b.metres).slice(0, 5);
  const path = target ? world.ports.nav.findPathDetailed(at, target) : null;
  return `${outcome} ${navigationFailure} from ${start} to ${target} at ${at}; path ${path ? `partial=${path.partial} gap=${path.arrivalGap.toFixed(2)}` : "null"}; nearby ${JSON.stringify(near)}`;
}

function talkAndWait(id: string): string {
  outcomes.length = 0;
  if (!world.execute("walker", { method: "interact", args: [id, "talk"] }).ok) return "refused";
  for (let tick = 0; tick < 600 && !outcomes.includes("dialogue.opened") && !outcomes.includes("navigation.failed"); tick++) world.tick();
  return outcomes.includes("dialogue.opened") ? "dialogue.opened" : outcomes.join(",") || "timeout";
}

function walkServicesAndTalk(anchorId: string, services: string[], keepers: string[], gateRoute?: [number, number]): string[] {
  const failed: string[] = [];
  const square = respawnAt(anchorId);
  if (gateRoute) {
    const outside = world.ports.nav.closestPoint([gateRoute[0], square[1], gateRoute[1]]);
    if (!outside) failed.push(`${anchorId} outside gate: no nav point`);
    else {
      if (Math.hypot(outside[0] - gateRoute[0], outside[2] - gateRoute[1]) > 2) {
        failed.push(`${anchorId} outside gate: navigable ground is more than 2 m from the approach`);
      }
      for (const [label, goal] of [["out through gate", outside], ["back through gate", square]] as const) {
        const outcome = moveAndWait({ position: goal });
        if (outcome !== "navigation.completed") failed.push(`${anchorId} ${label}: ${outcome}`);
      }
    }
  }
  for (const id of services) {
    for (const [label, args] of [[`to ${id}`, { entityId: id }], [`from ${id}`, { position: square }]] as const) {
      const outcome = moveAndWait(args);
      if (outcome !== "navigation.completed") failed.push(`${label}: ${outcome}`);
    }
  }
  for (const id of keepers) {
    const talkOutcome = talkAndWait(id);
    if (talkOutcome !== "dialogue.opened") failed.push(`talk ${id}: ${talkOutcome}`);
    const returnOutcome = moveAndWait({ position: square });
    if (returnOutcome !== "navigation.completed") failed.push(`from ${id}: ${returnOutcome}`);
  }
  return failed;
}

it("leaves every settlement respawn in eight directions", () => {
  expect(anchors.map(anchor => anchor.id).sort()).toEqual(["coldbrace", "crownward_town", "emberfast", "highcairn", "lantern_rest", "lastlight_square", "prism_hollow", "rootfall", "starhaven_square"]);
  const stuck: string[] = [];
  let walks = 0;
  for (const anchor of anchors) for (const radius of [4, 9]) for (let step = 0; step < 8; step++) {
    const start = respawnAt(anchor.id);
    const angle = step * Math.PI / 4;
    const goal = world.ports.nav.closestPoint([start[0] + Math.sin(angle) * radius, start[1], start[2] + Math.cos(angle) * radius]);
    if (!goal) continue;
    const outcome = walk(goal);
    if (outcome === null) continue;
    walks++;
    if (outcome !== "navigation.completed") stuck.push(`${anchor.id} ${radius} m at ${step * 45} deg: ${outcome}`);
  }
  expect(walks).toBeGreaterThan(90);
  expect(stuck).toEqual([]);
}, 120_000);

it("walks from the Oakwood green to every service and talks to every keeper", () => {
  const services = ["rootfall_bank_chest", "rootfall_cosmic", "rootfall_crafting", "rootfall_fletching", "rootfall_anvil",
    "rootfall_smith", "rootfall_range"];
  const keepers = ["npc_seamer_juno", "npc_smith_corra", "npc_trapper_mott", "npc_woodward_ansel"];
  // In and out through the West Gate first: the road the player arrives by.
  expect(walkServicesAndTalk("rootfall", services, keepers, [34, 124])).toEqual([]);
}, 120_000);

it("reaches Lastlight and Starhaven services and residents through their south gates", () => {
  const failed = [
    ...walkServicesAndTalk("lastlight_square", [
      "lastlight_bank", "lastlight_potion", "lastlight_smith", "lastlight_cosmic",
      "lastlight_anvil", "lastlight_crafting", "lastlight_fletching", "lastlight_range",
    ], ["npc_lastlight_watch", "npc_lastlight_apothecary"], outsideSouthGate("lastlight")),
    ...walkServicesAndTalk("starhaven_square", [
      "starhaven_bank", "starhaven_potion", "starhaven_smith", "starhaven_cosmic",
      "starhaven_anvil", "starhaven_crafting", "starhaven_fletching", "starhaven_range",
    ], ["npc_starhaven_watch", "npc_starhaven_host"], outsideSouthGate("starhaven")),
  ];
  expect(failed).toEqual([]);
}, 120_000);

it("moves a player saved inside what content later built there onto clear ground when they join", () => {
  // The old Oakwood stump top, now inside the rebuilt square's structures: every step from here was refused.
  const state = player.store.get();
  state.player.position = [64, 8.287293434143066, 127];
  state.player.regionId = "vellenwood";
  world.join("walker");
  const settled = [...state.player.position];
  expect(Math.hypot(settled[0]! - 64, settled[2]! - 127)).toBeLessThan(8);
  const goal = world.ports.nav.closestPoint([settled[0]! + 5, settled[1]!, settled[2]!])!;
  expect(walk(goal)).toBe("navigation.completed");
}, 120_000);
