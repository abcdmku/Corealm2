import * as THREE from 'three';

// Authored at metre scale. All working faces point toward +Z.
function palette() {
  const mat = (color: number, roughness = 0.85, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const materials = {
    stone: [mat(0x7e7568), mat(0x877c6e), mat(0x736c62), mat(0x8b7e6d)],
    mortar: mat(0x393631), iron: mat(0x292b2b, 0.62, 0.7), edge: mat(0x65696a, 0.35, 0.85),
    wood: mat(0x66452d), cut: mat(0x997249), soot: mat(0x171818),
    ember: new THREE.MeshStandardMaterial({ color: 0xb74017, emissive: 0xe65317, emissiveIntensity: 0.65, roughness: 1 }),
    copper: mat(0x895333, 0.5, 0.55),
  };
  materials.stone.forEach((stone, i) => { stone.name = `Corealm weathered strata@workshop-${i}`; });
  materials.wood.name = 'Bark_Corealm@workshop';
  materials.cut.name = 'Workshop cut timber';
  materials.mortar.name = 'Workshop recessed mortar';
  materials.iron.name = 'Workshop forged iron';
  materials.edge.name = 'Workshop polished iron edges';
  materials.soot.name = 'Workshop soot and charcoal';
  materials.ember.name = 'Workshop glowing embers';
  materials.copper.name = 'Workshop aged copper';
  return materials;
}
type Palette = ReturnType<typeof palette>;
function mesh(g: THREE.Group, geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) {
  if (material.name.startsWith('Corealm weathered strata@')) {
    // Continuous metre-space projection avoids one full texture repeat on every brick.
    const positions = geo.getAttribute('position'), normals = geo.getAttribute('normal'), uv = geo.getAttribute('uv');
    for (let i = 0; i < positions.count; i++) {
      const px = positions.getX(i) + x, py = positions.getY(i) + y, pz = positions.getZ(i) + z;
      const nx = normals.getX(i), ny = normals.getY(i), nz = normals.getZ(i);
      if (Math.abs(ny) > Math.abs(nx) && Math.abs(ny) > Math.abs(nz)) uv.setXY(i, px, -pz * Math.sign(ny));
      else if (Math.abs(nx) > Math.abs(nz)) uv.setXY(i, -pz * Math.sign(nx), py);
      else uv.setXY(i, px * Math.sign(nz), py);
    }
    uv.needsUpdate = true;
  }
  const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
}
function box(g: THREE.Group, p: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) {
  return mesh(g, new THREE.BoxGeometry(w, h, d), p, x, y, z);
}
function cylinder(g: THREE.Group, p: THREE.Material, x: number, y: number, z: number, top: number, bottom: number, height: number, n = 12) {
  const geo = new THREE.CylinderGeometry(top, bottom, height, n);
  if (p.name.startsWith('Bark_Corealm@')) {
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * (top + bottom), uv.getY(i) * height);
    uv.needsUpdate = true;
  }
  return mesh(g, geo, p, x, y, z);
}
function beam(g: THREE.Group, p: THREE.Material, a: number[], b: number[], r: number) {
  const start = new THREE.Vector3(...a as [number, number, number]);
  const end = new THREE.Vector3(...b as [number, number, number]);
  const m = cylinder(g, p, 0, 0, 0, r, r, start.distanceTo(end), 8);
  m.position.copy(start).add(end).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
  return m;
}
function profile(g: THREE.Group, p: THREE.Material, points: [number, number][], depth: number, z: number, bevel = 0.008) {
  const s = new THREE.Shape(); points.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); s.closePath();
  return mesh(g, new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, steps: 1 }), p, 0, 0, z);
}
function arch(g: THREE.Group, p: Palette, cy: number, inner: number, outer: number, front: number, depth: number, segments = 9) {
  for (let i = 0; i < segments; i++) {
    const a = i * Math.PI / segments + 0.014, b = (i + 1) * Math.PI / segments - 0.014;
    profile(g, p.stone[i % 4]!, [[Math.cos(a) * inner, cy + Math.sin(a) * inner], [Math.cos(a) * outer, cy + Math.sin(a) * outer], [Math.cos(b) * outer, cy + Math.sin(b) * outer], [Math.cos(b) * inner, cy + Math.sin(b) * inner]], depth, front - depth, 0.003);
  }
}
function brickWall(g: THREE.Group, p: Palette, x: number, z: number, w: number, d: number, bottom: number, rows: number, course = 0.19) {
  box(g, p.mortar, x, bottom + rows * course / 2, z, w - 0.012, rows * course - 0.014, d - 0.012);
  for (let row = 0; row < rows; row++) {
    const count = Math.max(1, Math.ceil(w / 0.32) + row % 2);
    for (let i = 0; i < count; i++) box(g, p.stone[(row * 3 + i) % 4]!, x - w / 2 + (i + 0.5) * w / count, bottom + (row + 0.5) * course, z, w / count - 0.015, course - 0.018, d);
  }
}
function coals(g: THREE.Group, p: Palette, y: number, z: number, width: number, depth: number) {
  box(g, p.soot, 0, y - 0.025, z, width, 0.05, depth);
  for (let i = 0; i < 24; i++) {
    const m = mesh(g, new THREE.DodecahedronGeometry(0.035 + (i % 3) * 0.009, 0), i % 3 ? p.soot : p.ember, ((i * 7 % 23) / 22 - 0.5) * (width - 0.08), y + 0.018, z + ((i * 11 % 23) / 22 - 0.5) * (depth - 0.06));
    m.scale.y = 0.5; m.rotation.set(i, i * 0.7, i * 0.31);
  }
}
function strap(g: THREE.Group, p: Palette, width: number, depth: number, y: number, z = 0) {
  box(g, p.iron, 0, y, z + depth / 2, width, 0.045, 0.018);
  box(g, p.iron, 0, y, z - depth / 2, width, 0.045, 0.018);
  for (const sign of [-1, 1]) {
    box(g, p.iron, sign * width / 2, y, z, 0.018, 0.045, depth);
    for (const x of [-0.34, 0.34]) {
      const rivet = cylinder(g, p.edge, x * width, y, z + sign * (depth / 2 + 0.015), 0.015, 0.015, 0.012, 8); rivet.rotation.x = Math.PI / 2;
    }
  }
}

