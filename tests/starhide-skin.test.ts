import { beforeAll, describe, expect, it, vi } from "vitest";
import { Document, NodeIO, type Primitive, type Skin } from "@gltf-transform/core";
import * as THREE from "three";
import { attachItemSkin } from "../tools/item-models/skin.js";
import { maskLegacyClothing } from "../game/src/render/itemBodyCoverage.js";
import { CharacterRig } from "../game/src/render/characterRig.js";

type HandSample = { position: number[]; weights: Map<string, number>; side: "l" | "r" };
const fingers = /^(index|middle|ring|pinky|thumb)_/;
let handSamples: HandSample[];

function influences(primitive: Primitive, skin: Skin, vertex: number): Map<string, number> {
  const indices: number[] = [], weights: number[] = [];
  primitive.getAttribute("JOINTS_0")!.getElement(vertex, indices);
  primitive.getAttribute("WEIGHTS_0")!.getElement(vertex, weights);
  return new Map(weights.flatMap((weight, i) => weight > 0 ? [[skin.listJoints()[indices[i]!]!.getName(), weight] as const] : []));
}

function gloveFixture(points: readonly number[][], native = true): Document {
  const document = new Document(), buffer = document.createBuffer(), scene = document.createScene();
  document.getRoot().setDefaultScene(scene);
  const position = document.createAccessor().setType("VEC3").setArray(new Float32Array(points.flat())).setBuffer(buffer);
  const primitive = document.createPrimitive().setAttribute("POSITION", position);
  const node = document.createNode("close-fit-glove").setMesh(document.createMesh("authored-glove").addPrimitive(primitive));
  if (native) node.setExtras({ itemModelDeform: "native-hand" });
  scene.addChild(node);
  return document;
}

beforeAll(async () => {
  const source = await new NodeIO().read("game/public/assets/models/character/base_male.glb");
  const skin = source.getRoot().listSkins()[0]!;
  const seen = new Set<string>();
  handSamples = [];
  for (const node of source.getRoot().listNodes()) {
    if (!node.getMesh() || node.getSkin() !== skin) continue;
    for (const primitive of node.getMesh()!.listPrimitives()) {
      const position = primitive.getAttribute("POSITION")!;
      for (let vertex = 0; vertex < position.getCount(); vertex++) {
        const point: number[] = []; position.getElement(vertex, point);
        const key = point.join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        const weights = influences(primitive, skin, vertex);
        // Select real finger/webbing blends, so a regression to rigid hand weights fails.
        if (![...weights].some(([bone, weight]) => fingers.test(bone) && weight > .1)
          || [...weights.values()].filter(weight => weight > .05).length < 2) continue;
        const side = point[0]! > 0 ? "l" : "r";
        if (handSamples.filter(sample => sample.side === side).length >= 3) continue;
        handSamples.push({ position: point, weights, side });
      }
    }
  }
  expect(handSamples.filter(sample => sample.side === "l")).toHaveLength(3);
  expect(handSamples.filter(sample => sample.side === "r")).toHaveLength(3);
});

describe("Starhide native hand deformation", () => {
  it("exports native finger blends on both hands with normalized weights and no opposite-side joints", async () => {
    const document = gloveFixture(handSamples.map(sample => sample.position));
    await attachItemSkin(document, "starhide_wraps");
    const io = new NodeIO(), exported = await io.readBinary(await io.writeBinary(document));
    const node = exported.getRoot().listNodes().find(candidate => candidate.getMesh())!;
    const skin = node.getSkin()!, primitive = node.getMesh()!.listPrimitives()[0]!;
    expect(exported.getRoot().listMeshes().map(mesh => mesh.getName())).toEqual(["authored-glove"]);
    expect(node.getExtras().itemModelDeform).toBe("native-hand");
    expect(skin.listJoints()).toHaveLength(65);
    handSamples.forEach((sample, vertex) => {
      const actual = influences(primitive, skin, vertex);
      const total = [...sample.weights.values()].reduce((sum, value) => sum + value, 0);
      expect([...actual.keys()].sort()).toEqual([...sample.weights.keys()].sort());
      for (const [bone, weight] of actual) {
        expect(Number.isFinite(weight) && weight > 0).toBe(true);
        expect(bone.endsWith(`_${sample.side}`)).toBe(true);
        expect(weight).toBeCloseTo(sample.weights.get(bone)! / total, 6);
      }
      expect([...actual.values()].reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6);
      expect([...actual.keys()].some(bone => fingers.test(bone))).toBe(true);
      expect(actual.size).toBeGreaterThan(1);
      const joints: number[] = [];
      primitive.getAttribute("JOINTS_0")!.getElement(vertex, joints);
      expect(joints.every(joint => Number.isInteger(joint) && joint >= 0 && joint < 65)).toBe(true);
      const position: number[] = []; primitive.getAttribute("POSITION")!.getElement(vertex, position);
      expect(position).toEqual(sample.position);
    });
  });

  it("requires the native-hand marker to opt into finger weights", async () => {
    const document = gloveFixture(handSamples.map(sample => sample.position), false);
    await attachItemSkin(document, "starhide_wraps");
    const skin = document.getRoot().listSkins()[0]!, primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    handSamples.forEach((sample, vertex) => {
      const bones = [...influences(primitive, skin, vertex).keys()];
      expect(bones).toContain(`hand_${sample.side}`);
      expect(bones.every(bone => [`hand_${sample.side}`, `lowerarm_${sample.side}`].includes(bone))).toBe(true);
      expect(bones.some(bone => fingers.test(bone))).toBe(false);
    });
  });

  it("rejects native hand transfer onto another garment slot or geometry outside the hand", async () => {
    await expect(attachItemSkin(gloveFixture(handSamples.map(sample => sample.position)), "starhide_robe"))
      .rejects.toThrow("native-hand deformation requires handwear");
    await expect(attachItemSkin(gloveFixture([[0, 0, 0], [0, .01, 0], [.01, 0, 0]]), "starhide_wraps"))
      .rejects.toThrow("more than 8cm");
  });
});

