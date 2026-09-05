import * as THREE from 'three';

// Original authored topology. Dimensions are metres, +Z is the face direction.
// Shell plates are clipped Voronoi polygons fitted to the carapace, not spheres.
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (v) => (v = clamp(v), v * v * (3 - 2 * v));
const vec = (p) => new THREE.Vector3(...p);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const blend = (a, b, t) => [[a, 1 - clamp(t)], [b, clamp(t)]];

function authoredSurfaceTextures(kind) {
  const size = 256, color = new Uint8Array(size * size * 4), height = new Uint8Array(color.length), rough = new Uint8Array(color.length);
  const hash = (x, y) => { const n = Math.sin(x * 127.13 + y * 319.17) * 41715.178; return n - Math.floor(n); };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1), grain = hash(x, y), i = (y * size + x) * 4;
    let shade, relief, roughness, warmth = 0;
    if (kind === 'scute') {
      const growth = Math.pow(v, .86) * 7.3 + v * (.072 * Math.sin(u * TAU * 3) + .04 * Math.sin(u * TAU * 7 + 1.3));
      const distance = Math.abs(growth - Math.round(growth));
      const groove = Math.exp(-((distance / .072) ** 2)), ridge = Math.exp(-(((distance - .14) / .115) ** 2));
      warmth = Math.pow(v, 5) * .17;
      const worn = .65 + .35 * Math.sin(u * TAU * 3 + v * 11) ** 2;
      shade = .86 - groove * .21 * worn + ridge * .06 + (grain - .5) * .075;
      relief = .43 - groove * .24 * worn + ridge * .23 + (grain - .5) * .13;
      roughness = .77 + groove * .19 + (grain - .5) * .14;
    } else {
      const gx = u * 22, gy = v * 29; let nearest = 1e9, second = 1e9, cell = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const cx = Math.floor(gx) + ox, cy = Math.floor(gy) + oy, px = cx + .5 + (hash(cx, cy) - .5) * .88, py = cy + .5 + (hash(cx + 91, cy - 74) - .5) * .88;
        const distance = Math.hypot((gx - px) * .93, gy - py);
        if (distance < nearest) { second = nearest; nearest = distance; cell = hash(cx + 32, cy + 15); } else if (distance < second) second = distance;
      }
      const interior = smooth((second - nearest) * 6.2);
      shade = .58 + interior * .29 + cell * .12 + (grain - .5) * .055;
      relief = .28 + interior * .33 + (grain - .5) * .085;
      roughness = .81 + (1 - interior) * .15 + (grain - .5) * .10;
    }
    color.set([255 * clamp(shade * (1 + warmth)), 255 * clamp(shade), 255 * clamp(shade * (1 - warmth)), 255], i);
    const b = 255 * clamp(relief), r = 255 * clamp(roughness); height.set([b, b, b, 255], i); rough.set([r, r, r, 255], i);
  }
  const texture = (data, name, colored) => {
    let t;
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), size, size), 0, 0); t = new THREE.CanvasTexture(canvas); t.flipY = false;
    } else t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.name = `slateback_authored_${kind}_${name}`; t.colorSpace = colored ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
  };
  // Tangent normals survive GLB export. Three.js bumpMap is intentionally not
  // used here because glTF has no corresponding material slot.
  const normal = new Uint8Array(color.length);
  const h = (x, y) => height[((((y + size) % size) * size + (x + size) % size) * 4)] / 255;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const strength = kind === 'scute' ? 2.3 : 1.7, nx = (h(x - 1, y) - h(x + 1, y)) * strength, ny = (h(x, y - 1) - h(x, y + 1)) * strength, length = Math.hypot(nx, ny, 1);
    normal.set([255 * (.5 + nx / length * .5), 255 * (.5 + ny / length * .5), 255 * (.5 + .5 / length), 255], (y * size + x) * 4);
  }
  return { map: texture(color, 'pigment', true), normalMap: texture(normal, 'normal', false), roughnessMap: texture(rough, 'roughness', false) };
}

