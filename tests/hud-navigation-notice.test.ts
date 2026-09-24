import { describe, expect, it } from "vitest";
import { UNREACHABLE_DESTINATION_MESSAGE } from "../game/src/api/gameApi.js";
import { describeNavigationFailure, ignoresRepeatedNotice } from "../game/src/ui/hud.js";

describe("HUD navigation failure notices", () => {
  it.each(["cancelled", "movement-disabled", "dead", "portal", "teleport", "target-in-range", "combat-command"])(
    "stays quiet when the game stops the walk on purpose (%s)", (reason) => {
      expect(describeNavigationFailure({ reason })).toBeNull();
    });

  it.each(["unreachable", "leg-unreachable", "stuck", "shortcut-failed"])("keeps the error notice for %s", (reason) => {
    expect(describeNavigationFailure({ reason })).toEqual({
      text: UNREACHABLE_DESTINATION_MESSAGE,
      tone: "error",
    });
  });

  it("does not count or wake the log for the same route failure again", () => {
    expect(ignoresRepeatedNotice(UNREACHABLE_DESTINATION_MESSAGE)).toBe(true);
    expect(ignoresRepeatedNotice("Your inventory is full.")).toBe(false);
  });
});
