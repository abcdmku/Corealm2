import { expect, it } from "vitest";
import { AdaptiveDrawDistance } from "../game/src/render/adaptiveDrawDistance.js";

function run(control: AdaptiveDrawDistance, ms: number, frame: number, eligible = true, moving = true): string[] {
  const changes: string[] = [];
  for (let time = 0; time < ms; time += frame) {
    const next = control.sample(frame, eligible, moving);
    if (next) changes.push(next);
  }
  return changes;
}

it("reduces distance under sustained load but never below near", () => {
  expect(run(new AdaptiveDrawDistance("far"), 60000, 40)).toEqual(["medium", "near"]);
});
it('uses active play to earn upgrades, while idle overload can still reduce distance', () => {
  const control = new AdaptiveDrawDistance('near');
  expect(run(control, 60000, 16.7, true, false)).toEqual([]);
  expect(run(control, 10000, 16.7)).toEqual([]);
  expect(run(control, 5000, 16.7, true, false)).toEqual([]);
  expect(run(control, 12000, 16.7)).toEqual([]);
  expect(run(control, 7000, 16.7)).toEqual(['medium']);
  expect(run(control, 18000, 40, true, false)).toEqual(['near']);
});
it("ignores hidden/paused sessions and isolated loading stalls", () => {
  const control = new AdaptiveDrawDistance("far");
  expect(run(control, 60000, 80, false)).toEqual([]);
  for (let window = 0; window < 10; window++) {
    expect(control.sample(900)).toBeNull();
    expect(run(control, 4000, 16.7)).toEqual([]);
  }
});
it("raises distance only after sustained smooth play and waits before retrying a failed level", () => {
  const control = new AdaptiveDrawDistance("medium");
  expect(run(control, 23000, 16.7)).toEqual(["far"]);
  expect(run(control, 18000, 40)).toEqual(["medium"]);
  expect(run(control, 90000, 16.7)).toEqual([]);
});
it("starts a fresh calibration after a manual graphics change", () => {
  const control = new AdaptiveDrawDistance("far");
  run(control, 14000, 40);
  control.reset("near");
  expect(run(control, 5000, 16.7)).toEqual([]);
});

it("reduces mobile distance at sustained 50 FPS instead of accepting it", () => {
  expect(run(new AdaptiveDrawDistance("far", true), 60000, 20)).toEqual(["medium", "near"]);
  expect(run(new AdaptiveDrawDistance("far", false), 60000, 20)).toEqual([]);
});

it("keeps mobile at near at 60 FPS and requires headroom before expanding", () => {
  const control = new AdaptiveDrawDistance("near", true);
  expect(run(control, 60000, 1000 / 60)).toEqual([]);
  expect(run(control, 16000, 12)).toEqual(["medium"]);
  expect(run(control, 18000, 20)).toEqual(["near"]);
  expect(run(control, 90000, 12)).toEqual([]);
});
