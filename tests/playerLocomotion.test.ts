import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { bakePlayerJog } from "../game/src/render/playerLocomotion.js";
import { loadGeometryGlb } from "../tools/player-locomotion-audit.js";

let source: THREE.AnimationClip;
let body: THREE.Object3D;
const changed = new Set(["thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r"].map(name => `${name}.quaternion`));

function transforms(root: THREE.Object3D): unknown[] {
  const rows: unknown[] = [];
  root.traverse(node => rows.push([node.name, node.position.toArray(), node.quaternion.toArray(), node.scale.toArray(), node.matrix.toArray(), node.matrixWorld.toArray()]));
  return rows;
}

beforeAll(async () => {
  const [library, model] = await Promise.all([
    loadGeometryGlb("game/public/assets/models/animation/animation_library_1.glb"),
    loadGeometryGlb("game/public/assets/models/character/base_male.glb"),
  ]);
  source = library.animations.find(clip => clip.name === "Jog_Fwd_Loop")!;
  body = model.scene;
});

describe("private player jog bake using shipped UAL motion", () => {
  it("preserves the source, rest body, pelvis and every channel outside the six leg rotations", () => {
    const original = THREE.AnimationClip.toJSON(source);
    const rest = transforms(body);
    const result = bakePlayerJog(source, body);
    expect(THREE.AnimationClip.toJSON(source)).toEqual(original);
    expect(transforms(body)).toEqual(rest);
    expect(result.clip).not.toBe(source);
    expect(result.clip.uuid).not.toBe(source.uuid);
    expect(result.clip.name).toBe(source.name);
    expect(result.clip.duration).toBe(source.duration);
    expect(result.clip.blendMode).toBe(source.blendMode);
    expect(result.clip.tracks.length).toBe(source.tracks.length);
    for (let i = 0; i < source.tracks.length; i++) {
      const before = source.tracks[i]!, after = result.clip.tracks[i]!;
      expect(after).not.toBe(before);
      expect(after.name).toBe(before.name);
      if (changed.has(before.name)) continue;
      expect(THREE.KeyframeTrack.toJSON(after)).toEqual(THREE.KeyframeTrack.toJSON(before));
    }
    expect(result.diagnostics.sourceNativeMps).toBeGreaterThan(5.8);
    expect(result.diagnostics.sourceNativeMps).toBeLessThan(6.1);
    expect(result.diagnostics.targetNativeMps * 1.2).toBeCloseTo(4.2, 10);
    expect(result.diagnostics.minReachMarginM).toBeGreaterThan(.1);
    expect(result.diagnostics.maxIkResidualM).toBeLessThan(1e-6);
  });

  it("keeps the rewritten rotations finite, normalized, continuous and closed", () => {
    const { clip } = bakePlayerJog(source, body);
    const previous = new THREE.Quaternion(), current = new THREE.Quaternion();
    for (const track of clip.tracks) {
      if (!changed.has(track.name)) continue;
      expect(track.validate()).toBe(true);
      for (let i = 0; i < track.values.length; i += 4) {
        current.fromArray(track.values, i);
        expect(current.toArray().every(Number.isFinite)).toBe(true);
        expect(current.length()).toBeCloseTo(1, 6);
        if (i > 0) expect(previous.dot(current)).toBeGreaterThan(.99);
        previous.copy(current);
      }
      expect(new THREE.Quaternion().fromArray(track.values).normalize().angleTo(current.normalize())).toBeLessThan(1e-7);
    }
  });

  it("reuses an immutable local profile by source identity and relevant rig transforms", () => {
    const first = bakePlayerJog(source, body);
    expect(bakePlayerJog(source, body)).toBe(first);
    expect(bakePlayerJog(source, body.clone(true))).toBe(first);
    const secondSource = source.clone();
    expect(bakePlayerJog(secondSource, body).clip).not.toBe(first.clip);
    expect(bakePlayerJog(source, body, 3.4).clip).not.toBe(first.clip);
  });

  it("rejects an incompatible source or target without returning poisoned cached data", () => {
    for (const target of [0, -1, NaN, Infinity, 7]) expect(() => bakePlayerJog(source, body, target)).toThrow();
    const wrong = source.clone(); wrong.name = "Walk_Loop";
    expect(() => bakePlayerJog(wrong, body)).toThrow(/Jog_Fwd_Loop/);
    const missing = source.clone(); missing.tracks = missing.tracks.filter(track => track.name !== "calf_l.quaternion");
    expect(() => bakePlayerJog(missing, body)).toThrow(/calf_l/);
    expect(() => bakePlayerJog(source, new THREE.Object3D())).toThrow(/pelvis/);
    expect(bakePlayerJog(source, body).diagnostics.targetNativeMps).toBe(3.5);
  });
});
