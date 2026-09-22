import { Group, Matrix4, Object3D, type InstancedBufferAttribute } from 'three';
import { MeshBasicNodeMaterial, NodeFrame, ReferenceNode, type Node } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { AirCurrentSheets } from '../game/src/render/airCurrentSheets.js';
import { EffectInstances } from '../game/src/render/effectInstances.js';
import { isElementalRefractionObject } from '../game/src/render/elementalRefraction.js';
import { lowerToWgsl } from './helpers/wgsl.js';

const shapes = ['crescent', 'spiral', 'jet', 'helix'] as const;
type Sheet = EffectInstances<MeshBasicNodeMaterial>;
function sheets(group: Group): Sheet[] { return group.children as Sheet[]; }
function pair(group: Group, shape: typeof shapes[number]): [Sheet, Sheet] {
  return [group.getObjectByName(`air-current-${shape}`) as Sheet,
    group.getObjectByName(`air-current-refraction-${shape}`) as Sheet];
}
function clocks(root: Node | null): ReferenceNode<'float', Object3D>[] {
  const found = new Set<ReferenceNode<'float', Object3D>>();
  root?.traverse(node => {
    if (node instanceof ReferenceNode && node.property === 'userData.effectClock.value')
      found.add(node as ReferenceNode<'float', Object3D>);
  });
  return [...found];
}

