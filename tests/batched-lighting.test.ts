import * as THREE from "three";
import { DirectionalLightNode, EnvironmentNode } from "three/webgpu";
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

it("builds the material's environment, light map and occlusion lighting with the scene lights", () => {
  const environment = new EnvironmentNode();
  const sun = new THREE.DirectionalLight(); sun.castShadow = true;
  const builder = { context: { materialLightings: [environment] }, renderer: { library: { getLightNodeClass: () => DirectionalLightNode } } };
  const nodes = new BatchedLighting().createNode([sun, new THREE.PointLight()]).setupLightsNode(builder as never) as unknown[];
  expect(nodes).toContain(environment);
  expect(nodes.filter(node => node instanceof DirectionalLightNode)).toHaveLength(1);
});
