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
  expect(ids).toContain("hollow_bough_t10");
  expect(ids).not.toContain("rimeback_tortoise_t10");
});
