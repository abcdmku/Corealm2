import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

// All dimensions are metres. Artwork has no rear view; the reverse carries the same forging.
function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + 17.8) * 43758.5453;
  return n - Math.floor(n);
}
function field(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), u), THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u), v);
}

/** Uneven overlapping hammer depressions, oxide in their hollows, and fine drawn scratches. */
function surfaceMaps(leather = false): { map: THREE.DataTexture; normalMap: THREE.DataTexture; roughnessMap: THREE.DataTexture } {
  const n = 256, heights = new Float32Array(n * n), color = new Uint8Array(n * n * 4);
  const normal = new Uint8Array(n * n * 4), rough = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const px = x / n * (leather ? 65 : 19), py = y / n * (leather ? 40 : 19);
    let nearest = 9;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = Math.floor(px) + dx, cy = Math.floor(py) + dy;
      nearest = Math.min(nearest, Math.hypot(px - cx - hash(cx, cy), py - cy - hash(cx + 73, cy + 51)));
    }
    const broad = field(x / 24, y / 24), fine = field(x / 2.6, y / 2.6);
    const scratch = Math.pow(Math.max(0, Math.sin(x * 1.7 + field(x / 27, y / 40) * 8)), 28) * (0.3 + 0.7 * field(x / 3, y / 45));
    const h = leather ? nearest * 0.35 + fine * 0.3 + broad * 0.35 : (1 - Math.cos(Math.min(nearest / 0.85, 1) * Math.PI)) * 0.28 + broad * 0.25 + fine * 0.035 - scratch * 0.025;
    const i = y * n + x; heights[i] = h;
    // Copper is freshly worked like the icon. Recess discoloration is restrained;
    // strong brown variation made the first candidate read as rust or timber.
    const mottling = leather ? 0.74 + 0.24 * h + scratch * 0.07 : 0.86 + 0.14 * h + broad * 0.025;
    const base = leather ? [72, 42, 28] : [233, 144, 88];
    for (let c = 0; c < 3; c++) color[i * 4 + c] = Math.round(base[c]! * mottling);
    color[i * 4 + 3] = 255;
    const r = leather ? 156 + 30 * (1 - h) : 92 + 82 * (1 - h);
    rough.set([r, r, r, 255], i * 4);
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const at = (xx: number, yy: number) => heights[((yy + n) % n) * n + (xx + n) % n]!;
    const v = new THREE.Vector3((at(x - 1, y) - at(x + 1, y)) * 1.1, (at(x, y - 1) - at(x, y + 1)) * 1.1, 1).normalize();
    normal.set([Math.round((v.x * 0.5 + 0.5) * 255), Math.round((v.y * 0.5 + 0.5) * 255), Math.round((v.z * 0.5 + 0.5) * 255), 255], (y * n + x) * 4);
  }
  const texture = (bytes: Uint8Array, name: string, srgb = false) => {
    const t = new THREE.DataTexture(bytes, n, n, THREE.RGBAFormat);
    t.name = name; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true; return t;
  };
  const prefix = leather ? 'creased-brown-leather' : 'hammered-copper';
  return { map: texture(color, `${prefix}-color`, true), normalMap: texture(normal, `${prefix}-normal`), roughnessMap: texture(rough, `${prefix}-roughness`) };
}