const coverageBones = ["clavicle_l", "upperarm_l", "lowerarm_l", "upperarm_r", "lowerarm_r", "hand_l", "hand_r",
  "index_01_l", "middle_02_r", "ring_03_l", "pinky_01_r", "thumb_02_l", "spine_03", "neck_01", "Head", "foot_l"];

function coverageFixture(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry(), vertices = coverageBones.length * 3;
  const positions = new Float32Array(vertices * 3), joints = new Uint16Array(vertices * 4), weights = new Float32Array(vertices * 4);
  for (let vertex = 0; vertex < vertices; vertex++) {
    positions[vertex * 3] = vertex % 3 === 1 ? .01 : 0;
    positions[vertex * 3 + 1] = vertex % 3 === 2 ? 1.41 : 1.4;
    joints[vertex * 4] = Math.floor(vertex / 3); weights[vertex * 4] = 1;
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(joints, 4));
  geometry.setAttribute("skinWeight", new THREE.BufferAttribute(weights, 4));
  geometry.setIndex(Array.from({ length: vertices }, (_, index) => index));
  return geometry;
}

describe("Starhide handwear anatomy coverage", () => {
  it("restores the original body after partial Starhide coverage is unequipped and releases each temporary mask", async () => {
    const assetId = "corealm_item_starhide_wraps";
    const assets = {
      entry: (id: string) => id === assetId ? {
        id, tags: ["arms", "starhide-tailored-approved"], itemModel: { itemId: "starhide_wraps", wearable: true },
      } : undefined,
      load: vi.fn(async () => new THREE.Group()),
    };
    const rig = new CharacterRig(assets as never) as any;
    const body = new THREE.Group(), original = coverageFixture(), material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.SkinnedMesh(original, material);
    const bones = coverageBones.map(name => { const bone = new THREE.Bone(); bone.name = name; return bone; });
    body.add(mesh, ...bones);
    mesh.bind(new THREE.Skeleton(bones));
    rig.root.add(body);
    rig.body = body; rig.bodyAssetId = "base_male"; rig.layerTarget = body;
    rig.bodyMeshes = [mesh]; rig.bodyGeometries.set(mesh, original);
    const originalDisposed = vi.fn(); original.addEventListener("dispose", originalDisposed);
    for (let cycle = 0; cycle < 2; cycle++) {
      rig.gearBySlot.set("hands", [{ assetId, slot: "hands", attach: "skin" }]);
      await rig.rebuildLayersNow();
      const masked = mesh.geometry, maskDisposed = vi.fn();
      masked.addEventListener("dispose", maskDisposed);
      expect(masked).not.toBe(original);
      expect(Array.from(masked.index!.array)).toEqual(Array.from(original.index!.array).filter(vertex => vertex < 15 || vertex >= 36));
      rig.gearBySlot.clear();
      await rig.rebuildLayersNow();
      expect(mesh.geometry).toBe(original);
      expect(mesh.geometry.index!.count).toBe(coverageBones.length * 3);
      expect(maskDisposed).toHaveBeenCalledOnce();
      expect(originalDisposed).not.toHaveBeenCalled();
      expect(rig.capGeometries).toEqual([]);
    }
    rig.dispose(); original.dispose(); material.dispose(); mesh.skeleton.dispose();
  });

  it("masks hands and every finger family while retaining upper/lower arms, with legacy hands covering both", () => {
    const geometry = coverageFixture();
    const glove = maskLegacyClothing(geometry, coverageBones, new Set(["handwear"]));
    const legacy = maskLegacyClothing(geometry, coverageBones, new Set(["hands"]));
    const original = Array.from(geometry.index!.array);
    expect(Array.from(glove.index!.array)).toEqual(original.filter(vertex => vertex < 15 || vertex >= 36));
    expect(Array.from(legacy.index!.array)).toEqual(original.filter(vertex => vertex >= 36));
    expect(Array.from(geometry.index!.array)).toEqual(Array.from({ length: coverageBones.length * 3 }, (_, index) => index));
    expect(Array.from(glove.getAttribute("skinWeight").array)).toEqual(Array.from(geometry.getAttribute("skinWeight").array));
    glove.dispose(); legacy.dispose(); geometry.dispose();
  });

  it("retains a wrist seam with an exposed forearm corner until sleeves are also covered", () => {
    const geometry = coverageFixture();
    // The left hand's first triangle reaches a corner dominated by lowerarm_l.
    geometry.getAttribute("skinIndex").setXY(15, 5, 2);
    geometry.getAttribute("skinWeight").setXY(15, .4, .6);
    const glove = maskLegacyClothing(geometry, coverageBones, new Set(["handwear"]));
    const sleevedGlove = maskLegacyClothing(geometry, coverageBones, new Set(["handwear", "sleeves"]));
    expect(Array.from(glove.index!.array)).toEqual(expect.arrayContaining([15, 16, 17]));
    expect(Array.from(sleevedGlove.index!.array)).not.toContain(15);
    expect(Array.from(sleevedGlove.index!.array)).toEqual(Array.from({ length: 12 }, (_, index) => index + 36));
    glove.dispose(); sleevedGlove.dispose(); geometry.dispose();
  });
});
