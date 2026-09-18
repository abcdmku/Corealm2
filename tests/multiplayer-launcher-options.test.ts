import { describe, expect, it } from "vitest";
import { localMultiplayerOptions } from "../tools/lib/localMultiplayer.js";

describe("local multiplayer launch options", () => {
  it("keeps dev, production and lab identities and saves separate", () => {
    const configs = [localMultiplayerOptions("dev", []), localMultiplayerOptions("prod", []),
      localMultiplayerOptions("dev", ["--lab"]), localMultiplayerOptions("prod", ["--lab"])];
    expect(new Set(configs.map(config => config.data)).size).toBe(4);
    expect(new Set(configs.map(config => config.worldId)).size).toBe(4);
    expect(configs.every(config => config.capacity === 200)).toBe(true);
    expect(configs[0]!.webPort).not.toBe(configs[1]!.webPort);
    expect(configs[0]!.worldPort).not.toBe(configs[1]!.worldPort);
  });
  it.each([["--capacity", "201"], ["--capacity", "0"], ["--capacity", "1.5"],
    ["--web-port", "-1"], ["--world-port", "65536"], ["--data"], ["--host", "0.0.0.0"],
    ["--web-port", "4180"], ["--skip-build"]])("rejects invalid or nonlocal launch options %j", (...args) => {
    expect(() => localMultiplayerOptions("dev", args)).toThrow();
  });
  it("supports ephemeral listeners for browser acceptance and explicit build reuse", () => {
    expect(localMultiplayerOptions("prod", ["--web-port", "0", "--world-port", "0", "--skip-build"]))
      .toMatchObject({ webPort: 0, worldPort: 0, skipBuild: true });
  });
});
