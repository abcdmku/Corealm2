import { afterEach, describe, expect, it, vi } from "vitest";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { Admission } from "../game/src/multiplayer/admission.js";
import { command, compatible, descriptor, discoverWorlds, envelope, worldKey } from "../game/src/multiplayer/protocol.js";
import { LocalSession } from "../game/src/multiplayer/localSession.js";

const world: WorldDescriptor = {
  providerId: "reference", worldId: "yard", name: "Test yard", endpoint: "ws://127.0.0.1:4180/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored",
  seed: 1337, population: 0, capacity: 1000, availability: "available",
};
afterEach(() => vi.unstubAllGlobals());

describe("world discovery trust boundary", () => {
  it("makes no discovery request when unconfigured", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await discoverWorlds()).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  });
  it("supports direct, list, and directory registration", async () => {
    expect(await discoverWorlds(world)).toEqual([world]);
    expect(await discoverWorlds([world])).toEqual([world]);
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([world]))); vi.stubGlobal("fetch", fetch);
    expect(await discoverWorlds({ directoryUrl: "https://example.test/worlds" })).toEqual([world]);
    expect(fetch).toHaveBeenCalledWith("https://example.test/worlds", expect.objectContaining({ credentials: "omit", redirect: "error" }));
  });
  it("carries and normalises a world's asset host", async () => {
    expect(descriptor({ ...world, assetBaseUrl: "https://cdn.example.com/corealm" }).assetBaseUrl)
      .toBe("https://cdn.example.com/corealm/");
    expect(descriptor({ ...world, assetBaseUrl: "http://127.0.0.1:4192" }).assetBaseUrl).toBe("http://127.0.0.1:4192/");
    expect(descriptor(world).assetBaseUrl).toBeUndefined();
    for (const base of ["http://cdn.example.com/", "https://user:secret@cdn.example.com/",
      "https://cdn.example.com/?token=secret", "/assets/", 7]) {
      expect(() => descriptor({ ...world, assetBaseUrl: base })).toThrow(/Endpoints require|Invalid endpoint/);
    }
  });
  it("isolates ambiguous provider/world pairs and rejects duplicates", async () => {
    expect(worldKey({ providerId: "a:b", worldId: "c" })).not.toBe(worldKey({ providerId: "a", worldId: "b:c" }));
    await expect(discoverWorlds([world, world])).rejects.toMatchObject({ code: "INVALID_MESSAGE" });
  });
  it.each(["ws://example.test/", "wss://user:secret@example.test/", "wss://example.test/?token=secret", "wss://example.test/#secret"])("rejects insecure or credential-bearing endpoint %s", (endpoint) => {
    expect(() => descriptor({ ...world, endpoint })).toThrow();
  });
  it("rejects extra credential fields, bad capacities, unknown fixtures, malformed revisions and other protocols", () => {
    expect(() => descriptor({ ...world, token: "secret" })).toThrow();
    expect(() => descriptor({ ...world, capacity: 1001 })).toThrow();
    expect(() => descriptor({ ...world, population: -1 })).toThrow();
    expect(() => descriptor({ ...world, contentVersion: "corealm-pve-1" })).toThrow();
    expect(() => descriptor({ ...world, fixture: "other" })).toThrow();
    expect(() => descriptor({ ...world, catalogRevision: "latest" })).toThrow();
    expect(descriptor({ ...world, catalogRevision: "ab".repeat(32) }).catalogRevision).toBe("ab".repeat(32));
    expect(() => compatible({ ...world, protocolVersion: WORLD_PROTOCOL_VERSION + 1 })).toThrow();
    expect(() => compatible({ ...world, protocolVersion: 1 })).toThrow();
  });
});

