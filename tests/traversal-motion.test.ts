import { describe, expect, it } from "vitest";
import type { SemanticEntity } from "../game/src/contracts.js";
import { sampleTraversal } from "../game/src/systems/traversalMotion.js";

const obstacle: SemanticEntity = {
  id: "vault", name: "Low wall", archetype: "obstacle", tier: 1, regionId: "fallowmarch",
  position: [0, 0, 0], state: "available", interactions: ["vault"],
  obstacle: { reqLevel: 1, exitPosition: [2, 0, 0], durationMs: 3000, savesMeters: 20 },
};
describe("traversal presentation paths", () => {
  it("aligns an accepted off-centre start before stepping onto a narrow support", () => {
    const beam: SemanticEntity = { ...obstacle, position: [0, 0, 0], interactionPosition: [0, 0, -2.2],
      obstacle: { ...obstacle.obstacle!, exitPosition: [0, 0, 2.2], durationMs: 4000 },
      meta: { traversalKind: "balance", traversalContactDepth: 3, traversalRise: 0.24 } };
    expect(sampleTraversal(beam, [1, 0, -2.2], [0, 0, 2.2], 0).position).toEqual([1, 0, -2.2]);
    expect(sampleTraversal(beam, [1, 0, -2.2], [0, 0, 2.2], 0.16).position).toEqual([0, 0, -2.2]);
    expect(sampleTraversal(beam, [1, 0, -2.2], [0, 0, 2.2], 0.5).position[0]).toBe(0);
  });

  it("conceals a material nav correction instead of showing a visible landing jump", () => {
    const sample = sampleTraversal(obstacle, [0, 0, 0], [3, 0, 0], 1);
    expect(sample.concealed).toBe(true);
    expect(sample.curtainOpacity).toBe(1);
  });
  it("uses actual support height despite the navmesh's vertical landing offset", () => {
    const beam: SemanticEntity = { ...obstacle, position: [0, 0, 0], interactionPosition: [0, 0, -2.2],
      obstacle: { ...obstacle.obstacle!, exitPosition: [0, 0, 2.2], durationMs: 4000 },
      meta: { traversalKind: "balance", traversalContactDepth: 3, traversalRise: 0.24 } };
    const sample = sampleTraversal(beam, [0, 0.2, -2.2], [0, 0.2, 2.2], 0.5);
    expect(sample.position[1]).toBeCloseTo(0.24, 6);
  });
  it("vaults across a compact obstacle with exact entry and landing and hip clearance", () => {
    const sample = (p: number) => sampleTraversal(obstacle, [0, 0, 0], [2, 0, 0], p);
    expect(sample(0).position).toEqual([0, 0, 0]);
    expect(sample(0).phase).toBe("entry");
    expect(sample(0.17).phase).toBe("contact");
    expect(sample(0.5).position[1]).toBeGreaterThan(0.8);
    expect(sample(1).position[0]).toBe(2);
    expect(sample(1).position[1]).toBeCloseTo(0);
    expect(sample(1).phase).toBe("recovery");
  });
  it.each(["climb", "balance", "slide"])("keeps %s rooted to its contact line", (traversalKind) => {
    const sample = sampleTraversal({ ...obstacle, meta: { traversalKind } }, [0, 0, 0], [2, 1, 0], 0.5);
    expect(sample.position[1]).toBeCloseTo(sample.position[0] / 2);
    expect(sample.kind).toBe(traversalKind);
  });
  it("conceals impossible distances without drawing intermediate airborne travel", () => {
    for (const metres of [40, 103, 146]) {
      const sample = sampleTraversal(obstacle, [0, 0, 0], [metres, 3, 0], 0.5);
      expect(sample.concealed).toBe(true);
      expect(sample.curtainOpacity).toBe(1);
      expect(sample.position).toEqual([0, 0, 0]);
      expect(sampleTraversal(obstacle, [0, 0, 0], [metres, 3, 0], 1).curtainOpacity).toBe(1);
    }
  });
  it("covers a concealed crossing in the same half second whatever its authored duration", () => {
    for (const durationMs of [2000, 3000, 3500, 6000]) {
      const long: SemanticEntity = { ...obstacle,
        obstacle: { ...obstacle.obstacle!, exitPosition: [140, 3, 0], durationMs } };
      const opaqueAt = (() => {
        for (let step = 0; step <= 1000; step++) {
          if (sampleTraversal(long, [0, 0, 0], [140, 3, 0], step / 1000).curtainOpacity >= 1) return step / 1000;
        }
        return 1;
      })();
      expect(opaqueAt * durationMs).toBeGreaterThan(400);
      expect(opaqueAt * durationMs).toBeLessThan(600);
    }
  });

  it("steps a concealed crossing onto its authored entrance before the cover closes", () => {
    const distant: SemanticEntity = { ...obstacle, interactionPosition: [1.5, 0, 0],
      obstacle: { ...obstacle.obstacle!, exitPosition: [140, 3, 0], durationMs: 6000 } };
    const at = (p: number) => sampleTraversal(distant, [0, 0, 0], [140, 3, 0], p);
    expect(at(0).position).toEqual([0, 0, 0]);
    expect(at(0.02).position[0]).toBeGreaterThan(0);
    expect(at(0.02).position[0]).toBeLessThan(1.5);
    // The authored entrance is reached by the time the cover is opaque, and never overshot.
    expect(at(at(0.5).curtainOpacity >= 1 ? 0.5 : 1).position[0]).toBeCloseTo(1.5, 6);
    expect(at(1).position[0]).toBeCloseTo(1.5, 6);
  });

  it("reverses facing and landing for a reverse crossing", () => {
    const sample = sampleTraversal(obstacle, [2, 0, 0], [0, 0, 0], 1);
    expect(sample.position[0]).toBe(0);
    expect(sample.facingRad).toBe(-Math.PI / 2);
  });
});
