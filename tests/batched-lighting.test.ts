import * as THREE from "three";
import { expect, it } from "vitest";
import { BatchedLighting } from "../game/src/render/batchedLighting.js";

const key = (lights: THREE.Light[]) => new BatchedLighting().createNode(lights).customCacheKey();

it("keeps one program key while cave, fairy, spell and lava light pools come and go", () => {
  const sun = new THREE.DirectionalLight(); sun.castShadow = true;
  const sky = new THREE.HemisphereLight();
  const surface = key([sun, sky]);
  expect(key([sun, sky, new THREE.HemisphereLight(), new THREE.PointLight(), new THREE.PointLight()])).toBe(surface);
  expect(key([sun, new THREE.RectAreaLight(), new THREE.PointLight()])).toBe(surface);
  expect(key([sun])).toBe(surface);
});

it("still separates programs by the shadowed sun", () => {
  const shadowed = new THREE.DirectionalLight(); shadowed.castShadow = true;
  const unshadowed = new THREE.DirectionalLight();
  expect(key([shadowed])).not.toBe(key([unshadowed]));
  expect(key([shadowed])).not.toBe(key([]));
});