function bladeGeometry(): THREE.BufferGeometry {
  // The main face is a diamond, with a narrow honed edge on each side.
  const stations = [[0.135, 0.067, 0.019], [0.23, 0.068, 0.019], [0.69, 0.059, 0.017], [0.94, 0.053, 0.014], [1.065, 0.036, 0.009], [1.145, 0.012, 0.0038], [1.18, 0, 0]];
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const section = [[-1, 0], [-0.84, 0.19], [-0.012, 1], [0.012, 1], [0.84, 0.19], [1, 0], [0.84, -0.19], [0.012, -1], [-0.012, -1], [-0.84, -0.19]];
  const geo = new THREE.BufferGeometry();
  for (let face = 0; face < section.length; face++) {
    const start = indices.length;
    for (let j = 0; j < stations.length - 1; j++) {
      const base = positions.length / 3;
      for (const [station, side] of [[j, face], [j, (face + 1) % section.length], [j + 1, face], [j + 1, (face + 1) % section.length]]) {
        const [y, w, z] = stations[station!]!; const [sx, sz] = section[side!]!;
        positions.push(sx! * w!, y!, sz! * z!); uvs.push((sx! + 1) * 0.5, (y! - 0.135) * 3.2);
      }
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    geo.addGroup(start, indices.length - start, [0, 2, 4, 5, 7, 9].includes(face) ? 1 : [3, 6].includes(face) ? 2 : 0);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(indices); geo.computeVertexNormals();
  return geo;
}

export const author: ItemModelAuthor = {
  ids: ['grithe_sword'],
  build(itemId) {
    if (itemId !== 'grithe_sword') throw new Error(`Unsupported sword: ${itemId}`);
    const root = new THREE.Group(); root.name = 'grithe-sword-forged-copper';
    root.userData.itemModel = { itemId, author: 'pilot-sword', reference: 'art/item-icons/generated/grithe_sword.png', description: 'Copper double-edged sword: broad diamond blade, narrow honed edges, curved flared guard, brown spiral leather grip, and domed coin pommel with concentric rim. Rear and thickness inferred.', grip: [0, 0, 0] };
    const copperMaps = surfaceMaps();
    const copper = new THREE.MeshStandardMaterial({ ...copperMaps, metalness: 0.72, roughness: 0.7, normalScale: new THREE.Vector2(0.65, 0.65) }); copper.name = 'lightly-hammered-warm-copper';
    const bladeCopper = new THREE.MeshStandardMaterial({ ...copperMaps, metalness: 0.76, roughness: 0.59, normalScale: new THREE.Vector2(0.48, 0.48) }); bladeCopper.name = 'polished-copper-broad-blade-faces';
    const lessPolishedCopper = bladeCopper.clone(); lessPolishedCopper.name = 'copper-forging-retained-on-secondary-facet'; lessPolishedCopper.color.set('#e9cbb5'); lessPolishedCopper.roughness = 0.77;
    const edge = new THREE.MeshStandardMaterial({ color: '#f9b87c', metalness: 0.8, roughness: 0.23 }); edge.name = 'polished-copper-edge';
    const leather = new THREE.MeshStandardMaterial({ ...surfaceMaps(true), metalness: 0, roughness: 0.85, normalScale: new THREE.Vector2(0.55, 0.55) }); leather.name = 'dark-brown-leather';
    const seam = new THREE.MeshStandardMaterial({ color: '#56311f', roughness: 0.62 }); seam.name = 'worn-leather-wrap-edge';
    const add = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[]) => {
      const m = new THREE.Mesh(geo, mat); m.name = name; m.castShadow = m.receiveShadow = true; root.add(m); return m;
    };
    add('forged-diamond-blade-with-honed-edges', bladeGeometry(), [bladeCopper, edge, lessPolishedCopper]);

    const shape = new THREE.Shape();
    shape.moveTo(-0.178, 0.149); shape.quadraticCurveTo(-0.17, 0.161, -0.162, 0.174);
    shape.bezierCurveTo(-0.118, 0.154, -0.082, 0.139, 0, 0.151);
    shape.bezierCurveTo(0.082, 0.139, 0.118, 0.154, 0.162, 0.174);
    shape.quadraticCurveTo(0.17, 0.161, 0.178, 0.149);
    shape.lineTo(0.171, 0.12); shape.bezierCurveTo(0.10, 0.118, 0.070, 0.114, 0, 0.108);
    shape.bezierCurveTo(-0.070, 0.114, -0.1, 0.118, -0.171, 0.12); shape.closePath();
    const guardGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.028, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.0035, bevelThickness: 0.004, curveSegments: 14 });
    guardGeo.translate(0, 0, -0.014);
    const uv = guardGeo.getAttribute('uv'); for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 7, uv.getY(i) * 7);
    add('solid-bowed-crossguard-flared-terminals', guardGeo, copper);

    const gripProfile: THREE.Vector2[] = [];
    for (let i = 0; i <= 48; i++) {
      const t = i / 48, y = -0.128 + t * 0.241;
      gripProfile.push(new THREE.Vector2(0.025 + 0.006 * Math.sin(t * Math.PI * 0.82), y));
    }
    const gripGeometry = new THREE.LatheGeometry(gripProfile, 64);
    const gripPositions = gripGeometry.getAttribute('position');
    for (let i = 0; i < gripPositions.count; i++) {
      const x = gripPositions.getX(i), y = gripPositions.getY(i), z = gripPositions.getZ(i);
      const turn = (y + 0.127) / 0.238 * 8.2 - Math.atan2(x, z) / (Math.PI * 2);
      const phase = turn - Math.floor(turn);
      const bulge = 0.0015 * Math.sin(phase * Math.PI);
      const radius = Math.hypot(x, z);
      gripPositions.setXYZ(i, x * (1 + bulge / radius), y, z * (1 + bulge / radius));
    }
    gripGeometry.computeVertexNormals();
    const grip = add('leather-wrapped-oval-grip', gripGeometry, leather); grip.scale.z = 0.82;
    // Continuous raised overlap follows eight turns around the tapered oval handle.
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 640; i++) {
      const t = i / 640, a = t * Math.PI * 2 * 8.2, r = 0.025 + 0.006 * Math.sin(t * Math.PI * 0.82);
      points.push(new THREE.Vector3(Math.sin(a) * (r + 0.0007), -0.127 + t * 0.238, Math.cos(a) * (r * 0.82 + 0.0007)));
    }
    add('continuous-eight-turn-leather-overlap', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 640, 0.0019, 8, false), seam);
    for (const y of [-0.126, 0.107]) {
      const ferrule = add(y < 0 ? 'pommel-neck-copper-ferrule' : 'guard-neck-copper-ferrule', new THREE.CylinderGeometry(y < 0 ? 0.026 : 0.031, y < 0 ? 0.026 : 0.031, 0.008, 48), copper);
      ferrule.position.y = y; ferrule.scale.z = 0.82;
    }
    // A forged wheel pommel: outer rounded rim, dark shallow reveal, and raised domed centre.
    const pommelProfile = [[0, -0.014], [0.025, -0.014], [0.048, -0.010], [0.056, -0.007], [0.059, -0.002], [0.059, 0.008], [0.057, 0.013], [0.053, 0.015], [0.050, 0.012], [0.049, 0.009], [0.047, 0.009], [0.045, 0.014], [0.035, 0.019], [0.018, 0.022], [0, 0.023]];
    const pommel = add('copper-wheel-pommel-inset-domed-face', new THREE.LatheGeometry(pommelProfile.map(([r, z]) => new THREE.Vector2(r, z)), 80), copper);
    pommel.rotation.x = Math.PI / 2; pommel.position.y = -0.176;
    const rim = add('pommel-polished-concentric-front-rim', new THREE.TorusGeometry(0.0535, 0.0022, 10, 80), edge); rim.position.set(0, -0.176, 0.014);
    const insetRim = add('pommel-inner-domed-face-bead', new THREE.TorusGeometry(0.0465, 0.0012, 8, 80), edge); insetRim.position.set(0, -0.176, 0.012);
    // The visible domed front is toward +Z; the icon does not specify the reverse ornament.
    return root;
  },
};
