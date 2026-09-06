import { expect, it } from "vitest";
import { guideCreatures } from "../tools/gen-docs.js";

it("publishes spawn pages for authored creatures while keeping unplaced candidates out", () => {
  const ids = guideCreatures().map((creature) => creature.id);
  expect(ids).toContain("cattle_t1");
  expect(ids).toContain("redbrush_fox_t1");
  expect(ids).not.toContain("goblin_archer_t1");
});
