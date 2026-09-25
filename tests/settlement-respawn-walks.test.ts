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

beforeAll(async () => {
  const ports = await createPackedWorld(await assertServerWorldPack(), 1337);
  const descriptor: WorldDescriptor = { providerId: "local", worldId: "respawn-walks", name: "Respawn walks", endpoint: "local:worker",
    protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity: 1, availability: "available" };
  world = new HeadlessWorld(descriptor, ports, null);
  player = world.join("walker");
  player.events.subscribe(event => { if (event.type === "navigation.completed" || event.type === "navigation.failed" || event.type === "dialogue.opened") outcomes.push(event.type); });
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

it("leaves every settlement respawn in eight directions", () => {
  expect(anchors.map(anchor => anchor.id).sort()).toEqual(["coldbrace", "crownward_town", "emberfast", "highcairn", "lantern_rest", "prism_hollow", "rootfall"]);
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
  const services = ["rootfall_bank_chest", "rootfall_general", "rootfall_crafting", "rootfall_fletching", "rootfall_anvil",
    "rootfall_smith", "rootfall_range"];
  const keepers = ["npc_seamer_juno", "npc_smith_corra", "npc_trapper_mott", "npc_woodward_ansel"];
  const failed: string[] = [];
  const green = respawnAt("rootfall");
  for (const id of services) {
    for (const [label, args] of [[`to ${id}`, { entityId: id }], [`from ${id}`, { position: green }]] as const) {
      outcomes.length = 0;
      if (!world.execute("walker", { method: "moveTo", args: [args] }).ok) { failed.push(`${label}: refused`); continue; }
      for (let tick = 0; tick < 600 && outcomes.length === 0; tick++) world.tick();
      if (outcomes[0] !== "navigation.completed") failed.push(`${label}: ${outcomes[0] ?? "timeout"}`);
    }
  }
  for (const id of keepers) {
    outcomes.length = 0;
    if (!world.execute("walker", { method: "interact", args: [id, "talk"] }).ok) { failed.push(`talk ${id}: refused`); continue; }
    for (let tick = 0; tick < 600 && !outcomes.includes("dialogue.opened") && !outcomes.includes("navigation.failed"); tick++) world.tick();
    if (!outcomes.includes("dialogue.opened")) failed.push(`talk ${id}: ${outcomes.join(",") || "timeout"}`);
    outcomes.length = 0;
    world.execute("walker", { method: "moveTo", args: [{ position: green }] });
    for (let tick = 0; tick < 600 && outcomes.length === 0; tick++) world.tick();
    if (outcomes[0] !== "navigation.completed") failed.push(`from ${id}: ${outcomes[0] ?? "timeout"}`);
  }
  expect(failed).toEqual([]);
}, 120_000);
