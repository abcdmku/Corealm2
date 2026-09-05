const TAU = Math.PI * 2;
const TEXTURE_SIZE = 256;

const PROFILES = {
  antler_beetle: {
    seed: 17,
    pattern: 'chitin',
    shell: ['#1b2421', '#28362d', '#354237'],
    shellAlt: ['#1d2722', '#2b382f', '#37443a'],
    horn: ['#24241f', '#35312a', '#413a30'],
    seam: '#1b241e',
    joint: '#28342c',
    eye: '#161410',
    detail: '#303d33',
    roughness: [0.32, 0.57],
    metalness: 0.025,
    normalScale: 0.58,
  },
  slag_centipede: {
    seed: 83,
    pattern: 'slag',
    shell: ['#282c2b', '#3a3e3b', '#4e4e43'],
    shellAlt: ['#302e29', '#454039', '#575047'],
    horn: ['#282723', '#38332c', '#494033'],
    seam: '#473225',
    joint: '#332820',
    eye: '#342319',
    detail: '#755136',
    roughness: [0.61, 0.9],
    metalness: 0.055,
    normalScale: 0.7,
  },
  hollowroot_spider: {
    seed: 139,
    pattern: 'root',
    shell: ['#2d3024', '#535543', '#75755a'],
    shellAlt: ['#343529', '#555640', '#747055'],
    horn: ['#282b20', '#3d4030', '#565b42'],
    seam: '#3d4031',
    joint: '#464a36',
    eye: '#131511',
    detail: '#51543e',
    roughness: [0.7, 0.94],
    metalness: 0.015,
    normalScale: 0.62,
  },
};

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const mix = (a, b, weight) => a + (b - a) * weight;
const smooth = (value) => value * value * (3 - 2 * value);

