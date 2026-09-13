import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CharacterRig } from "../game/src/render/characterRig.js";
import { maskLegacyClothing } from "../game/src/render/itemBodyCoverage.js";
import { NodeIO } from "@gltf-transform/core";
import { fileURLToPath } from "node:url";

// Each triangle belongs to one named body sample, so assertions identify the anatomy retained.
const samples = [
  ["clavicle_l", 1.4], ["upperarm_l", 1.4], ["lowerarm_l", 1.4],
  ["clavicle_r", 1.4], ["upperarm_r", 1.4], ["lowerarm_r", 1.4],
  ["hand_l", 1.4], ["hand_r", 1.4], ["index_01_l", 1.4], ["thumb_01_r", 1.4],
  ["spine_02", 1.2], ["spine_03", 1.42], ["spine_01", 1.01],
  ["neck_01", 1.5], ["Head", 1.7], ["thigh_l", .8], ["foot_r", .1],
] as const;
const hands = new Set(["hand_l", "hand_r", "index_01_l", "thumb_01_r"]);

function fixture(tag: string) {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [], joints: number[] = [], weights: number[] = [];
  samples.forEach(([, height], joint) => {
    for (let corner = 0; corner < 3; corner++) {
      positions.push(corner === 1 ? .01 : 0, height + (corner === 2 ? .005 : 0), 0);
      joints.push(joint, 0, 0, 0); weights.push(1, 0, 0, 0);
    }
  });
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(joints, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  geometry.setIndex(Array.from({ length: samples.length * 3 }, (_, vertex) => vertex));
  const material = new THREE.MeshBasicMaterial(), mesh = new THREE.SkinnedMesh(geometry, material);
  const body = new THREE.Group();
  const bones = samples.map(([name]) => { const bone = new THREE.Bone(); bone.name = name; return bone; });
  body.add(mesh, ...bones); mesh.bind(new THREE.Skeleton(bones));
  const entries = new Map([
    ["corealm_item_dragonhide_robe", { tags: ["torso", tag], itemModel: {
      itemId: "dragonhide_robe", wearable: true, bodyCoverage: [{ region: "torso", minY: 1.035, maxY: 1.38 }],
    } }],
    ["corealm_item_dragonhide_wraps", { tags: ["arms", tag], itemModel: {
      itemId: "dragonhide_wraps", wearable: true,
    } }],
  ]);
  const assets = { entry: (id: string) => entries.get(id), load: vi.fn(async () => new THREE.Group()) };
  const rig = new CharacterRig(assets as never) as any;
  rig.root.add(body);
  rig.body = body; rig.bodyAssetId = "base_male"; rig.layerTarget = body;
  rig.bodyMeshes = [mesh]; rig.bodyGeometries.set(mesh, geometry);
  return { rig, mesh, geometry, material };
}

function indicesWithout(hidden: ReadonlySet<string>): number[] {
  return samples.flatMap(([name], sample) => hidden.has(name) ? [] : [sample * 3, sample * 3 + 1, sample * 3 + 2]);
}

describe("tagged Dragonhide native cloth coverage", () => {
  it.each(["reference-tailored-candidate", "tier50-70-tailored-approved"].flatMap(tag =>
    ["body", "hands"].map(slot => [tag, slot] as const)))(
    "%s preserves exposed arms and restores only removed %s coverage before full unequip",
    async (tag, removedSlot) => {
      const { rig, mesh, geometry, material } = fixture(tag);
      const originalDisposed = vi.fn(); geometry.addEventListener("dispose", originalDisposed);
      try {
        rig.gearBySlot.set("body", [{ assetId: "corealm_item_dragonhide_robe", slot: "body", attach: "skin" }]);
        rig.gearBySlot.set("hands", [{ assetId: "corealm_item_dragonhide_wraps", slot: "hands", attach: "skin" }]);
        await rig.rebuildLayersNow();
        const bothMask = mesh.geometry, bothDisposed = vi.fn(); bothMask.addEventListener("dispose", bothDisposed);
        expect(bothMask).not.toBe(geometry);
        expect(Array.from(bothMask.index!.array)).toEqual(indicesWithout(new Set([...hands, "spine_02"])));

        rig.gearBySlot.delete(removedSlot);
        await rig.rebuildLayersNow();
        const partialMask = mesh.geometry, partialDisposed = vi.fn(); partialMask.addEventListener("dispose", partialDisposed);
        expect(partialMask).not.toBe(geometry);
        expect(partialMask).not.toBe(bothMask);
        expect(Array.from(partialMask.index!.array)).toEqual(indicesWithout(removedSlot === "body" ? hands : new Set(["spine_02"])));
        expect(bothDisposed).toHaveBeenCalledOnce();

        rig.gearBySlot.clear();
        await rig.rebuildLayersNow();
        expect(mesh.geometry).toBe(geometry);
        expect(Array.from(geometry.index!.array)).toEqual(indicesWithout(new Set()));
        expect(partialDisposed).toHaveBeenCalledOnce();
        expect(originalDisposed).not.toHaveBeenCalled();
        expect(rig.capGeometries).toEqual([]);
      } finally {
        rig.dispose(); geometry.dispose(); material.dispose(); mesh.skeleton.dispose();
      }
    },
  );
});

const waistBones = ["pelvis", "spine_01", "neck_01", "upperarm_l"];
const torsoSpan = [{ region: "torso" as const, minY: 1.02, maxY: 1.38 }];

function waistFixture(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  // Native male body triangle 503, with spine and leg influences grouped by coverage region.
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    .1038534567, 1.0602980852, .0748593286,
    .1065646335, 1.0831868649, .0835568309,
    .0828016475, 1.0822221041, .0892025828,
  ], 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3], 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute([
    .5309429239, .4690570761, 0, 0,
    .4625892699, .5374107301, 0, 0,
    .4373255888, .5626744112, 0, 0,
  ], 4));
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

