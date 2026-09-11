import * as THREE from 'three';
import { expect, it } from 'vitest';
import { LavaBankLighting } from '../game/src/render/lavaBankLighting.js';
import type { LavaChannel } from '../game/src/content/wildernessLava.js';

it('lights the shore from invisible upward emitting areas before the player approaches', () => {
  const parent = new THREE.Group();
  const channel: LavaChannel = { id: 'reach', points: [[-30, 0], [30, 0]],
    halfWidth: 3, depth: 2.6, bankWidth: 4.4, seed: 1, magic: 0 };
  const lighting = new LavaBankLighting(parent, [channel], () => -2.6);
  const camera = new THREE.PerspectiveCamera(55, 1.6, .1, 200);
  camera.position.set(0, 14, 70); camera.lookAt(0, -2, 0); camera.updateMatrixWorld();
  lighting.update(camera, true);
  expect(lighting.snapshot().active).toBeGreaterThan(0);
  expect(lighting.snapshot().budget).toBe(4);
  expect(parent.children.every(child => child instanceof THREE.RectAreaLight)).toBe(true);
  parent.updateMatrixWorld(true);
  for (const child of parent.children) {
    const light = child as THREE.RectAreaLight;
    if (!light.intensity) continue;
    // RectAreaLight emits along local -Z, toward the receiving banks above its plane.
    expect(light.getWorldDirection(new THREE.Vector3()).y).toBeLessThan(-.99);
    expect(light.height).toBeGreaterThan(1);
  }
  lighting.disable();
  expect(lighting.snapshot().active).toBe(0);
  lighting.dispose();
  expect(parent.children).toHaveLength(0);
});

it('fades source changes instead of moving a bright light to a new stream section', () => {
  const parent = new THREE.Group();
  const channel: LavaChannel = { id: 'long', points: [[-140, 0], [140, 0]],
    halfWidth: 3, depth: 2.6, bankWidth: 4.4, seed: 1 };
  const lighting = new LavaBankLighting(parent, [channel], () => -2.6);
  const camera = new THREE.PerspectiveCamera(55, 1.6, .1, 350);
  let previous = lighting.snapshot().slots;
  let replacements = 0;
  for (let frame = 0; frame < 480; frame++) {
    const x = frame < 120 ? -110 : -110 + Math.min(220, (frame - 120) * .8);
    camera.position.set(x, 14, 30); camera.lookAt(x, -2, 0); camera.updateMatrixWorld();
    lighting.update(camera, true, frame / 60);
    const current = lighting.snapshot().slots;
    current.forEach((slot, i) => {
      expect(Math.abs(slot.intensity - previous[i]!.intensity)).toBeLessThan(.8);
      if (slot.strip !== previous[i]!.strip && previous[i]!.strip !== null) {
        replacements++;
        expect(previous[i]!.intensity).toBeLessThan(.13);
      }
    });
    previous = current;
  }
  expect(replacements).toBeGreaterThan(0);
  camera.position.set(0, 20, 170); camera.lookAt(0, -2, 0); camera.updateMatrixWorld();
  for (let frame = 480; frame < 720; frame++) lighting.update(camera, true, frame / 60);
  expect(lighting.snapshot().active).toBeGreaterThan(0);
  expect(lighting.snapshot().slots.some(slot => slot.intensity > 5)).toBe(true);
  lighting.dispose();
});
