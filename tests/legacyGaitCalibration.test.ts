import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { loadContactHelpers } from "../tools/calibrate-legacy-gait.js";
import { loadGeometryGlb } from "../tools/player-locomotion-audit.js";

let helpers: Awaited<ReturnType<typeof loadContactHelpers>>;
let closeLoop: (clip: THREE.AnimationClip, fps: number) => number;
beforeAll(async () => {
  helpers = await loadContactHelpers();
  // Exercise the browser converter's implementation without loading its browser-only FBX imports.
  const source = await readFile(new URL("../tools/animals/convert.js", import.meta.url), "utf8");
  const first = source.indexOf("function quatAngle("), last = source.indexOf("async function loadTexture(");
  if (first < 0 || last <= first) throw new Error("Converter loop helpers are missing");
  closeLoop = new Function(`${source.slice(first, last)}\nreturn closeLoop;`)();
});

function rotationTrack(name: string, times: number[], angles: number[]) {
  return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, angles.flatMap(angle =>
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle).toArray()));
}

describe("animal importer loop closure", () => {
  it("gives a slow sparse frog limb seven frames to return, preserving every native key and value", () => {
    const track = rotationTrack("Bone003", [0, 7.7333331108, 8.1666669846], [0, .66234761854, .22094804854]);
    const clip = new THREE.AnimationClip("Idle", -1, [track]);
    const times = Array.from(track.times), values = Array.from(track.values);
    const nativeEnd = clip.duration;
    expect(closeLoop(clip, 30)).toBe(7);
    expect(clip.duration - nativeEnd).toBeCloseTo(7 / 30, 5);
    expect(Array.from(track.times).slice(0, -1)).toEqual(times);
    expect(Array.from(track.values).slice(0, -4)).toEqual(values);
    expect(Array.from(track.values).slice(-4)).toEqual(values.slice(0, 4));
    expect(.22094804854 / (clip.duration - nativeEnd)).toBeLessThan(1.01861312628);
  });

  it("uses translation cadence to give every track one shared closing time", () => {
    const position = new THREE.VectorKeyframeTrack("Root.position", [0, .25, .5], [0, 0, 0, 2, 0, 0, 4, 0, 0]);
    const rotation = rotationTrack("Limb", [0, .25, .5], [0, .4, .1]);
    const scale = new THREE.VectorKeyframeTrack("Body.scale", [0, .25, .5], [1, 1, 1, 1.1, 1.1, 1.1, 1, 1, 1]);
    const clip = new THREE.AnimationClip("Walk", -1, [position, rotation, scale]);
    const originals = clip.tracks.map(track => ({ times: Array.from(track.times), values: Array.from(track.values) }));
    expect(closeLoop(clip, 30)).toBe(15);
    expect(clip.duration).toBe(1);
    clip.tracks.forEach((track, index) => {
      expect(track.times.at(-1)).toBe(1);
      expect(Array.from(track.times).slice(0, -1)).toEqual(originals[index]!.times);
      expect(Array.from(track.values).slice(0, -track.getValueSize())).toEqual(originals[index]!.values);
      expect(Array.from(track.values).slice(-track.getValueSize())).toEqual(originals[index]!.values.slice(0, track.getValueSize()));
    });
  });

  it("includes scale-only closing motion", () => {
    const scale = new THREE.VectorKeyframeTrack("Body.scale", [0, .25, .5], [1, 1, 1, 2, 2, 2, 3, 3, 3]);
    const clip = new THREE.AnimationClip("Idle", -1, [scale]);
    expect(closeLoop(clip, 30)).toBe(15);
    expect(Array.from(scale.values).slice(-3)).toEqual([1, 1, 1]);
  });

  it("normalizes quaternion lengths and signs when deciding an authored loop is already closed", () => {
    const track = new THREE.QuaternionKeyframeTrack("Limb.quaternion", [0, .5, 1], [0, .3, 0, .4, 0, 0, 0, 1, 0, -.6, 0, -.8]);
    const clip = new THREE.AnimationClip("Idle", -1, [track]);
    const before = THREE.AnimationClip.toJSON(clip);
    expect(closeLoop(clip, 30)).toBe(0);
    expect(THREE.AnimationClip.toJSON(clip)).toEqual(before);
  });

  it("keeps a fast native cycle's short return at one frame", () => {
    const track = rotationTrack("Wing", [0, 1 / 30, 2 / 30], [0, 1, .5]);
    const clip = new THREE.AnimationClip("Run", -1, [track]);
    const nativeEnd = clip.duration;
    expect(closeLoop(clip, 30)).toBe(1);
    expect(clip.duration - nativeEnd).toBeCloseTo(1 / 30, 6);
  });
});

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
