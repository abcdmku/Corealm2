import { Group, Matrix4, Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { EffectInstances } from "../game/src/render/effectInstances.js";
import { ElementalFluidBodies } from "../game/src/render/elementalFluidBodies.js";
import { ElementalFlowSurfaces } from "../game/src/render/elementalFlowSurfaces.js";
import { lowerToWgsl } from "./helpers/wgsl.js";

const meshes = (parent: Group) => parent.children.map(child => {
  expect(child).toBeInstanceOf(EffectInstances);
  expect(child).toHaveProperty("count", 1);
  expect(child).not.toHaveProperty("isInstancedMesh", true);
  return child as EffectInstances;
});

describe("shared elemental pool materials", () => {
  it.each(["fluid", "flow"] as const)("shares %s graphs while retaining private data and clocks", kind => {
    const firstParent = new Group(), secondParent = new Group();
    const first = kind === "fluid" ? new ElementalFluidBodies(firstParent) : new ElementalFlowSurfaces(firstParent);
    const second = kind === "fluid" ? new ElementalFluidBodies(secondParent) : new ElementalFlowSurfaces(secondParent);
    const a = meshes(firstParent), b = meshes(secondParent);
    let firstDisposed = false, secondDisposed = false;
    try {
      first.begin(2.5); second.begin(19);
      const disposalCounts = new Map(a.map(mesh => [mesh.material, 0]));
      for (const [index, mesh] of a.entries()) {
        const other = b[index]!;
        expect(mesh.material).toBe(other.material);
        expect(mesh.geometry).not.toBe(other.geometry);
        expect(mesh.instanceMatrix.array).not.toBe(other.instanceMatrix.array);
        expect(mesh.instanceColor.array).not.toBe(other.instanceColor.array);
        expect(mesh.userData["effectClock"]).not.toBe(other.userData["effectClock"]);
        expect(mesh.userData["effectClock"].value).toBe(2.5);
        expect(other.userData["effectClock"].value).toBe(19);
        expect(mesh.capacity).toBe(kind === "flow" ? 96 : mesh.name.endsWith("drop") ? 640 : 32);
        expect(mesh.instanceCount).toBe(0);
        const attribute = kind === "fluid" ? "fluidVariant" : "flowLife";
        expect(mesh.geometry.getAttribute(attribute).array).not.toBe(other.geometry.getAttribute(attribute).array);
        mesh.material.addEventListener("dispose", () => disposalCounts.set(mesh.material, disposalCounts.get(mesh.material)! + 1));
        const shader = lowerToWgsl(mesh);
        expect(shader.vertex).toContain("effectMatrix0");
        expect(shader.vertex).toContain("effectMatrix3");
        expect(shader.fragment.length).toBeGreaterThan(500);
      }
      first.dispose(); firstDisposed = true;
      expect([...disposalCounts.values()]).toEqual([0, 0, 0, 0]);
      // Releasing another owner's pool must leave the shared graphs usable.
      for (const mesh of b) expect(lowerToWgsl(mesh).fragment.length).toBeGreaterThan(500);
      second.dispose(); secondDisposed = true;
      expect([...disposalCounts.values()]).toEqual([1, 1, 1, 1]);
    } finally {
      if (!firstDisposed) first.dispose();
      if (!secondDisposed) second.dispose();
    }
  });

  it("keeps full fluid capacity and independent transforms/variants", () => {
    const parent = new Group(), fluids = new ElementalFluidBodies(parent);
    try {
      fluids.begin(4);
      for (const kind of ["wave", "jet", "drop", "pool"] as const) {
        const capacity = kind === "drop" ? 640 : 32;
        for (let index = 0; index <= capacity; index++) fluids.put(kind, 11, 3, -5, 2, 4, .75, .7, .2, 54, -.3);
        const mesh = parent.getObjectByName(`elemental-fluid-${kind}`) as EffectInstances;
        expect(mesh.instanceCount).toBe(capacity);
        expect(mesh).toHaveProperty("count", 1);
        const actual = new Matrix4(); mesh.getMatrixAt(capacity - 1, actual);
        const expected = new Object3D(); expected.position.set(11, 3, -5); expected.rotation.set(.2, .7, 0); expected.scale.set(2, 4, .75); expected.updateMatrix();
        actual.elements.forEach((value, index) => expect(value).toBeCloseTo(expected.matrix.elements[index]!, 5));
        expect(mesh.geometry.getAttribute("fluidVariant").getX(capacity - 1)).toBe(54);
        expect(mesh.geometry.getAttribute("fluidVariant").getY(capacity - 1)).toBeCloseTo(-.3);
      }
      fluids.end();
      expect(fluids.instances).toBe(736);
      expect(fluids.dropped).toBe(4);
      expect(meshes(parent).every(mesh => mesh.visible)).toBe(true);
      fluids.begin(5); fluids.end();
      expect(fluids.instances).toBe(0);
      expect(meshes(parent).every(mesh => !mesh.visible)).toBe(true);
    } finally { fluids.dispose(); }
  });

  it("keeps every flow shape at full capacity with its profile and placement", () => {
    const parent = new Group(), flows = new ElementalFlowSurfaces(parent);
    try {
      flows.begin(7);
      for (const shape of ["band", "shell", "funnel", "plume"] as const) {
        for (let index = 0; index <= 96; index++) flows.put(shape, "fire", -9, 2, 12, 3, 6, 1.5, .8, 23, .6, .15, .4, { foot: .12, arc: .7, lean: -.6, twist: 1.2 });
        const mesh = parent.getObjectByName(`elemental-flow-${shape}`) as EffectInstances;
        expect(mesh.instanceCount).toBe(96);
        expect(mesh).toHaveProperty("count", 1);
        const matrix = new Matrix4(); mesh.getMatrixAt(95, matrix);
        expect(new Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([-9, 2, 12]);
        const life = mesh.geometry.getAttribute("flowLife"), profile = mesh.geometry.getAttribute("flowProfile");
        expect(life.getX(95)).toBe(3); expect(life.getZ(95)).toBe(23);
        expect(profile.getX(95)).toBeCloseTo(.12); expect(profile.getY(95)).toBeCloseTo(.7);
        expect(profile.getZ(95)).toBeCloseTo(-.6); expect(profile.getW(95)).toBeCloseTo(1.2);
      }
      flows.end(); expect(flows.instances).toBe(384); expect(flows.dropped).toBe(4);
      expect(meshes(parent).every(mesh => mesh.visible)).toBe(true);
      flows.begin(8); flows.end(); expect(flows.instances).toBe(0);
    } finally { flows.dispose(); }
  });
});
