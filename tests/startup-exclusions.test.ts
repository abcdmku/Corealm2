import { expect, it } from "vitest";
import { ExclusionZones, type ExclusionBand } from "../game/src/world/scatter.js";

it("preserves exact exclusion fades after rejecting distant circle and rotated rectangle bounds", () => {
  const zones = new ExclusionZones().addCircle(-12, 7, 8).addOrientedRect(15, -5, 14, 6, 0.73, 2);
  const ramp = (distance: number, band: ExclusionBand) => distance <= band.hard ? 0
    : band.fade <= 0 ? 1 : Math.min(1, (distance - band.hard) / band.fade);
  for (const band of [{ hard: 0, fade: 0 }, { hard: -5, fade: 3 }, { hard: 3, fade: 14 }, { hard: 50, fade: 10 }]) {
    for (let x = -100; x <= 100; x += 1.7) for (let z = -100; z <= 100; z += 2.3) {
      const circle = Math.hypot(x + 12, z - 7) - 8;
      const dx = x - 15, dz = z + 5, c = Math.cos(0.73), s = Math.sin(0.73);
      const rectangle = Math.hypot(Math.max(Math.abs(dx * c - dz * s) - 7, 0),
        Math.max(Math.abs(dx * s + dz * c) - 3, 0)) - 2;
      expect(zones.densityAt(x, z, { base: band })).toBe(Math.min(ramp(circle, band), ramp(rectangle, band)));
    }
  }
});
