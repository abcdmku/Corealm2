import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { FairyArchitecture, FAIRY_LAMP_LIGHT_BUDGET, fairyArchitectureSurface, createFairyMarketCanopyGeometry } from '../game/src/render/fairyArchitecture.js';
import { buildPrefab, prefabCollision, variantSeed, type PartPlacement } from '../game/src/render/buildings.js';
import { LANTERN_MARKET_COUNTER_Y, LANTERN_MARKET_SEED } from '../game/src/render/structures/fairyStructureParts.js';

describe('fairy structure presentation', () => {
  it('keeps source maps and materials intact while separating the two fairy palettes', () => {
    const style = new FairyArchitecture();
    const source = new THREE.MeshStandardMaterial({ name: 'MI_Plaster', map: new THREE.Texture(), normalMap: new THREE.Texture(), aoMap: new THREE.Texture(), roughnessMap: new THREE.Texture() });
    const warm = style.material(source, 'wall_plaster_straight', 'gloamgarden') as THREE.MeshStandardMaterial;
    const cool = style.material(source, 'wall_plaster_straight', 'faeholme') as THREE.MeshStandardMaterial;
    expect(warm).not.toBe(source);
    expect(warm.map).toBe(source.map);
    expect(warm.normalMap).toBe(source.normalMap);
    expect(warm.aoMap).toBe(source.aoMap);
    expect(warm.roughnessMap).toBe(source.roughnessMap);
    expect(warm.customProgramCacheKey()).not.toBe(cool.customProgramCacheKey());
    expect(style.material(source, 'wall_plaster_straight', 'gloamgarden')).toBe(warm);
    expect(style.material(source, 'wall_plaster_straight', 'fallowmarch')).toBeNull();
    expect(source.color.getHex()).toBe(0xffffff);
    style.dispose();
  });

  it('lights the actual window pane without making the frame or wall emissive', () => {
    const style = new FairyArchitecture();
    const glass = new THREE.MeshStandardMaterial({ name: 'MI_WindowGlass', transparent: true, opacity: .095 });
    const lit = style.material(glass, 'window_wide', 'gloamgarden') as THREE.MeshStandardMaterial;
    expect(lit.opacity).toBe(1);
    expect(lit.transparent).toBe(false);
    // Guard against the previous pale diffuse + HDR emission that washed panes white.
    const radiance = lit.emissive.clone().multiplyScalar(lit.emissiveIntensity);
    expect(lit.emissiveIntensity).toBeGreaterThan(.3);
    expect(lit.emissiveIntensity).toBeLessThanOrEqual(.8);
    expect(radiance.r).toBeGreaterThan(radiance.g * 2.4);
    expect(radiance.g).toBeGreaterThan(radiance.b * 5);
    expect(.2126 * radiance.r + .7152 * radiance.g + .0722 * radiance.b).toBeLessThan(.4);
    expect(lit.color.r).toBeLessThan(.45);
    const frame = style.material(new THREE.MeshStandardMaterial({ name: 'MI_WoodTrim_Wear' }), 'window_wide', 'gloamgarden') as THREE.MeshStandardMaterial;
    expect(frame.emissive.getHex()).toBe(0);
    expect(glass.opacity).toBe(.095);
    expect(fairyArchitectureSurface('market_stall', 'MI_Banner')).toBe('cloth');
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
    const treated = style.material(source, 'door_round_2', 'gloamgarden') as THREE.MeshStandardMaterial;
    expect(treated).not.toBeNull();
    expect(treated.metalness).toBeLessThan(.25);
    expect(treated.roughness).toBeGreaterThan(.85);
    expect(treated.emissive.getHex()).toBe(0);
    expect(treated.map).toBe(source.map);
    expect(treated.normalMap).toBe(source.normalMap);
    expect(source.metalness).toBe(1);
    expect(style.material(source, 'door_round_2', 'fallowmarch')).toBeNull();
    expect(fairyArchitectureSurface('market_stall', source.name)).toBeNull();
    style.dispose();
  });

  it('uses at most four nearby unshadowed lights and removes them on disposal', () => {
    const style = new FairyArchitecture(), parent = new THREE.Group();
    const positions = Array.from({ length: 20 }, (_, index) => new THREE.Vector3(index * 3, 2, 0));
    style.updateLights(parent, positions, new THREE.Vector3());
    expect(parent.children).toHaveLength(FAIRY_LAMP_LIGHT_BUDGET);
    expect(parent.children.every(light => !(light as THREE.PointLight).castShadow)).toBe(true);
    style.updateLights(parent, [], new THREE.Vector3());
    expect(parent.children.every(light => (light as THREE.PointLight).intensity === 0)).toBe(true);
    style.dispose();
    expect(parent.children).toHaveLength(0);
  });

  it('gives the authored market three staggered counters and keeps generic rows unchanged', () => {
    const market = buildPrefab('market_row', [12, 3], LANTERN_MARKET_SEED, 'timber');
    const stalls = market.filter(part => part.assetId === 'market_stall');
    expect(stalls.map(part => [part.dx, part.dz, part.rotationY])).toEqual([[-4.2, 2, .15], [0, -.8, 0], [4.2, 2, -.18]]);
    expect(market.filter(part => part.assetId === 'lamp_wall')).toHaveLength(3);
    expect(market.filter(part => part.tag.startsWith('fairy_stall_rear_post_'))).toHaveLength(6);
    expect(new Set(market.map(part => part.tag)).size).toBe(market.length);
    expect(market.filter(part => /_counter_/.test(part.tag))).toHaveLength(15);
    expect(market.filter(part => /_floor_/.test(part.tag))).toHaveLength(9);
    expect(market.filter(part => /_counter_apples$/.test(part.tag)).every(part => Math.abs(part.dy - .016 * part.scale - LANTERN_MARKET_COUNTER_Y) < .00001)).toBe(true);
    const ordinary = buildPrefab('market_row', [9, 3], 4, 'timber').filter(part => part.assetId === 'market_stall');
    expect(new Set(ordinary.map(part => part.dz)).size).toBe(1);
    expect(ordinary.every(part => part.rotationY === 0)).toBe(true);
  });

  it('contains the real GLB geometry in three curved counter boxes and six rear-post boxes', async () => {
    const seed = variantSeed('lantern_rest_shelter');
    expect(seed).toBe(LANTERN_MARKET_SEED);
    const parts = buildPrefab('market_row', [12, 3], seed, 'timber');
    const boxes = prefabCollision('market_row', [12, 3], seed);
    expect(boxes).toHaveLength(9);
    expect(boxes.filter(box => /^pitch\d+$/.test(box.tag))).toHaveLength(3);
    expect(boxes.filter(box => /_rear_/.test(box.tag))).toHaveLength(6);
    const io = new NodeIO();
    const sources = new Map(await Promise.all([
      ['market_stall', 'prop'], ['corner_wood', 'building'],
    ].map(async ([assetId, category]) => [assetId!, await io.read(`game/public/assets/models/${category}/${assetId}.glb`)] as const)));
    const placementMatrix = (part: PartPlacement) => new THREE.Matrix4().compose(
      new THREE.Vector3(part.dx, part.dy, part.dz),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), part.rotationY),
      new THREE.Vector3(...(part.scaleAxes ?? [1, 1, 1])).multiplyScalar(part.scale),
    );
    for (const part of parts.filter(part => part.assetId === 'market_stall' || part.tag.startsWith('fairy_stall_rear_post_'))) {
      const counterIndex = /^stall(\d+)$/.exec(part.tag);
      const postIndex = /^fairy_stall_rear_post_(\d+)_(-?1)$/.exec(part.tag);
      const boxTag = counterIndex ? `pitch${counterIndex[1]}` : `pitch${postIndex![1]}_rear_${postIndex![2] === '-1' ? 0 : 1}`;
      const box = boxes.find(box => box.tag === boxTag)!;
      expect(box, part.tag).toBeDefined();
      if (counterIndex) expect(box.height).toBe(1.25);
      const transform = placementMatrix(part);
      let maxHorizontalOverrun = 0, maxPostY = 0, testedVertices = 0;
      for (const node of sources.get(part.assetId)!.getRoot().listNodes()) {
        const mesh = node.getMesh();
        if (!mesh) continue;
        const matrix = transform.clone().multiply(new THREE.Matrix4().fromArray(node.getWorldMatrix()));
        for (const primitive of mesh.listPrimitives()) {
          const position = primitive.getAttribute('POSITION')!;
          for (let vertex = 0; vertex < position.getCount(); vertex++) {
            const local = position.getElement(vertex, []);
            const point = new THREE.Vector3(local[0], local[1], local[2]).applyMatrix4(matrix);
            maxHorizontalOverrun = Math.max(maxHorizontalOverrun,
              Math.abs(point.x - box.dx) - box.sizeX / 2, Math.abs(point.z - box.dz) - box.sizeZ / 2);
            if (postIndex) maxPostY = Math.max(maxPostY, point.y);
            testedVertices++;
          }
        }
      }
      expect(testedVertices).toBeGreaterThan(20);
      expect(maxHorizontalOverrun, part.tag).toBeLessThan(.00001);
      if (postIndex) expect(maxPostY, part.tag).toBeLessThanOrEqual(box.height + .00001);
    }
  });

  it('puts a supported cloth roof over the counter with a clear walking height and textured UVs', () => {
    const geometry = createFairyMarketCanopyGeometry();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(2.9);
    expect(size.z).toBeGreaterThan(2.2);
    expect(geometry.boundingBox!.min.y).toBeGreaterThan(2.1);
    expect(geometry.boundingBox!.max.y).toBeLessThan(2.9);
    const pos = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
    expect(pos.count).toBe(uv.count);
    expect(Array.from(pos.array).every(Number.isFinite)).toBe(true);
    const style = new FairyArchitecture();
    const source = new THREE.MeshStandardMaterial({ name: 'MI_Banner', map: new THREE.Texture(), normalMap: new THREE.Texture(), vertexColors: true });
    const canopy = style.marketCanopyPart(source, 'gloamgarden');
    expect((canopy.material as THREE.MeshStandardMaterial).map).toBe(source.map);
    expect((canopy.material as THREE.MeshStandardMaterial).normalMap).toBe(source.normalMap);
    expect(canopy.material.vertexColors).toBe(false);
    expect(source.vertexColors).toBe(true);
    geometry.dispose();
    style.dispose();
  });

  it('drapes above sampled native frame triangles and both rear post caps without timber cutting the cloth', async () => {
    const parts = buildPrefab('market_row', [12, 3], LANTERN_MARKET_SEED, 'timber');
    const stall = parts.find(part => part.tag === 'stall1')!;
    const supports = [stall, ...parts.filter(part => part.tag.startsWith('fairy_stall_rear_post_1_'))];
    expect(supports).toHaveLength(3);
    const io = new NodeIO();
    const documents = new Map(await Promise.all([
      ['market_stall', 'prop'], ['corner_wood', 'building'],
    ].map(async ([assetId, category]) => [assetId!, await io.read(`game/public/assets/models/${category}/${assetId}.glb`)] as const)));
    const geometry = createFairyMarketCanopyGeometry();
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const canopy = new THREE.Mesh(geometry, material);
    canopy.position.set(stall.dx, stall.dy, stall.dz);
    canopy.rotation.y = stall.rotationY;
    canopy.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    let minimumClearance = Infinity, maximumPostCapGap = 0, samples = 0;
    const roofAt = (x: number, z: number) => {
      ray.ray.origin.set(x, 4, z);
      const hits = ray.intersectObject(canopy, false);
      expect(hits.length, `roof coverage at ${x.toFixed(3)},${z.toFixed(3)}`).toBeGreaterThan(0);
      return hits[0]!.point.y;
    };
    for (const part of supports) {
      const transform = new THREE.Matrix4().compose(new THREE.Vector3(part.dx, part.dy, part.dz),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), part.rotationY),
        new THREE.Vector3(...(part.scaleAxes ?? [1, 1, 1])).multiplyScalar(part.scale));
      for (const node of documents.get(part.assetId)!.getRoot().listNodes()) {
        const mesh = node.getMesh();
        if (!mesh) continue;
        const matrix = transform.clone().multiply(new THREE.Matrix4().fromArray(node.getWorldMatrix()));
        for (const primitive of mesh.listPrimitives()) {
          if (primitive.getMaterial()?.getName() !== 'MI_Trim_Furniture' && part === stall) continue;
          const positions = primitive.getAttribute('POSITION')!, indices = primitive.getIndices()!;
          for (let triangle = 0; triangle < indices.getCount(); triangle += 3) {
            const vertices = [0, 1, 2].map(corner => {
              const source = positions.getElement(indices.getScalar(triangle + corner), []);
              return new THREE.Vector3(source[0], source[1], source[2]).applyMatrix4(matrix);
            });
            if (Math.max(...vertices.map(vertex => vertex.y)) < 2.2) continue;
            // Wide crossbars need interior samples: their endpoints were clear while the old
            // cloth sag cut through the middle of each long native triangle.
            for (let a = 0; a <= 8; a++) for (let b = 0; b <= 8 - a; b++) {
              const point = vertices[0]!.clone().multiplyScalar(a / 8)
                .addScaledVector(vertices[1]!, b / 8).addScaledVector(vertices[2]!, 1 - (a + b) / 8);
              if (point.y < 2.2) continue;
              const gap = roofAt(point.x, point.z) - point.y;
              minimumClearance = Math.min(minimumClearance, gap);
              if (part !== stall && point.y > 2.799) maximumPostCapGap = Math.max(maximumPostCapGap, gap);
              samples++;
            }
          }
        }
      }
    }
    expect(samples).toBeGreaterThan(200);
    expect(minimumClearance).toBeGreaterThan(.005);
    expect(maximumPostCapGap).toBeLessThan(.04);
    const rear = roofAt(stall.dx, stall.dz - .85), front = roofAt(stall.dx, stall.dz + .4);
    const middle = roofAt(stall.dx, stall.dz - .225);
    expect((rear + front) / 2 - middle).toBeGreaterThan(.07);
    expect((rear + front) / 2 - middle).toBeLessThan(.15);
    geometry.dispose();
    material.dispose();
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
