import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareSemver, isSemver, parseSemver } from "../game/src/multiplayer/semver.js";

describe("the base game version", () => {
  it("is package.json's version, and that is strict semver", () => {
    const version = JSON.parse(readFileSync("package.json", "utf8")).version;
    expect(isSemver(version)).toBe(true);
  });

  it("accepts MAJOR.MINOR.PATCH with an optional prerelease, and nothing looser", () => {
    for (const good of ["0.0.0", "0.1.0", "1.2.3", "10.20.30", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-0.3.7", "1.0.0-x.7.z.92", "1.0.0-x-y-z.--", "1.0.0-rc.1"])
      expect([good, isSemver(good)]).toEqual([good, true]);
    for (const bad of ["v1.2.3", "1.2", "1.2.3.4", "01.2.3", "1.02.3", "1.2.03", "1.0.0+build.1", "1.0.0-alpha+001", "1.0.0-", "1.0.0-01", "1.0.0-alpha..1",
      " 1.0.0", "1.0.0 ", "1.0.0-al pha", "", "1.0.0-é", `1.0.0-${"a".repeat(60)}`, "99999999999999999999.0.0"])
      expect([bad, isSemver(bad)]).toEqual([bad, false]);
    for (const value of [null, undefined, 1, {}, ["1.0.0"]]) expect(isSemver(value)).toBe(false);
    expect(parseSemver("1.0.0-x.7.z.92")).toEqual({ major: 1, minor: 0, patch: 0, prerelease: ["x", 7, "z", 92] });
  });

  it("orders versions by semver precedence", () => {
    // The chain from the semver specification, section 11, oldest first.
    const chain = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "2.0.0", "10.0.0"];
    for (let i = 0; i < chain.length; i++) for (let j = 0; j < chain.length; j++)
      expect([chain[i], chain[j], Math.sign(compareSemver(chain[i]!, chain[j]!))]).toEqual([chain[i], chain[j], Math.sign(i - j)]);
    expect(compareSemver("0.1.0", "0.1.0")).toBe(0);
    expect(compareSemver("0.9.0", "0.10.0")).toBe(-1);
    expect(compareSemver("1.0.0-2", "1.0.0-10")).toBe(-1);
    expect(compareSemver("1.0.0-a", "1.0.0-1")).toBe(1);
    expect(() => compareSemver("v1.0.0", "1.0.0")).toThrow("Not a version");
  });
});
