import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { carveLavaTerrain, DEEP_WILDERNESS_LAVA_LAB_CHANNELS, isMoltenLavaAt,
  lavaClearanceAt, lavaCollisionSegments, lavaMagicAt, lavaSections,
  WILDERNESS_LAVA_CHANNELS, WILDERNESS_LAVA_EXPANSION_CHANNELS } from '../game/src/content/wildernessLava.js';
import { WILDERNESS_EXPANSION_SITES, WILDERNESS_RESOURCE_INTENTS } from '../game/src/content/wildernessDepth.js';
import { WildernessEffects, deepWildernessEffectsLabTorches, wildernessTorchPalette,
  type WildernessTorch } from '../game/src/render/wildernessEffects.js';
import { Ambience } from '../game/src/render/vfx.js';
import { lavaObstacles } from '../game/src/world/lavaObstacles.js';

const channels = DEEP_WILDERNESS_LAVA_LAB_CHANNELS;
const ground = (x: number, z: number): number => carveLavaTerrain(0, x, z, channels);
const segmentDistance = (x: number, z: number, a: readonly number[], b: readonly number[]): number => {
  const dx = b[0]! - a[0]!, dz = b[1]! - a[1]!;
  const t = Math.max(0, Math.min(1, ((x - a[0]!) * dx + (z - a[1]!) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a[0]! - t * dx, z - a[1]! - t * dz);
};

describe('forks and seeded lava pools', () => {
  it('uses the accepted expansion for the world and reserves the new structures and resources', () => {
    expect(WILDERNESS_LAVA_CHANNELS).toBe(WILDERNESS_LAVA_EXPANSION_CHANNELS);
    expect(WILDERNESS_LAVA_CHANNELS).toHaveLength(21);
    expect(WILDERNESS_LAVA_EXPANSION_CHANNELS.filter(channel => channel.kind === 'pool').length).toBeGreaterThanOrEqual(10);
    for (const site of WILDERNESS_EXPANSION_SITES) {
      for (let x = -site.footprint[0] / 2; x <= site.footprint[0] / 2; x += 4) {
        for (let z = -site.footprint[1] / 2; z <= site.footprint[1] / 2; z += 4) {
          const wx = site.position[0] + x * Math.cos(site.rotationY) + z * Math.sin(site.rotationY);
          const wz = site.position[1] - x * Math.sin(site.rotationY) + z * Math.cos(site.rotationY);
          expect(lavaClearanceAt(wx, wz, WILDERNESS_LAVA_EXPANSION_CHANNELS), site.id).toBeGreaterThan(8);
        }
      }
    }
    for (const site of WILDERNESS_RESOURCE_INTENTS) {
      expect(lavaClearanceAt(site.position[0], site.position[1], WILDERNESS_LAVA_EXPANSION_CHANNELS), site.id).toBeGreaterThan(24);
    }
  });

  it('renders pools as broad rounded basins and keeps every molten edge inside the collision union', () => {
    for (const channel of channels) {
      const sections = lavaSections(channel, .6);
      const capsules = lavaCollisionSegments(channel);
      if (channel.kind === 'pool') {
        expect(sections[0]!.halfWidth).toBeCloseTo(0);
        expect(sections.at(-1)!.halfWidth).toBeCloseTo(0);
        expect(Math.max(...sections.map(s => s.halfWidth))).toBeGreaterThan(4);
      }
      for (const section of sections) {
        for (const fraction of [-1, -.5, 0, .5, 1]) {
          const x = section.x - section.tz * section.halfWidth * fraction;
          const z = section.z + section.tx * section.halfWidth * fraction;
          expect(capsules.some(c => segmentDistance(x, z, c.from, c.to) <= c.radius + .02),
            `${channel.id} edge ${section.progress}:${fraction}`).toBe(true);
        }
      }
    }
    expect(ground(1, -9)).toBeCloseTo(-1.5, 3);
    expect(ground(-3, -24)).toBeCloseTo(-1.5, 3);
    expect(ground(0, 10)).toBe(0);
    expect(isMoltenLavaAt(1, -9, channels)).toBe(true);
    expect(lavaObstacles(channels, ground).every(solid => solid.id.startsWith('lava:'))).toBe(true);
  });

  it('keeps the depth palette continuous and produces independent repeatable basin shapes', () => {
    const ordinary = WILDERNESS_LAVA_EXPANSION_CHANNELS.find(c => c.id === 'veilburn-river')!;
    expect(lavaMagicAt(ordinary, 0, 620)).toBe(0);
    expect(lavaMagicAt(ordinary, 0, 840)).toBe(1);
    for (let z = 640; z < 830; z += .5) {
      expect(Math.abs(lavaMagicAt(ordinary, 80, z + .5) - lavaMagicAt(ordinary, 80, z))).toBeLessThan(.007);
    }
    const pools = WILDERNESS_LAVA_EXPANSION_CHANNELS.filter(c => c.kind === 'pool');
    const shapes = pools.map(pool => lavaSections(pool).map(row => Number(row.halfWidth.toFixed(3))).join(','));
    expect(new Set(shapes).size).toBe(pools.length);
    expect(lavaSections(pools[0]!)).toEqual(lavaSections(pools[0]!));
    expect(pools.every(pool => pool.magic === undefined)).toBe(true);
  });
});

describe('production deep lava rendering', () => {
  it('applies distinct authored torch themes to the actual lights, flames and sparks', () => {
    const themes = ['ember', 'azure', 'violet'] as const;
    const spy = vi.spyOn(Ambience.prototype, 'addEmitter');
    const torches: WildernessTorch[] = themes.map((theme, index) => ({ id: theme,
      theme, magic: 1, position: [index * 3, 1.5, 0], support: 'brazier' }));
    const effects = new WildernessEffects(new THREE.Scene(), { groundHeightAt: () => 0, channels: [], torches });
    try {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(3, 2, 4); camera.updateMatrixWorld(); effects.update(1, camera);
      const expected = {
        ember: { light: 0xffa257, flame: [1, .52, .14], spark: [1, .42, .09] },
        azure: { light: 0x447cff, flame: [.07, .34, 1], spark: [.09, .42, 1] },
        violet: { light: 0x9865ff, flame: [.38, .17, 1], spark: [.32, .20, 1] },
      };
      for (const theme of themes) {
        const flame = spy.mock.calls.find(([emitter]) => emitter.id === `wilderness:${theme}:flame`)![0];
        const sparks = spy.mock.calls.find(([emitter]) => emitter.id === `wilderness:${theme}:embers`)![0];
        expect(flame.colour).toEqual(expected[theme].flame);
        expect(sparks.colour).toEqual(expected[theme].spark);
        const slot = effects.getState().lights.findIndex(light => light.id === theme);
        const light = effects.group.getObjectByName(`wilderness-light-${slot}`) as THREE.PointLight;
        expect(light.color.getHex()).toBe(expected[theme].light);
      }
      expect(wildernessTorchPalette({}).light).toBe(expected.ember.light);
      expect(wildernessTorchPalette({ magic: 1 }).light).toBe(expected.violet.light);
      expect(wildernessTorchPalette({ magic: .5 }).light).not.toBe(expected.ember.light);
      expect(effects.getState().lightBudget).toBe(6);
    } finally { effects.dispose(); spy.mockRestore(); }
  });

  it('opens bank mouths at forks, exposes both palettes, and retains a fixed six-light budget', () => {
    const scene = new THREE.Scene();
    const effects = new WildernessEffects(scene, { groundHeightAt: ground, channels,
      torches: deepWildernessEffectsLabTorches(ground), maxLights: 60 });
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(24, 5, -22); camera.updateMatrixWorld();
    effects.update(2, camera);
    const state = effects.getState();
    expect(state.pools).toBe(2);
    expect(state.paletteRange).toEqual([0, 1]);
    expect(state.lightBudget).toBe(6);
    expect(state.liveParticles).toBeGreaterThan(0);
    expect(state.dryApronTriangles).toBeGreaterThan(0);
    effects.group.updateMatrixWorld(true);
    const downward = new THREE.Vector3(0, -1, 0);
    for (const channel of channels) {
      const bank = effects.group.getObjectByName(`wilderness-lava-banks-${channel.id}`) as THREE.Mesh;
      const positions = bank.geometry.getAttribute('position');
      const other = channels.filter(c => c !== channel);
      for (const index of bank.geometry.index!.array) {
        expect(isMoltenLavaAt(positions.getX(index), positions.getZ(index), other, .02), channel.id).toBe(false);
      }
      const molten = effects.group.getObjectByName(`wilderness-lava-${channel.id}`) as THREE.Mesh;
      const magic = molten.geometry.getAttribute('lavaMagic');
      expect(magic.getX(0)).toBe(channel.magic);
      const vertices = molten.geometry.getAttribute('position');
      for (let i = 0; i < vertices.count; i++) {
        expect(vertices.getY(i) - ground(vertices.getX(i), vertices.getZ(i))).toBeCloseTo(.075, 4);
      }
      const apron = effects.group.getObjectByName(`wilderness-lava-apron-${channel.id}`) as THREE.Mesh;
      // Full-width dry banks and end caps must be covered even where the raised berms diverge.
      for (const section of lavaSections(channel, 3)) {
        for (const side of [-1, 1]) {
          const lateral = side * (section.halfWidth + channel.bankWidth * .95);
          const x = section.x - section.tz * lateral, z = section.z + section.tx * lateral;
          if (lavaClearanceAt(x, z, [channel]) > .5) continue;
          const ray = new THREE.Raycaster(new THREE.Vector3(x, ground(x, z) + 10, z), downward, 0, 20);
          const hit = ray.intersectObject(apron, false)[0];
          expect(hit, `${channel.id} dry shore ${section.progress}:${side}`).toBeDefined();
          expect(hit!.point.y - ground(x, z)).toBeGreaterThan(-.015);
          expect(hit!.point.y - ground(x, z)).toBeLessThan(.15);
        }
      }
    }
    const lights = effects.group.children.filter(c => (c as THREE.PointLight).isPointLight);
    camera.position.set(900, 5, 900); camera.updateMatrixWorld(); effects.update(3, camera);
    expect(effects.getState().lights.every(light => light.intensity === 0)).toBe(true);
    expect(effects.getState().liveParticles).toBe(0);
    expect(lights.every(light => light.visible)).toBe(true);
    effects.dispose();
    expect(scene.children).not.toContain(effects.group);
  });
});
