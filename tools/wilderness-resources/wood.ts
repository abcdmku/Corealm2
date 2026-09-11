import { Document, type Material, type Primitive } from '@gltf-transform/core';
import { Vector3 } from 'three';
import type { Point, ResourceTreeId } from './sculpt.js';

type WoodVertex = { p: Point; n: Point; uv: [number, number]; c: Point };
const v3 = (p: Point) => new Vector3(...p);
const lerp = (a: WoodVertex, b: WoodVertex, t: number): WoodVertex => ({
  p: a.p.map((v, i) => v + (b.p[i]! - v) * t) as Point,
  n: v3(a.n).lerp(v3(b.n), t).normalize().toArray() as Point,
  uv: a.uv.map((v, i) => v + (b.uv[i]! - v) * t) as [number, number],
  c: a.c.map((v, i) => v + (b.c[i]! - v) * t) as Point,
});
function vertices(p: Primitive): WoodVertex[] {
  const ids = p.getIndices()?.getArray() ?? Array.from({ length: p.getAttribute('POSITION')!.getCount() }, (_, i) => i);
  return Array.from(ids, i => ({ p: p.getAttribute('POSITION')!.getElement(i, [0, 0, 0]) as Point,
    n: p.getAttribute('NORMAL')!.getElement(i, [0, 0, 0]) as Point,
    uv: p.getAttribute('TEXCOORD_0')!.getElement(i, [0, 0]) as [number, number],
    c: p.getAttribute('COLOR_0')!.getElement(i, [0, 0, 0]) as Point }));
}
function surface(doc: Document, rows: WoodVertex[], material: Material, name: string): Primitive {
  const primitive = doc.createPrimitive().setMaterial(material), buffer = doc.getRoot().listBuffers()[0]!;
  for (const [semantic, key] of [['POSITION', 'p'], ['NORMAL', 'n'], ['TEXCOORD_0', 'uv'], ['COLOR_0', 'c']] as const)
    primitive.setAttribute(semantic, doc.createAccessor(`${name}-${semantic}`).setBuffer(buffer).setType(key === 'uv' ? 'VEC2' : 'VEC3').setArray(Float32Array.from(rows.flatMap(v => v[key]))));
  return primitive;
}

/** Local fire scars follow the bole with an uneven boundary; the lee retains living bark. */
function charAmount(id: ResourceTreeId, [x, y, z]: Point): number {
  const direction = id.endsWith('lastroot') ? 1 : -1, angle = Math.atan2(z, x * direction), radius = Math.hypot(x, z);
  const side = radius > .02 ? (x * direction - z * .95) / radius : 0;
  const boundary = .18 + .17 * Math.sin(y * 8.3 + angle * 3) + .11 * Math.sin(y * 22 - angle * 9);
  const sideMask = Math.max(0, Math.min(1, (side - boundary) * 12));
  const heightMask = Math.max(0, Math.min(1, (6.0 - y + .3 * Math.sin(angle * 5)) * 2));
  return sideMask * heightMask;
}

export function scorchBark(doc: Document, primitive: Primitive, id: ResourceTreeId): Primitive {
  const input = vertices(primitive), rows: WoodVertex[] = [];
  const emit = (triangle: WoodVertex[], depth = 0): void => {
    const lengths = triangle.map((v, i) => v3(v.p).distanceTo(v3(triangle[(i + 1) % 3]!.p)));
    const max = Math.max(...lengths), edge = lengths.indexOf(max);
    if (depth < 8 && max > .16 && triangle.some(v => v.p[1] < 6.2)) {
      const a = triangle[edge]!, b = triangle[(edge + 1) % 3]!, c = triangle[(edge + 2) % 3]!, middle = lerp(a, b, .5);
      emit([a, middle, c], depth + 1); emit([middle, b, c], depth + 1); return;
    }
    for (const v of triangle) {
      const amount = charAmount(id, v.p), coal = [.115, .108, .105];
      rows.push({ ...v, c: v.c.map((value, axis) => value * (1 - amount) + coal[axis]! * amount) as Point });
    }
  };
  for (let i = 0; i < input.length; i += 3) emit(input.slice(i, i + 3));
  return surface(doc, rows, primitive.getMaterial()!, `${id}-scorched-bark`);
}