describe("world capacity", () => {
  it("admits 1000 and rejects 1001 without evicting anyone", () => {
    const admission = new Admission(1000);
    for (let i = 0; i < 1000; i++) admission.join(`p${i}`, `s${i}`);
    expect(() => admission.join("extra", "extra")).toThrow("full");
    expect(() => admission.check("extra")).toThrow("full");
    expect(admission.population).toBe(1000);
  });
  it("holds a dropped player's place for 30 seconds and ignores an old disconnect", () => {
    let now = 0; const admission = new Admission(1, () => now);
    admission.join("a", "one");
    admission.leave("a", "one", true);
    expect(() => admission.join("b", "two")).toThrow("full");
    admission.check("a"); admission.join("a", "reconnected");
    admission.leave("a", "one", false);
    expect(admission.population).toBe(1);
    admission.leave("a", "reconnected", true); now = 29_999;
    expect(() => admission.check("b")).toThrow("full");
    now = 30_000; admission.join("b", "two");
    expect(admission.population).toBe(1);
  });
  it("explicit leave releases the slot immediately", () => {
    const admission = new Admission(1); admission.join("a", "one"); admission.leave("a", "one", false);
    admission.join("b", "two"); expect(admission.population).toBe(1);
  });
  it("frees a held place when the player goes to another world, but never a live one", () => {
    const admission = new Admission(2); admission.join("a", "one"); admission.join("b", "two");
    admission.leave("a", "one", true); admission.forget("a"); admission.forget("b");
    expect(admission.population).toBe(1);
  });
});

describe("command boundary", () => {
  it.each([
    { method: "giveItem", args: ["grithe_ore", 99] },
    { method: "steer", args: [Number.NaN, 0] },
    { method: "steer", args: [100, 0] },
    { method: "bank", args: ["withdraw", { quantity: 0 }] },
    { method: "bank", args: ["withdraw", { itemId: "grithe_ore", playerId: "someone_else" }] },
    { method: "attack", args: ["enemy"], playerId: "someone_else" },
    { method: "moveTo", args: [{ position: [0, Infinity, 0] }] },
  ])("rejects forged or malformed intents", (input) => { expect(() => command(input)).toThrow(); });
  it("accepts an explicit equipment slot and rejects forged slots", () => {
    expect(command({method: "equipItem", args: ["crafted_ring_t10", "ring2"]}).args).toEqual(["crafted_ring_t10", "ring2"]);
    expect(command({method: "equipItem", args: ["worn_sword", null]}).args).toEqual(["worn_sword", null]);
    expect(() => command({method: "equipItem", args: ["worn_sword", "invented"]})).toThrow();
  });
  it("validates envelopes and copies command arguments", () => {
    expect(() => envelope({ sessionId: "s", sequence: 0, command: { method: "stop", args: [] } })).toThrow();
    const input = { method: "attack", args: ["enemy"] }; const copy = command(input); input.args[0] = "different";
    expect(copy.args).toEqual(["enemy"]);
  });
  it("accepts production dialogue option IDs and targeted or ground invocation intents", () => {
    expect(command({method:"dialogue",args:["choose","ilse_root#who"]}).args).toEqual(["choose","ilse_root#who"]);
    expect(command({method:"castNow",args:["ember-dart"]}).method).toBe("castNow");
    expect(command({method:"castArea",args:["furnace-whip",[1,0,2]]}).method).toBe("castArea");
    expect(()=>command({method:"castArea",args:["furnace-whip",[1,NaN,2]]})).toThrow();
    expect(()=>command({method:"dialogue",args:["choose"]})).toThrow();
  });
  it("local sessions report the executor decision asynchronously and refuse closed writes", async () => {
    const execute = vi.fn().mockReturnValue({ ok: false, error: { code: "OUT_OF_RANGE", message: "Too far away" } });
    const session = new LocalSession("local", "player", { execute, tick: 4 });
    const result = session.command({ method: "attack", args: ["enemy"] }); expect(result).toBeInstanceOf(Promise);
    expect(await result).toMatchObject({ status: "rejected", sequence: 1, error: { code: "OUT_OF_RANGE" } });
    await session.close(); await session.command({ method: "attack", args: ["enemy"] });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
