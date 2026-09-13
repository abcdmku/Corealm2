import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { ArmorMaterials, ArmorTheme } from './contracts.js';
import { buildRobe, robeCoatPoint } from './robe.js';
import { bodyPoint } from './robe-geometry.js';

// Focused authoring checks only. Browser animation and screenshots remain the
// root acceptance gate; rest-space clearance cannot prove walking clearance.
const material = () => new THREE.MeshStandardMaterial({ color: 0x6688aa });
const m: ArmorMaterials = { cloth: material(), scales: material(), metal: material(), lining: material(), gem: material(), sole: material(), thread: material(), scutes: [material(), material(), material()] };
for (const theme of ['dragonhide', 'starhide'] as const satisfies readonly ArmorTheme[]) {
  const g = buildRobe(theme, m); g.updateMatrixWorld(true);
  let triangles = 0, meshes = 0, skirtMeshes = 0, scaleMeshes = 0, invalid = 0, degenerate = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  g.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    meshes++;
    if (node.userData.itemModelDeform === 'skirt') skirtMeshes++;
    if (node.name.includes('scutes')) scaleMeshes++;
    const p = node.geometry.getAttribute('position'), n = node.geometry.getAttribute('normal'), ix = node.geometry.index;
    for (let i = 0; i < p.count; i++) if (![p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i)].every(Number.isFinite)) invalid++;
    const count = (ix?.count ?? p.count) / 3; triangles += count;
    for (let i = 0; i < count; i++) {
      a.fromBufferAttribute(p, ix ? ix.getX(i * 3) : i * 3);
      b.fromBufferAttribute(p, ix ? ix.getX(i * 3 + 1) : i * 3 + 1);
      c.fromBufferAttribute(p, ix ? ix.getX(i * 3 + 2) : i * 3 + 2);
      if (b.sub(a).cross(c.sub(a)).lengthSq() < 1e-24) degenerate++;
    }
    if (/tail|tasset|waist|pendant/i.test(node.name)) assert.equal(node.userData.itemModelDeform, 'skirt', `${node.name} has inconsistent skirt weights`);
  });
  const bounds = new THREE.Box3().setFromObject(g);
  const categories: Record<string, number> = {};
  g.traverse(n => {
    if (!(n instanceof THREE.Mesh)) return;
    const key = n.name.includes('scutes') ? 'scutes' : Array.isArray(n.material) && n.material[0] === n.material[1] ? 'metal-and-backing' : 'cloth';
    categories[key] = (categories[key] ?? 0) + (n.geometry.index?.count ?? n.geometry.getAttribute('position').count) / 3;
  });
  console.log({ theme, categories });
  assert.equal(invalid, 0, 'Nonfinite robe geometry');
  assert.ok(triangles < 150000, `${theme} has ${triangles} triangles`);
  assert.ok(bounds.min.y > .20 && bounds.max.y < 1.62, 'Robe height outside native body fit');
  let shoulderExtent = 0;
  g.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const p = node.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      a.fromBufferAttribute(p, i).applyMatrix4(node.matrixWorld);
      if (a.y > 1.2) shoulderExtent = Math.max(shoulderExtent, Math.abs(a.x));
    }
  });
  assert.ok(shoulderExtent < .33, 'Upper robe exceeds fitted shoulder silhouette');
  const waistWidth = bodyPoint(1.14, Math.PI / 2, .015).x - bodyPoint(1.14, -Math.PI / 2, .015).x;
  const referenceWidth = theme === 'dragonhide' ? .9677893817424774 : .8030880391597748;
  const width = bounds.max.x - bounds.min.x;
  assert.ok(Math.abs(width - (waistWidth * 2 + referenceWidth) / 2) < .00001, 'Total skirt width must sit halfway between R9 and the reference');
  assert.ok(robeCoatPoint(.57, 0, theme).z > .152, 'Missing forward knee movement allowance');
  console.log(JSON.stringify({ theme, meshes, triangles, skirtMeshes, scaleMeshes, degenerate, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } }));
}
