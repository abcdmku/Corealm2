import { describe, expect, it } from "vitest";
import { checkActionResult, evaluateExpectation, playStatus, validateScenario, type PlayStep } from "../tools/play-game.js";

const scenario = (action: unknown) => ({ name: "probe", actions: [action] });

describe("scripted gameplay evidence", () => {
  it.each([
    { typo: "w" }, { key: "w", click: [1, 2] }, { key: "w", holdMs: -1 },
    { click: [1, Number.NaN] }, { drag: [1, 2, 3] }, { waitMs: "100" },
    { debug: "getState", args: {} }, { reset: false }, { key: "w", expect: [] },
    { key: "w", expected: true }, { key: "w", expectError: "NOT_FOUND" },
    { inspect: "getState", expect: [{ path: "result.ready", equals: true, gt: 0 }] },
    { inspect: "getState", expect: [{ path: "result.__proto__.ready", equals: true }] },
  ])("rejects malformed actions before boot: %j", (action) => {
    expect(() => validateScenario(scenario(action))).toThrow();
  });

  it("requires observed values and rejects unchanged movement or wrong inventory deltas", () => {
    const context = {
      before: { position: [0, 0, 0], ore: 4 },
      after: { position: [0, 0, 0], ore: 6 },
      result: { state: "depleted" },
    };
    expect(evaluateExpectation({ path: "after.position", changedFrom: "before.position" }, context)).toMatch(/failed/);
    expect(evaluateExpectation({ path: "after.ore", deltaFrom: { path: "before.ore", equals: 1 } }, context)).toMatch(/failed/);
    expect(evaluateExpectation({ path: "after.ore", deltaFrom: { path: "before.ore", equals: 2 } }, context)).toBeNull();
    expect(evaluateExpectation({ path: "result.state", equals: "depleted" }, context)).toBeNull();
    expect(evaluateExpectation({ path: "result.remaining", equals: undefined }, context)).toMatch(/Missing semantic path/);
    expect(evaluateExpectation({ path: "result.state", gt: 0 }, context)).toMatch(/not a finite number/);
  });

  it("fails tool errors unless the scenario explicitly expects the exact code", () => {
    for (const failure of [{ error: "NOT_REACHABLE", message: "blocked" }, { ok: false, error: { code: "NOT_REACHABLE", message: "blocked" } }]) {
      expect(checkActionResult(failure)).toMatch(/returned failure/);
      expect(checkActionResult(failure, "NOT_REACHABLE")).toBeNull();
      expect(checkActionResult(failure, "NOT_FOUND")).toMatch(/Expected error/);
    }
    expect(checkActionResult({ ok: true }, "NOT_REACHABLE")).toMatch(/received success/);
    expect(checkActionResult({ ok: false })).toMatch(/returned failure/);
    expect(checkActionResult({ ok: true, value: false })).toBeNull();
  });

  it("never accepts a recording with no semantic expectations and includes request failures", () => {
    const step = { action: { key: "w" }, changed: true, assertions: [] } as unknown as PlayStep;
    const errors = { console: [], page: [], requests: [] as string[], game: [] as string[] };
    expect(playStatus({ actions: [step], errors })).toBe("diagnostic");
    step.assertions = [{ path: "after.position", passed: true }];
    expect(playStatus({ actions: [step], errors })).toBe("passed");
    step.assertions[0]!.passed = false;
    expect(playStatus({ actions: [step], errors })).toBe("failed");
    step.assertions[0]!.passed = true;
    errors.requests.push("GET missing.glb: failed");
    expect(playStatus({ actions: [step], errors })).toBe("failed");
    errors.requests.length = 0;
    errors.game.push("Background scatter could not load its asset");
    expect(playStatus({ actions: [step], errors })).toBe("failed");
  });

  it("accepts a bounded local lab scenario with typed before/after assertions", () => {
    const input = {
      name: "movement", route: "/index.html?mode=combat",
      actions: [{ key: "w", holdMs: 350, expect: [{ path: "after.playerPosition", changedFrom: "before.playerPosition" }] }],
    };
    expect(validateScenario(input)).toBe(input);
    expect(() => validateScenario({ ...input, route: "//other-host/game" })).toThrow();
  });
});
