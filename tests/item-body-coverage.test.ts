import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { NodeIO } from "@gltf-transform/core";
import { maskLegacyClothing } from "../game/src/render/itemBodyCoverage.js";

const names = ["spine_03", "upperarm_l", "pelvis", "calf_r", "foot_l", "Head", "neck_01", "thumb_01_r"];
function fixture(indexed = true): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const count = 24;
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(Array.from({ length: count * 3 }, (_, i) => i / 100), 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(count * 2).fill(0.25), 2));
  geometry.setAttribute("color", new THREE.Uint8BufferAttribute(new Uint8Array(count * 3).fill(128), 3, true));
  geometry.setAttribute("custom", new THREE.Int16BufferAttribute(new Int16Array(count).fill(17), 1));
  const indices = new Uint8Array(count * 4), weights = new Float32Array(count * 4);
  for (let vertex = 0; vertex < count; vertex++) {
    indices[vertex * 4] = Math.floor(vertex / 3); weights[vertex * 4] = 1;
  }
  geometry.setAttribute("skinIndex", new THREE.Uint8BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  geometry.morphAttributes.position = [geometry.getAttribute("position").clone()];
  geometry.morphTargetsRelative = true;
  if (indexed) geometry.setIndex(Array.from({ length: count }, (_, i) => i));
  geometry.addGroup(0, 12, 2); geometry.addGroup(12, 12, 7);
  return geometry;
}

