import { beforeAll, describe, expect, it } from "vitest";
import { WORLD_PROTOCOL_VERSION, type LootStack, type PartyOperation, type WorldDescriptor } from "../game/src/contracts.js";
import { HeadlessWorld, type HeadlessWorldPorts } from "../game/src/multiplayer/headlessWorld.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { Replicator, ReplicatedState } from "../game/src/multiplayer/replication.js";
import { command } from "../game/src/multiplayer/protocol.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { parseChatInput } from "../game/src/ui/chatCommands.js";

const descriptor: WorldDescriptor = { providerId: "reference", worldId: "social", name: "Social", endpoint: "ws://127.0.0.1:4180/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity: 1000, availability: "available" };
let ports: HeadlessWorldPorts;
beforeAll(async () => { ports = await createMultiplayerLabWorld(); });
function fixture() {
  const world = new HeadlessWorld(descriptor, ports);
  for (const id of ["a", "b", "c"]) { const player = world.join(id); player.store.get().player.name = id; player.store.get().player.position = [0, 0, 0]; }
  return world;
}
function action(world: HeadlessWorld, id: string, op: PartyOperation, target?: string) {
  return world.execute(id, { method: "party", args: target ? [op, target] : [op] });
}
function group(world: HeadlessWorld, members = ["a", "b"]) {
  expect(action(world, members[0]!, "create").ok).toBe(true);
  const id = world.social.view(members[0]!).party!.id;
  for (const member of members.slice(1)) {
    expect(action(world, members[0]!, "invite", member).ok).toBe(true);
    expect(action(world, member, "accept", id).ok).toBe(true);
  }
  return id;
}
function pile(world: HeadlessWorld, partyId?: string) {
  const items: LootStack[] = ["grithe_ore", "palewood_log", "grithe_ore"].map((itemId, index) => ({ itemId, quantity: 1, stackId: `stack:${index}`, ...(partyId ? { partyId } : {}) }));
  world.shared.lootPiles.pile = { position: [0, 0, 0], items, expiresAtMs: 60_000, ownerOnly: false };
  world.entities.add({ id: "pile", name: "Shared loot", archetype: "loot", tier: 1, regionId: "fallowmarch", position: [0, 0, 0], state: "available", interactions: ["loot"], loot: items });
  return items;
}
const count = (world: HeadlessWorld, id: string, itemId: string) => world.players.get(id)!.store.get().inventory.slots.reduce((sum, stack) => sum + (stack?.itemId === itemId ? stack.quantity : 0), 0);

describe("authoritative chat and parties", () => {
  it("routes chat at send time with realm/radius isolation, no late leakage, bounded history and cooldown", () => {
    const world = fixture();
    world.players.get("b")!.store.get().player.position = [30, 0, 0];
    world.players.get("c")!.store.get().player.position = [30.01, 0, 0];
    expect(world.execute("a", { method: "chat", args: [" <img onerror=evil()> "] }).ok).toBe(true);
    expect(world.social.view("a").messages[0]!.text).toBe("<img onerror=evil()>");
    expect(world.social.view("b").messages).toHaveLength(1); expect(world.social.view("c").messages).toHaveLength(0);
    world.players.get("c")!.store.get().player.position = [0, 0, 0];
    expect(world.social.view("c").messages).toHaveLength(0);
    expect(world.execute("a", { method: "chat", args: ["too soon"] }).ok).toBe(false);
    world.players.get("b")!.store.get().player.regionId = "gravelmaw";
    for (let i = 0; i < 85; i++) { world.clock.skipMs(1000); world.execute("a", { method: "chat", args: [String(i)] }); }
    expect(world.social.view("a").messages).toHaveLength(80);
    expect(world.social.view("b").messages).toHaveLength(1);
    expect(fixture().social.view("a").messages).toHaveLength(0);
  });
  it("validates wire operations and rejects spoofed senders or reward commands", () => {
    for (const bad of [{ method: "chat", args: ["", "b"] }, { method: "chat", args: ["x".repeat(281)] },
      { method: "chat", args: ["hi", "b"] }, { method: "chat", args: ["hi", "whisper"] }, { method: "chat", args: ["hi", "party", "b"] },
      { method: "who", args: ["a"] },
      { method: "party", args: ["accept", "party:1", "a"] }, { method: "party", args: ["grantXp"] }]) expect(() => command(bad)).toThrow();
    expect(command({ method: "chat", args: ["hello"] }).method).toBe("chat");
    expect(command({ method: "chat", args: ["hello", "whisper", "Some Name"] }).args).toEqual(["hello", "whisper", "Some Name"]);
    expect(command({ method: "who", args: [] }).method).toBe("who");
  });
  it("routes party chat to members anywhere and whispers to one player by id or name", () => {
    const world = fixture(); group(world);
    world.players.get("b")!.store.get().player.position = [500, 0, 500];
    expect(world.execute("c", { method: "chat", args: ["no party", "party"] }).ok).toBe(false);
    expect(world.execute("a", { method: "chat", args: ["regroup", "party"] }).ok).toBe(true);
    expect(world.social.view("b").messages.map(message => [message.channel, message.text])).toEqual([["party", "regroup"]]);
    expect(world.social.view("c").messages).toHaveLength(0);
    world.clock.skipMs(1000);
    expect(world.execute("c", { method: "chat", args: ["psst", "whisper", "B"] }).ok).toBe(true);
    expect(world.social.view("b").messages.at(-1)).toMatchObject({ channel: "whisper", text: "psst", name: "c", toId: "b", toName: "b" });
    expect(world.social.view("c").messages.at(-1)).toMatchObject({ channel: "whisper", toName: "b" });
    expect(world.social.view("a").messages.some(message => message.channel === "whisper")).toBe(false);
    world.clock.skipMs(1000);
    expect(world.execute("c", { method: "chat", args: ["hello?", "whisper", "nobody"] }).ok).toBe(false);
    expect(world.execute("c", { method: "chat", args: ["me", "whisper", "c"] }).ok).toBe(false);
  });
  it("lists other online players with combat levels and invites them at any distance", () => {
    const world = fixture();
    world.players.get("c")!.store.get().player.position = [900, 0, 900];
    const roster = world.execute("a", { method: "who", args: [] });
    expect(roster.ok && (roster.value as { players: { id: string; name: string; level: number }[] }).players.map(player => [player.id, player.name, typeof player.level]))
      .toEqual([["b", "b", "number"], ["c", "c", "number"]]);
    expect(action(world, "a", "create").ok).toBe(true);
    expect(action(world, "a", "invite", "c").ok).toBe(true);
    expect(action(world, "a", "invite", "nobody").ok).toBe(false);
    world.leave("b");
    expect(action(world, "a", "invite", "b").ok).toBe(false);
    const partyId = world.social.view("a").party!.id;
    expect(action(world, "c", "accept", partyId).ok).toBe(true);
    const members = world.social.view("a").party!.members;
    expect(members.map(member => member.id)).toEqual(["a", "c"]);
    expect(members.every(member => Number.isInteger(member.level) && member.level >= 1)).toBe(true);
  });
  it("parses chat bar slash commands", () => {
    const say = { channel: "nearby" } as const;
    expect(parseChatInput(" hi there ", say, null)).toEqual({ target: say, text: "hi there" });
    expect(parseChatInput("/p on my way", say, null)).toEqual({ target: { channel: "party" }, text: "on my way" });
    expect(parseChatInput("/p", say, null)).toEqual({ target: { channel: "party" }, text: "" });
    expect(parseChatInput("/w Ada meet at the bank", say, null)).toEqual({ target: { channel: "whisper", name: "Ada" }, text: "meet at the bank" });
    expect(parseChatInput("/r ok", say, "Ada")).toEqual({ target: { channel: "whisper", name: "Ada" }, text: "ok" });
    expect(parseChatInput("/r ok", say, null)).toHaveProperty("error");
    expect(parseChatInput("/w", say, null)).toHaveProperty("error");
    expect(parseChatInput("/dance", say, null)).toHaveProperty("error");
  });
  it("requires consent, caps membership at eight at acceptance, and restricts leader commands", () => {
    const world = fixture();
    for (let i = 0; i < 7; i++) world.join(`extra${i}`);
    const partyId = group(world);
    expect(action(world, "c", "accept", partyId).ok).toBe(false);
    expect(action(world, "b", "invite", "c").ok).toBe(false);
    expect(action(world, "b", "kick", "a").ok).toBe(false);
    for (let i = 0; i < 7; i++) expect(action(world, "a", "invite", `extra${i}`).ok).toBe(true);
    for (let i = 0; i < 6; i++) expect(action(world, `extra${i}`, "accept", partyId).ok).toBe(true);
    expect(action(world, "extra6", "accept", partyId).ok).toBe(false);
    expect(world.social.view("a").party!.members).toHaveLength(8);
    expect(world.social.view("c").party).toBeNull();
    action(world, "a", "leave"); expect(world.social.view("b").party!.leaderId).toBe("b");
    action(world, "b", "disband"); expect(world.social.view("extra0").party).toBeNull();
  });
  it("expires invitations, supports declines, and preserves reconnect seats for only 30 seconds", () => {
    const world = fixture(), partyId = group(world);
    action(world, "a", "invite", "c"); action(world, "c", "decline", partyId);
    expect(world.social.view("c").invitations).toHaveLength(0);
    action(world, "a", "invite", "c"); world.clock.skipMs(60_000);
    expect(action(world, "c", "accept", partyId).ok).toBe(false);
    world.leave("a"); world.clock.skipMs(29_000); world.social.tick(); world.join("a");
    expect(world.social.view("a").party!.leaderId).toBe("a");
    world.leave("a"); world.clock.skipMs(30_000); world.social.tick();
    expect(world.social.view("b").party!.leaderId).toBe("b");
  });
  it("shares only kill XP through actual production combat and excludes dead, distant and other-realm players", () => {
    const world = fixture(); world.join("d"); world.join("e"); group(world, ["a", "b", "c", "d", "e"]);
    const enemy = world.entities.get("multiplayer:frog")!, a = world.players.get("a")!;
    a.store.get().player.position = [...enemy.position]; world.players.get("b")!.store.get().player.position = [...enemy.position];
    world.players.get("c")!.store.get().player.health = 0;
    world.players.get("d")!.store.get().player.position = [120, 0, 120];
    world.players.get("e")!.store.get().player.regionId = "gravelmaw";
    const before = [...world.players].map(([id, player]) => [id, player.store.get().skills.melee.xp] as const);
    expect(a.combat.damageEnemy(enemy.id, 100000, world.clock.elapsedMs, "melee")).toBe(true);
    const bonus = Math.round(enemy.combat!.maxHealth * 2);
    for (const [id, xp] of before) expect(world.players.get(id)!.store.get().skills.melee.xp - xp).toBe(id === "a" ? bonus : id === "b" ? Math.floor(bonus / 2) : 0);
    a.combat.damageEnemy(enemy.id, 100000, world.clock.elapsedMs, "melee");
    expect(world.players.get("b")!.store.get().skills.melee.xp - before.find(([id]) => id === "b")![1]).toBe(Math.floor(bonus / 2));
  });
  it("shows piles to outsiders and lets their pickup route each stack to the earning party", () => {
    const world = fixture(), partyId = group(world); pile(world, partyId);
    const aBefore = count(world, "a", "grithe_ore"), bBefore = count(world, "b", "palewood_log"), cBefore = count(world, "c", "grithe_ore");
    const update = new Replicator("session", "c").update(world, 0, new Map(), true);
    expect(update.entities.some(entity => entity.id === "pile")).toBe(true); expect(update.social!.party).toBeNull();
    expect(world.execute("c", { method: "takeLoot", args: ["pile", 0, "stack:0"] }).ok).toBe(true);
    expect(world.execute("c", { method: "takeLoot", args: ["pile", 1, "stack:1"] }).ok).toBe(true);
    expect(count(world, "a", "grithe_ore")).toBe(aBefore + 1); expect(count(world, "b", "palewood_log")).toBe(bBefore + 1);
    expect(count(world, "c", "grithe_ore")).toBe(cBefore);
    expect(world.execute("c", { method: "takeLoot", args: ["pile", 0, "stack:0"] }).ok).toBe(false);
    expect(world.shared.lootPiles.pile!.items).toHaveLength(1);
    expect(world.social.view("a").party!.nextLootId).toBe("a");
  });
  it("skips ineligible or full recipients and never consumes items or turns if all are unavailable", () => {
    const world = fixture(), partyId = group(world); pile(world, partyId);
    const a = world.players.get("a")!.store.get(), b = world.players.get("b")!.store.get();
    a.player.position = [100, 0, 100]; b.player.health = 0;
    expect(world.execute("c", { method: "takeLoot", args: ["pile", 0] }).ok).toBe(false);
    expect(world.shared.lootPiles.pile!.items).toHaveLength(3); expect(world.social.view("a").party!.nextLootId).toBe("a");
    a.player.position = [0, 0, 0]; b.player.health = 10;
    a.inventory.slots = a.inventory.slots.map((_, slotIndex) => ({ itemId: "worn_sword", quantity: 1, slotIndex }));
    const before = count(world, "b", "grithe_ore");
    expect(world.execute("c", { method: "takeLoot", args: ["pile", 0] }).ok).toBe(true);
    expect(count(world, "b", "grithe_ore")).toBe(before + 1);
  });
  it("accepts JSON nulls for optional legacy pickup arguments", () => {
    const world = fixture(); const items = pile(world);
    for (const item of items) delete item.stackId;
    const input = command(JSON.parse(JSON.stringify({ method: "takeLoot", args: ["pile", 0, undefined] })));
    expect(world.execute("c", input).ok).toBe(true);
    expect(world.shared.lootPiles.pile!.items).toHaveLength(2);
    expect(world.execute("c", command({ method: "takeLoot", args: ["pile", null, null] })).ok).toBe(true);
    expect(world.shared.lootPiles.pile).toBeUndefined();
  });
  it("persists membership, routing cursor, public pile and delivery together in SQLite", async () => {
    const world = fixture(), partyId = group(world); pile(world, partyId);
    world.execute("c", { method: "takeLoot", args: ["pile", 0] });
    const storage = new SqliteWorldStorage(":memory:");
    try {
      await storage.commit(world.snapshot());
      const loaded = await storage.load(descriptor); const restored = new HeadlessWorld(descriptor, ports, loaded);
      restored.join("a"); restored.join("b"); restored.join("c");
      expect(restored.social.view("a").party!.nextLootId).toBe("b");
      expect(restored.shared.lootPiles.pile!.items).toHaveLength(2);
      const before = count(restored, "b", "palewood_log");
      expect(restored.execute("c", { method: "takeLoot", args: ["pile", 0] }).ok).toBe(true);
      expect(count(restored, "b", "palewood_log")).toBe(before + 1);
    } finally { await storage.close(); }
  });
  it("keeps partial stacks, skips duplicate orbs, and advances only after inventory delivery", () => {
    const world = fixture(), partyId = group(world); const items = pile(world, partyId);
    items.splice(0, items.length, { itemId: "palewood_log", quantity: 3, partyId, stackId: "partial" });
    const a = world.players.get("a")!.store.get();
    a.inventory.slots = a.inventory.slots.map((_, slotIndex) => ({ itemId: "worn_sword", quantity: 1, slotIndex }));
    a.inventory.slots[0] = null;
    expect(world.execute("c", { method: "takeLoot", args: ["pile", 0, "partial"] }).ok).toBe(true);
    expect(items[0]!.quantity).toBe(2); expect(world.social.view("a").party!.nextLootId).toBe("b");
    expect(world.execute("c", { method: "takeLoot", args: ["pile", 0, "partial"] }).ok).toBe(true);
    expect(world.shared.lootPiles.pile).toBeUndefined();
    const orb = ALL_ITEMS.find(item => item.orb)!; expect(orb).toBeDefined();
    const orbItems = pile(world, partyId); orbItems.splice(0, orbItems.length, { itemId: orb.id, quantity: 1, partyId, stackId: "orb" });
    a.magic.consumedOrbs[orb.id] = true;
    expect(world.execute("c", { method: "takeLoot", args: ["pile", 0, "orb"] }).ok).toBe(true);
    expect(count(world, "b", orb.id)).toBe(1);
    const blocked = pile(world, partyId); blocked.splice(0, blocked.length, { itemId: orb.id, quantity: 1, partyId, stackId: "blocked" });
    const next = world.social.view("a").party!.nextLootId;
    expect(world.execute("c", { method: "takeLoot", args: ["pile", 0, "blocked"] }).ok).toBe(false);
    expect(blocked).toHaveLength(1); expect(world.social.view("a").party!.nextLootId).toBe(next);
  });
  it("rotates across all eight members and preserves the next turn when a member leaves", () => {
    const world = fixture(), ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    for (const id of ids.slice(3)) world.join(id);
    const partyId = group(world, ids), items = pile(world, partyId);
    items.splice(0, items.length, ...ids.map((id, index) => ({ itemId: "grithe_ore", quantity: 1, partyId, stackId: `turn:${index}` })));
    const before = ids.map(id => count(world, id, "grithe_ore"));
    for (let i = 0; i < 8; i++) expect(world.execute("a", { method: "takeLoot", args: ["pile", 0] }).ok).toBe(true);
    ids.forEach((id, i) => expect(count(world, id, "grithe_ore")).toBe(before[i]! + 1));
    expect(world.social.view("a").party!.nextLootId).toBe("a");
    action(world, "a", "leave"); expect(world.social.view("b").party!.nextLootId).toBe("b");
  });
  it("replicates owner-only social state as bounded deltas and rejects malformed parties", () => {
    const world = fixture(); group(world);
    const replicator = new Replicator("session", "b"); const first = replicator.update(world, 0, new Map(), true);
    expect(first.social!.party!.members).toHaveLength(2);
    expect(replicator.update(world, 0, new Map()).social).toBeUndefined();
    const state = new ReplicatedState("session", "b"); expect(state.apply(structuredClone(first))).toBe(true);
    first.social!.party!.members.length = 0; expect(() => new ReplicatedState("session", "b").apply(first)).toThrow();
  });
});
