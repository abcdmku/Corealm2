import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorldDescriptor } from "../game/src/contracts.js";
import { contentUpdated, descriptor } from "../game/src/multiplayer/protocol.js";
import {
  joinRoute, launchWorld, peekPendingLaunch, storePendingLaunch, takePendingLaunch, worldForeign,
} from "../game/src/multiplayer/playIntent.js";

/** Joining a server whose baked world differs from the page build's reloads onto it; the same world joins as it stands. */

const BUILD = "a".repeat(64), SERVER = "b".repeat(64), CATALOG = "c".repeat(64);

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: key => { values.delete(key); }, clear: () => values.clear(),
  } as Storage;
}
const globals = globalThis as { sessionStorage?: Storage };
beforeEach(() => { globals.sessionStorage = storage(); });
afterEach(() => { delete globals.sessionStorage; });

const listed = {
  providerId: "ravenwood", worldId: "main", name: "Ravenwood", endpoint: "wss://ravenwood.test:4443/", protocolVersion: 1,
  fixture: "authored", catalogRevision: CATALOG, seed: 1337, population: 0, capacity: 32, availability: "available",
  contentAssetUrl: "https://ravenwood.test:4443/content-assets/",
};

describe("the world descriptor", () => {
  it("carries the geometry revision a server names", () => {
    expect(descriptor({ ...listed, worldRevision: SERVER }, "socket").worldRevision).toBe(SERVER);
    expect(descriptor(listed, "socket").worldRevision).toBeUndefined();
  });

  it("refuses a geometry revision that is not a sha256", () => {
    for (const worldRevision of ["", "B".repeat(64), "b".repeat(63), 42, "../generated"]) {
      expect(() => descriptor({ ...listed, worldRevision }, "socket"), String(worldRevision)).toThrow("Invalid world descriptor");
    }
  });
});

describe("the content-updated message", () => {
  it("keeps a connected page on a server that switched to a world it baked", () => {
    expect(contentUpdated({ type: "content-updated", revision: CATALOG, worldRevision: SERVER })).toBe(CATALOG);
    expect(contentUpdated({ type: "content-updated", revision: CATALOG })).toBe(CATALOG);
  });

  it("refuses a world revision that is not a sha256", () => {
    for (const worldRevision of ["", "nope", 7, null]) {
      expect(() => contentUpdated({ type: "content-updated", revision: CATALOG, worldRevision }), String(worldRevision)).toThrow("Invalid content update");
    }
  });
});

describe("joining", () => {
  const page = { buildRevision: BUILD, serverRevision: null };
  it("joins a world on the build's own geometry, named or not, without a reload", () => {
    expect(worldForeign(page, {})).toBe(false);
    expect(worldForeign(page, { worldRevision: BUILD })).toBe(false);
    expect(joinRoute({ assetHostForeign: false, worldForeign: false, rebaseAttempts: 0, canStore: true })).toBe("join");
  });

  it("reloads once onto a world the server baked, then refuses instead of looping", () => {
    expect(worldForeign(page, { worldRevision: SERVER })).toBe(true);
    expect(joinRoute({ assetHostForeign: false, worldForeign: true, rebaseAttempts: 0, canStore: true })).toBe("reload");
    expect(joinRoute({ assetHostForeign: false, worldForeign: true, rebaseAttempts: 1, canStore: true })).toBe("refuse");
    expect(joinRoute({ assetHostForeign: false, worldForeign: true, rebaseAttempts: 0, canStore: false })).toBe("refuse");
  });

  it("on a page already on that server world, joins it and reloads for anything else", () => {
    const onServer = { buildRevision: BUILD, serverRevision: SERVER };
    expect(worldForeign(onServer, { worldRevision: SERVER })).toBe(false);
    // Another server on the build's world, local play (which names none), or a newer bake of this one.
    expect(worldForeign(onServer, {})).toBe(true);
    expect(worldForeign(onServer, { worldRevision: BUILD })).toBe(true);
    expect(worldForeign(onServer, { worldRevision: "d".repeat(64) })).toBe(true);
  });

  it("writes where the second boot finds the server's catalog and files", () => {
    const world = descriptor({ ...listed, worldRevision: SERVER }, "socket");
    expect(launchWorld(world, BUILD)).toEqual({ revision: SERVER, contentAssetUrl: "https://ravenwood.test:4443/content-assets/",
      catalogUrl: `https://ravenwood.test:4443/catalog/${CATALOG}`, catalogRevision: CATALOG });
    expect(launchWorld(descriptor(listed, "socket"), BUILD)).toBeUndefined();
    expect(launchWorld({ ...world, worldRevision: BUILD }, BUILD)).toBeUndefined();
  });

  it("refuses a baked world whose server does not say where its files are", () => {
    const { contentAssetUrl: _, ...noFiles } = listed;
    expect(() => launchWorld({ ...noFiles, worldRevision: SERVER } as unknown as WorldDescriptor, BUILD)).toThrow(/does not say where its files are/);
  });
});

describe("the pending launch", () => {
  const world = { revision: SERVER, contentAssetUrl: "https://ravenwood.test:4443/content-assets/",
    catalogUrl: `https://ravenwood.test:4443/catalog/${CATALOG}`, catalogRevision: CATALOG };

  it("carries the server world across one reload: the entry peeks, boot takes", () => {
    storePendingLaunch({ providerId: "ravenwood", worldId: "main", world, attempts: 1 });
    const expected = { providerId: "ravenwood", worldId: "main", world, attempts: 1 };
    expect(peekPendingLaunch()).toEqual(expected);
    expect(peekPendingLaunch()).toEqual(expected);
    expect(takePendingLaunch()).toEqual(expected);
    expect(peekPendingLaunch()).toBeNull();
  });

  it("carries a choice back onto the build's world with neither a host nor a server world", () => {
    storePendingLaunch({ providerId: "other", worldId: "main", attempts: 1 });
    expect(takePendingLaunch()).toEqual({ providerId: "other", worldId: "main", attempts: 1 });
  });

  it("drops a server world it cannot trust", () => {
    for (const bad of [{ ...world, revision: "nope" }, { ...world, contentAssetUrl: "javascript:alert(1)" },
      { ...world, catalogUrl: "/catalog/x" }, { ...world, catalogRevision: "x" }, "world"]) {
      globals.sessionStorage!.setItem("corealm.play.pending.v1", JSON.stringify({ providerId: "ravenwood", worldId: "main", world: bad, attempts: 1 }));
      expect(takePendingLaunch(), JSON.stringify(bad)).toBeNull();
    }
  });
});
