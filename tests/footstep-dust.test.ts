import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Ambience } from "../game/src/render/vfx.js";

function harness(maxParticles = 640) {
  const parent = new THREE.Group();
  const ambience = new Ambience(parent, { maxParticles });
  const dust = parent.getObjectByName("ambience-dust") as THREE.InstancedMesh;
  const additive = parent.getObjectByName("ambience") as THREE.InstancedMesh;
  return { parent, ambience, dust, additive, viewer: new THREE.Vector3() };
}

describe("footstep dust", () => {
  it("fades pigment alpha while keeping sparks on the existing additive batch", () => {
    const { parent, ambience, dust, additive, viewer } = harness();
    try {
      ambience.burst("dust", [0, 0.02, 0], 2, 0);
      ambience.burst("spark", [0, 0, 0], 3, 0);
      ambience.update(100, viewer);

      const material = dust.material as THREE.MeshBasicMaterial;
      const colours = dust.geometry.getAttribute("color") as THREE.InstancedBufferAttribute;
      expect(material.blending).toBe(THREE.NormalBlending);
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.vertexColors).toBe(true);
      expect(dust.instanceColor).toBeNull();
      expect(colours.isInstancedBufferAttribute).toBe(true);
      expect(colours.itemSize).toBe(4);
      expect(colours.count).toBe(dust.instanceMatrix.count);
      expect((additive.material as THREE.MeshBasicMaterial).blending).toBe(THREE.AdditiveBlending);
      expect(additive.count).toBe(3);
      expect(dust.count).toBe(2);
      expect(ambience.liveParticles()).toBe(5);
      expect(ambience.drawCalls()).toBe(2);

      const rgb = [colours.getX(0), colours.getY(0), colours.getZ(0)];
      const earlyAlpha = colours.getW(0);
      expect(earlyAlpha).toBeGreaterThan(0);
      expect(earlyAlpha).toBeLessThan(0.3);
      ambience.update(250, viewer);
      expect(colours.getW(0)).toBeGreaterThan(0);
      expect(colours.getW(0)).toBeLessThan(earlyAlpha);
      expect([colours.getX(0), colours.getY(0), colours.getZ(0)]).toEqual(rgb);

      ambience.update(400, viewer);
      expect(dust.count).toBe(0);
      expect(dust.visible).toBe(false);
      expect(additive.count).toBe(3);
      expect(ambience.drawCalls()).toBe(1);
      ambience.update(900, viewer);
      expect(ambience.liveParticles()).toBe(0);
      expect(ambience.drawCalls()).toBe(0);
    } finally {
      ambience.dispose();
    }
    expect(parent.children).toHaveLength(0);
  });

  it("keeps the visible puffs small and near their contact height", () => {
    const { ambience, dust, viewer } = harness();
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    try {
      ambience.burst("dust", [0, 2.02, 0], 2, 0);
      for (let time = 25; time < 400; time += 25) {
        ambience.update(time, viewer);
        for (let index = 0; index < dust.count; index += 1) {
          dust.getMatrixAt(index, matrix);
          matrix.decompose(position, rotation, scale);
          expect(position.y).toBeGreaterThan(2);
          expect(position.y).toBeLessThan(2.15);
          expect(Math.hypot(position.x, position.z)).toBeLessThan(0.25);
          expect(scale.x).toBeLessThan(0.5);
          expect(scale.y).toBeLessThan(scale.x * 0.5);
        }
      }
    } finally {
      ambience.dispose();
    }
  });

  it("shares the particle cap and submits no dust outside its cull radius", () => {
    const { ambience, dust, additive, viewer } = harness(3);
    try {
      ambience.addEmitter({ id: "forge", kind: "spark", position: [0, 0, 0], count: 2 });
      ambience.burst("dust", [0, 0.02, 0], 2, 0);
      ambience.update(100, viewer);
      expect(additive.count).toBe(2);
      expect(dust.count).toBe(1);
      expect(ambience.liveParticles()).toBe(3);

      viewer.set(100, 0, 0);
      ambience.update(125, viewer);
      expect(dust.count).toBe(0);
      expect(dust.visible).toBe(false);
      expect(ambience.drawCalls()).toBe(0);

      viewer.set(0, 0, 0);
      ambience.update(150, viewer);
      expect(dust.count).toBeGreaterThan(0);
      expect(ambience.liveParticles()).toBeLessThanOrEqual(3);
      ambience.clearEmitters();
      ambience.update(200, viewer);
      expect(ambience.liveParticles()).toBe(0);
      expect(ambience.drawCalls()).toBe(0);
    } finally {
      ambience.dispose();
    }
  });
});
