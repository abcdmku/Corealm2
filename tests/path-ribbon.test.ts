/**
 * The guide ribbon's geometry: a terrain-seated strip with a distance/across attribute the
 * fragment program paints by. Pure, so it runs without a renderer.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildRibbonGeometry, createRibbonMaterial, projectAlong } from "../game/src/render/pathRibbon.js";

const HALF = 0.4;
const LIFT = 0.2;

function attribute(geometry: THREE.BufferGeometry, name: string): THREE.BufferAttribute {
  return geometry.getAttribute(name) as THREE.BufferAttribute;
}

describe("buildRibbonGeometry", () => {
  it("needs two samples", () => {
    expect(buildRibbonGeometry([[0, 0]], () => 0, HALF, LIFT)).toBeNull();
    expect(buildRibbonGeometry([], () => 0, HALF, LIFT)).toBeNull();
  });

  it("lays two edge vertices per sample, each on its own ground, with distance along the strip", () => {
    const ground = (x: number, z: number): number => x * 0.1 + z * 0.5;
    const built = buildRibbonGeometry([[0, 0], [2, 0], [4, 0]], ground, HALF, LIFT)!;
    const position = attribute(built.geometry, "position");
    const trail = attribute(built.geometry, "aTrail");
    expect(position.count).toBe(6);
    expect(built.geometry.index!.count).toBe(12);
    expect(built.length).toBeCloseTo(4);

    // Straight run along +x: one edge at +z, the other at -z, both HALF from the centre.
    expect(position.getZ(0)).toBeCloseTo(HALF);
    expect(position.getZ(1)).toBeCloseTo(-HALF);
    expect(position.getX(2)).toBeCloseTo(2);
    // Each edge takes the height under ITSELF, not the centreline's.
    expect(position.getY(0)).toBeCloseTo(ground(0, HALF) + LIFT);
    expect(position.getY(1)).toBeCloseTo(ground(0, -HALF) + LIFT);
    expect(position.getY(5)).toBeCloseTo(ground(4, -HALF) + LIFT);

    expect([trail.getX(0), trail.getX(2), trail.getX(4)]).toEqual([0, 2, 4]);
    expect([trail.getY(0), trail.getY(1)]).toEqual([1, -1]);
    expect(built.geometry.boundingSphere).not.toBeNull();
    expect(Array.from(built.centre)).toEqual([0, 0, 0, 2, 0, 2, 4, 0, 4]);
  });

  it("projects a point onto the centreline as metres along and metres off", () => {
    const built = buildRibbonGeometry([[0, 0], [10, 0], [10, 10]], () => 0, HALF, LIFT)!;
    expect(projectAlong(built.centre, 3, 0.5)).toEqual({ along: 3, lateral: 0.5 });
    // Past the corner: the second leg, measured from the corner onward.
    expect(projectAlong(built.centre, 11, 4)).toEqual({ along: 14, lateral: 1 });
    // Before the start and beyond the end clamp to the ends.
    expect(projectAlong(built.centre, -5, 0)).toEqual({ along: 0, lateral: 5 });
    expect(projectAlong(built.centre, 10, 12)).toEqual({ along: 20, lateral: 2 });
  });

  it("miters a corner so the strip keeps its width, and caps a hairpin", () => {
    const corner = buildRibbonGeometry([[0, 0], [10, 0], [10, 10]], () => 0, HALF, LIFT)!;
    const position = attribute(corner.geometry, "position");
    // The corner's two edge vertices straddle the corner along the bisector, sqrt(2) x HALF out.
    const cornerSpan = Math.hypot(position.getX(2) - position.getX(3), position.getZ(2) - position.getZ(3));
    expect(cornerSpan).toBeCloseTo(2 * HALF * Math.SQRT2, 5);
    expect(corner.length).toBeCloseTo(20);

    const hairpin = buildRibbonGeometry([[0, 0], [10, 0], [0.5, 0.01]], () => 0, HALF, LIFT)!;
    const tip = attribute(hairpin.geometry, "position");
    const tipSpan = Math.hypot(tip.getX(2) - tip.getX(3), tip.getZ(2) - tip.getZ(3));
    expect(tipSpan).toBeLessThanOrEqual(2 * HALF * 1.6 + 1e-6);
  });
});

describe("createRibbonMaterial", () => {
  it("shares live uniforms and preserves transparent overlay rendering", () => {
    const uniforms = { uTime: { value: 0 }, uLength: { value: 12 }, uHead: { value: 0 } };
    const material = createRibbonMaterial(new THREE.Color("#ffd98a"), uniforms);
    expect(material.customProgramCacheKey()).toMatch(/ribbon/);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.toneMapped).toBe(false);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "#include <common>\nvoid main(){\n#include <begin_vertex>\n}",
      fragmentShader: "#include <common>\nvoid main(){\n#include <color_fragment>\n}",
    };
    material.onBeforeCompile(shader as never, {} as never);
    expect(shader.uniforms.uTime).toBe(uniforms.uTime);
    expect(shader.uniforms.uLength).toBe(uniforms.uLength);
    expect(shader.uniforms.uHead).toBe(uniforms.uHead);

  });
});