class SurfaceBank {
  constructor() { this.data = new Map(); }
  surface(material, rows, columns, sample, color, weights, reverse = false, uvTransform = null) {
    if (!this.data.has(material)) this.data.set(material, { p: [], uv: [], c: [], si: [], sw: [], ix: [] });
    const d = this.data.get(material); const offset = d.p.length / 3;
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= columns; i++) {
      const u = i / columns, v = j / rows, p = sample(u, v), w = weights(p, u, v);
      p[1] = Math.max(0, p[1]);
      const c = typeof color === 'function' ? color(p, u, v) : color;
      d.p.push(...p); d.uv.push(...(uvTransform ? uvTransform(u, v, p) : [u, v])); d.c.push(...c);
      d.si.push(...Array.from({ length: 4 }, (_, k) => w[k]?.[0] ?? 0));
      d.sw.push(...Array.from({ length: 4 }, (_, k) => w[k]?.[1] ?? 0));
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
      const a = offset + j * (columns + 1) + i, b = a + columns + 1;
      if (reverse) d.ix.push(a, b, a + 1, a + 1, b, b + 1);
      else d.ix.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  finish(object, skeleton, materials) {
    for (const [name, d] of this.data) {
      const g = new THREE.BufferGeometry();
      for (const [key, values, n] of [['position', d.p, 3], ['uv', d.uv, 2], ['color', d.c, 3], ['skinWeight', d.sw, 4]]) g.setAttribute(key, new THREE.Float32BufferAttribute(values, n));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(d.si, 4)); g.setIndex(d.ix); g.computeVertexNormals();
      // UV seams retain separate vertices, with common normals at coincident
      // positions so the organic lofts do not acquire a visible zipper seam.
      const normals = g.getAttribute('normal'), shared = new Map();
      for (let i = 0; i < d.p.length / 3; i++) {
        const key = d.p.slice(i * 3, i * 3 + 3).map((x) => Math.round(x * 1e6)).join(',');
        if (!shared.has(key)) shared.set(key, []); shared.get(key).push(i);
      }
      for (const vertices of shared.values()) if (vertices.length > 1) {
        const average = new THREE.Vector3();
        for (const i of vertices) average.add(new THREE.Vector3().fromBufferAttribute(normals, i)); average.normalize();
        for (const i of vertices) normals.setXYZ(i, average.x, average.y, average.z);
      }
      const mesh = new THREE.SkinnedMesh(g, materials[name]); mesh.name = `slateback_${name}`; mesh.castShadow = true; mesh.receiveShadow = true;
      object.add(mesh); mesh.bind(skeleton); mesh.frustumCulled = false;
    }
  }
}

function interpolateRing(rings, t) {
  const index = Math.min(rings.length - 2, Math.floor(t * (rings.length - 1))), f = t * (rings.length - 1) - index;
  const a = rings[Math.max(0, index - 1)], b = rings[index], c = rings[index + 1], d = rings[Math.min(rings.length - 1, index + 2)];
  return b.map((value, k) => {
    const result = .5 * (2 * value + (-a[k] + c[k]) * f + (2 * a[k] - 5 * value + 4 * c[k] - d[k]) * f * f + (-a[k] + 3 * value - 3 * c[k] + d[k]) * f * f * f);
    return k > 2 ? Math.max(0.0001, result) : result;
  });
}

function loftPoint(rings, u, t) {
  const r = interpolateRing(rings, t), before = interpolateRing(rings, clamp(t - .002)), after = interpolateRing(rings, clamp(t + .002));
  const tangent = vec(after.slice(0, 3)).sub(vec(before.slice(0, 3))).normalize();
  let side = new THREE.Vector3(1, 0, 0).addScaledVector(tangent, -tangent.x);
  if (side.lengthSq() < .001) side.set(0, 0, 1).addScaledVector(tangent, -tangent.z);
  side.normalize(); const other = tangent.clone().cross(side).normalize();
  return vec(r.slice(0, 3)).addScaledVector(side, Math.cos(u * TAU) * r[3]).addScaledVector(other, Math.sin(u * TAU) * r[4]).toArray();
}

function loft(bank, material, rings, rows, columns, color, weights) {
  // Rings contain centre xyz, transverse width and depth. The tangent frame
  // follows the sculpted centre line, allowing elbows and neck bends to flow.
  bank.surface(material, rows, columns, (u, t) => {
    return loftPoint(rings, u, t);
  }, color, weights);
}

function oval(bank, material, center, radius, color, bone, segments = 20, rows = 12) {
  bank.surface(material, rows, segments, (u, v) => [center[0] + radius[0] * Math.sin(v * Math.PI) * Math.cos(u * TAU), center[1] + radius[1] * Math.cos(v * Math.PI), center[2] + radius[2] * Math.sin(v * Math.PI) * Math.sin(u * TAU)], color, () => [[bone, 1]]);
}

