import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { loadContactHelpers } from "../tools/calibrate-legacy-gait.js";
import { loadGeometryGlb } from "../tools/player-locomotion-audit.js";

let helpers: Awaited<ReturnType<typeof loadContactHelpers>>;
beforeAll(async () => { helpers = await loadContactHelpers(); });

function fixture(scale = 1) {
  const root = new THREE.Group(); root.scale.setScalar(scale);
  const first = new THREE.Object3D(); first.name = "foot_a";
  const second = new THREE.Object3D(); second.name = "foot_b";
  root.add(first, second); root.updateMatrixWorld(true);
  const values = (positions: number[]) => positions.map(value => value / scale);
  const clip = new THREE.AnimationClip("Walk", 1, [
    new THREE.VectorKeyframeTrack("foot_a.position", [0, .4, .6, .8, 1], values([0, 0, .2, 0, 0, -.2, 0, .2, -.1, 0, .2, .1, 0, 0, .2])),
    new THREE.VectorKeyframeTrack("foot_b.position", [0, .2, .4, .8, 1], values([1, 0, .2, 1, 0, -.2, 1, .2, -.1, 1, .2, .1, 1, 0, .2])),
  ]);
  return { root, clip };
}

describe("legacy ground-contact calibration", () => {
  it("measures backward contact velocity instead of excursion divided by the entire cycle", () => {
    const { root, clip } = fixture();
    const result = helpers.measureContactGait(root, clip, { groups: [["foot_a"]], samples: 960, heightM: .001 });
    expect(result.speedMps).toBeCloseTo(1, 5);
    expect(result.speedMps).not.toBeCloseTo(.4, 1);
    expect(result.feet[0]!.samples).toBeGreaterThan(300);
  });

  it("gives physical feet equal weight despite different stance durations", () => {
    const { root, clip } = fixture();
    const result = helpers.measureContactGait(root, clip, { groups: [["foot_a"], ["foot_b"]], samples: 960, heightM: .001 });
    expect(result.feet[0]!.medianMps).toBeCloseTo(1, 5);
    expect(result.feet[1]!.medianMps).toBeCloseTo(2, 5);
    expect(result.speedMps).toBeCloseTo(1.5, 5);
  });

  it("includes the drawn import scale once and restores the caller's pose and clip", () => {
    const { root, clip } = fixture(.01);
    const originalClip = THREE.AnimationClip.toJSON(clip);
    const poses = root.children.map(node => [node.position.toArray(), node.quaternion.toArray(), node.scale.toArray()]);
    expect(helpers.measureContactGait(root, clip, { groups: [["foot_a"]], samples: 960, heightM: .001 }).speedMps).toBeCloseTo(1, 5);
    expect(root.scale.toArray()).toEqual([.01, .01, .01]);
    expect(root.children.map(node => [node.position.toArray(), node.quaternion.toArray(), node.scale.toArray()])).toEqual(poses);
    expect(THREE.AnimationClip.toJSON(clip)).toEqual(originalClip);
  });

  it("requires anatomical contact nodes instead of treating low tails as feet", () => {
    const { root, clip } = fixture(); root.children.forEach(node => { node.name = `tail_${node.name}`; });
    expect(helpers.measureContactGait(root, clip, { assetId: "animal_viper" }).speedMps).toBeNull();
    expect(() => helpers.measureContactGait(root, clip, { groups: [["missing-foot"]] })).toThrow(/contact node/);
  });

  it("uses physical shipped goat soles, preserving source geometry and gait tracks", async () => {
    const gltf = await loadGeometryGlb("game/public/assets/models/animal/animal_goat.glb");
    const clip = gltf.animations.find(clip => clip.name === "Walk")!;
    const before = THREE.AnimationClip.toJSON(clip);
    const positions: Float32Array[] = [];
    gltf.scene.traverse(node => {
      if (node instanceof THREE.SkinnedMesh) positions.push(new Float32Array(node.geometry.getAttribute("position").array));
    });
    const result = helpers.measureContactGait(gltf.scene, clip, { assetId: "animal_goat", samples: 1920 });
    expect(result.method).toContain("sole");
    expect(result.speedMps).toBeCloseTo(.9911, 3);
    expect(result.feet).toHaveLength(4);
    expect(THREE.AnimationClip.toJSON(clip)).toEqual(before);
    let index = 0;
    gltf.scene.traverse(node => {
      if (node instanceof THREE.SkinnedMesh) expect(new Float32Array(node.geometry.getAttribute("position").array)).toEqual(positions[index++]);
    });
  });
});