export function buildFurnace(): THREE.Group {
  const g = new THREE.Group(); g.name = 'town_masonry_smelter'; const p = palette();
  box(g, p.stone[2]!, 0, 0.085, 0, 1.5, 0.17, 1.3);
  box(g, p.stone[1]!, 0, 0.205, 0.04, 1.38, 0.07, 1.2);
  // Side piers and back are solid; the forward fire chamber stays open.
  brickWall(g, p, -0.505, -0.04, 0.33, 1.08, 0.24, 4);
  brickWall(g, p, 0.505, -0.04, 0.33, 1.08, 0.24, 4);
  brickWall(g, p, 0, -0.48, 0.7, 0.2, 0.24, 4);
  box(g, p.soot, 0, 0.63, -0.365, 0.7, 0.76, 0.025);
  coals(g, p, 0.295, 0.04, 0.63, 0.65);
  arch(g, p, 0.66, 0.345, 0.565, 0.535, 0.27);
  // Spandrels close the wedges above the outer arch and carry the hood shoulders.
  // Their curved lower edges follow the voussoirs; the firebox remains unobstructed.
  const springTop = 1.0, hoodBottom = 1.205, archRadius = 0.565, archCentre = 0.66;
  const angleStart = Math.asin((springTop - archCentre) / archRadius);
  const angleEnd = Math.asin((hoodBottom - archCentre) / archRadius);
  for (const sign of [-1, 1]) {
    const points: [number, number][] = [[sign * 0.665, springTop]];
    for (let i = 0; i <= 8; i++) {
      const angle = angleStart + (angleEnd - angleStart) * i / 8;
      points.push([sign * archRadius * Math.cos(angle), archCentre + archRadius * Math.sin(angle)]);
    }
    points.push([sign * 0.665, hoodBottom]);
    profile(g, p.stone[1]!, points, 0.27, 0.265, 0.002);
    brickWall(g, p, sign * 0.505, -0.16, 0.33, 0.84, springTop, 1, hoodBottom - springTop);
  }
  brickWall(g, p, 0, -0.48, 0.7, 0.2, springTop, 1, hoodBottom - springTop);
  // Corbelled masonry hood rests on the arch and piers.
  brickWall(g, p, 0, -0.11, 1.33, 0.84, 1.205, 1, 0.17);
  brickWall(g, p, 0, -0.15, 1.12, 0.78, 1.375, 1, 0.17);
  brickWall(g, p, 0, -0.19, 0.88, 0.65, 1.545, 1, 0.16);
  brickWall(g, p, 0, -0.22, 0.5, 0.46, 1.705, 2, 0.19);
  box(g, p.stone[2]!, 0, 2.13, -0.22, 0.6, 0.09, 0.55);
  box(g, p.soot, 0, 2.178, -0.22, 0.32, 0.009, 0.27);
  strap(g, p, 1.345, 0.86, 1.3, -0.11);
  strap(g, p, 0.515, 0.47, 1.92, -0.22);
  // Low removable grate and the tap-hole below the fire bed.
  for (const x of [-0.25, -0.125, 0, 0.125, 0.25]) beam(g, p.iron, [x, 0.32, 0.42], [x, 0.48, 0.42], 0.014);
  beam(g, p.iron, [-0.31, 0.39, 0.43], [0.31, 0.39, 0.43], 0.016);
  box(g, p.iron, 0.48, 0.43, 0.51, 0.19, 0.22, 0.026);
  const tap = cylinder(g, p.soot, 0.48, 0.44, 0.54, 0.048, 0.048, 0.026); tap.rotation.x = Math.PI / 2;
  // Pokers lean against the side with broad visible loop handles.
  beam(g, p.iron, [0.67, 0.19, 0.48], [0.77, 1.12, 0.19], 0.016);
  const loop = mesh(g, new THREE.TorusGeometry(0.045, 0.012, 6, 12), p.iron, 0.77, 1.16, 0.18); loop.rotation.y = 0.2;
  return g;
}

