import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CharacterRig } from "../game/src/render/characterRig.js";

// One triangle per named body sample, so assertions name the anatomy that still draws.
const samples = [
  ["clavicle_l", 1.4], ["upperarm_l", 1.4], ["lowerarm_l", 1.4], ["upperarm_r", 1.4], ["lowerarm_r", 1.4],
  ["hand_l", 1.4], ["hand_r", 1.4], ["index_01_l", 1.4], ["thumb_01_r", 1.4],
  ["spine_01", 1.01], ["spine_02", 1.2], ["spine_03", 1.42], ["neck_01", 1.5], ["Head", 1.7],
  ["thigh_l", .8], ["calf_r", .4], ["foot_r", .1],
] as const;

const entries = new Map<string, { tags: string[]; itemModel?: { itemId: string; wearable: boolean } }>([
  ["corealm_item_dewglass_gauntlets", { tags: ["arms", "tripo-armor-approved"], itemModel: { itemId: "dewglass_gauntlets", wearable: true } }],
  ["corealm_item_dewglass_plate", { tags: ["torso", "tripo-armor-approved"], itemModel: { itemId: "dewglass_plate", wearable: true } }],
  ["outfit_male_peasant_chest", { tags: ["torso"] }],
  ["outfit_male_peasant_legs", { tags: ["legs"] }],
  ["outfit_male_peasant_boots", { tags: ["feet"] }],
  ["outfit_male_peasant_gloves", { tags: ["arms"] }],
]);

/** The native body stores position, normal, uv and weights in one interleaved buffer. */
function bodySource(): THREE.Group {
  const count = samples.length * 3, stride = 12, packed = new Float32Array(count * stride);
  const joints = new Uint16Array(count * 4);
  samples.forEach(([, height], joint) => {
    for (let corner = 0; corner < 3; corner++) {
      const vertex = joint * 3 + corner, base = vertex * stride;
      packed.set([corner === 1 ? .01 : 0, height + (corner === 2 ? .005 : 0), 0], base);
      packed.set([0, 0, 1], base + 3);
      packed.set([corner / 2, 0], base + 6);
      packed.set([1, 0, 0, 0], base + 8);
      joints[vertex * 4] = joint;
    }
  });
  const interleaved = new THREE.InterleavedBuffer(packed, stride);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
  geometry.setAttribute("normal", new THREE.InterleavedBufferAttribute(interleaved, 3, 3));
  geometry.setAttribute("uv", new THREE.InterleavedBufferAttribute(interleaved, 2, 6));
  geometry.setAttribute("skinWeight", new THREE.InterleavedBufferAttribute(interleaved, 4, 8));
  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(joints, 4));
  geometry.setIndex(Array.from({ length: count }, (_, vertex) => vertex));
  const bones = samples.map(([name]) => Object.assign(new THREE.Bone(), { name }));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = "SuperHero_Male";
  const source = new THREE.Group();
  source.add(mesh, ...bones);
  mesh.bind(new THREE.Skeleton(bones));
  return source;
}

async function builtRig() {
  const source = bodySource();
  const assets = {
    entry: (id: string) => entries.get(id),
    load: vi.fn(async (id: string) => id === "base_male" ? source : new THREE.Group()),
    clip: () => undefined,
  };
  const rig = new CharacterRig(assets as never) as any;
  expect(await rig.build({ bodyAssetId: "base_male", completeOutfit: false, hairAssetId: null, preloadGear: false })).toBe(true);
  const mesh = rig.bodyMeshes[0] as THREE.SkinnedMesh;
  return { rig, mesh };
}

const drawn = (geometry: THREE.BufferGeometry) => {
  // A head cap compacts vertices, so identify each triangle by its only joint.
  const names = new Set<string>(), joint = geometry.getAttribute("skinIndex");
  for (let i = 0; i < geometry.index!.count; i += 3) names.add(samples[joint.getX(geometry.index!.getX(i))]![0]);
  return names;
};
/** What a WebGPU pipeline bakes in: one entry per vertex buffer and its attribute layout. */
const vertexLayout = (geometry: THREE.BufferGeometry) => Object.entries(geometry.attributes).map(([name, attribute]) =>
  `${name}:${attribute.itemSize}:${(attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? "interleaved" : "own"}`).sort();

const wear = (rig: any, parts: Record<string, string>) => {
  rig.gearBySlot.clear();
  for (const [slot, assetId] of Object.entries(parts)) rig.gearBySlot.set(slot, [{ assetId, slot, attach: "skin" }]);
  return rig.rebuildLayersNow();
};

describe("body under fitted armor", () => {
  it("keeps the arm between a legacy sleeve and a Tripo gauntlet, and caps only a complete Tripo arm", async () => {
    const { rig, mesh } = await builtRig();
    try {
      await wear(rig, { body: "outfit_male_peasant_chest", legs: "outfit_male_peasant_legs",
        feet: "outfit_male_peasant_boots", hands: "outfit_male_peasant_gloves" });
      expect([...drawn(mesh.geometry)]).toEqual(["Head"]);

      await wear(rig, { body: "outfit_male_peasant_chest", legs: "outfit_male_peasant_legs",
        feet: "outfit_male_peasant_boots", hands: "corealm_item_dewglass_gauntlets" });
      expect([...drawn(mesh.geometry)]).toEqual(["clavicle_l", "upperarm_l", "lowerarm_l", "upperarm_r", "lowerarm_r", "neck_01", "Head"]);

      // A Tripo plate supplies the upper arm the gauntlet lacks, so the pair replaces the body.
      await wear(rig, { body: "corealm_item_dewglass_plate", legs: "outfit_male_peasant_legs",
        feet: "outfit_male_peasant_boots", hands: "corealm_item_dewglass_gauntlets" });
      expect([...drawn(mesh.geometry)]).toEqual(["Head"]);
    } finally { rig.dispose(); }
  });

  it("never changes the body's vertex buffer layout across cap, mask and restore", async () => {
    const { rig, mesh } = await builtRig();
    try {
      const built = vertexLayout(mesh.geometry);
      expect(built).toEqual(["normal:3:own", "position:3:own", "skinIndex:4:own", "skinWeight:4:own", "uv:2:own"]);
      await wear(rig, { body: "outfit_male_peasant_chest", legs: "outfit_male_peasant_legs",
        feet: "outfit_male_peasant_boots", hands: "outfit_male_peasant_gloves" });
      expect(vertexLayout(mesh.geometry)).toEqual(built);
      await wear(rig, { hands: "corealm_item_dewglass_gauntlets" });
      expect(vertexLayout(mesh.geometry)).toEqual(built);
      await wear(rig, {});
      expect(vertexLayout(mesh.geometry)).toEqual(built);
      expect(drawn(mesh.geometry).size).toBe(samples.length);
    } finally { rig.dispose(); }
  });
});
