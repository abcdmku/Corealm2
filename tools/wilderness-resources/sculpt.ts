import { Matrix3, Vector3 } from 'three';

export type ResourceTreeId = 'corealm_teak_lastroot' | 'corealm_teak_embershelter' | 'corealm_magic_starwood' | 'corealm_magic_moonvein';
export type Point = [number, number, number];
export const RESOURCE_TREE_DESIGNS = [
  { id: 'corealm_teak_lastroot', source: 'corealm_teak_1', species: 'teak', tier: 50, description: 'Fireward boughs stripped bare above a broad living lee crown; the bowed bole still supports each surviving leaf spray.' },
  { id: 'corealm_teak_embershelter', source: 'corealm_teak_2', species: 'teak', tier: 50, description: 'A low storm-bent teak with a ragged split crown, charred windward wood and sheltered olive growth.' },
  { id: 'corealm_magic_starwood', source: 'corealm_magic_1', species: 'magic', tier: 70, description: 'An ancient wide-forked magic tree with low spreading arms, dark violet bark and blue sap exposed inside long bark fissures.' },
  { id: 'corealm_magic_moonvein', source: 'corealm_magic_2', species: 'magic', tier: 70, description: 'A rising corkscrew magic tree with an unequal swept crown and violet sap following the wood grain.' },
] as const;

/** One smooth spatial deformation moves wood and attached sprays together. The rooted pivot stays fixed. */
export function sculptTreePoint(id: ResourceTreeId, [x, y, z]: Point): Point {
  const t = Math.max(0, y / 14), root = Math.min(1, y / 1.4);
  if (id === 'corealm_teak_lastroot') return [x * (1 + .26 * t) - 1.85 * t * t, y * .91, z * (1 + .1 * t) + .35 * t * t];
  if (id === 'corealm_teak_embershelter') return [x * (1 + .42 * t) + 2.7 * t * t, y * .83, z * .9 - .65 * t * t];
  const angle = (id === 'corealm_magic_starwood' ? -.56 : 1.20) * t * t;
  const spread = id === 'corealm_magic_starwood' ? 1 + .29 * root : 1 + .09 * root;
  return [(x * Math.cos(angle) - z * Math.sin(angle)) * spread + (id.endsWith('starwood') ? -.72 : 1.05) * t * t,
    y * (id.endsWith('starwood') ? .89 : 1.02), (x * Math.sin(angle) + z * Math.cos(angle)) * spread];
}

/** Inverse-transpose of the local deformation, preserving the native bark and leaf normals. */
export function sculptTreeNormal(id: ResourceTreeId, point: Point, normal: Point): Point {
  const e = .0001, base = sculptTreePoint(id, point), columns = [0, 1, 2].map(axis => {
    const p = [...point] as Point; p[axis]! += e;
    return new Vector3(...sculptTreePoint(id, p)).sub(new Vector3(...base)).multiplyScalar(1 / e);
  });
  const m = new Matrix3().set(columns[0]!.x, columns[1]!.x, columns[2]!.x,
    columns[0]!.y, columns[1]!.y, columns[2]!.y, columns[0]!.z, columns[1]!.z, columns[2]!.z).invert().transpose();
  return new Vector3(...normal).applyMatrix3(m).normalize().toArray() as Point;
}

/** Remove whole connected leaf sprays; never cut arbitrary triangles through an alpha card. */
export function retainLeafSpray(id: ResourceTreeId, [x, y, z]: Point, serial: number): boolean {
  if (id.startsWith('corealm_magic_')) return true;
  const fireward = id.endsWith('lastroot') ? x + z * .32 : -x + z * .43;
  const bare = fireward > (id.endsWith('lastroot') ? .2 : -.15) && y > 5.8;
  return !bare || serial % 11 === 0;
}

export function sculptOrePoint(family: 'cindervein' | 'nightglass', [x, y, z]: Point): Point {
  if (family === 'cindervein') return [x * 1.06 + y * .13, y * .94, z * (1 + y * .09)];
  return [x * .98 - y * .08, y * 1.09, z * .97 + Math.sin(y * 4) * .022];
}

export function sculptOreNormal(family: 'cindervein' | 'nightglass', point: Point, normal: Point): Point {
  const y = point[1], z = point[2];
  const m = family === 'cindervein' ? new Matrix3().set(1.06, .13, 0, 0, .94, 0, 0, z * .09, 1 + y * .09)
    : new Matrix3().set(.98, -.08, 0, 0, 1.09, 0, 0, Math.cos(y * 4) * .088, .97);
  return new Vector3(...normal).applyMatrix3(m.invert().transpose()).normalize().toArray() as Point;
}
