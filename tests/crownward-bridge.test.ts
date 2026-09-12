import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SemanticEntity } from '../game/src/contracts.js';
import { buildCrownwardBridge, CROWNWARD_BRIDGE } from '../game/src/render/compositions/crownwardBridge.js';
import { buildCrownwardBridgeNavigationSources } from '../game/src/render/crownwardBridgeNavigation.js';

function bridge(id = 'bridge#premade_bridge'): SemanticEntity {
  return { id, archetype: 'landmark', name: 'Medieval bridge', tier: 40, regionId: 'crownward',
    position: [30, 2, 50], state: 'dormant', interactions: ['inspect'],
    view: { assetId: CROWNWARD_BRIDGE.assetId, scale: 2, rotationY: Math.PI / 2, scaleAxes: [1, 2, 1] } };
}

describe('Crownward imported bridge', () => {
  it('fits the 24 m crossing without nonuniformly stretching the arched deck', () => {
    const [part] = buildCrownwardBridge();
    const asset = JSON.parse(readFileSync('tools/medieval-bridge/catalog.json', 'utf8')).assets[0];
    const profile = asset.metadata.inspection.deckProfile as {x: number; y: number | null}[];
    expect(part!.scale * asset.size.x).toBeCloseTo(24, 5);
    expect(part!.scaleAxes).toBeUndefined();
    const approaches = profile.filter(row => Math.abs(row.x) > 3.2 && row.y !== null);
    expect(approaches.length).toBeGreaterThan(2);
    expect(approaches.every(row => Math.abs(part!.dy + row.y! * part!.scale) < .15)).toBe(true);
    const crown = Math.max(...profile.filter(row => row.y !== null).map(row => part!.dy + row.y! * part!.scale));
    expect(crown).toBeGreaterThan(1.8);
    expect(crown).toBeLessThan(2.1);
    expect(CROWNWARD_BRIDGE.approaches[0][0]).toBeLessThan(-12);
    expect(CROWNWARD_BRIDGE.approaches[1][0]).toBeGreaterThan(12);
  });

  it('preserves the source arch and rails, normalization and placed transform for both crossings', async () => {
    const source = new THREE.Group();
    source.position.set(0, 0.275519, -0.0695965);
    const deckGeometry = new THREE.BufferGeometry();
    deckGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-3, 0, 0, 0, 1.36, 0, 3, 0, 0], 3));
    const deck = new THREE.Mesh(deckGeometry); deck.name = 'ArchedDeck';
    const rail = new THREE.Mesh(new THREE.BoxGeometry(6, 1, .1)); rail.name = 'Rail';
    source.add(deck, rail);
    let loads = 0;
    const second = bridge('second#premade_bridge'); second.position = [80, 3, 90];
    const result = await buildCrownwardBridgeNavigationSources({
      load: async () => { loads++; return source; }, instance: () => source.clone(true),
    }, [bridge(), second]);
    expect(loads).toBe(1);
    expect(result.roots).toHaveLength(2);
    expect(result.meshes.map(mesh => mesh.name)).toEqual(['ArchedDeck', 'Rail', 'ArchedDeck', 'Rail']);
    expect(result.meshes[0]!.geometry).toBe(deckGeometry);
    const expected = new THREE.Vector3(0, 1.36, 0).add(source.position)
      .multiply(new THREE.Vector3(2, 4, 2)).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
      .add(new THREE.Vector3(30, 2, 50));
    const actual = new THREE.Vector3(0, 1.36, 0).applyMatrix4(result.meshes[0]!.matrixWorld);
    expect(actual.distanceTo(expected)).toBeLessThan(1e-8);
    expect(result.meshes.every(mesh => mesh.userData['structureNavigation'] === mesh.userData['structureCamera'])).toBe(true);
    expect(source.position.toArray()).toEqual([0, .275519, -.0695965]);
  });

  it('does not load a bridge for unrelated structure entities', async () => {
    const other = bridge(); other.view!.assetId = 'white_knight_castle';
    const result = await buildCrownwardBridgeNavigationSources({
      load: async () => { throw new Error('Unexpected asset load'); }, instance: () => new THREE.Group(),
    }, [other]);
    expect(result).toEqual({ roots: [], meshes: [] });
  });
});
