import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { ensureNodeMaterial } from '../game/src/render/nodeMaterials.js';
import { createCastleStoneMaterial } from '../game/src/render/castleStoneMaterial.js';
import { NodeIO } from '@gltf-transform/core';
import { FairyArchitecture, FAIRY_LAMP_LIGHT_BUDGET, fairyArchitectureSurface } from '../game/src/render/fairyArchitecture.js';
import { buildPrefab, prefabCollision, variantSeed } from '../game/src/render/buildings.js';
import { LANTERN_MARKET_SEED } from '../game/src/render/structures/fairyStructureParts.js';

describe('fairy structure presentation', () => {
  it.each(['imported', 'node'] as const)('keeps %s source maps intact while separating the two fairy palettes', kind => {
    const style = new FairyArchitecture();
    const imported = new THREE.MeshStandardMaterial({ name: 'MI_Plaster', map: new THREE.Texture(), normalMap: new THREE.Texture(), aoMap: new THREE.Texture(), roughnessMap: new THREE.Texture() });
    const source = kind === 'node' ? ensureNodeMaterial(imported) as MeshStandardNodeMaterial : imported;
    const warm = style.material(source, 'wall_plaster_straight', 'gloamgarden') as MeshStandardNodeMaterial;
    const cool = style.material(source, 'wall_plaster_straight', 'faeholme') as MeshStandardNodeMaterial;
    expect(warm).not.toBe(source);
    expect(warm.map).toBe(source.map);
    expect(warm.normalMap).toBe(source.normalMap);
    expect(warm.aoMap).toBe(source.aoMap);
    expect(warm.roughnessMap).toBe(source.roughnessMap);
    expect((warm as MeshStandardNodeMaterial).isMeshStandardNodeMaterial).toBe(true);
    expect((warm as MeshStandardNodeMaterial).colorNode).not.toBeNull();
    expect((cool as MeshStandardNodeMaterial).colorNode).not.toBe((warm as MeshStandardNodeMaterial).colorNode);
    expect(style.material(source, 'wall_plaster_straight', 'gloamgarden')).toBe(warm);
    expect(style.material(source, 'wall_plaster_straight', 'fallowmarch')).toBeNull();
    expect(source.color.getHex()).toBe(0xffffff);
    style.dispose();
  });

  it.each(['pearl', 'cinder'] as const)('applies %s castle stone after imported material conversion', stoneStyle => {
    const source = ensureNodeMaterial(new THREE.MeshStandardMaterial({ map: new THREE.Texture(), roughness: .73 }));
    const stone = createCastleStoneMaterial(source, stoneStyle, { paletteMask: true }) as MeshStandardNodeMaterial;
    expect(stone).not.toBe(source);
    expect(stone.isMeshStandardNodeMaterial).toBe(true);
    expect(stone.colorNode).not.toBeNull();
    expect(stone.normalNode).not.toBeNull();
    expect(stone.userData.corealmCastleStone).toMatchObject({ style: stoneStyle, paletteMask: true });
    expect(source.colorNode).toBeNull();
    stone.dispose();
    source.dispose();
  });

  it('lights the actual window pane without making the frame or wall emissive', () => {
    const style = new FairyArchitecture();
    const glass = new THREE.MeshStandardMaterial({ name: 'MI_WindowGlass', transparent: true, opacity: .095 });
    const lit = style.material(glass, 'window_wide', 'gloamgarden') as MeshStandardNodeMaterial;
    expect(lit.opacity).toBe(1);
    expect(lit.transparent).toBe(false);
    expect((lit as MeshStandardNodeMaterial).colorNode).not.toBeNull();
    expect((lit as MeshStandardNodeMaterial).emissiveNode).not.toBeNull();
    // Guard against the previous pale diffuse + HDR emission that washed panes white.
    const radiance = lit.emissive.clone().multiplyScalar(lit.emissiveIntensity);
    expect(lit.emissiveIntensity).toBeGreaterThan(.3);
    expect(lit.emissiveIntensity).toBeLessThanOrEqual(.8);
    expect(radiance.r).toBeGreaterThan(radiance.g * 2.4);
    expect(radiance.g).toBeGreaterThan(radiance.b * 5);
    expect(.2126 * radiance.r + .7152 * radiance.g + .0722 * radiance.b).toBeLessThan(.4);
    expect(lit.color.r).toBeLessThan(.45);
    const frame = style.material(new THREE.MeshStandardMaterial({ name: 'MI_WoodTrim_Wear' }), 'window_wide', 'gloamgarden') as MeshStandardNodeMaterial;
    expect(frame.emissive.getHex()).toBe(0);
    expect(glass.opacity).toBe(.095);
    expect(fairyArchitectureSurface('banner_1', 'MI_Banner')).toBe('cloth');
    style.dispose();
  });

  it('fits one shared amber insert inside the measured native lamp cage', () => {
    const style = new FairyArchitecture();
    const part = style.lanternPart();
    part.geometry.computeBoundingBox();
    const bounds = part.geometry.boundingBox!.clone().applyMatrix4(part.matrix);
    expect(bounds.min.y).toBeCloseTo(.17);
    expect(bounds.max.y).toBeCloseTo(.5);
    expect(bounds.min.z).toBeGreaterThan(.66);
    expect(bounds.max.z).toBeLessThan(.96);
    expect(style.lanternPart().geometry).toBe(part.geometry);
    const radiance = part.material.emissive.clone().multiplyScalar(part.material.emissiveIntensity);
    expect(part.material.emissiveIntensity).toBeGreaterThan(.7);
    expect(part.material.emissiveIntensity).toBeLessThanOrEqual(1);
    expect(radiance.r).toBeGreaterThan(radiance.g * 2.4);
    expect(radiance.g).toBeGreaterThan(radiance.b * 5);
    expect(.2126 * radiance.r + .7152 * radiance.g + .0722 * radiance.b).toBeLessThan(.5);
    style.dispose();
  });

  it('gives the real cottage door grille a rough warm iron treatment only in fairy regions', async () => {
    const document = await new NodeIO().read('game/public/assets/models/building/door_round_2.glb');
    const ornament = document.getRoot().listMaterials().find(material => material.getName() === 'MI_MetalOrnaments')!;
    expect(ornament).toBeDefined();
    const source = new THREE.MeshStandardMaterial({
      name: ornament.getName(), metalness: ornament.getMetallicFactor(),
      roughness: ornament.getRoughnessFactor(), map: new THREE.Texture(), normalMap: new THREE.Texture(),
    });
    const style = new FairyArchitecture();
    const treated = style.material(source, 'door_round_2', 'gloamgarden') as MeshStandardNodeMaterial;
    expect(treated).not.toBeNull();
    expect(treated.metalness).toBeLessThan(.25);
    expect(treated.roughness).toBeGreaterThan(.85);
    expect(treated.emissive.getHex()).toBe(0);
    expect(treated.map).toBe(source.map);
    expect(treated.normalMap).toBe(source.normalMap);
    expect(source.metalness).toBe(1);
    expect(style.material(source, 'door_round_2', 'fallowmarch')).toBeNull();
    expect(fairyArchitectureSurface('market_stall_cloth', source.name)).toBeNull();
    style.dispose();
  });

  it('uses at most four nearby unshadowed lights and removes them on disposal', () => {
    const style = new FairyArchitecture(), parent = new THREE.Group();
    style.updateLights(parent, [], new THREE.Vector3());
    const reserved = [...parent.children];
    expect(reserved).toHaveLength(FAIRY_LAMP_LIGHT_BUDGET);
    expect(reserved.every(light => light.visible && (light as THREE.PointLight).intensity === 0)).toBe(true);
    const positions = Array.from({ length: 20 }, (_, index) => new THREE.Vector3(index * 3, 2, 0));
    style.updateLights(parent, positions, new THREE.Vector3());
    expect(parent.children).toEqual(reserved);
    expect(parent.children.every(light => (light as THREE.PointLight).intensity > 0)).toBe(true);
    expect(parent.children).toHaveLength(FAIRY_LAMP_LIGHT_BUDGET);
    expect(parent.children.every(light => !(light as THREE.PointLight).castShadow)).toBe(true);
    style.updateLights(parent, [], new THREE.Vector3());
    expect(parent.children.every(light => (light as THREE.PointLight).intensity === 0)).toBe(true);
    style.dispose();
    expect(parent.children).toHaveLength(0);
  });

  it('places three complete imported stalls in the authored market', () => {
    const market = buildPrefab('market_row', [12, 3], LANTERN_MARKET_SEED, 'timber');
    expect(market.map(part => part.assetId)).toEqual([
      'market_stall_cloth', 'market_stall_cosmic', 'market_stall_potion',
    ]);
    expect(market.map(part => [part.dx, part.dz, part.rotationY])).toEqual([
      [-4.2, 2, .15], [0, -.8, 0], [4.2, 2, -.18],
    ]);
    expect(prefabCollision('market_row', [12, 3], LANTERN_MARKET_SEED)).toHaveLength(3);
    expect(new Set(market.map(part => part.tag)).size).toBe(3);
    const ordinary = buildPrefab('market_row', [9, 3], 4, 'timber');
    expect(ordinary).toHaveLength(2);
    expect(ordinary.every(part => part.assetId.startsWith('market_stall_'))).toBe(true);
  });

  it('puts one front door lantern below the eave on each authored fairy cottage', () => {
    for (const id of ['lantern_rest_willow_cottage', 'lantern_rest_moss_cottage', 'lantern_rest_moonpetal_cottage',
      'lantern_rest_orchid_cottage', 'lantern_rest_dewglass_cottage', 'prism_hollow_root_cottage',
      'prism_hollow_orchid_cottage', 'prism_hollow_moon_cottage']) {
      const pieces = buildPrefab('cottage', [6, 4], variantSeed(id), 'timber');
      const lamps = pieces.filter(part => part.assetId === 'lamp_wall');
      expect(lamps, id).toHaveLength(1);
      expect(lamps[0]!.dy + 1.419 * lamps[0]!.scale).toBeLessThan(3.123);
      expect(lamps[0]!.dz).toBeCloseTo(-2.121, 3);
      const steps = pieces.filter(piece => piece.tag.startsWith('fairy_doorstep_'));
      expect(steps).toHaveLength(2);
      expect(steps[0]!.dy + .134).toBeGreaterThan(steps[1]!.dy);
      expect(steps[1]!.dy + .134).toBeLessThan(.3);
    }
    for (const id of ['lantern_rest_moss_cottage', 'lantern_rest_moonpetal_cottage']) {
      const parts = buildPrefab('cottage', [4, 6], variantSeed(id), 'timber');
      const lamp = parts.find(piece => piece.assetId === 'lamp_wall')!;
      expect(lamp.dz).toBeCloseTo(-3.121, 3);
      expect(Math.abs(lamp.dx)).toBeLessThan(2);
      const steps = parts.filter(piece => piece.tag.startsWith('fairy_doorstep_'));
      expect(steps).toHaveLength(2);
      expect(steps[1]!.dz).toBeCloseTo(-3.57, 3);
    }
  });
});
