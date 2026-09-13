import * as THREE from 'three';

/** Original procedural PBR tiles. One UV unit covers approximately 25 cm.
 * Only material grain is baked here. Plates, seams and folds belong to geometry.
 */
export type GrainKind = 'cloth' | 'hide' | 'metal' | 'lining' | 'sole';
export interface GrainMaps {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
}
const SIZE = 1024;
const TAU = Math.PI * 2;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (v: number) => v * v * (3 - 2 * v);
const cache = new Map<GrainKind, GrainMaps>();

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x + 137, 374761393) + Math.imul(y + 941, 668265263) + Math.imul(seed + 7, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Periodic interpolated noise makes the tile continuous along both UV axes. */
function noise(x: number, y: number, cells: number, seed: number): number {
  const sx = x / SIZE * cells, sy = y / SIZE * cells;
  const ix = Math.floor(sx), iy = Math.floor(sy);
  const tx = smooth(sx - ix), ty = smooth(sy - iy);
  const at = (a: number, b: number) => hash((a + cells) % cells, (b + cells) % cells, seed);
  const a = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
  const b = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
  return a * (1 - ty) + b * ty;
}

function texture(data: Uint8Array, name: string, color = false): THREE.DataTexture {
  const result = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  result.name = `tier50-70-${name}`;
  result.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  result.wrapS = result.wrapT = THREE.RepeatWrapping;
  result.magFilter = THREE.LinearFilter;
  result.minFilter = THREE.LinearMipmapLinearFilter;
  result.generateMipmaps = true;
  result.anisotropy = 8;
  result.needsUpdate = true;
  return result;
}

export function createGrainMaps(kind: GrainKind): GrainMaps {
  const existing = cache.get(kind);
  if (existing) return existing;
  const color = new Uint8Array(SIZE * SIZE * 4);
  const normal = new Uint8Array(SIZE * SIZE * 4);
  const rough = new Uint8Array(SIZE * SIZE * 4);
  const heights = new Float32Array(SIZE * SIZE);
  const clothRelief = kind === 'cloth' ? new Float32Array(SIZE * SIZE) : undefined;

  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const p = y * SIZE + x, i = p * 4;
    const fine = hash(x, y, 79) - .5;
    const medium = noise(x, y, 64, 71) - .5;
    const broad = noise(x, y, 16, 131) - .5;
    let c = 230, height = .5, r = .6;
    if (kind === 'cloth' || kind === 'lining') {
      // A close four-over-one twill with fine fibre striation and irregular yarn thickness.
      const yarnX = x + noise(x, y, 16, 21) * 1.3;
      const yarnY = y + noise(x, y, 16, 49) * 1.3;
      const period = kind === 'cloth' ? 8 : 4;
      const warp = Math.cos(TAU * yarnX / period), weft = Math.cos(TAU * yarnY / period);
      const over = ((Math.floor(x / period) - Math.floor(y / period) + 10240) % 5) < 2;
      const weave = (over ? warp : weft) * .68 + (over ? weft : warp) * .2;
      const slub = Math.sin(TAU * x / 32 + noise(x, y, 32, 811) * 4) * medium;
      const strength = kind === 'cloth' ? 1 : .68;
      c = 229 + weave * 10 * strength + fine * 9 + broad * 14 + slub * 6;
      height = .5 + weave * (kind === 'cloth' ? .062 : .046) * strength + fine * .013
        + medium * (kind === 'cloth' ? .065 : .04) + slub * (kind === 'cloth' ? .045 : .025);
      if (clothRelief) {
        // Millimetre-scale fabric compression, separate from the fine yarns.
        // All phases and warp fields tile periodically. Broad hanging ripples
        // are crossed by shallower irregular tension wrinkles, never painted shadows.
        const u = x / SIZE, v = y / SIZE;
        const warp = noise(x, y, 4, 571) - .5;
        const tension = noise(x, y, 8, 837) - .5;
        const hanging = Math.sin(TAU * (5 * u + v + .9 * warp));
        const gathered = Math.sin(TAU * (11 * u - 3 * v + .75 * tension));
        const crease = Math.pow(.5 + .5 * Math.cos(TAU * (7 * u + 2 * v + warp)), 7);
        clothRelief[p] = .00115 * hanging * (.65 + .5 * noise(x, y, 4, 993))
          + .00038 * gathered * (.5 + .6 * noise(x, y, 8, 341)) - .00032 * crease;
        // Small dye/yarn variation stays independent of the direction of light.
        c += warp * 11 + tension * 4;
      }
      // Dry woven cloth: broad diffuse folds and visible yarns, with no satin stripe.
      r = (kind === 'cloth' ? .94 : .8) + medium * .05 + fine * .025 - weave * .015;
    } else if (kind === 'hide' || kind === 'sole') {
      // Irregular shallow pebbles and pores, without a repeated picture of a scale.
      const grain = noise(x, y, 128, 231);
      const creases = Math.pow(clamp(1 - Math.abs(medium) * 7.3), 10);
      const pores = fine < -.44 ? (fine + .44) * 2.2 : 0;
      c = 228 + broad * 16 + medium * 12 + (grain - .5) * 13 + fine * 5 - creases * 6;
      const hideDetail = kind === 'hide' ? 1.55 : 1;
      height = .5 + (medium * .082 + (grain - .5) * .046 - creases * .025 + pores * .03) * hideDetail;
      r = (kind === 'hide' ? .345 : .82) + broad * .05 + medium * (kind === 'hide' ? .11 : .06) + creases * .025;
    } else {
      // Quiet hand abrasion over narrow chased diagonal cuts. Ornament is modelled.
      const brush = Math.sin(TAU * y / 4 + noise(x, y, 32, 41) * 1.3);
      const diagonal = (x + y + Math.sin(TAU * y / 128) * 3) % 64;
      const engraving = Math.exp(-Math.pow((diagonal - 32) / .9, 2));
      const worn = noise(x, y, 32, 177) - .5;
      c = 234 + brush * 2 + fine * 5 + worn * 15 - engraving * 13;
      height = .5 + brush * .004 + fine * .005 + medium * .016 - engraving * .022;
      r = .30 + worn * .09 + medium * .04 + engraving * .055 + fine * .012;
    }
    const value = Math.round(clamp(c, 0, 255));
    color[i] = color[i + 1] = color[i + 2] = value;
    color[i + 3] = rough[i + 3] = 255;
    const rv = Math.round(clamp(r) * 255);
    rough[i] = rough[i + 1] = rough[i + 2] = rv;
    heights[p] = height;
  }
  // Normals come from the independent height field, not shaded albedo.
  const strength = kind === 'cloth' ? 5 : kind === 'hide' ? 4.2 : kind === 'metal' ? 2.1 : 3;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    const at = (px: number, py: number) => heights[((py + SIZE) % SIZE) * SIZE + ((px + SIZE) % SIZE)]!;
    const reliefAt = (px: number, py: number) => clothRelief?.[((py + SIZE) % SIZE) * SIZE + ((px + SIZE) % SIZE)] ?? 0;
    // Convert the cloth height in metres to slopes over a 25 cm PBR tile.
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength + (reliefAt(x + 1, y) - reliefAt(x - 1, y)) * SIZE / .5;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength + (reliefAt(x, y + 1) - reliefAt(x, y - 1)) * SIZE / .5;
    const length = Math.sqrt(dx * dx + dy * dy + 1);
    normal[i] = Math.round((-.5 * dx / length + .5) * 255);
    normal[i + 1] = Math.round((-.5 * dy / length + .5) * 255);
    normal[i + 2] = Math.round((.5 / length + .5) * 255);
    normal[i + 3] = 255;
  }
  const result = {
    map: texture(color, `${kind}-color`, true),
    normalMap: texture(normal, `${kind}-normal`),
    roughnessMap: texture(rough, `${kind}-roughness`),
  };
  cache.set(kind, result);
  return result;
}
