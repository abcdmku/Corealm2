import { describe, expect, it } from 'vitest';
import { generateTree, pointOn, TREE_DESIGNS } from '../tools/wilderness-trees/geometry.js';

describe('original Wilderness dead forest geometry', () => {
  const trees = TREE_DESIGNS.map(spec => generateTree(spec.id));
  it('grounds each distinct silhouette with finite, nondegenerate geometry at native scale', () => {
    for (const tree of trees) {
      expect(tree.min[1], tree.id).toBe(0);
      expect(tree.triangles, tree.id).toBeGreaterThan(5000);
      expect(tree.triangles, tree.id).toBeLessThan(25000);
      for (const skin of Object.values(tree.skins)) {
        expect([...skin.position, ...skin.normal, ...skin.uv].every(Number.isFinite), tree.id).toBe(true);
        for (let i = 0; i < skin.normal.length; i += 3) expect(Math.hypot(...skin.normal.slice(i, i + 3)), `${tree.id} unit normals`).toBeCloseTo(1, 5);
        for (let i = 0; i < skin.indices.length; i += 3) {
          const p = skin.indices.slice(i, i + 3).map(index => skin.position.slice(index * 3, index * 3 + 3));
          const a = p[1]!.map((v, n) => v - p[0]![n]!), b = p[2]!.map((v, n) => v - p[0]![n]!);
          const area = Math.hypot(a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!);
          expect(area, `${tree.id} collapsed triangle`).toBeGreaterThan(1e-7);
        }
      }
    }
    const fallen = trees.find(t => t.id.endsWith('fallen'))!, crown = trees.find(t => t.id.endsWith('crown'))!;
    expect(fallen.max[1], 'fallen root plate should remain lower than a standing tree').toBeLessThan(3.2);
    expect(crown.max[2] - crown.min[2], 'broad dead crown must have room for off-axis forks').toBeGreaterThan(8);
    expect(crown.max[1], 'full mature crown').toBeGreaterThan(9);
  });
  it('seats every branch on its actual parent and tapers toward fine or broken tips', () => {
    for (const tree of trees) {
      expect(tree.axes.filter(axis => axis.parent === null), tree.id).toHaveLength(1);
      expect(tree.axes.filter(axis => axis.parent !== null).length, tree.id).toBeGreaterThan(20);
      for (const axis of tree.axes) {
        if (axis.parent !== null) {
          expect(axis.parent, tree.id).toBeLessThan(axis.id);
          const joint = pointOn(tree.axes[axis.parent]!, axis.at);
          expect(Math.hypot(...axis.rings[0]!.p.map((v, n) => v - joint.p[n]!)), `${tree.id} branch ${axis.id} attachment`).toBeLessThan(1e-8);
          expect(axis.rings[0]!.radius, `${tree.id} oversized graft`).toBeLessThanOrEqual(joint.radius);
        }
        for (let i = 1; i < axis.rings.length; i++) expect(axis.rings[i]!.radius, `${tree.id} reverse taper`).toBeLessThanOrEqual(axis.rings[i - 1]!.radius + 1e-9);
      }
    }
  });
  it('gives griefwood a real aperture and inner wall rather than a dark painted patch', () => {
    const hollow = trees.find(t => t.id.endsWith('hollow'))!;
    expect(hollow.openingFaces).toBeGreaterThan(100);
    expect(hollow.skins.cavity.indices.length).toBeGreaterThan(0);
    expect(hollow.skins.heartwood.indices.length).toBeGreaterThan(0);
    for (const other of trees.filter(t => !t.id.endsWith('hollow'))) expect(other.openingFaces).toBe(0);
  });
  it('keeps torn secondary roots attached to an uneven three-dimensional fallen butt', () => {
    const fallen = trees.find(tree => tree.id.endsWith('fallen'))!;
    const roots = fallen.axes.filter(axis => axis.root && axis.parent === 0);
    expect(roots.length).toBeGreaterThanOrEqual(5);
    const tips = roots.map(axis => axis.rings.at(-1)!.p);
    for (const dimension of [0, 1, 2]) {
      const values = tips.map(p => p[dimension]!);
      expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(.5);
    }
    for (const root of roots) {
      const laterals = fallen.axes.filter(axis => axis.parent === root.id);
      expect(laterals.length).toBeGreaterThanOrEqual(2);
      expect(laterals.every(axis => axis.root && axis.broken)).toBe(true);
    }
  });
  it('rebuilds each silhouette deterministically', () => {
    for (const spec of TREE_DESIGNS) {
      const a = generateTree(spec.id), b = generateTree(spec.id);
      expect(a.skins).toEqual(b.skins);
    }
  });
});
