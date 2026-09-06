import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FishingLine, FishingPoseLayer, FishingRodFlex, sampleFishing, solveFishingFloat, solveFishingLine } from "../game/src/render/fishingPose.js";
import { buildFishingRod } from "../game/src/render/proceduralGearModels.js";
import { FISHING_ROD_LOOKS } from "../game/src/render/proceduralGear.js";
import { CharacterRig } from "../game/src/render/characterRig.js";

describe("procedural fishing", () => {
  it("casts once, waits, peaks at the roll and settles after reeling", () => {
    expect(sampleFishing(200, 1600, 1800).phase).toBe("cast");
    expect(sampleFishing(1000, 800, 1800).phase).toBe("hold");
    expect(sampleFishing(1799, 1, 1800).lift).toBeCloseTo(1, 3);
    expect(sampleFishing(1800, 1800, 1800).lift).toBe(1);
    expect(sampleFishing(2000, 1600, 1800).phase).toBe("reel");
    expect(sampleFishing(2600, 1000, 1800).phase).toBe("hold");
  });
  it("lands on the entity water plane and retrieves toward the live tip", () => {
    const tip = new THREE.Vector3(1, 3, 2), spot = new THREE.Vector3(5, 0.7, 8), out = new THREE.Vector3();
    solveFishingFloat(out, tip, spot, sampleFishing(0, 1800, 1800));
    expect(out.toArray()).toEqual(tip.toArray());
    solveFishingFloat(out, tip, spot, sampleFishing(1000, 800, 1800));
    expect(out.x).toBe(spot.x); expect(out.z).toBe(spot.z);
    expect(Math.abs(out.y - spot.y)).toBeLessThanOrEqual(0.012);
    solveFishingFloat(out, tip, spot, sampleFishing(2125, 1475, 1800));
    expect(out.distanceTo(tip)).toBeLessThan(spot.distanceTo(tip) * 0.4);
  });
  it("keeps exact line endpoints and bows the interior below the chord", () => {
    const points = new Float32Array(99), tip = new THREE.Vector3(0, 3, 0), end = new THREE.Vector3(6, 1, 0);
    solveFishingLine(points, tip, end, 0.2);
    expect([...points.slice(0, 3)]).toEqual(tip.toArray());
    expect([...points.slice(-3)]).toEqual(end.toArray());
    expect(points[49]).toBeCloseTo(1.8);
  });
  it("restores constant bone channels without accumulating rotations", () => {
    const root = new THREE.Group(), spine = new THREE.Bone(); spine.name = "spine_02"; root.add(spine);
    const bones = new Map([[spine.name, spine]]), layer = new FishingPoseLayer(), original = spine.quaternion.clone();
    for (let i = 0; i < 200; i++) { layer.apply(root, bones, sampleFishing(1200, 600, 1800)); layer.restore(); }
    expect(spine.quaternion.toArray()).toEqual(original.toArray());
  });
  it("uses the live rod world anchor, reuses buffers, and hides outside fishing", () => {
    const rod = buildFishingRod(FISHING_ROD_LOOKS.palewood_rod!), root = new THREE.Group(), line = new FishingLine();
    root.add(rod, line.root); rod.position.set(2, 3, 4); root.updateMatrixWorld(true);
    line.update(rod, [5, 1, 8], sampleFishing(1000, 800, 1800));
    const expected = new THREE.Vector3().fromArray(rod.userData.fishingRod.lineGuide).applyMatrix4(rod.matrixWorld);
    expect(line.tip.toArray()).toEqual(expected.toArray());
    const geometry = (line.root.children[0] as THREE.Line).geometry;
    rod.position.x += 1; root.updateMatrixWorld(true); line.update(rod, [5, 1, 8], sampleFishing(1100, 700, 1800));
    expect(line.tip.x).toBeCloseTo(expected.x + 1);
    expect((line.root.children[0] as THREE.Line).geometry).toBe(geometry);
    line.update(rod, null, null); expect(line.root.visible).toBe(false); line.dispose();
  });
  it("flexes private rod buffers and the line guide together, then restores the cached model", () => {
    const rod = buildFishingRod(FISHING_ROD_LOOKS.palewood_rod!), flex = new FishingRodFlex();
    const mesh = rod.getObjectByName("rod-shaft") as THREE.Mesh;
    const original = mesh.geometry, originalGuide = [...rod.userData.fishingRod.lineGuide];
    flex.update(rod, sampleFishing(1800, 1800, 1800));
    expect(mesh.geometry).not.toBe(original);
    expect(rod.userData.fishingRod.lineGuide[2]).toBeCloseTo(originalGuide[2] - 0.1);
    const privateGeometry = mesh.geometry;
    flex.update(rod, sampleFishing(1850, 1750, 1800));
    expect(mesh.geometry).toBe(privateGeometry);
    flex.dispose();
    expect(mesh.geometry).toBe(original);
    expect(rod.userData.fishingRod.lineGuide).toEqual(originalGuide);
  });
  it("disposes the rig-owned line geometry and materials on teardown", () => {
    const rig = new CharacterRig({} as never);
    rig.update(0);
    const line = rig.root.getObjectByName("fishing-line-world")!.children[0] as THREE.Line;
    let geometries = 0, materials = 0;
    line.geometry.addEventListener("dispose", () => geometries++);
    (line.material as THREE.Material).addEventListener("dispose", () => materials++);
    rig.dispose();
    expect(geometries).toBe(1); expect(materials).toBe(1);
    expect(line.parent?.parent).toBeNull();
  });
});
