import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createPackedWorld, encodeServerWorldPack, loadServerWorldPack, readServerWorldPackHeader, SERVER_WORLD_PACK_FILE, SERVER_WORLD_PACK_VERSION, type ServerWorldPack } from "../game/src/multiplayer/worldPack.js";
import { sha256Hex } from "../game/src/multiplayer/worldPackHash.js";
import type { TerrainSamplerData } from "../game/src/world/terrainSampler.js";

const terrain = (minX: number, coast: boolean): TerrainSamplerData => ({
  bounds: { minX, maxX: minX + 4, minZ: 0, maxZ: 4 }, coast: coast ? { collar: 2, seaLevel: -1 } : null,
  regions: [{ regionId: "fallowmarch", rect: { minX, maxX: minX + 4, minZ: 0, maxZ: 4 } }],
  lattice: { heights: Float32Array.from([0, 1, 2, 1, 2, 3, 2, 3, 4.5]), cols: 3, rows: 3, minX, minZ: 0, stepX: 2, stepZ: 2 },
  coastGrid: coast ? { heights: new Float32Array(25).fill(.25), cols: 5, rows: 5, minX: minX - 2, minZ: -2, stepX: 2, stepZ: 2 } : null,
  waterBodies: [], roads: [[[0, 0, 0], [1, 0, 1]]],
});

const pack = (): ServerWorldPack => ({
  formatVersion: SERVER_WORLD_PACK_VERSION, revision: "r".repeat(64), seeds: [1337, 7],
  assets: { crate_wood: { size: { x: 1, y: 2, z: 3 }, base: { x: -.5, y: -.25, z: -1.5 } } },
  worlds: new Map([1337, 7].map(seed => [seed, {
    terrain: { main: terrain(0, true), fairy: terrain(100 + seed, false) },
    solids: [{ kind: "box", id: "rock", position: [1, 0, 1], size: [1, 1, 1], rotationY: 0 }],
    structureBounds: [{ min: [0, 0, 0], max: [1, 1, 1] }],
    trees: [{ id: `forest:${seed}:a`, resourceId: "tree_palewood", regionId: "fallowmarch", position: [1.1, 0.123456789012345, 2.2], assetId: "tree_a", scale: 1.25, rotationY: .5, trunkRadius: .3 },
      { id: `forest:${seed}:b`, resourceId: "tree_palewood", regionId: "fallowmarch", position: [3, 1, 3], assetId: "tree_b", scale: 1, rotationY: 0, trunkRadius: .2 }],
    nav: { navData: Uint8Array.from([1, 2, 3, 4, 5]), strategy: "solo" as const, sourceMeshes: 2, sourceTriangles: 12, polyCount: 3 },
  }])),
});

const tampered = (bytes: Uint8Array, change: (copy: Uint8Array, view: DataView) => void): Uint8Array => {
  const copy = bytes.slice(); change(copy, new DataView(copy.buffer)); return copy;
};

describe("server world pack format", () => {
  it("names the file the server and the packager agree on", () => {
    expect(SERVER_WORLD_PACK_FILE).toBe("server-world.pack");
  });

  it("hashes like node:crypto across block boundaries", () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 70_001]) {
      const data = Uint8Array.from({ length }, (_, index) => (index * 31 + 7) & 255);
      expect(sha256Hex(data)).toBe(createHash("sha256").update(data).digest("hex"));
    }
  });

  it("returns what was encoded, with doubles and float grids intact", () => {
    const source = pack(), loaded = loadServerWorldPack(encodeServerWorldPack(source));
    expect(loaded).toEqual(source);
    expect(readServerWorldPackHeader(encodeServerWorldPack(source))).toEqual({ version: SERVER_WORLD_PACK_VERSION, revision: source.revision, seeds: [1337, 7] });
  });

  it("encodes the same contents to the same bytes", () => {
    expect(Buffer.from(encodeServerWorldPack(pack())).equals(Buffer.from(encodeServerWorldPack(pack())))).toBe(true);
  });

  it("reads a pack that sits at an odd address in a larger buffer", () => {
    const bytes = encodeServerWorldPack(pack()), host = new Uint8Array(bytes.length + 3);
    host.set(bytes, 3);
    expect(loadServerWorldPack(host.subarray(3))).toEqual(pack());
  });

  it("refuses a foreign file, another version, a damaged body and a cut file", () => {
    const bytes = encodeServerWorldPack(pack());
    expect(() => loadServerWorldPack(new Uint8Array(64))).toThrow("not a world pack");
    expect(() => loadServerWorldPack(tampered(bytes, (_, view) => view.setUint32(8, 99, true)))).toThrow(`format version 99, but this server reads version ${SERVER_WORLD_PACK_VERSION}`);
    expect(() => loadServerWorldPack(tampered(bytes, copy => { copy[copy.length - 9]! ^= 1; }))).toThrow("integrity hash does not match");
    expect(() => loadServerWorldPack(bytes.subarray(0, bytes.length - 64))).toThrow(/outside the file|integrity hash/);
  });

  it("refuses a seed it was not baked for and says which seeds it holds", async () => {
    const loaded = loadServerWorldPack(encodeServerWorldPack(pack()));
    await expect(createPackedWorld(loaded, 42)).rejects.toThrow("no world for seed 42. This pack holds seeds 1337, 7. Set the world's seed to one of those, or bake the pack again with --seeds 1337,7,42.");
  });
});
