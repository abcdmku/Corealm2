import { expect, it } from "vitest";
import { PlayerSilhouette } from "../game/src/render/playerSilhouette.js";

it("shows substantial obstruction immediately, ignores small overlaps, and clears immediately", () => {
  const silhouette = new PlayerSilhouette();
  expect(silhouette.shouldShow(3)).toBe(false);
  expect(silhouette.shouldShow(4)).toBe(true);
  expect(silhouette.shouldShow(5)).toBe(true);
  expect(silhouette.shouldShow(0)).toBe(false);
  expect(silhouette.shouldShow(5)).toBe(true);
  expect(silhouette.shouldShow(3)).toBe(false);
  silhouette.dispose();
});

it("fades in and out over 100ms without an activation delay", () => {
  const silhouette = new PlayerSilhouette();
  expect(silhouette.updateOpacity(0, 0)).toBe(0);
  expect(silhouette.updateOpacity(5, 16)).toBeGreaterThan(0);
  expect(silhouette.updateOpacity(5, 50)).toBeCloseTo(0.12);
  expect(silhouette.updateOpacity(5, 100)).toBeCloseTo(0.24);
  expect(silhouette.updateOpacity(2, 116)).toBeCloseTo(0.2016);
  expect(silhouette.updateOpacity(2, 150)).toBeCloseTo(0.12);
  expect(silhouette.updateOpacity(2, 200)).toBeCloseTo(0);
  silhouette.dispose();
});
