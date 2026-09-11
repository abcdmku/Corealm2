import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FishingLine, FishingPoseLayer, FishingRodFlex, type FishingSample } from "../game/src/render/fishingPose.js";

const sample: FishingSample = { phase: "strike", ageMs: 1600, weight: 1, lift: 1, flight: 1, retrieve: 0, crank: 0 };

describe("authored fishing model integration", () => {
  it("flexes merged local geometry and the line guide together without mutating a cached model or sibling", () => {
    const source = new THREE.Group();
    source.userData.fishingRod = { lineGuide: [.173, 1.64, .006], crankAnchor: [.14872, .09376, .074], line: 0xaca777, bobber: 0xe0d1b5 };
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, .173, 1.64, .006, .16, 1.6, 0], 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    source.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
    const originalPositions = Array.from(geometry.getAttribute("position").array);
    const rod = source.clone(true), sibling = source.clone(true);
    const mesh = rod.children[0] as THREE.Mesh;
    const root = new THREE.Group(), line = new FishingLine(), flex = new FishingRodFlex();
    root.position.set(4, .6, -2); root.rotation.y = .8;
    rod.position.set(.4, 1.2, .1); rod.rotation.set(.4, -.3, .2); rod.scale.setScalar(1.3);
    root.add(rod, line.root); root.updateMatrixWorld(true);
    flex.update(rod, sample);
    const privateGeometry = mesh.geometry;
    expect(privateGeometry).not.toBe(geometry);
    expect(rod.userData.fishingRod.lineGuide[2]).toBeCloseTo(-.094);
    expect(source.userData.fishingRod.lineGuide).toEqual([.173, 1.64, .006]);
    expect(sibling.userData.fishingRod.lineGuide).toEqual([.173, 1.64, .006]);
    expect((sibling.children[0] as THREE.Mesh).geometry).toBe(geometry);
    expect(Array.from(geometry.getAttribute("position").array)).toEqual(originalPositions);
    line.update(rod, [6, .1, 3], sample);
    expect(line.root.visible).toBe(true);
    const actualGuide = new THREE.Vector3().fromBufferAttribute(privateGeometry.getAttribute("position"), 1).applyMatrix4(rod.matrixWorld);
    expect(line.tip.distanceTo(actualGuide)).toBeLessThan(1e-6);
    const renderedLine = line.root.children[0] as THREE.Line;
    expect(new THREE.Vector3().fromBufferAttribute(renderedLine.geometry.getAttribute("position"), 0).distanceTo(line.tip)).toBeLessThan(1e-6);
    flex.update(rod, { ...sample, lift: .4 });
    expect(mesh.geometry).toBe(privateGeometry);
    expect(rod.userData.fishingRod.lineGuide[2]).toBeCloseTo(-.034);
    let disposed = 0;
    privateGeometry.addEventListener("dispose", () => disposed++);
    flex.dispose();
    expect(disposed).toBe(1);
    expect(mesh.geometry).toBe(geometry);
    expect(rod.userData.fishingRod.lineGuide).toEqual(source.userData.fishingRod.lineGuide);
    line.update(rod, null, null);
    expect(line.root.visible).toBe(false);
    line.dispose(); geometry.dispose(); (mesh.material as THREE.Material).dispose();
  });

  it("reaches the authored crank grip and preserves the procedural fallback target", () => {
    for (const authored of [true, false]) {
      const root = new THREE.Group(), rod = new THREE.Group();
      rod.position.set(.05, 1.2, .1); root.add(rod);
      const anchor = [.14872, .09376, .074] as const;
      if (authored) rod.userData.fishingRod = { crankAnchor: [...anchor] };
      const arm = new THREE.Bone(), elbow = new THREE.Bone(), hand = new THREE.Bone();
      arm.name = "upperarm_l"; elbow.name = "lowerarm_l"; hand.name = "hand_l";
      arm.position.set(.2, 1.45, 0); elbow.position.x = .30; hand.position.x = .30;
      root.add(arm); arm.add(elbow); elbow.add(hand); root.updateMatrixWorld(true);
      const bones = new Map([arm, elbow, hand].map(bone => [bone.name, bone]));
      const layer = new FishingPoseLayer();
      for (const crank of [0, Math.PI / 2, Math.PI]) {
        layer.apply(root, bones, { ...sample, lift: 0, crank }, rod);
        const expected = authored
          ? new THREE.Vector3(anchor[0], anchor[1] + Math.sin(crank) * .025, anchor[2] + (Math.cos(crank) - 1) * .025)
          : new THREE.Vector3(.055, -.137 + Math.sin(crank) * .025, .051 + Math.cos(crank) * .025);
        rod.localToWorld(expected);
        expect(hand.getWorldPosition(new THREE.Vector3()).distanceTo(expected)).toBeLessThan(1e-6);
        layer.restore(); root.updateMatrixWorld(true);
      }
    }
  });
});
