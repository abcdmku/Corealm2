import { describe, expect, it } from "vitest";
import { stripView } from "../devdocs/src/workspaces/world/bakeStrip.js";

/* The World workspace offers Render map while the server's map does not show the world it runs. */

const WORLD = "b".repeat(64), OTHER = "d".repeat(64);

describe("the World workspace's map note", () => {
  const status = { revision: WORLD, base: false, history: [], canBake: true };
  it("stays while the server's map shows another world, and goes once it shows this one", () => {
    expect(stripView(status, 0).mapStale).toBe(true);
    expect(stripView(status, 0, OTHER).mapStale).toBe(true);
    expect(stripView(status, 0, WORLD).mapStale).toBe(false);
    expect(stripView({ ...status, base: true }, 0).mapStale).toBe(false);
  });
});
