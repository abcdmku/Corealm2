import { describe, expect, it } from "vitest";
import { Rng } from "../game/src/core/rng.js";
import {
  WANDER_MIN_METRES,
  WANDER_PAUSE_MAX_MS,
  WANDER_PAUSE_MIN_MS,
  WANDER_RADIUS_METRES,
  hashId,
  wanderDestination,
} from "../game/src/systems/enemyAI.js";
import { LEASH_METRES } from "../game/src/world/habitatMovement.js";
import type { Vec3 } from "../game/src/contracts.js";

/**
 * Idle creatures potter about instead of standing perfectly still.
 *
 * A field of animals that never move reads as a diorama — measured before this existed, an
 * undisturbed flock of hens sat at exactly 0.000 m/s indefinitely. The rhythm is what sells it: a
 * couple of metres at a time, then eight to eighteen seconds of nothing, per creature and out of
 * step with its neighbours.
 *
 * `spawnPos` anchors the leash, the respawn point and every walk-home in `systems/enemyAI.ts`, so
 * the one thing this must never do is let a creature drift somewhere those three stop making sense.
 */
describe("creature wander", () => {
  const SPAWN: Vec3 = [10, 3, -20];

  it("keeps every destination inside the ring around the spawn point", () => {
    const rng = new Rng(1234);
    for (let index = 0; index < 500; index += 1) {
      const target = wanderDestination(SPAWN, rng);
      const distance = Math.hypot(target[0] - SPAWN[0], target[2] - SPAWN[2]);
      expect(distance).toBeGreaterThanOrEqual(WANDER_MIN_METRES - 1e-9);
      expect(distance).toBeLessThanOrEqual(WANDER_RADIUS_METRES + 1e-9);
    }
  });

  it("never picks a destination the creature is already standing on", () => {
    // The floor is the whole reason the destination is a ring rather than a disc. Without it a
    // creature can draw a point a few centimetres away, take one step, and read as a twitch.
    const rng = new Rng(99);
    for (let index = 0; index < 200; index += 1) {
      const target = wanderDestination(SPAWN, rng);
      expect(Math.hypot(target[0] - SPAWN[0], target[2] - SPAWN[2])).toBeGreaterThan(1);
    }
  });

  it("leaves height to the navmesh rather than inventing one", () => {
    expect(wanderDestination(SPAWN, new Rng(7))[1]).toBe(SPAWN[1]);
  });

  it("stays far inside the leash, so wandering cannot trip a walk home", () => {
    // A creature that could wander past `LEASH_METRES` would leash itself while idle, walk back,
    // and heal — a loop with no player in it at all.
    expect(WANDER_RADIUS_METRES).toBeLessThan(LEASH_METRES / 4);
  });

  it("gives every creature its own stream, so a flock does not move in lockstep", () => {
    // Five hens spawned by the same group differ only by the index suffix on their entity id.
    const first = [1, 2, 3, 4, 5].map((index) => {
      const rng = new Rng(hashId(`marchfield_hens_${index}`));
      return wanderDestination(SPAWN, rng).join(",");
    });
    expect(new Set(first).size, "two hens drew the same destination").toBe(first.length);
  });

  it("is deterministic for one creature, so a replay is a replay", () => {
    const once = wanderDestination(SPAWN, new Rng(hashId("marchfield_hens_3")));
    const again = wanderDestination(SPAWN, new Rng(hashId("marchfield_hens_3")));
    expect(again).toEqual(once);
  });

  it("pauses long enough to read as stillness rather than milling", () => {
    // The point of the pause is that MOST of a flock is standing at any moment, and the creature
    // that decides it is the SLOWEST one: 1.2 m/s crosses the full radius in five seconds, so a
    // five-second floor would have left a hen moving half the time. This is the assertion that
    // caught exactly that while the constants were being picked.
    expect(WANDER_PAUSE_MAX_MS).toBeGreaterThan(WANDER_PAUSE_MIN_MS);
    const SLOWEST_CREATURE_MPS = 1.2;
    const longestStrollSeconds = WANDER_RADIUS_METRES / SLOWEST_CREATURE_MPS;
    const movingFraction = longestStrollSeconds
      / (longestStrollSeconds + WANDER_PAUSE_MIN_MS / 1000);
    expect(movingFraction, "the slowest creature spends too long walking").toBeLessThan(0.4);
  });

  it("spreads pauses across the range rather than clustering", () => {
    const rng = new Rng(hashId("redsill_frogs_2"));
    const pauses = Array.from({ length: 400 }, () => rng.int(WANDER_PAUSE_MIN_MS, WANDER_PAUSE_MAX_MS));
    expect(Math.min(...pauses)).toBeGreaterThanOrEqual(WANDER_PAUSE_MIN_MS);
    expect(Math.max(...pauses)).toBeLessThanOrEqual(WANDER_PAUSE_MAX_MS);
    // Both halves of the range get used, so the rhythm varies rather than settling on one beat.
    const midpoint = (WANDER_PAUSE_MIN_MS + WANDER_PAUSE_MAX_MS) / 2;
    expect(pauses.some((pause) => pause < midpoint)).toBe(true);
    expect(pauses.some((pause) => pause > midpoint)).toBe(true);
  });
});