describe("overlapping trouser and bounded robe coverage", () => {
  it("removes blended waist triangles and joins the robe span to an already covered trouser corner", () => {
    const geometry = waistFixture();
    const waist = maskLegacyClothing(geometry, waistBones, new Set(["legs"]), torsoSpan);
    expect(Array.from(waist.index!.array)).toEqual([]);
    // A corner below the robe hem is still covered by the trousers themselves.
    geometry.getAttribute("position").setY(0, 1);
    geometry.getAttribute("skinWeight").setXYZW(0, .8, .2, 0, 0);
    const seam = maskLegacyClothing(geometry, waistBones, new Set(["legs"]), torsoSpan);
    expect(Array.from(seam.index!.array)).toEqual([]);
    expect(Array.from(geometry.index!.array)).toEqual([0, 1, 2]);
    waist.dispose(); seam.dispose(); geometry.dispose();
  });

  it.each(["no trousers", "outside robe span", "neck transition", "exposed arm"] as const)(
    "retains the waist triangle with %s",
    boundary => {
      const geometry = waistFixture();
      if (boundary === "outside robe span") geometry.getAttribute("position").setY(2, 1.01);
      if (boundary === "neck transition") geometry.getAttribute("skinWeight").setXYZW(2, .3, .4, .3, 0);
      if (boundary === "exposed arm") geometry.getAttribute("skinWeight").setXYZW(2, .15, .25, 0, .6);
      const result = maskLegacyClothing(geometry, waistBones, new Set(boundary === "no trousers" ? [] : ["legs"]), torsoSpan);
      expect(Array.from(result.index!.array)).toEqual([0, 1, 2]);
      result.dispose(); geometry.dispose();
    },
  );
});

it("covers the native clavicle-weighted pectorals while preserving shoulder and neck boundary triangles", async () => {
  const document = await new NodeIO().read(fileURLToPath(new URL('../game/public/assets/models/character/base_male.glb', import.meta.url)));
  const node = document.getRoot().listNodes().find(node => node.getName() === 'SuperHero_Male')!;
  const primitive = node.getMesh()!.listPrimitives()[0]!, geometry = new THREE.BufferGeometry();
  const names = node.getSkin()!.listJoints().map(joint => joint.getName());
  for (const [target, source, size] of [['position','POSITION',3],['skinIndex','JOINTS_0',4],['skinWeight','WEIGHTS_0',4]] as const) {
    const values=Array.from(primitive.getAttribute(source)!.getArray()!);
    geometry.setAttribute(target, target==='skinIndex' ? new THREE.Uint16BufferAttribute(values,size) : new THREE.Float32BufferAttribute(values,size));
  }
  geometry.setIndex(Array.from(primitive.getIndices()!.getArray()!));
  const covered = new Set(['legs','feet','handwear'] as const);
  const before = maskLegacyClothing(geometry, names, covered, [{region:'torso',minY:1.02,maxY:1.38}]);
  const after = maskLegacyClothing(geometry, names, covered, [{region:'torso',minY:1.02,maxY:1.48}]);
  const triangles = (g: THREE.BufferGeometry) => new Set(Array.from({length:g.index!.count / 3}, (_,i) =>
    [0,1,2].map(k => g.index!.getX(i*3+k)).join(',')));
  const oldKeys=triangles(before),newKeys=triangles(after),originalKeys=[...triangles(geometry)];
  // These actual sternum/pectoral triangles have as much as 82% clavicle influence.
  for (const index of [12,107]) {
    expect(oldKeys.has(originalKeys[index]!)).toBe(true);
    expect(newKeys.has(originalKeys[index]!)).toBe(false);
  }
  const joints=geometry.getAttribute('skinIndex'),weights=geometry.getAttribute('skinWeight');
  for (const key of oldKeys) if(!newKeys.has(key)) for(const vertex of key.split(',').map(Number)) {
    let neck=0,arm=0;
    for(let k=0;k<4;k++) {
      const name=names[joints.getComponent(vertex,k)]!,strength=weights.getComponent(vertex,k);
      if(/^(Head|neck)(_|$)/.test(name))neck+=strength;
      if(/^(upperarm|lowerarm)_/.test(name))arm+=strength;
    }
    expect(neck).toBeLessThan(.25);
    expect(arm).toBeLessThan(.35);
  }
  expect(Array.from(geometry.getAttribute('position').array)).toEqual(Array.from(primitive.getAttribute('POSITION')!.getArray()!));
  before.dispose();after.dispose();geometry.dispose();
});
