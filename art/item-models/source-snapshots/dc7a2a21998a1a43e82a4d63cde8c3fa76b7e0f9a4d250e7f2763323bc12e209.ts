import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

// Authored directly from the approved copper cuirass, in native male bind space.
type Surface = (u: number, v: number) => THREE.Vector3;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const sq = (x: number) => x * x;

function grainTexture(leather = false): THREE.DataTexture {
  const size = 256;
  const pixels = new Uint8Array(size * size * 4);
  const rand = (x: number, y: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7 + 45.1) * 43758.5453;
    return n - Math.floor(n);
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Irregular hammer strikes, avoiding a repeating square pixel pattern.
    const cx = Math.floor(x / 6), cy = Math.floor(y / 6);
    let nearest = Infinity, coarse = .5;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const sx = cx + ox, sy = cy + oy;
      const dx = x - (sx + rand(sx, sy)) * 6;
      const dy = y - (sy + rand(sx + 53, sy + 97)) * 6;
      const distance = dx * dx + dy * dy;
      if (distance < nearest) { nearest = distance; coarse = rand(sx + 13, sy + 19); }
    }
    const fine = rand(x, y);
    const scratch = Math.abs(Math.sin(x * .27 + y * .59 + Math.sin(y * .12))) < .035;
    const k = leather ? .72 + fine * .20 + coarse * .15 : .935 + coarse * .061 + fine * .011 - (scratch ? .022 : 0);
    const color = leather ? [78, 45, 29] : [227, 126, 76];
    const offset = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) pixels[offset + c] = Math.min(255, color[c]! * k);
    pixels[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.name = leather ? 'creased-brown-leather-grain' : 'hammered-copper-flecks-and-scratches';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function grainNormal(source: THREE.DataTexture, strength: number): THREE.DataTexture {
  const size = 256, sourceData = source.image.data as Uint8Array;
  const pixels = new Uint8Array(size * size * 4);
  const height = (x: number, y: number) => sourceData[(((y + size) % size) * size + ((x + size) % size)) * 4]! / 255;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = V((height(x - 1, y) - height(x + 1, y)) * strength, (height(x, y - 1) - height(x, y + 1)) * strength, 1).normalize();
    const i = (y * size + x) * 4;
    pixels[i] = Math.round((n.x * .5 + .5) * 255);
    pixels[i + 1] = Math.round((n.y * .5 + .5) * 255);
    pixels[i + 2] = Math.round((n.z * .5 + .5) * 255); pixels[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.name = `${source.name}-tangent-normal`;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

function hammeredNormal(): THREE.DataTexture {
  const size = 256, spacing = 8;
  const pixels = new Uint8Array(size * size * 4);
  const random = (x: number, y: number) => {
    const n = Math.sin(((x + 32) % 32) * 127.1 + ((y + 32) % 32) * 311.7 + 12.4) * 43758.5453;
    return n - Math.floor(n);
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let dx = 0, dy = 0;
    const cx = Math.floor(x / spacing), cy = Math.floor(y / spacing);
    // Smooth, shallow individual hammer depressions. Color flecks do not drive relief.
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const sx = cx + ox, sy = cy + oy;
      const px = x - (sx + .2 + random(sx, sy) * .6) * spacing;
      const py = y - (sy + .2 + random(sy, sx + 7) * .6) * spacing;
      const width = 6 + random(sx + 9, sy + 3) * 4;
      const bell = Math.exp(-(px * px + py * py) / width);
      dx += px * bell * .078; dy += py * bell * .078;
    }
    const n = V(-dx, -dy, 1).normalize(), i = (y * size + x) * 4;
    pixels[i] = Math.round((n.x * .5 + .5) * 255);
    pixels[i + 1] = Math.round((n.y * .5 + .5) * 255);
    pixels[i + 2] = Math.round((n.z * .5 + .5) * 255); pixels[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.name = 'copper-shallow-rounded-hammer-strike-normal';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

export const author: ItemModelAuthor = {
  ids: ['grithe_cuirass'],
  build(itemId) {
    if (itemId !== 'grithe_cuirass') throw new Error(`Unsupported cuirass ${itemId}`);
    const root = new THREE.Group();
    root.name = 'grithe_cuirass-native-bind';
    root.userData.itemModel = {
      itemId, author: 'pilot-armor', reference: 'art/item-icons/generated/grithe_cuirass.png',
      description: 'Hollow hammered copper anatomical cuirass, rolled copper rims, riveted leather shoulder mounts, brass eyelets and crossed rawhide side laces.',
      wearable: true,
    };
    const copperMap = grainTexture();
    const hideMap = grainTexture(true);
    const copper = new THREE.MeshPhysicalMaterial({ name: 'forged-hammered-copper', map: copperMap, metalness: .79, roughness: .265, clearcoat: .18, clearcoatRoughness: .23, normalMap: hammeredNormal() });
    const inner = new THREE.MeshStandardMaterial({ name: 'dark-copper-interior', color: '#633721', metalness: .65, roughness: .6 });
    const rim = new THREE.MeshStandardMaterial({ name: 'polished-copper-rolled-edges', color: '#d8874a', metalness: .85, roughness: .28 });
    const leather = new THREE.MeshStandardMaterial({ name: 'dark-brown-leather-straps-and-gussets', map: hideMap, roughness: .83, normalMap: grainNormal(hideMap, 1.5) });
    const brass = new THREE.MeshStandardMaterial({ name: 'aged-brass-rivets-and-eyelets', color: '#dfb961', metalness: .72, roughness: .23 });
    const lace = new THREE.MeshStandardMaterial({ name: 'tan-rawhide-lacing', color: '#ac8050', roughness: .91 });
    const mesh = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]) => {
      const result = new THREE.Mesh(geometry, material); result.name = name;
      result.castShadow = result.receiveShadow = true; root.add(result); return result;
    };
    // Closed thin walls around open garment panels, never a filled torso solid.
    function shell(name: string, surface: Surface, nx: number, ny: number, thickness: number, material: THREE.Material) {
      const positions: number[] = [], uv: number[] = [], indices: number[] = [];
      const outer: THREE.Vector3[] = [];
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) outer.push(surface(i / nx, j / ny));
      const count = outer.length;
      for (let layer = 0; layer < 2; layer++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
        const k = j * (nx + 1) + i;
        const du = outer[j * (nx + 1) + Math.min(nx, i + 1)]!.clone().sub(outer[j * (nx + 1) + Math.max(0, i - 1)]!);
        const dv = outer[Math.min(ny, j + 1) * (nx + 1) + i]!.clone().sub(outer[Math.max(0, j - 1) * (nx + 1) + i]!);
        const normal = du.cross(dv).normalize();
        const p = outer[k]!.clone().addScaledVector(normal, layer ? -thickness : 0);
        positions.push(p.x, p.y, p.z); uv.push(i / nx, material === copper ? (p.y - 1) / .5 : j / ny);
      }
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
      const outerCount = indices.length;
      for (let i = 0; i < outerCount; i += 3) indices.push(indices[i]! + count, indices[i + 2]! + count, indices[i + 1]! + count);
      const wall = (a: number, b: number) => indices.push(a, a + count, b, b, a + count, b + count);
      for (let i = 0; i < nx; i++) { wall(i + 1, i); wall(ny * (nx + 1) + i, ny * (nx + 1) + i + 1); }
      for (let j = 0; j < ny; j++) { wall(j * (nx + 1), (j + 1) * (nx + 1)); wall((j + 1) * (nx + 1) + nx, j * (nx + 1) + nx); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(indices); g.computeVertexNormals();
      g.addGroup(0, outerCount, 0); g.addGroup(outerCount, outerCount, material === copper ? 1 : 0); g.addGroup(outerCount * 2, indices.length - outerCount * 2, 0);
      return mesh(name, g, [material, inner]);
    }
    function tube(name: string, points: THREE.Vector3[], radius: number, material: THREE.Material, segments = 48) {
      return mesh(name, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, radius, 6, false), material);
    }
    const radius = (y: number) => .151 + .037 * Math.exp(-sq((y - 1.34) / .117)) + .017 * Math.exp(-sq((y - 1.015) / .043));
    function torso(theta: number, y: number, offset = 0) {
      const front = Math.cos(theta) >= 0;
      const chest = Math.exp(-sq((y - 1.33) / .103));
      const hem = Math.exp(-sq((y - 1.015) / .04));
      const depth = front ? .156 + .018 * chest + .009 * hem : .131 + .010 * chest + .006 * hem;
      const x = (radius(y) + offset) * Math.sin(theta);
      let z = (depth + offset) * Math.cos(theta) - .018;
      if (front) {
        const pec = .012 * Math.exp(-sq((Math.abs(x) - .084) / .061) - sq((y - 1.334) / .070));
        const abs = .006 * Math.exp(-sq((Math.abs(x) - .037) / .034)) * (Math.exp(-sq((y - 1.24) / .031)) + Math.exp(-sq((y - 1.185) / .031)));
        z += (pec + abs) * Math.cos(theta);
      }
      return V(x, y, z);
    }
    function top(theta: number, front: boolean) {
      const a = Math.abs(theta);
      // Shoulder peaks, generous neck scoop, descending cutout toward armpit.
      return (front ? 1.427 : 1.434) + (front ? .053 : .046) * Math.exp(-sq((a - .83) / .29)) - .151 * Math.pow(a / 1.25, 7);
    }
    const panel = (front: boolean): Surface => (u, v) => {
      const t = (u * 2 - 1) * (front ? 1.1 : 1.25);
      const theta = front ? t : Math.PI + t;
      const bottom = 1.009 + .014 * Math.abs(Math.sin(t));
      return torso(theta, THREE.MathUtils.lerp(bottom, top(t * (front ? 1.25 / 1.1 : 1), front), v));
    };
    const front = panel(true), back = panel(false);
    shell('chest-copper-anatomical-front', front, 64, 48, .0032, copper);
    shell('chest-copper-curved-back', back, 48, 40, .0032, copper);
    for (const [name, surface] of [['front', front], ['back', back]] as const) {
      for (const edge of [0, 1]) {
        tube(`chest-${name}-${edge ? 'neck-arm' : 'hem'}-rolled-rim`, Array.from({ length: 81 }, (_, i) => surface(i / 80, edge)), .0022, rim, 80);
        tube(`chest-${name}-${edge ? 'left' : 'right'}-side-rim`, Array.from({ length: 41 }, (_, i) => surface(edge, i / 40)), .0018, rim, 40);
      }
      shell(`belt-${name}-copper-hem-band`, (u, v) => surface(u, v * .065).addScaledVector(V(Math.sin((u * 2 - 1) * (name === 'front' ? 1.1 : 1.25) + (name === 'back' ? Math.PI : 0)), 0, Math.cos((u * 2 - 1) * (name === 'front' ? 1.1 : 1.25) + (name === 'back' ? Math.PI : 0))), .002), 48, 3, .002, copper);
      for (let i = 0; i < 7; i++) {
        const t = (i / 6 * 2 - 1) * (name === 'front' ? 1.04 : 1.18) + (name === 'back' ? Math.PI : 0);
        rivet(`belt-${name}-rivet-${i}`, torso(t, 1.024 + .014 * Math.abs(Math.sin(t)), .004), V(Math.sin(t), 0, Math.cos(t)), .007);
      }
    }
    function rivet(name: string, p: THREE.Vector3, normal: THREE.Vector3, r = .0044) {
      const m = mesh(name, new THREE.SphereGeometry(r, 12, 8), brass);
      m.position.copy(p); m.scale.z = .42; m.quaternion.setFromUnitVectors(V(0, 0, 1), normal.clone().normalize());
    }
    for (const side of [-1, 1]) {
      const sideSurface: Surface = (u, v) => torso(side * (1.095 + u * (Math.PI - 2.34)), 1.026 + v * .252, -.003);
      // Reverse the left gusset parameterization so its outer normals face out.
      shell(`chest-${side}-leather-side-gusset`, side === 1 ? (u, v) => sideSurface(u, v) : (u, v) => sideSurface(1 - u, v), 14, 24, .004, leather);
      const eye = (theta: number, y: number, name: string) => {
        const normal = V(Math.sin(theta), 0, Math.cos(theta));
        const p = torso(theta, y, .0045);
        const m = mesh(name, new THREE.TorusGeometry(.0075, .002, 7, 14), brass);
        m.position.copy(p); m.quaternion.setFromUnitVectors(V(0, 0, 1), normal);
        return p;
      };
      for (let row = 0; row < 5; row++) {
        const y = 1.054 + row * .049;
        eye(side * 1.055, y, `chest-${side}-front-eyelet-${row}`);
        eye(side * 1.936, y, `chest-${side}-back-eyelet-${row}`);
        if (row < 4) for (const cross of [false, true]) {
          const points = Array.from({ length: 15 }, (_, i) => {
            const f = i / 14;
            return torso(side * (1.055 + .881 * f), y + .049 * (cross ? 1 - f : f), .009 + Math.sin(Math.PI * f) * (cross ? .002 : .004));
          });
          tube(`chest-${side}-crossed-rawhide-${row}-${cross}`, points, .0028, lace, 20);
        }
      }
      tube(`chest-${side}-lace-loose-tail`, [torso(side * 1.42, 1.077, .012), torso(side * 1.46, 1.052, .016), torso(side * 1.52, 1.032, .019)], .0028, lace, 12);
      // The plate continues over each shoulder. Leather mounts sit directly on it.
      const shoulder = (x: number, v: number, lift: number) => {
        if (v < .24 || v > .76) {
          const isFront = v < .24;
          const f = isFront ? v / .24 : (1 - v) / .24;
          const y = 1.439 + .038 * f;
          const angle = Math.asin(Math.min(.99, x / radius(y)));
          const p = torso(isFront ? side * angle : side * (Math.PI - angle), y, .003 + lift);
          p.x = side * x;
          return p;
        }
        const f = (v - .24) / .52;
        const angle = Math.asin(Math.min(.99, x / radius(1.477)));
        const a = torso(side * angle, 1.477, .003 + lift);
        const b = torso(side * (Math.PI - angle), 1.477, .003 + lift);
        return V(side * x, 1.477 + (.009 + lift) * Math.sin(Math.PI * f), THREE.MathUtils.lerp(a.z, b.z, f));
      };
      const copperShoulder: Surface = (u, v) => shoulder(.085 + u * .066, v, 0);
      shell(`shoulder-${side}-integrated-copper-arch`, side === 1 ? copperShoulder : (u, v) => copperShoulder(1 - u, v), 10, 32, .0032, copper);
      for (const edge of [0, 1]) tube(`shoulder-${side}-copper-arch-rim-${edge}`, Array.from({ length: 41 }, (_, i) => copperShoulder(edge, i / 40)), .0018, rim, 40);
      const strap: Surface = (u, v) => shoulder(.095 + u * .045, .035 + v * .93, .003);
      shell(`shoulder-${side}-leather-bridge`, side === 1 ? strap : (u, v) => strap(1 - u, v), 8, 32, .005, leather);
      for (const edge of [0, 1]) tube(`shoulder-${side}-stitched-edge-${edge}`, Array.from({ length: 25 }, (_, i) => strap(edge ? .92 : .08, i / 24).add(V(0, .001, 0))), .0007, lace, 30);
      for (const v of [.045, .13, .87, .955]) {
        const normal = V(side * .5, .15, v < .5 ? .85 : -.85).normalize();
        rivet(`shoulder-${side}-mount-rivet-${v}`, strap(.5, v).addScaledVector(normal, .0025), normal, .0065);
      }
    }
    return root;
  },
};
