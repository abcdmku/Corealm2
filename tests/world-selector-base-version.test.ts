import { describe, expect, it } from "vitest";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { descriptor } from "../game/src/multiplayer/protocol.js";
import { baseVersionLabel, worldListLayout } from "../game/src/multiplayer/worldSelector.js";
import { localWorldDescriptor, parseLocalWorldManifest } from "../game/src/worker/localHostProtocol.js";

const world = (worldId: string, endpoint: string, baseVersion?: string): WorldDescriptor => ({ providerId: "reference", worldId, name: worldId, endpoint,
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity: 10, availability: "available", ...(baseVersion ? { baseVersion } : {}) });

describe("the base version in the world picker", () => {
  it("prints a version as v plus the semver, and nothing for a server that reports none", () => {
    expect([baseVersionLabel("0.1.0"), baseVersionLabel("1.2.0-rc.1"), baseVersionLabel(undefined)]).toEqual(["v0.1.0", "v1.2.0-rc.1", null]);
  });

  it("puts it once per server: on a lone world's row, on a heading over several that agree, on each row when they do not", () => {
    const layout = worldListLayout([
      world("solo", "wss://one.example/", "0.1.0"),
      world("north", "wss://two.example:4443/", "0.2.0"), world("south", "wss://two.example:4443/", "0.2.0"),
      world("old", "wss://three.example/"),
      world("east", "wss://four.example/", "0.2.0"), world("west", "wss://four.example/", "0.3.0"),
      world("half", "wss://five.example/", "0.2.0"), world("none", "wss://five.example/"),
    ]);
    expect(layout.map(entry => entry.kind === "server" ? ["server", entry.host, entry.version] : [entry.world.worldId, entry.version])).toEqual([
      ["solo", "v0.1.0"],
      ["server", "two.example:4443", "v0.2.0"], ["north", null], ["south", null],
      ["old", null],
      ["east", "v0.2.0"], ["west", "v0.3.0"],
      ["half", "v0.2.0"], ["none", null],
    ]);
  });

  it("accepts a descriptor's base version only as strict semver of at most 64 characters", () => {
    const remote = world("north", "wss://two.example/", "0.1.0");
    expect(descriptor(remote, "socket").baseVersion).toBe("0.1.0");
    for (const bad of ["v0.1.0", "0.1", "0.1.0+build", 1, `0.1.0-${"a".repeat(60)}`])
      expect(() => descriptor({ ...remote, baseVersion: bad }, "socket")).toThrow("Invalid world descriptor");
    expect(descriptor(world("old", "wss://two.example/"), "socket")).not.toHaveProperty("baseVersion");
  });

  it("gives local play the build's own base version, from the published manifest", () => {
    const manifest = { version: 1, catalog: { revision: "r", formulaRevision: "f", file: "server-catalog-0.json", bytes: 1 }, clientCatalog: { revision: "r", file: "client-catalog-0.json", bytes: 1 },
      pack: { file: "server-world.pack", revision: "p", seeds: [1337], bytes: 1 } };
    expect(parseLocalWorldManifest({ ...manifest, baseVersion: "0.1.0" }).baseVersion).toBe("0.1.0");
    expect(() => parseLocalWorldManifest({ ...manifest, baseVersion: "latest" })).toThrow("malformed");
    expect(localWorldDescriptor("authored", 1337, "0.1.0").baseVersion).toBe("0.1.0");
    expect(localWorldDescriptor("authored", 1337)).not.toHaveProperty("baseVersion");
  });
});
