import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { orderAnimationBudget } from "../game/src/render/entityViews.js";

// Full rigs share a bounded evaluator budget; every actor keeps an independent playback clock.

interface Rig {
  id: string;
  position: THREE.Vector3;
  lastTickedFrame: number;
}

function rigs(count: number, spacing = 2): Rig[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `rig-${index}`,
    position: new THREE.Vector3(index * spacing, 0, 0),
    lastTickedFrame: 0,
  }));
}

/** Runs the policy for `frames` frames and reports how many times each rig was ticked. */
function run(all: Rig[], cap: number, frames: number, viewer?: THREE.Vector3): Map<string, number> {
  const ticks = new Map<string, number>(all.map((rig) => [rig.id, 0]));
  // The sequence is bumped PER RIG, mirroring `EntityViews.update`. Stamping every rig ticked in
  // one frame with the same number leaves ties that a stable sort settles by array position, and
  // that position is distance — see the evenness case below.
  let sequence = 0;
  for (let frame = 1; frame <= frames; frame += 1) {
    const ranked = [...all];
    orderAnimationBudget(ranked, cap, viewer);
    for (const rig of ranked.slice(0, cap)) {
      sequence += 1;
      rig.lastTickedFrame = sequence;
      ticks.set(rig.id, (ticks.get(rig.id) ?? 0) + 1);
    }
  }
  return ticks;
}

describe("animation budget", () => {
  const viewer = new THREE.Vector3(0, 0, 0);

  it("ticks everything when the crowd fits under the cap", () => {
    const all = rigs(6);
    const ticks = run(all, 10, 20, viewer);
    for (const rig of all) expect(ticks.get(rig.id), rig.id).toBe(20);
  });

  it("keeps the nearest rigs on every single frame", () => {
    // Whatever else rotates, the creature the player is fighting must never skip a frame.
    const all = rigs(20);
    const ticks = run(all, 10, 40, viewer);
    // NEAREST_ANIMATION_SHARE is 0.5, so ceil(10 * 0.5) = 5 reserved slots.
    for (const rig of all.slice(0, 5)) expect(ticks.get(rig.id), rig.id).toBe(40);
  });

  it("gives every crowded rig progress and shares spare evaluations evenly", () => {
    // Both previous fixes were correct at 60 fps and wrong at 7, and the reason was that their
    // ordering key depended on elapsed time. This one reads no clock at all, so frame rate cannot
    // enter into it — what is worth checking instead is that the guarantee survives any ratio of
    // crowd to budget, including the pathological one where the crowd is many times the cap.
    for (const crowd of [11, 17, 24, 40, 120]) {
      const all = rigs(crowd);
      const frames = crowd * 4;
      const ticks = run(all, 10, frames, viewer);
      for (const rig of all) {
        expect(ticks.get(rig.id), `crowd ${crowd}: ${rig.id} never animated`).toBeGreaterThan(0);
      }
      const contested = all.slice(5).map((rig) => ticks.get(rig.id) ?? 0);
      expect(
        Math.max(...contested) - Math.min(...contested),
        `crowd ${crowd} refresh spread`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it("rotates the whole budget when there is no viewer to be near", () => {
    // Without a camera there is no "nearest", so nothing is reserved and every rig shares equally.
    const all = rigs(15);
    const ticks = run(all, 10, 60);
    const counts = all.map((rig) => ticks.get(rig.id) ?? 0);
    expect(Math.min(...counts)).toBeGreaterThan(0);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });


});
