import { expect, it } from "vitest";
import { guideCreatures } from "../tools/gen-docs.js";

it("publishes spawn pages for authored creatures while keeping unplaced candidates out", () => {
  const ids = guideCreatures().map((creature) => creature.id);
  expect(ids).toContain("cattle_t1");
  expect(ids).toContain("redbrush_fox_t1");
  expect(ids).toContain("heath_jack_t1");
  expect(ids).toContain("fen_crawler_t5");
  expect(ids).toContain("vault_custodian_t10");
  expect(ids).toContain("kiln_marrow_t20");
  // The Hollow Bough is a Wilderness resident now: its authored packs are the tier-50 dead boughs,
  // petrified grove and deadwood population. Its tier-10 and tier-70 blocks stay registered as
  // unplaced family fallbacks, so the guide must publish the placed tier and only that one.
  expect(ids).toContain("hollow_bough_t50");
  expect(ids).not.toContain("hollow_bough_t10");
  expect(ids).not.toContain("hollow_bough_t70");
  expect(ids).not.toContain("rimeback_tortoise_t10");
});