function hash(x, y, seed) {
  let value = Math.imul(x + seed * 31, 374761393) ^ Math.imul(y + seed * 13, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

// Integer lattice sizes keep every noise layer continuous across a UV seam.
function noise(u, v, cellsX, cellsY, seed) {
  const x = u * cellsX;
  const y = v * cellsY;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const sx = smooth(x - ix);
  const sy = smooth(y - iy);
  const wrapX = (n) => ((n % cellsX) + cellsX) % cellsX;
  const wrapY = (n) => ((n % cellsY) + cellsY) % cellsY;
  return mix(
    mix(hash(wrapX(ix), wrapY(iy), seed), hash(wrapX(ix + 1), wrapY(iy), seed), sx),
    mix(hash(wrapX(ix), wrapY(iy + 1), seed), hash(wrapX(ix + 1), wrapY(iy + 1), seed), sx),
    sy,
  );
}

function rgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function paletteColor(palette, value) {
  const index = value < 0.5 ? 0 : 1;
  const amount = value < 0.5 ? value * 2 : value * 2 - 1;
  return palette[index].map((channel, i) => mix(channel, palette[index + 1][i], amount));
}

// Pigment follows the egg mesh's dorsal UVs. It never changes surface relief.
function dorsalFolium(u, v) {
  const t = (v - 0.3) / 0.52;
  if (t <= 0 || t >= 1) return 0;
  const center = 0.25 + Math.sin(t * TAU) * 0.003;
  const distance = Math.abs(u - center);
  const taper = Math.pow(Math.sin(t * Math.PI), 0.48);
  const scallops = 0.88 + 0.12 * Math.cos(t * TAU * 5);
  const halfWidth = 0.09 * taper * scallops;
  const border = smooth(clamp((halfWidth - distance) / 0.006));
  const spine = smooth(clamp((0.012 * taper - distance) / 0.006));
  let branches = 0;
  for (const start of [0.385, 0.465, 0.545, 0.625, 0.705]) {
    const branchDistance = Math.abs(v - (start + distance * 0.65));
    branches = Math.max(branches, smooth(clamp((0.008 - branchDistance) / 0.005)));
  }
  return border * (0.6 + Math.max(spine, branches) * 0.24);
}

function samplePattern(profile, role, u, v) {
  const seed = profile.seed + (role === 'shellAlt' ? 23 : role === 'horn' ? 47 : 0);
  const broad = noise(u, v, 5, 7, seed);
  const grain = noise(u, v, 57, 43, seed + 3);
  const pores = noise(u, v, 101, 97, seed + 9);
  const warp = noise(u, v, 8, 5, seed + 17) - 0.5;

  if (role === 'horn') {
    const fibres = 0.5 + 0.5 * Math.sin(TAU * (u * 43 + warp * 0.1));
    const baseRoughness = profile.pattern === 'chitin' ? 0.42 : profile.pattern === 'root' ? 0.63 : 0.56;
    return {
      color: 0.46 + broad * 0.08 + fibres * 0.025,
      height: 0.5 + fibres * 0.022 + grain * 0.012,
      roughness: baseRoughness + broad * 0.12 - fibres * 0.035,
      moss: 0,
    };
  }

  if (profile.pattern === 'chitin') {
    const striae = 0.5 + 0.5 * Math.sin(TAU * (u * 41 + warp * 0.09));
    const punctures = Math.pow(clamp((pores - 0.57) / 0.43), 2);
    return {
      color: 0.43 + broad * 0.1 + striae * 0.025 - punctures * 0.035,
      height: 0.5 + striae * 0.022 + grain * 0.012 - punctures * 0.055,
      roughness: mix(profile.roughness[0], profile.roughness[1], clamp(0.15 + broad * 0.45 + grain * 0.23 + punctures * 0.2)),
      moss: 0,
    };
  }

  if (profile.pattern === 'slag') {
    const bands = Math.pow(0.5 + 0.5 * Math.sin(TAU * (v * 9 + Math.sin(u * TAU * 3) * 0.08)), 6);
    const striae = Math.pow(0.5 + 0.5 * Math.cos(TAU * (u * 23 + warp * 0.35)), 6);
    const oxidation = smooth(clamp((broad - 0.42) * 2.5));
    const pits = Math.pow(clamp((pores - 0.55) * 2.22), 3);
    return {
      color: clamp(0.4 + oxidation * 0.16 + grain * 0.04 + bands * 0.025 - pits * 0.06),
      height: 0.48 + bands * 0.04 + striae * 0.025 + grain * 0.035 - pits * 0.075,
      roughness: mix(profile.roughness[0], profile.roughness[1], clamp(0.21 + oxidation * 0.32 + grain * 0.39 + pits * 0.3)),
      moss: 0,
    };
  }

  const punctures = Math.pow(clamp((pores - 0.6) / 0.4), 2);
  const moss = smooth(clamp((noise(u, v, 13, 11, seed + 21) - 0.55) * 4)) * smooth(clamp((grain - 0.42) * 3));
  return {
    color: clamp(0.42 + broad * 0.16 + grain * 0.035 - punctures * 0.04),
    height: 0.5 + grain * 0.018 - punctures * 0.028,
    roughness: mix(profile.roughness[0], profile.roughness[1], clamp(0.24 + grain * 0.4 + punctures * 0.18 + moss * 0.3)),
    moss,
    folium: role === 'shell' ? dorsalFolium(u, v) : 0,
  };
}

function dataTexture(THREE, name, pixels, color = false) {
  const texture = new THREE.DataTexture(pixels, TEXTURE_SIZE, TEXTURE_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = name;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function makeSurface(THREE, id, profile, role) {
  const count = TEXTURE_SIZE * TEXTURE_SIZE;
  const colors = new Uint8Array(count * 4);
  const roughness = new Uint8Array(count * 4);
  const normals = new Uint8Array(count * 4);
  const heights = new Float32Array(count);
  const palette = profile[role].map(rgb);
  const mossColor = [89, 96, 59];
  const foliumColor = [35, 38, 29];

  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const index = y * TEXTURE_SIZE + x;
      const sample = samplePattern(profile, role, x / TEXTURE_SIZE, y / TEXTURE_SIZE);
      const color = paletteColor(palette, sample.color);
      for (let channel = 0; channel < 3; channel += 1) {
        const mossyColor = mix(color[channel], mossColor[channel], sample.moss * 0.3);
        colors[index * 4 + channel] = Math.round(mix(mossyColor, foliumColor[channel], sample.folium ?? 0));
        roughness[index * 4 + channel] = Math.round(sample.roughness * 255);
      }
      colors[index * 4 + 3] = 255;
      roughness[index * 4 + 3] = 255;
      heights[index] = sample.height;
    }
  }

  const at = (x, y) => heights[((y + TEXTURE_SIZE) % TEXTURE_SIZE) * TEXTURE_SIZE + ((x + TEXTURE_SIZE) % TEXTURE_SIZE)];
  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const offset = (y * TEXTURE_SIZE + x) * 4;
      const dx = (at(x - 1, y) - at(x + 1, y)) * 3.4;
      const dy = (at(x, y - 1) - at(x, y + 1)) * 3.4;
      const length = Math.hypot(dx, dy, 1);
      normals[offset] = Math.round((dx / length * 0.5 + 0.5) * 255);
      normals[offset + 1] = Math.round((dy / length * 0.5 + 0.5) * 255);
      normals[offset + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
      normals[offset + 3] = 255;
    }
  }

  return {
    map: dataTexture(THREE, `${id}_${role}_color`, colors, true),
    normalMap: dataTexture(THREE, `${id}_${role}_normal`, normals),
    roughnessMap: dataTexture(THREE, `${id}_${role}_roughness`, roughness),
  };
}

/** Original tiled surfaces for the crawler source models. No DOM or asset fetches. */
export function makeCrawlerMaterials(THREE, id) {
  const profile = PROFILES[id];
  if (!profile) throw new Error(`Unknown crawler material profile: ${id}`);

  const material = (role, parameters) => new THREE.MeshStandardMaterial({
    name: `${id}_${role}`,
    side: THREE.FrontSide,
    ...parameters,
  });
  const shell = (role) => material(role, {
    ...makeSurface(THREE, id, profile, role),
    color: '#ffffff',
    metalness: profile.metalness,
    roughness: 1,
    normalScale: new THREE.Vector2(profile.normalScale, profile.normalScale),
  });

  return {
    shell: shell('shell'),
    shellAlt: shell('shellAlt'),
    seam: material('seam', { color: profile.seam, roughness: 0.79, metalness: 0.01 }),
    horn: material('horn', {
      ...makeSurface(THREE, id, profile, 'horn'),
      color: '#ffffff',
      roughness: 1,
      metalness: 0.015,
      normalScale: new THREE.Vector2(0.46, 0.46),
    }),
    joint: material('joint', { color: profile.joint, roughness: id === 'antler_beetle' ? 0.59 : 0.8, metalness: 0 }),
    eye: material('eye', { color: profile.eye, roughness: 0.2, metalness: 0 }),
    detail: material('detail', { color: profile.detail, roughness: id === 'antler_beetle' ? 0.53 : 0.75, metalness: 0.015 }),
  };
}
