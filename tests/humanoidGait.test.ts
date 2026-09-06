import { describe, expect, it } from "vitest";
import { ENEMY_BLOCKS } from "../game/src/content/enemies.js";
import { ENEMY_RETURN_SPEED_MPS } from "../game/src/systems/enemyAI.js";
import { CREATURE_RUN_SPEED, MOVEMENT, PLAYER_SPEED } from "../game/src/app/config.js";

/**
 * Humanoids RUN — on the same Jog_Fwd_Loop the player runs on, only slightly slower.
 *
 * Two failed states bracket this file, both shipped and both reported. Retiming the 5.92 m/s jog
 * exactly to a 2.1 m/s pursuit played it at 0.35x: slow motion. Swapping to a sped-up walk fixed
 * the slow motion and produced "they should run, not walk fast": the read of a raider is a RUN.
 * The resolution was first on the CONTENT side — pursuit speeds authored at 3.4-3.9, just under
 * the player's 4.2. Slices 02/03 then moved every creature's pursuit and return onto one shared
 * `CREATURE_RUN_SPEED` (90% of the 5.2 m/s player run): `systems/enemyAI.ts` steps pursuit and
 * return with that constant, and an authored `moveSpeedMps` now only seeds the unauthored walk
 * fallback. This file therefore checks the EFFECTIVE pursuit speed, not the retained content
 * numbers. The clip threshold and rate constants are duplicated from `render/entityViews.ts` so
 * a change there has to be meant.
 */
const HUMANOID_JOG_IMPLIED_MPS = 5.92;
const HUMANOID_WALK_IMPLIED_MPS = 1.15;
const HUMANOID_JOG_MIN_RATE = 0.55;
/** What `enemyAI.ts` actually moves a pursuing or returning humanoid at. */
const PURSUIT_SPEED = CREATURE_RUN_SPEED;

const HUMANOIDS = ENEMY_BLOCKS.filter((block) => block.family === "reaver");

describe("humanoid gait", () => {
  it("has humanoid enemies to cover", () => {
    expect(HUMANOIDS.length).toBeGreaterThan(0);
  });

  it("pursues and returns on the jog, at the player's presentation cadence", () => {
    // The jog plays at `characterRig.runPresentationScale` — cadence over planted feet, because
    // exact planting reads as slow motion even at the player's own 4.2 (that rig's documented
    // finding, twice re-confirmed from play against enemies). The player's steady run is 1.2x;
    // a pursuing reaver must land close under it — visibly a run, visibly not quite the player.
    expect(ENEMY_RETURN_SPEED_MPS).toBe(PURSUIT_SPEED);
    for (const block of HUMANOIDS) {
      const pursuit = PURSUIT_SPEED;
      for (const [gait, speed] of [["run", pursuit], ["return", ENEMY_RETURN_SPEED_MPS]] as const) {
        // At or above the threshold the clip choice is Jog_Fwd_Loop...
        expect(speed, `${block.id} ${gait} must land on the jog`)
          .toBeGreaterThanOrEqual(HUMANOID_JOG_IMPLIED_MPS * HUMANOID_JOG_MIN_RATE);
        // ...played at the shared presentation formula, inside the player's own cadence band.
        const rate = Math.min(
          MOVEMENT.runPlaybackRate,
          Math.max(MOVEMENT.runMinPlaybackRate, speed / MOVEMENT.runSpeed * MOVEMENT.runPlaybackRate),
        );
        expect(rate, `${block.id} ${gait} presentation rate`).toBeGreaterThanOrEqual(0.95);
        expect(rate, `${block.id} ${gait} presentation rate`).toBeLessThanOrEqual(MOVEMENT.runPlaybackRate);
      }
      // The pursuit specifically stays visibly under the player's full-tilt 1.2x.
      expect(pursuit / MOVEMENT.runSpeed * MOVEMENT.runPlaybackRate, `${block.id} pursuit cadence`)
        .toBeLessThan(MOVEMENT.runPlaybackRate);
    }
  });

  it("runs slightly slower than the player, so escaping on foot stays possible", () => {
    for (const block of HUMANOIDS) {
      const pursuit = PURSUIT_SPEED;
      expect(pursuit, `${block.id} pursuit`).toBeLessThan(PLAYER_SPEED);
      // "Slightly": a raider that pursues at half the player's speed is not a threat, and one at
      // 95% is an escape that takes a minute of running. 80-93% is the authored band.
      expect(pursuit / PLAYER_SPEED, `${block.id} pursuit fraction`).toBeGreaterThan(0.8);
    }
  });

  it("potters on the walk cycle, below the jog threshold", () => {
    for (const block of HUMANOIDS) {
      const walk = block.walkSpeedMps ?? 0;
      expect(walk, `${block.id} walk`).toBeGreaterThan(0);
      expect(walk, `${block.id} walk stays under the jog threshold`)
        .toBeLessThan(HUMANOID_JOG_IMPLIED_MPS * HUMANOID_JOG_MIN_RATE);
      // And the walk retime is natural rather than clamped.
      const rate = walk / HUMANOID_WALK_IMPLIED_MPS;
      expect(rate, `${block.id} walk rate`).toBeGreaterThan(0.5);
      expect(rate, `${block.id} walk rate`).toBeLessThan(1.5);
    }
  });
});