/** Two subordinate dead boughs grow out of a collar and end in unequal torn splinters. */
export function brokenBoughs(doc: Document, bark: Primitive, id: ResourceTreeId): Primitive[] {
  const source = vertices(bark), wood: WoodVertex[] = [], cut: WoodVertex[] = [], direction = id.endsWith('lastroot') ? 1 : -1;
  for (let branch = 0; branch < 2; branch++) {
    const height = id.endsWith('lastroot') ? 3.05 + branch * 1.25 : 2.7 + branch * 1.1;
    const band = source.filter(v => Math.abs(v.p[1] - height) < .12);
    const min = Math.min(...band.map(v => Math.hypot(v.p[0], v.p[2])));
    const bole = band.filter(v => Math.hypot(v.p[0], v.p[2]) < min + .23);
    const origin = bole.reduce((sum, v) => sum.add(v3(v.p)), new Vector3()).multiplyScalar(1 / bole.length); origin.y = height;
    const reach = branch ? 1.22 : 1.75, lift = branch ? .82 : .58;
    const centres = Array.from({ length: 8 }, (_, i) => {
      const t = i / 7;
      return origin.clone().add(new Vector3(direction * reach * t, lift * t + .15 * Math.sin(t * Math.PI), (branch ? .54 : -.32) * t));
    });
    const radii = [1.34, 1.02, .9, .8, .71, .64, .58, .52].map(r => r * (branch ? .105 : .145));
    const rings: WoodVertex[][] = [], sides = 12;
    for (let i = 0; i < centres.length; i++) {
      const tangent = centres[Math.min(7, i + 1)]!.clone().sub(centres[Math.max(0, i - 1)]!).normalize();
      const u = new Vector3().crossVectors(tangent, new Vector3(0, 1, 0)).normalize(), w = new Vector3().crossVectors(tangent, u).normalize();
      rings.push(Array.from({ length: sides }, (_, j) => {
        const angle = j / sides * Math.PI * 2, normal = u.clone().multiplyScalar(Math.cos(angle)).addScaledVector(w, Math.sin(angle));
        const torn = i === 7 ? .14 * Math.sin(j * 2.7) + (j % 4 === 0 ? .20 : 0) : 0;
        const p = centres[i]!.clone().addScaledVector(normal, radii[i]! * (1 + .07 * Math.sin(j * 4.2))).addScaledVector(tangent, torn);
        return { p: p.toArray() as Point, n: normal.toArray() as Point, uv: [j / sides * Math.PI * 2 * radii[i]!, i / 7 * reach] as [number, number], c: [.17, .15, .135] as Point };
      }));
    }
    for (let i = 0; i < 7; i++) for (let j = 0; j < sides; j++) {
      const k = (j + 1) % sides;
      wood.push(rings[i]![j]!, rings[i]![k]!, rings[i + 1]![j]!, rings[i]![k]!, rings[i + 1]![k]!, rings[i + 1]![j]!);
    }
    const end = centres[7]!.clone().addScaledVector(centres[7]!.clone().sub(centres[6]!).normalize(), -.06);
    for (let j = 0; j < sides; j++) {
      const a = rings[7]![j]!, b = rings[7]![(j + 1) % sides]!, n = v3(a.p).sub(end).cross(v3(b.p).sub(end)).normalize().toArray() as Point;
      const colour = j % 3 === 0 ? [.18, .125, .075] as Point : [.34, .25, .15] as Point;
      cut.push({ p: end.toArray() as Point, n, uv: [.5, .5], c: colour }, { ...a, n, c: colour }, { ...b, n, c: colour });
    }
  }
  const cutMaterial = doc.createMaterial('Cutwood_Corealm_torn_fire_bough').setRoughnessFactor(.97).setMetallicFactor(0);
  return [surface(doc, wood, bark.getMaterial()!, `${id}-broken-boughs`), surface(doc, cut, cutMaterial, `${id}-torn-ends`)];
}

