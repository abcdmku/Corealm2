import { Bone, Group, Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { conformTerrainRig, restoreTerrainRig } from "../game/src/render/terrainRig.js";

describe("terrain creature articulation", () => {
  function creature() {
    const root = new Group(), spine: Bone[] = [], feet: Bone[] = [];
    for (let i = 0; i < 10; i++) {
      const body = new Bone(); body.name = `trunk_${i}`;
      body.position.set(0, i ? 0 : .3, i ? -.25 : 1);
      (spine.at(-1) ?? root).add(body); spine.push(body);
      for (const side of [-1, 1]) {
        const foot = new Bone(); foot.position.set(side * .5, -.3, 0); body.add(foot); feet.push(foot);
      }
    }
    return { root, spine, feet };
  }
  it("plants all twenty feet and bends every segment across a crest without cumulative drift", () => {
    const { root, spine, feet } = creature();
    const heightAt = (x: number, z: number) => .1 * x + .4 * Math.cos(z * 2);
    root.position.y = heightAt(0, 0);
    const pose = { placement: new Matrix4(), origin: root.position, heightAt };
    for (let frame = 0; frame < 100; frame++) {
      restoreTerrainRig(root); conformTerrainRig(root, pose);
      for (const foot of feet) {
        const p = foot.getWorldPosition(new Vector3());
        expect(p.y - heightAt(p.x, p.z)).toBeCloseTo(0, 9);
      }
      for (const body of spine) {
        const p = body.getWorldPosition(new Vector3());
        expect(p.y - heightAt(p.x, p.z)).toBeCloseTo(.3, 9);
      }
    }
    expect(spine[0]!.matrixWorld.elements[9]).not.toBeCloseTo(spine[9]!.matrixWorld.elements[9]!, 2);
  });
  it("preserves swing clearance, nonuniform scale and facing in live and instanced coordinates", () => {
    const live = creature(), sampled = creature();
    const placement = new Matrix4().makeRotationY(.7).scale(new Vector3(1.2, .8, 2));
    const heightAt = (x: number, z: number) => x * .3 + z * .2;
    const origin = new Vector3(10, heightAt(10, 8), 8); placement.setPosition(origin);
    live.root.applyMatrix4(placement);
    live.feet[0]!.position.y += .12; sampled.feet[0]!.position.y += .12;
    conformTerrainRig(live.root, { placement: new Matrix4(), origin, heightAt });
    conformTerrainRig(sampled.root, { placement, origin, heightAt });
    for (let i = 0; i < live.feet.length; i++) {
      const a = live.feet[i]!.getWorldPosition(new Vector3());
      const b = sampled.feet[i]!.getWorldPosition(new Vector3()).applyMatrix4(placement);
      expect(a.distanceTo(b)).toBeLessThan(1e-9);
      expect(a.y - heightAt(a.x, a.z)).toBeCloseTo(i === 0 ? .096 : 0, 9);
    }
    restoreTerrainRig(live.root); live.root.updateMatrixWorld(true);
    expect(live.feet.every(foot => foot.matrixAutoUpdate)).toBe(true);
  });
});