export function buildAnvil(): THREE.Group {
  const g = new THREE.Group(); g.name = 'town_smith_anvil'; const p = palette();
  cylinder(g, p.wood, 0, 0.275, 0, 0.32, 0.385, 0.55, 11);
  cylinder(g, p.cut, 0, 0.56, 0, 0.323, 0.323, 0.022, 11);
  for (let i = 0; i < 11; i++) {
    const a = i / 11 * Math.PI * 2;
    beam(g, p.mortar, [Math.sin(a) * 0.369, 0.045, Math.cos(a) * 0.369], [Math.sin(a) * 0.319, 0.525, Math.cos(a) * 0.319], 0.009);
  }
  for (const y of [0.12, 0.46]) {
    const ring = mesh(g, new THREE.TorusGeometry(y < 0.2 ? 0.369 : 0.334, 0.021, 4, 22), p.iron, 0, y, 0); ring.rotation.x = Math.PI / 2;
  }
  box(g, p.iron, 0, 0.595, 0, 0.57, 0.065, 0.36);
  profile(g, p.iron, [[-0.27, 0.62], [0.27, 0.62], [0.14, 0.74], [0.15, 0.83], [0.33, 0.905], [0.33, 0.975], [-0.34, 0.975], [-0.34, 0.90], [-0.14, 0.82], [-0.14, 0.74]], 0.25, -0.125, 0.012);
  box(g, p.edge, -0.01, 0.979, 0, 0.68, 0.027, 0.285);
  // Forged horn tapers horizontally from the left shoulder.
  const horn = cylinder(g, p.edge, -0.49, 0.866, 0, 0.008, 0.125, 0.37, 12); horn.rotation.z = Math.PI / 2;
  horn.scale.z = 0.86;
  // Hardy hole is an inset dark square in the heel, rimmed by the striking face.
  box(g, p.soot, 0.225, 0.994, 0, 0.055, 0.004, 0.055);
  for (const x of [-0.23, 0.23]) for (const z of [-0.15, 0.15]) cylinder(g, p.edge, x, 0.635, z, 0.022, 0.025, 0.033, 6);
  // Hammer and tongs hang off the near face of the stump.
  beam(g, p.cut, [0.38, 0.1, 0.3], [0.26, 0.58, 0.3], 0.028);
  const hammer = box(g, p.iron, 0.27, 0.57, 0.3, 0.22, 0.09, 0.09); hammer.rotation.z = 0.25;
  for (const sign of [-1, 1]) {
    beam(g, p.iron, [-0.2 + sign * 0.055, 0.12, 0.35], [-0.2 - sign * 0.027, 0.43, 0.35], 0.013);
    beam(g, p.iron, [-0.2 - sign * 0.027, 0.43, 0.35], [-0.2 - sign * 0.062, 0.54, 0.35], 0.013);
  }
  return g;
}