/** Retain the actual living tree's textured lower bole and roots, then close its exact cut rim. */
export function cutLivingStump(doc: Document, species: 'teak' | 'magic'): { rimVertices: number; barkTexture: boolean } {
  const height = species === 'teak' ? .43 : .57, rim = new Map<string, WoodVertex>();
  const field = (v: WoodVertex) => v.p[1] - height - .055 * v.p[0] + .022 * Math.sin(v.p[0] * 31) + .017 * Math.sin(v.p[2] * 27);
  let barkTexture = false;
  for (const mesh of doc.getRoot().listMeshes()) {
    mesh.setExtras({ wildernessStumpFromLivingRoots: true });
    for (const primitive of [...mesh.listPrimitives()]) {
      mesh.removePrimitive(primitive);
      if (!primitive.getMaterial()!.getName().startsWith('Bark')) { primitive.dispose(); continue; }
      const rows: WoodVertex[] = [], input = vertices(primitive); barkTexture ||= !!primitive.getMaterial()!.getBaseColorTexture();
      for (let i = 0; i < input.length; i += 3) {
        const triangle = input.slice(i, i + 3), polygon: WoodVertex[] = [];
        for (let edge = 0; edge < 3; edge++) {
          const a = triangle[edge]!, b = triangle[(edge + 1) % 3]!, fa = field(a), fb = field(b);
          if (fa <= 0) polygon.push(a);
          if ((fa <= 0) !== (fb <= 0)) {
            const v = lerp(a, b, fa / (fa - fb)); polygon.push(v); rim.set(v.p.map(n => n.toFixed(6)).join(','), v);
          }
        }
        for (let j = 1; j < polygon.length - 1; j++) rows.push(polygon[0]!, polygon[j]!, polygon[j + 1]!);
      }
      if (rows.length) mesh.addPrimitive(surface(doc, rows, primitive.getMaterial()!, `stump-${species}-living-bark`));
      primitive.dispose();
    }
    const edge = [...rim.values()], centre = edge.reduce((sum, v) => sum.add(v3(v.p)), new Vector3()).multiplyScalar(1 / edge.length);
    edge.sort((a, b) => Math.atan2(a.p[2] - centre.z, a.p[0] - centre.x) - Math.atan2(b.p[2] - centre.z, b.p[0] - centre.x));
    const cap: WoodVertex[] = [], base: WoodVertex = { p: centre.toArray() as Point, n: [0, 1, 0], uv: [.5, .5], c: [1, 1, 1] };
    for (let ring = 0; ring < 9; ring++) for (let j = 0; j < edge.length; j++) {
      const colour: Point = species === 'teak' ? [.39, .27, .145] : [.29, .235, .285];
      const gain = ring % 2 ? .76 : 1;
      const at = (fraction: number, k: number): WoodVertex => ({ ...lerp(base, edge[k % edge.length]!, fraction), n: [0, 1, 0], c: colour.map(v => v * gain) as Point });
      const a = at(ring / 9, j), b = at((ring + 1) / 9, j), c = at((ring + 1) / 9, j + 1), d = at(ring / 9, j + 1);
      if (ring === 0) cap.push(a, c, b); else cap.push(a, d, b, b, d, c);
    }
    mesh.addPrimitive(surface(doc, cap, doc.createMaterial(`Cutwood_Corealm_${species}_growth_rings`).setRoughnessFactor(.97).setMetallicFactor(0), `stump-${species}-cut`));
  }
  return { rimVertices: rim.size, barkTexture };
}
