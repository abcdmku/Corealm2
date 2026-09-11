import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WildernessCreatureEffects, type WildernessCreatureEmitter } from '../game/src/render/wildernessCreatureEffects.js';

function cameraAt(x = 0, y = 3, z = 11): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(55, 1.6, .1, 200);
  camera.position.set(x, y, z);
  camera.lookAt(x, 1, z - 11);
  camera.updateMatrixWorld(true);
  return camera;
}

function batch(effects: WildernessCreatureEffects): THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> {
  return effects.group.getObjectByName('wilderness-creature-fissure-fragments') as
    THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
}

function particles(effects: WildernessCreatureEffects): number[] {
  const mesh = batch(effects);
  return Array.from(mesh.geometry.getAttribute('centreSize').array)
    .slice(0, mesh.geometry.instanceCount * 4);
}

describe('Wilderness creature emission', () => {
  it('keeps dense encounters in one bounded batch and selects the same nearest actors in any input order', () => {
    const effects = new WildernessCreatureEffects(new THREE.Scene());
    const camera = cameraAt();
    const actors: WildernessCreatureEmitter[] = Array.from({ length: 40 }, (_, i) => ({
      id: `archon-${String(i).padStart(2, '0')}`, position: { x: 0, y: 0, z: 1 - i * .4 }, hero: true,
    }));
    const mesh = batch(effects);
    const storage = mesh.geometry.getAttribute('centreSize').array;
    effects.update(10, camera, actors);
    const first = effects.getState();
    expect(first.emitters.map(row => row.id)).toEqual(actors.slice(0, 16).map(actor => actor.id));
    expect(first.nearbyCandidates).toBe(40);
    expect(first.budgetCulled).toBe(24);
    expect(first.liveParticles).toBeGreaterThan(300);
    expect(first.liveParticles).toBeLessThanOrEqual(384);
    const firstParticles = particles(effects);
    effects.update(10, camera, [...actors].reverse());
    expect(effects.getState()).toEqual(first);
    expect(particles(effects)).toEqual(firstParticles);
    expect(mesh.geometry.getAttribute('centreSize').array).toBe(storage);
    expect(effects.group.children).toHaveLength(1);
    expect(effects.group.children.some(child => (child as THREE.Light).isLight)).toBe(false);
    effects.dispose();
  });

  it('removes distant and offscreen emitters before they can consume the nearby budget', () => {
    const effects = new WildernessCreatureEffects(new THREE.Scene());
    const camera = cameraAt();
    effects.update(5, camera, [
      { id: 'visible', position: { x: 0, y: 0, z: 0 } },
      { id: 'distant', position: { x: 0, y: 0, z: -60 } },
      { id: 'behind-camera', position: { x: 0, y: 0, z: 20 } },
      { id: 'outside-view', position: { x: 30, y: 0, z: 8 } },
      { id: 'invalid', position: { x: NaN, y: 0, z: 0 } },
    ]);
    expect(effects.getState().emitters.map(row => row.id)).toEqual(['visible']);
    expect(effects.getState().liveParticles).toBeGreaterThan(0);
    camera.position.set(300, 3, 300);
    camera.updateMatrixWorld();
    effects.update(5.2, camera, [{ id: 'visible', position: { x: 0, y: 0, z: 0 } }]);
    expect(effects.getState().liveParticles).toBe(0);
    expect(batch(effects).visible).toBe(false);
    expect(batch(effects).geometry.instanceCount).toBe(0);
    effects.dispose();
  });

  it('reconstructs the same motion after streaming and follows the current actor position', () => {
    const effects = new WildernessCreatureEffects(new THREE.Scene());
    const camera = cameraAt();
    const actor = { id: 'voidstone-7', position: { x: 0, y: 0, z: 0 }, scale: 1.4 };
    effects.update(18.4, camera, [actor]);
    const first = particles(effects);
    effects.update(18.8, camera, [actor]);
    expect(particles(effects)).not.toEqual(first);
    effects.update(20, camera, []);
    effects.update(18.4, camera, [actor]);
    expect(particles(effects)).toEqual(first);
    actor.position = { x: 2, y: .5, z: 1 };
    effects.update(18.4, camera, [actor]);
    const moved = particles(effects);
    expect(moved).toHaveLength(first.length);
    for (let i = 0; i < moved.length; i += 4) {
      expect(moved[i]! - first[i]!).toBeCloseTo(2, 5);
      expect(moved[i + 1]! - first[i + 1]!).toBeCloseTo(.5, 5);
      expect(moved[i + 2]! - first[i + 2]!).toBeCloseTo(1, 5);
      expect(moved[i + 3]).toBe(first[i + 3]);
    }
    effects.dispose();
  });

  it('fades approaching the distance boundary while preserving particle size and material identity', () => {
    const effects = new WildernessCreatureEffects(new THREE.Scene());
    const actor = { id: 'rift-carapace', position: { x: 0, y: 0, z: 0 } };
    const near = cameraAt(0, 3, 11), far = cameraAt(0, 3, 32);
    far.lookAt(0, 1, 0); far.updateMatrixWorld();
    const mesh = batch(effects), material = mesh.material;
    effects.update(7, near, [actor]);
    const nearAlphas = Array.from(mesh.geometry.getAttribute('tintAlpha').array)
      .slice(0, mesh.geometry.instanceCount * 4).filter((_, i) => i % 4 === 3);
    effects.update(7, far, [actor]);
    const farAlphas = Array.from(mesh.geometry.getAttribute('tintAlpha').array)
      .slice(0, mesh.geometry.instanceCount * 4).filter((_, i) => i % 4 === 3);
    expect(Math.max(...farAlphas)).toBeLessThan(Math.max(...nearAlphas) * .4);
    expect(Math.max(...farAlphas)).toBeGreaterThan(0);
    expect(mesh.material).toBe(material);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(mesh.userData['magicGlow']).toBe(false);
    effects.dispose();
  });

  it('uses cool arcane colours and lets heroes emit more fragments without changing shaders', () => {
    const effects = new WildernessCreatureEffects(new THREE.Scene());
    const camera = cameraAt();
    const actor: WildernessCreatureEmitter = { id: 'hollow-star', position: { x: 0, y: 0, z: 0 } };
    effects.update(12, camera, [actor]);
    const ordinary = effects.getState().liveParticles;
    const mesh = batch(effects), material = mesh.material;
    const colour = mesh.geometry.getAttribute('tintAlpha');
    expect(colour.getZ(0)).toBeGreaterThan(colour.getX(0));
    effects.update(12, camera, [{ ...actor, hero: true }]);
    expect(effects.getState().liveParticles).toBeGreaterThan(ordinary);
    effects.update(12, camera, [{ ...actor, palette: 'ember' }]);
    expect(colour.getX(0)).toBeGreaterThan(colour.getZ(0));
    expect(mesh.material).toBe(material);
    effects.dispose();
  });

  it('clears stale emission on disable, death/removal and disposal, and releases GPU resources once', () => {
    const parent = new THREE.Scene();
    const effects = new WildernessCreatureEffects(parent);
    const camera = cameraAt();
    const actors = [{ id: 'keeper', position: { x: 0, y: 0, z: 0 } }];
    const mesh = batch(effects);
    let geometryDisposals = 0, materialDisposals = 0;
    mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
    mesh.material.addEventListener('dispose', () => materialDisposals++);
    effects.update(1, camera, actors);
    effects.setEnabled(false);
    expect(effects.getState().liveParticles).toBe(0);
    expect(effects.getState().emitters).toEqual([]);
    expect(effects.group.visible).toBe(false);
    effects.update(2, camera, actors);
    expect(effects.getState().liveParticles).toBe(0);
    effects.setEnabled(true);
    effects.update(3, camera, actors);
    expect(effects.getState().liveParticles).toBeGreaterThan(0);
    effects.update(4, camera, []);
    expect(effects.getState().liveParticles).toBe(0);
    effects.update(NaN, camera, actors);
    expect(effects.getState().seconds).toBe(4);
    effects.dispose(); effects.dispose();
    effects.setEnabled(true); effects.update(5, camera, actors);
    expect(effects.getState().ready).toBe(false);
    expect(effects.getState().liveParticles).toBe(0);
    expect(parent.children).not.toContain(effects.group);
    expect(geometryDisposals).toBe(1);
    expect(materialDisposals).toBe(1);
  });
});