describe('shared air current materials', () => {
  it('uses only eight material graphs across the 36 multiplayer pools', () => {
    const groups = Array.from({ length: 36 }, () => new Group());
    const pools = groups.map(group => new AirCurrentSheets(group, 'air'));
    try {
      expect(groups.flatMap(sheets)).toHaveLength(288);
      expect(new Set(groups.flatMap(group => sheets(group).map(mesh => mesh.material))).size).toBe(8);
      for (const shape of shapes) {
        const [visible, pressure] = pair(groups[0]!, shape);
        expect(visible.material).not.toBe(pressure.material);
        expect(visible.material.userData.magicEmissionPass).toEqual({ value: 0 });
        expect(pressure.material.userData.magicEmissionPass).toBeUndefined();
        expect(isElementalRefractionObject(pressure)).toBe(true);
        expect(visible.userData.magicGlow).toBe(true);
        for (const group of groups.slice(1)) {
          const next = pair(group, shape);
          expect(next[0].material).toBe(visible.material);
          expect(next[1].material).toBe(pressure.material);
        }
      }
    } finally { pools.forEach(pool => pool.dispose()); }
  });

  it('keeps pool clocks and poses independent while visible and pressure draws stay aligned', () => {
    const groups = [new Group(), new Group()] as const;
    const pools = groups.map(group => new AirCurrentSheets(group, 'air'));
    try {
      pools[0]!.begin(2); pools[1]!.begin(9);
      for (const shape of shapes) {
        pools[0]!.put(shape, 4, 5, 6, 2, 3, 4, .8, 13, .2, .3, .4,
          { turns: 2, width: .7, foot: .5, drift: 3 });
        pools[1]!.put(shape, -4, -5, -6, 1, 2, 3, .4, 17);
      }
      pools.forEach(pool => pool.end());
      const expected = new Object3D();
      expected.position.set(4, 5, 6); expected.rotation.set(.3, .2, .4);
      expected.scale.set(2, 3, 4); expected.updateMatrix();
      for (const shape of shapes) {
        const [visible, pressure] = pair(groups[0], shape), [other] = pair(groups[1], shape);
        expect(visible).toBeInstanceOf(EffectInstances);
        expect(visible).not.toHaveProperty('isInstancedMesh');
        expect(visible.geometry).not.toBe(pressure.geometry);
        expect(visible.instanceMatrix).toBe(pressure.instanceMatrix);
        expect(visible.instanceMatrix).not.toBe(other.instanceMatrix);
        for (const name of ['currentLife', 'currentProfile']) {
          expect(visible.geometry.getAttribute(name)).toBe(pressure.geometry.getAttribute(name));
          expect(visible.geometry.getAttribute(name)).not.toBe(other.geometry.getAttribute(name));
        }
        const life = visible.geometry.getAttribute('currentLife') as InstancedBufferAttribute;
        const profile = visible.geometry.getAttribute('currentProfile') as InstancedBufferAttribute;
        expect(life.getX(0)).toBeCloseTo(.8); expect(life.getY(0)).toBe(13);
        expect([profile.getX(0), profile.getY(0), profile.getZ(0), profile.getW(0)])
          .toEqual([2, Math.fround(.7), .5, 3]);
        for (const mesh of [visible, pressure]) {
          const actual = new Matrix4(); mesh.getMatrixAt(0, actual);
          actual.elements.forEach((value, index) => expect(value).toBeCloseTo(expected.matrix.elements[index]!, 5));
          expect(mesh.instanceCount).toBe(1); expect(mesh.visible).toBe(true);
          expect(mesh.userData.effectClock).toBe(visible.userData.effectClock);
          const references = clocks(mesh.material.positionNode);
          expect(references.length).toBeGreaterThan(0);
          for (const reference of references) {
            expect(reference.object).toBeNull();
            const frame = new NodeFrame(); frame.object = mesh;
            expect(reference.updateReference(frame)).toBe(mesh);
            frame.object = other;
            expect(reference.updateReference(frame)).toBe(other);
          }
        }
        expect(visible.userData.effectClock.value).toBe(2);
        expect(other.userData.effectClock.value).toBe(9);
        expect(visible.userData.effectClock).not.toBe(other.userData.effectClock);
      }
      expect(pools[0]!.instances).toBe(8);
      pools[0]!.begin(3); pools[0]!.end();
      expect(pools[0]!.instances).toBe(0); expect(pools[1]!.instances).toBe(8);
      expect(sheets(groups[0]).every(mesh => !mesh.visible)).toBe(true);
    } finally { pools.forEach(pool => pool.dispose()); }
  });

  it('releases both geometry wrappers without invalidating another pool or its emission pass', () => {
    const groups = [new Group(), new Group()] as const;
    const pools = groups.map(group => new AirCurrentSheets(group, 'air'));
    const first = sheets(groups[0]);
    const geometries = first.map(mesh => vi.spyOn(mesh.geometry, 'dispose'));
    const materials = first.map(mesh => vi.spyOn(mesh.material, 'dispose'));
    try {
      pools[0]!.dispose(); pools[0]!.dispose();
      geometries.forEach(dispose => expect(dispose).toHaveBeenCalledOnce());
      materials.forEach(dispose => expect(dispose).not.toHaveBeenCalled());
      expect(groups[0].children).toHaveLength(0); expect(groups[1].children).toHaveLength(8);
      pools[1]!.begin(7); pools[1]!.put('helix', 1, 2, 3, 1, 1, 1, 1, 4); pools[1]!.end();
      const [visible, pressure] = pair(groups[1], 'helix');
      visible.material.userData.magicEmissionPass.value = 1;
      expect(visible.instanceCount).toBe(1); expect(pressure.instanceCount).toBe(1);
      expect(visible.material.userData.magicEmissionPass.value).toBe(1);
      pools[1]!.dispose();
      materials.forEach(dispose => expect(dispose).toHaveBeenCalledOnce());
    } finally { pools.forEach(pool => pool.dispose()); vi.restoreAllMocks(); }
  });

  it('lowers every visible and pressure recipe with named draw attributes', () => {
    const groups = [new Group(), new Group()] as const;
    const pools = groups.map(group => new AirCurrentSheets(group, 'air'));
    try {
      pools.forEach((pool, index) => {
        pool.begin(index + 1);
        shapes.forEach(shape => pool.put(shape, index, 0, 0, 1, 2, 3, 1, index)); pool.end();
      });
      for (let index = 0; index < 8; index++) {
        const first = lowerToWgsl(sheets(groups[0])[index]!);
        const second = lowerToWgsl(sheets(groups[1])[index]!);
        expect(first).toEqual(second);
        for (let column = 0; column < 4; column++) expect(first.vertex).toContain(`effectMatrix${column}`);
        expect(first.vertex).toContain('currentLife');
        expect(first.vertex).toContain('currentProfile');
        expect(first.vertex).not.toMatch(/array<mat4x4<f32>,\s*64>/);
        expect(first.fragment).not.toContain('vInstanceColor');
        expect(first.fragment.length).toBeGreaterThan(200);
      }
    } finally { pools.forEach(pool => pool.dispose()); }
  });
});