function lineTube(bank, material, points, radius, color, bone, columns = 8) {
  loft(bank, material, points.map((p, i) => [...p, radius * (i === 0 || i === points.length - 1 ? 0.35 : 1), radius * (i === 0 || i === points.length - 1 ? 0.35 : 1)]), Math.max(6, (points.length - 1) * 2), columns, color, () => [[bone, 1]]);
}

function shellPoint(x, z, inset = 0) {
  const r = Math.sqrt(x * x + z * z), theta = Math.atan2(z, x);
  const opening = 0.075 * Math.pow(Math.sin(theta * 2), 6) + 0.055 * Math.pow(Math.abs(Math.sin(theta)), 12);
  return [x * (0.79 - inset), 0.45 + (0.81 - inset) * Math.pow(Math.max(0, 1 - r * r), 0.72) + opening * Math.pow(r, 8), z * (1.04 - inset)];
}

function clipPolygon(polygon, a, b, d) {
  const result = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length], pv = p[0] * a + p[1] * b - d, qv = q[0] * a + q[1] * b - d;
    if (pv <= 0) result.push(p);
    if ((pv < 0) !== (qv < 0)) result.push(mix(p, q, pv / (pv - qv)));
  }
  return result;
}

function buildShell(bank, body) {
  bank.surface('shell_seams', 20, 48, (u, v) => shellPoint(Math.cos(u * TAU) * v, Math.sin(u * TAU) * v), [0.075, 0.093, 0.091], () => [[body, 1]]);
  // Rolled, visibly thick outer edge, with a dark underside that leaves the
  // neck and diagonal leg entrances open above the narrow plastron.
  bank.surface('shell_edge', 6, 96, (u, v) => {
    const t = u * TAU, r = 1 - 0.067 * Math.sin(v * Math.PI / 2), p = shellPoint(Math.cos(t) * r, Math.sin(t) * r);
    const edge = shellPoint(Math.cos(t), Math.sin(t)); p[1] = edge[1] - 0.07 * Math.sin(v * Math.PI); return p;
  }, (p, u) => [0.22 + 0.025 * Math.cos(u * 30 * TAU), 0.24 + 0.022 * Math.cos(u * 30 * TAU), 0.20], () => [[body, 1]]);

  const sites = [[0, -0.68], [0, -0.34], [0, 0], [0, 0.34], [0, 0.68]];
  for (const side of [-1, 1]) for (const z of [-0.54, -0.18, 0.18, 0.54]) sites.push([side * 0.52, z]);
  for (let i = 0; i < 20; i++) sites.push([Math.cos(i / 20 * TAU) * .96, Math.sin(i / 20 * TAU) * .96]);
  const polygons = sites.map((site) => {
    let poly = Array.from({ length: 96 }, (_, i) => [Math.cos(i / 96 * TAU) * 0.999, Math.sin(i / 96 * TAU) * 0.999]);
    for (const other of sites) if (other !== site) {
      const a = other[0] - site[0], b = other[1] - site[1], d = (other[0] ** 2 + other[1] ** 2 - site[0] ** 2 - site[1] ** 2) / 2;
      poly = clipPolygon(poly, a, b, d);
    }
    return poly;
  });
  polygons.forEach((original, index) => {
    let poly = original;
    if (poly.length < 3) return;
    const average = poly.reduce((c, p) => [c[0] + p[0] / poly.length, c[1] + p[1] / poly.length], [0, 0]);
    const center = mix(average, poly[(index * 3) % poly.length], .15);
    poly = poly.map((p) => mix(center, p, 0.990));
    const columns = poly.length * 3;
    bank.surface(`scutes_${index % 3}`, 6, columns, (u, v) => {
      const edge = u * poly.length, i = Math.min(poly.length - 1, Math.floor(edge)), f = edge - i;
      const perimeter = mix(poly[i], poly[(i + 1) % poly.length], f), xz = mix(center, perimeter, v);
      const p = shellPoint(...xz), bevel = Math.sin(Math.min(1, (1 - v) * 9) * Math.PI / 2);
      const growth = 0.0045 * Math.cos(v * 3 * TAU + .12 * Math.sin(u * TAU * 3)) * Math.sin(v * Math.PI);
      p[1] += (index < 13 ? 0.026 : 0.012) * bevel + growth; return p;
    }, (p, u, v) => {
      const wear = 0.012 * Math.sin(index * 5.6), crown = (1 - v) * 0.021, margin = Math.pow(v, 5) * 0.032;
      return [0.085 + wear + crown + margin, 0.135 + wear + crown + margin * .75, 0.149 + wear * .4 + crown + margin * .35];
    }, () => [[body, 1]]);
  });

  // The underside is a flattened lobed shield with six visibly divided plates.
  loft(bank, 'plastron', [[0, 0.335, -0.92, 0.001, 0.001], [0, 0.315, -0.76, 0.37, 0.052], [0, 0.30, -0.43, 0.54, 0.072], [0, 0.29, 0.0, 0.56, 0.083], [0, 0.315, 0.45, 0.47, 0.07], [0, 0.35, 0.82, 0.20, 0.044], [0, 0.35, 0.92, 0.001, 0.001]], 32, 32, (p, u, v) => {
    const seam = Math.min(Math.abs(Math.sin(v * 5 * Math.PI)) * 9, 1), underside = 0.028 * Math.sin(u * TAU), middle = .55 + .45 * Math.min(1, Math.abs(Math.cos(u * TAU)) * 35);
    return [(0.26 + underside + 0.10 * seam) * middle, (0.22 + underside + 0.08 * seam) * middle, (0.11 + 0.05 * seam) * middle];
  }, () => [[body, 1]]);
}