export function buildCookingRange(): THREE.Group {
  const g = new THREE.Group(); g.name = 'town_masonry_cooking_range'; const p = palette();
  box(g, p.stone[2]!, 0, 0.07, 0, 1.58, 0.14, 1.1);
  brickWall(g, p, -0.56, -0.01, 0.38, 0.94, 0.14, 3);
  brickWall(g, p, 0.56, -0.01, 0.38, 0.94, 0.14, 3);
  brickWall(g, p, 0, -0.4, 0.74, 0.19, 0.14, 3);
  box(g, p.soot, 0, 0.42, -0.293, 0.75, 0.53, 0.02);
  coals(g, p, 0.21, 0.025, 0.67, 0.62);
  arch(g, p, 0.35, 0.35, 0.5, 0.47, 0.22, 7);
  box(g, p.iron, 0, 0.845, -0.015, 1.55, 0.065, 1.02);
  strap(g, p, 1.56, 1.025, 0.84, -0.015);
  // Raised burner rings keep cookware off the flat plate.
  for (const x of [-0.38, 0.34]) {
    cylinder(g, p.soot, x, 0.882, 0.04, 0.22, 0.22, 0.012, 24);
    const ring = mesh(g, new THREE.TorusGeometry(0.205, 0.019, 6, 24), p.edge, x, 0.895, 0.04); ring.rotation.x = Math.PI / 2;
  }
  // Copper stockpot has a real open rim and dark soup surface.
  const potProfile = [new THREE.Vector2(0.13, 0), new THREE.Vector2(0.17, 0.03), new THREE.Vector2(0.18, 0.21), new THREE.Vector2(0.166, 0.22), new THREE.Vector2(0.152, 0.20), new THREE.Vector2(0.148, 0.035)];
  mesh(g, new THREE.LatheGeometry(potProfile, 24), p.copper, -0.38, 0.904, 0.04);
  cylinder(g, p.soot, -0.38, 1.08, 0.04, 0.151, 0.151, 0.008, 24);
  for (const x of [-0.595, -0.165]) {
    const handle = mesh(g, new THREE.TorusGeometry(0.05, 0.012, 6, 12), p.iron, x, 1.067, 0.04); handle.rotation.y = Math.PI / 2;
  }
  cylinder(g, p.iron, 0.34, 0.912, 0.04, 0.185, 0.165, 0.035, 24);
  const panRim = mesh(g, new THREE.TorusGeometry(0.185, 0.017, 6, 24), p.edge, 0.34, 0.93, 0.04); panRim.rotation.x = Math.PI / 2;
  beam(g, p.iron, [0.34, 0.925, 0.2], [0.34, 0.96, 0.51], 0.023);
  // Rear chimney rises from its supported masonry back and has a capped, open top.
  brickWall(g, p, 0, -0.38, 0.48, 0.27, 0.88, 4, 0.2);
  box(g, p.stone[2]!, 0, 1.735, -0.38, 0.58, 0.11, 0.36);
  box(g, p.soot, 0, 1.795, -0.38, 0.32, 0.008, 0.16);
  for (const x of [-0.22, 0.22]) {
    beam(g, p.iron, [x, 0.22, 0.41], [x, 0.41, 0.41], 0.012);
  }
  beam(g, p.iron, [-0.31, 0.28, 0.42], [0.31, 0.28, 0.42], 0.014);
  // Oven rake and a copper ladle hang from the right pier.
  beam(g, p.iron, [0.67, 0.23, 0.51], [0.67, 0.7, 0.51], 0.014);
  const ladle = mesh(g, new THREE.SphereGeometry(0.055, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), p.copper, 0.67, 0.25, 0.51); ladle.rotation.x = Math.PI;
  return g;
}