describe("mixed legacy clothing coverage", () => {
  it("applies bounded torso and leg spans without masking pelvis, feet, arms, hands or seam-crossing triangles", () => {
    const source = fixture();
    const position = source.getAttribute("position");
    for (let i = 0; i < position.count; i++) position.setY(i, .4);
    const torso = maskLegacyClothing(source, names, new Set(), [{ region: "torso", minY: .2, maxY: .6 }]);
    expect(Array.from(torso.index!.array)).toEqual(Array.from({ length: 21 }, (_, i) => i + 3));
    const legs = maskLegacyClothing(source, names, new Set(), [{ region: "legs", minY: .2, maxY: .6 }]);
    expect(Array.from(legs.index!.array)).toEqual(Array.from({ length: 24 }, (_, i) => i).filter(i => i < 9 || i >= 12));
    position.setY(11, .6);
    const boundary = maskLegacyClothing(source, names, new Set(), [{ region: "legs", minY: .2, maxY: .6 }]);
    expect(boundary.index!.count).toBe(24);
    position.setY(11, .8);
    const separated = maskLegacyClothing(source, names, new Set(), [
      { region: "legs", minY: .2, maxY: .6 }, { region: "legs", minY: .7, maxY: .9 },
    ]);
    expect(separated.index!.count).toBe(24);
    expect(() => maskLegacyClothing(source, names, new Set(), [{ region: "legs", minY: 1, maxY: 0 }])).toThrow("span");
  });

  it("removes the native rear-calf overlap inside greave lining while retaining uncovered anatomy and attributes", async () => {
    const document = await new NodeIO().read("game/public/assets/models/character/base_male.glb");
    const boneNames = document.getRoot().listSkins()[0]!.listJoints().map(node => node.getName());
    const primitive = document.getRoot().listMeshes().at(-1)!.listPrimitives()[0]!;
    const geometry = new THREE.BufferGeometry();
    for (const [semantic, attribute] of [["POSITION", "position"], ["NORMAL", "normal"], ["TEXCOORD_0", "uv"], ["COLOR_0", "color"], ["JOINTS_0", "skinIndex"], ["WEIGHTS_0", "skinWeight"]]) {
      const accessor = primitive.getAttribute(semantic!)!;
      const array = attribute === "skinIndex" ? new Uint16Array(accessor.getArray()!) : new Float32Array(accessor.getArray()!);
      geometry.setAttribute(attribute!, new THREE.BufferAttribute(array, accessor.getElementSize(), accessor.getNormalized()));
    }
    const original = Array.from(primitive.getIndices()!.getArray()!);
    geometry.setIndex(original);
    const result = maskLegacyClothing(geometry, boneNames, new Set(), [{ region: "legs", minY: .145, maxY: .938 }]);
    const retained = new Set<string>();
    for (let i = 0; i < result.index!.count; i += 3) retained.add([0, 1, 2].map(k => result.index!.getX(i + k)).join(","));
    let removedRearCalf = 0, preservedOutside = 0;
    const position = geometry.getAttribute("position");
    for (let i = 0; i < original.length; i += 3) {
      const corners = original.slice(i, i + 3), kept = retained.has(corners.join(","));
      if (corners.some(vertex => position.getY(vertex) <= .145 || position.getY(vertex) >= .938)) {
        expect(kept).toBe(true); preservedOutside++;
      }
      // Native rear calf reaches z=-.1605 while the authored greave backs stop at z=-.1420.
      if (corners.every(vertex => position.getY(vertex) > .35 && position.getY(vertex) < .45)
        && corners.some(vertex => position.getZ(vertex) < -.142)) {
        expect(kept).toBe(false); removedRearCalf++;
      }
    }
    expect(removedRearCalf).toBeGreaterThan(0);
    expect(preservedOutside).toBeGreaterThan(100);
    for (const name of Object.keys(geometry.attributes)) {
      expect(Array.from(result.getAttribute(name).array)).toEqual(Array.from(geometry.getAttribute(name).array));
      expect(result.getAttribute(name)).not.toBe(geometry.getAttribute(name));
    }
    expect(original.length).toBe(geometry.index!.count);
    expect(result.index!.count).toBeLessThan(geometry.index!.count);
  });

  it("covers sleeve bones while keeping bare hands and fingers, with legacy hands still covering both", () => {
    const sleeveNames = ["clavicle_l", "upperarm_r", "lowerarm_l", "hand_l", "thumb_01_r", "neck_01", "Head", "spine_03"];
    const source = fixture();
    const sleeves = maskLegacyClothing(source, sleeveNames, new Set(["sleeves"]));
    expect(Array.from(sleeves.index!.array)).toEqual(Array.from({ length: 15 }, (_, i) => i + 9));
    const legacy = maskLegacyClothing(source, sleeveNames, new Set(["hands"]));
    expect(Array.from(legacy.index!.array)).toEqual(Array.from({ length: 9 }, (_, i) => i + 15));
    expect(sleeves.groups).toEqual([{ start: 0, count: 3, materialIndex: 2 }, { start: 3, count: 12, materialIndex: 7 }]);
    expect(sleeves.morphTargetsRelative).toBe(true);
    expect(Array.from(sleeves.morphAttributes.position![0]!.array)).toEqual(Array.from(source.morphAttributes.position![0]!.array));
    expect(Array.from(sleeves.getAttribute("skinWeight").array)).toEqual(Array.from(source.getAttribute("skinWeight").array));
    expect(source.index!.count).toBe(24);
  });

  it("keeps exposed wrist and shoulder boundary triangles until both adjoining regions are covered", () => {
    const sleeveNames = ["clavicle_l", "upperarm_r", "lowerarm_l", "hand_l", "thumb_01_r", "neck_01", "Head", "spine_03"];
    const source = fixture();
    const joint = source.getAttribute("skinIndex"), weight = source.getAttribute("skinWeight");
    // Two sleeve corners and one mostly bare-hand corner still need their wrist triangle.
    joint.setXY(8, 2, 3); weight.setXY(8, .4, .6);
    // A mostly torso corner keeps a sleeve-only mask from cutting an exposed shoulder.
    joint.setXY(5, 1, 7); weight.setXY(5, .4, .6);
    const sleeves = maskLegacyClothing(source, sleeveNames, new Set(["sleeves"]));
    expect(Array.from(sleeves.index!.array)).toContain(3);
    expect(Array.from(sleeves.index!.array)).toContain(6);
    const robe = maskLegacyClothing(source, sleeveNames, new Set(["body", "sleeves"]));
    expect(Array.from(robe.index!.array)).not.toContain(3);
    expect(Array.from(robe.index!.array)).toContain(6);
    expect(Array.from(robe.index!.array)).toContain(9);
    const fullLegacy = maskLegacyClothing(source, sleeveNames, new Set(["body", "hands"]));
    expect(Array.from(fullLegacy.index!.array)).toEqual([15, 16, 17, 18, 19, 20]);
  });

  it("masks an old torso and trousers while preserving arms, fingers, feet, head and neck", () => {
    const source = fixture();
    const result = maskLegacyClothing(source, names, new Set(["body", "legs"]));
    expect(Array.from(result.index!.array)).toEqual([3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
    expect(result.groups).toEqual([{ start: 0, count: 3, materialIndex: 2 }, { start: 3, count: 12, materialIndex: 7 }]);
    expect(source.index!.count).toBe(24);
    for (const name of Object.keys(source.attributes)) {
      const original = source.getAttribute(name), cloned = result.getAttribute(name);
      expect(cloned).not.toBe(original);
      expect(cloned.array.constructor).toBe(original.array.constructor);
      expect(cloned.normalized).toBe(original.normalized);
      expect(Array.from(cloned.array)).toEqual(Array.from(original.array));
    }
    expect(result.morphAttributes.position![0]).not.toBe(source.morphAttributes.position![0]);
    expect(result.morphTargetsRelative).toBe(true);
    expect(Array.from(maskLegacyClothing(source, names, new Set(["body", "legs"])).index!.array)).toEqual(Array.from(result.index!.array));
  });

  it("keeps uncertain shoulder triangles and substantial neck transition weights", () => {
    const source = fixture();
    // One arm-dominant corner protects a mostly torso triangle at the sleeve edge.
    source.getAttribute("skinIndex").setXY(0, 0, 1);
    source.getAttribute("skinWeight").setXY(0, 0.4, 0.6);
    // Preserve a neck transition even when torso weights are still dominant.
    source.getAttribute("skinIndex").setXY(6, 0, 6);
    source.getAttribute("skinWeight").setXY(6, 0.7, 0.3);
    const result = maskLegacyClothing(source, names, new Set(["body", "legs"]));
    expect(Array.from(result.index!.array)).toContain(0);
    expect(Array.from(result.index!.array)).toContain(6);
    expect(Array.from(result.index!.array)).not.toContain(9);
  });

  it.each(["male", "female"])("preserves every native %s neck boundary triangle while masking weak-neck upper back", async sex => {
    const document = await new NodeIO().read(`game/public/assets/models/character/base_${sex}.glb`);
    const boneNames = document.getRoot().listSkins()[0]!.listJoints().map(node => node.getName());
    let protectedTriangles = 0, weakNeckRemoved = 0;
    for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute("POSITION")!, joints = primitive.getAttribute("JOINTS_0"), weights = primitive.getAttribute("WEIGHTS_0");
      if (!joints || !weights) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions.getArray()!), 3));
      geometry.setAttribute("skinIndex", new THREE.BufferAttribute(new Uint16Array(joints.getArray()!), 4, joints.getNormalized()));
      geometry.setAttribute("skinWeight", new THREE.BufferAttribute(new Float32Array(weights.getArray()!), 4, weights.getNormalized()));
      const original = primitive.getIndices()
        ? Array.from(primitive.getIndices()!.getArray()!) : Array.from({ length: positions.getCount() }, (_, index) => index);
      geometry.setIndex(original);
      const result = maskLegacyClothing(geometry, boneNames, new Set(["body", "sleeves"]));
      const kept = new Set<string>();
      for (let offset = 0; offset < result.index!.count; offset += 3) {
        kept.add([0, 1, 2].map(corner => result.index!.getX(offset + corner)).join(","));
      }
      const neckShare = (vertex: number): number => {
        const js: number[] = [], ws: number[] = [];
        joints.getElement(vertex, js); weights.getElement(vertex, ws);
        return ws.reduce((sum, strength, influence) => sum + (/^(Head|neck_)/.test(boneNames[js[influence]!]!) ? strength : 0), 0)
          / ws.reduce((sum, strength) => sum + strength, 0);
      };
      for (let offset = 0; offset < original.length; offset += 3) {
        const corners = original.slice(offset, offset + 3), shares = corners.map(neckShare);
        const retained = kept.has(corners.join(","));
        if (shares.some(share => share >= .25)) { expect(retained).toBe(true); protectedTriangles++; }
        if (!retained && shares.some(share => share > 0 && share < .25)) weakNeckRemoved++;
      }
      result.dispose(); geometry.dispose();
    }
    expect(protectedTriangles).toBeGreaterThan(100);
    expect(weakNeckRemoved).toBeGreaterThan(10);
  });

  it("handles nonindexed geometry, hands independently of feet, and remaps draw ranges", () => {
    const source = fixture(false);
    source.setDrawRange(3, 15);
    const result = maskLegacyClothing(source, names, new Set(["hands", "feet"]));
    expect(Array.from(result.index!.array)).toEqual([0, 1, 2, 6, 7, 8, 9, 10, 11, 15, 16, 17, 18, 19, 20]);
    expect(result.drawRange).toEqual({ start: 3, count: 9 });
    expect(result.groups).toEqual([{ start: 0, count: 9, materialIndex: 2 }, { start: 9, count: 6, materialIndex: 7 }]);
    expect(source.index).toBeNull();
  });

  it("returns independent unchanged clones for empty coverage or absent skin data", () => {
    const source = fixture();
    const empty = maskLegacyClothing(source, names, new Set());
    expect(empty).not.toBe(source);
    expect(empty.index).not.toBe(source.index);
    expect(Array.from(empty.index!.array)).toEqual(Array.from(source.index!.array));
    source.deleteAttribute("skinWeight");
    const unskinned = maskLegacyClothing(source, names, new Set(["body"]));
    expect(Array.from(unskinned.index!.array)).toEqual(Array.from(source.index!.array));
  });
});