export async function buildTortoise() {
  const object = new THREE.Group(); object.name = 'slateback_tortoise';
  const bones = [], indices = {};
  const bone = (name, p, parent) => {
    const b = new THREE.Bone(); b.name = name; b.position.fromArray(p); indices[name] = bones.length; bones.push(b); (parent ?? object).add(b); return b;
  };
  const root = bone('tortoise_root', [0, 0, 0]), bodyBone = bone('tortoise_body', [0, 0, 0], root), body = indices.tortoise_body;
  const neck1 = bone('tortoise_neck_base', [0, 0.63, 0.77], bodyBone);
  const neck2 = bone('tortoise_neck_extend', [0, 0.035, 0.25], neck1);
  const head = bone('tortoise_head', [0, 0.06, 0.26], neck2);
  const jaw = bone('tortoise_jaw', [0, -0.065, 0.04], head);
  const tail1 = bone('tortoise_tail_base', [0, 0.43, -0.82], bodyBone);
  const tail2 = bone('tortoise_tail_tip', [0, -0.04, -0.20], tail1);
  const legs = [];
  for (const front of [true, false]) for (const side of [-1, 1]) {
    const label = `${front ? 'front' : 'rear'}_${side < 0 ? 'left' : 'right'}`;
    const hip = [side * 0.49, 0.54, front ? 0.56 : -0.58];
    const elbow = [side * 0.69, 0.325, front ? 0.69 : -0.70];
    const ankle = [side * 0.765, 0.105, front ? 0.80 : -0.80];
    const upper = bone(`tortoise_${label}_upper`, hip, bodyBone);
    const lower = bone(`tortoise_${label}_lower`, vec(elbow).sub(vec(hip)).toArray(), upper);
    const foot = bone(`tortoise_${label}_foot`, vec(ankle).sub(vec(elbow)).toArray(), lower);
    legs.push({ label, front, side, hip, elbow, ankle, upper, lower, foot, upperIndex: indices[upper.name], lowerIndex: indices[lower.name], footIndex: indices[foot.name] });
  }
  object.updateMatrixWorld(true);
  const bank = new SurfaceBank();
  const skinColor = (p, u, v) => {
    const wrinkles = 0.012 * Math.cos(v * 11 * TAU) * Math.cos(u * 9 * TAU), warm = 0.022 * Math.sin(u * TAU);
    return [0.235 + wrinkles + warm, 0.252 + wrinkles + warm, 0.163 + wrinkles * .8];
  };
  buildShell(bank, body);
  loft(bank, 'skin', [[0, 0.56, -0.86, 0.035, 0.02], [0, 0.58, -0.62, 0.47, 0.20], [0, 0.58, -0.24, 0.65, 0.235], [0, 0.58, 0.21, 0.63, 0.235], [0, 0.59, 0.58, 0.42, 0.215], [0, 0.63, 0.83, 0.17, 0.145]], 24, 32, skinColor, () => [[body, 1]]);
  loft(bank, 'skin', [[0, 0.61, 0.76, 0.17, 0.145], [0, 0.63, 0.90, 0.16, 0.145], [0, 0.66, 1.05, 0.135, 0.123], [0, 0.70, 1.20, 0.135, 0.115], [0, 0.745, 1.32, 0.118, 0.088], [0, 0.76, 1.39, 0.024, 0.020]], 28, 28, skinColor, (p) => {
    if (p[2] < 0.90) return blend(body, indices[neck1.name], (p[2] - 0.76) / 0.14);
    if (p[2] < 1.16) return blend(indices[neck1.name], indices[neck2.name], (p[2] - 0.94) / 0.19);
    return blend(indices[neck2.name], indices[head.name], (p[2] - 1.16) / 0.15);
  });
  // A broad back of the skull narrows into a short downturned keratin beak.
  loft(bank, 'skin', [[0, 0.725, 1.225, 0.07, 0.075], [0, 0.76, 1.31, 0.155, 0.128], [0, 0.765, 1.43, 0.179, 0.132], [0, 0.75, 1.54, 0.147, 0.109], [0, 0.718, 1.635, 0.111, 0.070], [0, 0.705, 1.673, 0.045, 0.027], [0, 0.699, 1.686, 0.001, 0.001]], 28, 28, (p, u, v) => [0.275 + 0.018 * Math.sin(v * 5 * TAU), 0.290 + 0.015 * Math.sin(v * 5 * TAU), 0.182], () => [[indices[head.name], 1]]);
  loft(bank, 'beak', [[0, 0.667, 1.31, 0.035, 0.008], [0, 0.65, 1.41, 0.131, 0.038], [0, 0.659, 1.57, 0.113, 0.031], [0, 0.68, 1.664, 0.055, 0.011], [0, 0.684, 1.676, 0.001, 0.001]], 16, 24, [0.16, 0.155, 0.085], () => [[indices[jaw.name], 1]]);
  loft(bank, 'beak', [[0, .704, 1.608, .08, .021], [0, .706, 1.65, .078, .024], [0, .696, 1.679, .04, .020], [0, .685, 1.692, .001, .001]], 8, 14, [.19, .182, .102], () => [[indices[head.name], 1]]);
  for (const side of [-1, 1]) {
    oval(bank, 'eye_socket', [side * 0.166, 0.799, 1.445], [0.017, 0.027, 0.036], [0.115, 0.126, 0.068], indices[head.name], 18, 10);
    oval(bank, 'eye', [side * 0.178, 0.800, 1.452], [0.009, 0.017, 0.023], [0.30, 0.21, 0.064], indices[head.name], 20, 12);
    oval(bank, 'pupil', [side * 0.186, 0.801, 1.457], [0.0035, 0.013, 0.012], [0.018, 0.020, 0.010], indices[head.name], 16, 10);
    oval(bank, 'eye', [side * 0.189, 0.807, 1.463], [0.001, 0.003, 0.002], [0.69, 0.69, 0.57], indices[head.name], 10, 6);
    lineTube(bank, 'skin', [[side * 0.15, 0.820, 1.401], [side * 0.17, 0.833, 1.437], [side * 0.163, 0.827, 1.48]], 0.010, [0.27, 0.288, 0.18], indices[head.name]);
    lineTube(bank, 'mouth', [[side * 0.117, 0.665, 1.332], [side * 0.154, 0.676, 1.46], [side * 0.116, 0.689, 1.589], [side * 0.058, 0.697, 1.673]], 0.005, [0.10, 0.085, 0.046], indices[head.name], 6);
    oval(bank, 'pupil', [side * 0.070, 0.756, 1.629], [0.012, 0.008, 0.008], [0.08, 0.065, 0.04], indices[head.name], 12, 8);
  }
  // Transverse neck folds are shallow modeled ridges; they retract with skin.
  for (let i = 0; i < 8; i++) {
    const z = 0.87 + i * 0.046, y = 0.63 + (z - 0.9) * 0.27, width = 0.154 - (z - 0.87) * 0.07;
    const b = z < 1.02 ? indices[neck1.name] : indices[neck2.name];
    const points = Array.from({ length: 13 }, (_, k) => { const a = Math.PI * (0.05 + k / 12 * 0.90); return [Math.cos(a) * width, y - Math.sin(a) * width * 0.83, z]; });
    lineTube(bank, 'scales', points, 0.006, [0.33, 0.315, 0.21], b, 5);
  }

  for (const leg of legs) {
    const { hip, elbow, ankle, side, front, upperIndex, lowerIndex, footIndex } = leg;
    const rings = [[...hip, 0.15, 0.15], [...mix(hip, elbow, 0.5), 0.175, 0.154], [...elbow, 0.147, 0.134], [...mix(elbow, ankle, 0.65), 0.142, 0.128], [...ankle, 0.16, 0.123], [ankle[0], 0.043, ankle[2] + 0.021, 0.155, 0.11], [ankle[0], 0.016, ankle[2] + 0.029, 0.125, 0.095]];
    loft(bank, 'skin', rings, 24, 20, skinColor, (p, u, t) => t < 0.42 ? blend(upperIndex, lowerIndex, (t - 0.24) / 0.20) : blend(lowerIndex, footIndex, (t - 0.55) / 0.18));
    // Overlapping shields, flatter and broad at the elephantine wrist.
    for (let row = 0; row < 5; row++) for (let column = 0; column < 6; column++) {
      const around = (front ? .25 : .75) + (column / 5 - .5) * .42 + (row % 2) * .012, along = .40 + row * .095;
      bank.surface('scales', 2, 6, (u, v) => {
        const theta = u * TAU, localU = around + Math.cos(theta) * v * .038, localT = along + Math.sin(theta) * v * .039, p = vec(loftPoint(rings, localU, localT));
        const normal = p.clone().sub(vec(interpolateRing(rings, localT).slice(0, 3))).normalize();
        return p.addScaledVector(normal, .0005 + .0018 * (1 - v * v)).toArray();
      }, (p, u, v) => skinColor(p, around + Math.cos(u * TAU) * v * .038, along + Math.sin(u * TAU) * v * .039), (p, u, v) => {
        const t = along + Math.sin(u * TAU) * v * .039;
        return t < .42 ? blend(upperIndex, lowerIndex, (t - .24) / .20) : blend(lowerIndex, footIndex, (t - .55) / .18);
      }, true, (u, v) => [around + Math.cos(u * TAU) * v * .038, along + Math.sin(u * TAU) * v * .039]);
    }
    const count = front ? 5 : 4;
    for (let toe = 0; toe < count; toe++) {
      const lateral = (toe / (count - 1) - 0.5) * 0.235, fwd = front ? 1 : -1;
      const root = [ankle[0] + lateral, 0.045, ankle[2] + fwd * (.048 + .027 * Math.sin(toe / (count - 1) * Math.PI))];
      const reach = .077 + .029 * Math.sin(toe / (count - 1) * Math.PI);
      loft(bank, 'claws', [[...root, 0.025, 0.026], [root[0] + lateral * 0.09, 0.04, root[2] + fwd * reach * .54, 0.024, 0.020], [root[0] + lateral * 0.12, 0.020, root[2] + fwd * reach, 0.005, 0.003]], 6, 8, (p, u, t) => [.28 + t * .11, .27 + t * .09, .17 + t * .055], () => [[footIndex, 1]]);
    }
  }
  loft(bank, 'skin', [[0, 0.44, -0.78, 0.10, 0.075], [0, 0.425, -0.94, 0.083, 0.062], [0, 0.39, -1.10, 0.046, 0.037], [0, 0.345, -1.24, 0.003, 0.003]], 20, 20, skinColor, (p) => blend(indices[tail1.name], indices[tail2.name], (-p[2] - 0.93) / 0.20));

  const materials = {}, skinTextures = authoredSurfaceTextures('skin'), scuteTextures = authoredSurfaceTextures('scute');
  for (const name of bank.data.keys()) {
    const scute = name.startsWith('scutes_'), skin = name === 'skin' || name === 'scales';
    materials[name] = new THREE.MeshStandardMaterial({ name: `slateback_${name}`, vertexColors: true, roughness: scute ? .73 + Number(name.at(-1)) * .08 : name === 'eye' || name === 'pupil' ? .28 : .90, metalness: 0, side: THREE.DoubleSide,
      ...(scute ? { ...scuteTextures, normalScale: new THREE.Vector2(.78, .78) } : skin ? { ...skinTextures, normalScale: new THREE.Vector2(.72, .72) } : {}) });
  }
  const skeleton = new THREE.Skeleton(bones); bank.finish(object, skeleton, materials);
  const bind = bones.map((b) => ({ p: b.position.clone(), q: b.quaternion.clone() }));

  function poseIK(leg, target, bodyPosition, bodyQuaternion, footPitch = 0) {
    const invBody = bodyQuaternion.clone().invert(), localTarget = target.clone().sub(bodyPosition).applyQuaternion(invBody), hip = vec(leg.hip);
    const v0 = vec(leg.elbow).sub(hip), v1 = vec(leg.ankle).sub(vec(leg.elbow)), length0 = v0.length(), length1 = v1.length();
    const direction = localTarget.clone().sub(hip), distance = clamp(direction.length(), Math.abs(length0 - length1) + 0.001, length0 + length1 - 0.001); direction.normalize();
    const restPole = vec(leg.elbow).sub(hip.clone().lerp(vec(leg.ankle), 0.5));
    let pole = restPole.addScaledVector(direction, -restPole.dot(direction));
    if (pole.lengthSq() < 0.00001) pole.set(leg.side, 0, 0).addScaledVector(direction, -leg.side * direction.x);
    pole.normalize();
    const along = (length0 * length0 + distance * distance - length1 * length1) / (2 * distance), height = Math.sqrt(Math.max(0, length0 * length0 - along * along));
    const knee = hip.clone().addScaledVector(direction, along).addScaledVector(pole, height);
    const qUpper = new THREE.Quaternion().setFromUnitVectors(v0.normalize(), knee.clone().sub(hip).normalize());
    const lowerDirection = localTarget.clone().sub(knee).normalize().applyQuaternion(qUpper.clone().invert());
    const qLower = new THREE.Quaternion().setFromUnitVectors(v1.normalize(), lowerDirection);
    leg.upper.quaternion.copy(qUpper); leg.lower.quaternion.copy(qLower);
    leg.foot.quaternion.copy(bodyQuaternion.clone().multiply(qUpper).multiply(qLower).invert()).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), footPitch));
  }

  function pose(kind, time) {
    bones.forEach((b, i) => { b.position.copy(bind[i].p); b.quaternion.copy(bind[i].q); });
    let bob = 0, roll = 0, yaw = 0, neckPitch = 0, neckYaw = 0, retract = 0, jawOpen = 0;
    if (kind === 'Idle') { bob = 0.0035 * Math.sin(time * TAU); neckYaw = 0.035 * Math.sin(time * TAU); neckPitch = 0.025 * Math.sin(time * TAU + 0.3) - 0.025 * Math.sin(0.3); }
    if (kind === 'Walk' || kind === 'Run') {
      const running = kind === 'Run'; bob = (running ? 0.007 : 0.004) * (1 - Math.cos(time * TAU * 2)); roll = (running ? 0.026 : 0.018) * Math.sin(time * TAU); yaw = 0.012 * Math.sin(time * TAU);
      neckYaw = -yaw * 1.4; neckPitch = 0.014 * Math.sin(time * TAU * 2);
    }
    if (kind === 'Attack') {
      const prepare = Math.sin(Math.PI * clamp(time / 0.40)), snap = Math.exp(-(((time - 0.49) / 0.08) ** 2)), recover = smooth((time - 0.65) / 0.35);
      retract = 0.145 * prepare * (1 - recover); neckPitch = 0.18 * prepare - 0.17 * snap; jawOpen = 0.20 * Math.sin(Math.PI * clamp((time - 0.30) / 0.38));
      bob = -0.012 * prepare; neck2.position.z += 0.057 * snap; head.position.z += 0.025 * snap;
    }
    if (kind.startsWith('Hit')) {
      const impact = Math.sin(Math.PI * clamp(time / 0.26)) * (1 - smooth((time - 0.20) / 0.80)), envelope = Math.sin(Math.PI * time);
      retract = 0.175 * Math.max(impact, 0) + 0.04 * envelope; neckPitch = 0.16 * envelope;
      roll = (kind === 'HitLeft' ? -1 : kind === 'HitRight' ? 1 : 0) * 0.045 * envelope; yaw = -roll * 0.5; bob = -0.022 * envelope;
    }
    if (kind === 'Death') { const fall = smooth(time / 0.72); bob = -0.16 * fall; roll = 0.07 * fall; neckPitch = 0.55 * fall; retract = 0.155 * fall; jawOpen = 0.09 * fall; }
    bodyBone.position.set(Math.sin(roll) * 0.54, bob + 0.54 * (1 - Math.cos(roll)), 0); bodyBone.quaternion.setFromEuler(new THREE.Euler(0, yaw, roll));
    neck1.rotation.set(neckPitch * 0.4, neckYaw * 0.45, 0); neck2.rotation.set(neckPitch * 0.6, neckYaw * 0.55, 0); head.rotation.x = -neckPitch * 0.22;
    neck2.position.z -= retract * 0.60; head.position.z -= retract * 0.40; jaw.rotation.x = jawOpen;
    tail1.rotation.y = kind === 'Walk' || kind === 'Run' ? 0.05 * Math.sin(time * TAU) : 0.018 * Math.sin(time * TAU); tail2.rotation.y = tail1.rotation.y * 0.6;
    for (const leg of legs) {
      const target = vec(leg.ankle); let pitch = 0;
      if (kind === 'Walk' || kind === 'Run') {
        const run = kind === 'Run', stance = run ? 0.66 : 0.76, stride = run ? 0.20 : 0.14, lift = run ? 0.065 : 0.038;
        const offset = leg.front ? (leg.side < 0 ? 0 : 0.5) : (leg.side < 0 ? 0.74 : 0.24), phase = (time + offset) % 1;
        let z, y = 0;
        if (phase < stance) z = stride * (0.5 - phase / stance);
        else {
          const s = (phase - stance) / (1 - stance), tangent = -stride * (1 - stance) / stance;
          z = (2 * s ** 3 - 3 * s * s + 1) * -stride / 2 + (s ** 3 - 2 * s * s + s) * tangent + (-2 * s ** 3 + 3 * s * s) * stride / 2 + (s ** 3 - s * s) * tangent;
          y = lift * Math.sin(s * Math.PI) ** 2; pitch = -0.12 * Math.sin(s * Math.PI);
        }
        target.z += z; target.y += y;
      }
      if (kind === 'Death') { const f = smooth(time / 0.72); target.x += leg.side * 0.04 * f; target.z += (leg.front ? 1 : -1) * 0.025 * f; }
      poseIK(leg, target, bodyBone.position, bodyBone.quaternion, pitch);
    }
  }

  const specifications = [['Idle', 4.4, true], ['Walk', 2.8, true], ['Run', 1.8, true], ['Attack', 1.45, false], ['Hit', 0.8, false], ['HitLeft', 0.8, false], ['HitRight', 0.8, false], ['Death', 1.8, false]];
  const clips = specifications.map(([name, duration, loop]) => {
    const count = name === 'Attack' ? 80 : 64, times = [], positions = bones.map(() => []), quaternions = bones.map(() => []);
    for (let frame = 0; frame <= count; frame++) {
      const normalized = frame / count; pose(name, loop && frame === count ? 0 : normalized); times.push(normalized * duration);
      bones.forEach((b, i) => { positions[i].push(...b.position.toArray()); quaternions[i].push(...b.quaternion.toArray()); });
    }
    const tracks = [];
    bones.forEach((b, i) => { tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.position`, times, positions[i]), new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, quaternions[i])); });
    return new THREE.AnimationClip(name, duration, tracks);
  });
  bones.forEach((b, i) => { b.position.copy(bind[i].p); b.quaternion.copy(bind[i].q); }); object.updateMatrixWorld(true);
  let triangles = 0; object.traverse((n) => { if (n.isMesh) triangles += n.geometry.index.count / 3; });
  return { object, clips, meta: {
    id: 'slateback_tortoise', is: 'slateback tortoise', tags: ['reptile', 'tortoise', 'ground', 'quadruped', 'armored'], provenance: 'Original procedural anatomical surface modeling, scute tessellation, authored skeleton and IK clips. No external model or source creature reused.',
    attackSeconds: 1.45, contactNormalized: 0.49, impliedWalkMps: 0.14 / (0.76 * 2.8), impliedRunMps: 0.20 / (0.66 * 1.8), walkClipSeconds: 2.8, runClipSeconds: 1.8,
    gaitFootBones: legs.map((leg) => leg.foot.name), triangles,
    notes: 'Domed slate carapace with 33 fitted scutes and growth ridges, thick rolled margins, lobed ochre plastron, neck and limb openings, folded retractable neck, beaked skull, inset amber eyes, scaled elephantine feet, five front and four rear keratin claws. Four-beat planted IK gait; body stays in place; attack retracts then snaps forward; directional flinches return to bind pose and death settles.',
  } };
}
