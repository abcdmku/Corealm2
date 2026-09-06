import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { DAYLIGHT_LOOK, Renderer } from "../game/src/render/renderer.js";

describe("daylight shadow stability", () => {
  for (const resolution of [1024, 2048]) {
    it(`keeps fixed world points on the same fractional shadow texel at ${resolution}px while the camera moves`, () => {
      const sun = new THREE.DirectionalLight();
      Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 220 });
      sun.shadow.camera.updateProjectionMatrix();
      sun.shadow.mapSize.set(resolution, resolution);
      const rig = Object.assign(Object.create(Renderer.prototype) as Renderer, { sun });
      const sample = (stable: boolean) => {
        rig.setShadowStabilizationEnabled(stable);
        return Array.from({ length: 25 }, (_, i) => {
          // Millimetres of camera motion, including negative world coordinates and grid crossings.
          rig.followShadow(new THREE.Vector3(-17.4 + i * .007, 3.1 + i * .003, 26.2 - i * .009));
          sun.updateMatrixWorld(true);
          sun.shadow.updateMatrices(sun);
          const direction = sun.position.clone().sub(sun.target.position);
          expect(direction.distanceTo(new THREE.Vector3(...Object.values(DAYLIGHT_LOOK.sunOffset)))).toBeLessThan(1e-10);
          return new THREE.Vector3(2, 7, 25).applyMatrix4(sun.shadow.matrix).multiplyScalar(resolution);
        });
      };
      const offsets = (samples: THREE.Vector3[]) => samples.slice(1).flatMap(p => {
        const delta = p.clone().sub(samples[0]!);
        return [Math.abs(delta.x - Math.round(delta.x)), Math.abs(delta.y - Math.round(delta.y))];
      });
      expect(Math.max(...offsets(sample(false)))).toBeGreaterThan(.1);
      expect(Math.max(...offsets(sample(true)))).toBeLessThan(1e-8);
    });
  }
});
