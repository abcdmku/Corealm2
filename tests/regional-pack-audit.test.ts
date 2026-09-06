import { describe, expect, it } from "vitest";
import type { RegionalPackAssembly } from "../game/src/world/regionalPackEntities.js";
import { auditRegionalPack, type RegionalPackAuditPorts } from "../game/src/world/regionalPackAudit.js";

const assembly: RegionalPackAssembly = {
  packId: "pack_test",
  habitat: { id: "test", groupId: "pack_test", regionId: "fallowmarch", centre: [0, 0],
    radius: 8, anchors: [[-3, 0], [3, 0]], activity: "patrol", dressing: [] },
  entities: [{ id: "resident", name: "Goblin", archetype: "enemy", regionId: "fallowmarch",
    tier: 1, state: "alive", interactions: ["attack"],
    position: [-3, 0, 0], combat: { health: 10, maxHealth: 10, level: 2, bodyRadius: 0.5, aggroRadius: 7 } }],
};
const ports: RegionalPackAuditPorts = {
  sample: () => ({ regionId: "fallowmarch", height: 0, slopeDegrees: 0, waterDepth: 0 }),
  clearance: () => true,
  path: (from, to) => [from, to],
};

describe("regional pack generated-world acceptance probe", () => {
  it("checks every production idle leg and return, with complete body samples", () => {
    const result = auditRegionalPack(assembly, ports);
    expect(result.accepted).toBe(true);
    expect(result.checkedRoutes).toBe(6);
    expect(result.sampledPoints).toBeGreaterThan(20);
  });
  it("finds trunks between otherwise clear spawn and patrol endpoints", () => {
    const result = auditRegionalPack(assembly, {
      ...ports, clearance: (x, z, radius) => Math.hypot(x, z) > radius + 0.15,
    });
    expect(result.failures.some((failure) => failure.kind === "blocked-body")).toBe(true);
  });
  it("rejects a body crossing a wet bank or semantic seam even when its centre is dry", () => {
    const result = auditRegionalPack(assembly, {
      ...ports, sample: (x, z) => ({ regionId: z > 0.4 ? "vellenwood" : "fallowmarch",
        height: 0, slopeDegrees: 0, waterDepth: x < -3.4 ? 0.1 : 0 }),
    });
    expect(result.failures.some((failure) => failure.kind === "wet-body")).toBe(true);
    expect(result.failures.some((failure) => failure.kind === "region-seam")).toBe(true);
  });
  it("uses exact nav arrival coordinates and rejects routes outside the habitat", () => {
    expect(auditRegionalPack(assembly, { ...ports, path: () => null }).accepted).toBe(false);
    expect(auditRegionalPack(assembly, { ...ports, path: () => [[NaN, 0, 0]] }).accepted).toBe(false);
    const wrongArrival = auditRegionalPack(assembly, {
      ...ports, path: (from, to) => [from, [to[0] + 0.351, to[1], to[2]]],
    });
    expect(wrongArrival.failures.some((failure) => failure.kind === "unreachable-arrival")).toBe(true);
    const detour = auditRegionalPack(assembly, {
      ...ports, path: (from, to) => [from, [0, 0, 9], to],
    });
    expect(detour.failures.some((failure) => failure.kind === "habitat-envelope")).toBe(true);
  });
  it("includes the full combat leash disc when requested", () => {
    const blocked: RegionalPackAuditPorts = {
      ...ports, clearance: (x) => x > -7,
    };
    expect(auditRegionalPack(assembly, blocked).accepted).toBe(true);
    expect(auditRegionalPack(assembly, blocked, { pursuitRadius: 5 }).accepted).toBe(false);
  });
  it("fails invalid terrain and rejects invalid audit configuration", () => {
    expect(auditRegionalPack(assembly, { ...ports, sample: () => ({
      regionId: "fallowmarch", height: NaN, waterDepth: 0, slopeDegrees: 0,
    }) }).accepted).toBe(false);
    expect(() => auditRegionalPack(assembly, ports, { sampleSpacing: 0 })).toThrow("Invalid regional pack");
  });
});
