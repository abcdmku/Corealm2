import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WildernessEffects, wildernessEffectsLabTorches, torchFlameOrigin } from '../game/src/render/wildernessEffects.js';
import { carveLavaTerrain, lavaClearanceAt, lavaCollisionSegments, lavaSections, sampleLavaChannel,
  WILDERNESS_LAVA_CHANNELS, WILDERNESS_LAVA_LAB_CHANNELS } from '../game/src/content/wildernessLava.js';

describe('shared lava footprint', () => {
  it('carves a closed trench with continuous dry banks and leaves the rest of the world unchanged', () => {
    const channel = WILDERNESS_LAVA_CHANNELS[0]!;
    const centre = lavaSections(channel).find(row => row.progress >= .5)!;
    expect(carveLavaTerrain(10, centre.x, centre.z)).toBeCloseTo(8.5, 3);
    expect(carveLavaTerrain(10, -220, -140)).toBe(10);
    expect(lavaClearanceAt(-220, -140)).toBeGreaterThan(200);
    let last = carveLavaTerrain(10, centre.x, centre.z);
    for (let d = .05; d <= 12; d += .05) {
      const next = carveLavaTerrain(10, centre.x - centre.tz * d, centre.z + centre.tx * d);
      expect(Math.abs(next - last)).toBeLessThan(.065);
      expect(next).toBeGreaterThanOrEqual(8.49);
      expect(next).toBeLessThanOrEqual(10);
      last = next;
    }
    expect(last).toBe(10);
  });

  it('keeps rendered centreline sections inside collision capsules and clears the authored bank', () => {
    const channel = WILDERNESS_LAVA_CHANNELS[0]!;
    const segments = lavaCollisionSegments(channel);
    for (const section of lavaSections(channel)) {
      expect(sampleLavaChannel(channel, section.x, section.z).distance).toBeLessThan(.03);
      const covered = segments.some(segment => {
        const dx = segment.to[0] - segment.from[0];
        const dz = segment.to[1] - segment.from[1];
        const t = Math.max(0, Math.min(1, ((section.x - segment.from[0]) * dx
          + (section.z - segment.from[1]) * dz) / (dx * dx + dz * dz)));
        return Math.hypot(section.x - segment.from[0] - dx * t,
          section.z - segment.from[1] - dz * t) < segment.radius;
      });
      expect(covered).toBe(true);
    }
    expect(lavaClearanceAt(180, 667)).toBeLessThan(0);
    for (let x = 16; x <= 64; x += 4) for (let z = 572; z <= 628; z += 4) {
      expect(lavaClearanceAt(x, z), `Black Knight Castle floor ${x},${z}`).toBeGreaterThan(2);
    }
  });
});

describe('production Wilderness effects', () => {
  const ground = (x: number, z: number): number => carveLavaTerrain(0, x, z, WILDERNESS_LAVA_LAB_CHANNELS);

  it('keeps flames in the measured metal bowl when a mounted torch is rotated', () => {
    expect(torchFlameOrigin([10, 5, 20], 2, 0)).toEqual([10, 5.7, 20.554]);
    const rotated = torchFlameOrigin([10, 5, 20], 2, Math.PI / 2);
    expect(rotated[0]).toBeCloseTo(10.554);
    expect(rotated[1]).toBe(5.7);
    expect(rotated[2]).toBeCloseTo(20);
  });

  it('lights only the nearest six sources, animates their intensity and drops distant work', () => {
    const parent = new THREE.Scene();
    const effects = new WildernessEffects(parent, {
      groundHeightAt: ground, torches: wildernessEffectsLabTorches(ground),
      channels: WILDERNESS_LAVA_LAB_CHANNELS, maxLights: 6,
    });
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(-12, 3, 6); camera.updateMatrixWorld();
    effects.update(1, camera);
    const first = effects.getState();
    expect(first.lights).toHaveLength(6);
    expect(first.lights[0]!.id).toBe('lab-ruin-brazier-0');
    expect(first.liveParticles).toBeGreaterThan(20);
    expect(first.lights.every(light => light.intensity > 0)).toBe(true);
    effects.update(1.35, camera);
    expect(effects.getState().lights[0]!.intensity).not.toBe(first.lights[0]!.intensity);
    effects.setLightingEnabled(false); effects.update(1.4, camera);
    expect(effects.getState().lights.every(light => light.intensity === 0)).toBe(true);
    expect(effects.getState().liveParticles).toBeGreaterThan(20);
    expect(effects.group.visible).toBe(true);
    effects.setLightingEnabled(true);
    camera.position.set(300, 3, 300); camera.updateMatrixWorld(); effects.update(2, camera);
    expect(effects.getState().liveParticles).toBe(0);
    expect(effects.getState().lights.every(light => light.intensity === 0)).toBe(true);
    effects.dispose();
    expect(parent.children).not.toContain(effects.group);
    expect(effects.getState().ready).toBe(false);
  });

  it('draws bank relief and raised crust over the carved terrain with upward bank normals', () => {
    const parent = new THREE.Scene();
    const effects = new WildernessEffects(parent, {
      groundHeightAt: ground, torches: [], channels: WILDERNESS_LAVA_LAB_CHANNELS,
    });
    const state = effects.getState();
    expect(state.crustPlates).toBeGreaterThan(6);
    expect(state.bankRocks).toBeGreaterThan(20);
    expect(state.moltenTriangles).toBeGreaterThan(300);
    expect(state.bounds!.max[1]! - state.bounds!.min[1]!).toBeGreaterThan(1);
    const bank = effects.group.getObjectByName('wilderness-lava-banks-lab-widows-furnace') as THREE.Mesh;
    const normals = bank.geometry.getAttribute('normal');
    expect(Array.from({ length: normals.count }, (_, i) => normals.getY(i)).filter(n => n > .3).length)
      .toBeGreaterThan(normals.count * .85);
    const molten = effects.group.getObjectByName('wilderness-lava-lab-widows-furnace') as THREE.Mesh;
    const positions = molten.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      expect(positions.getY(i) - ground(positions.getX(i), positions.getZ(i))).toBeCloseTo(.075, 4);
    }
    effects.setEnabled(false);
    expect(effects.group.visible).toBe(false);
    expect(effects.getState().liveParticles).toBe(0);
    effects.dispose();
  });
});
