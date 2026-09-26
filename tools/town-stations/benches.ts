import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

type MaterialKey = "oak" | "oakDark" | "oakLight" | "endGrain" | "iron" | "ironEdge" | "leather" | "cord" | "shaft" | "feather" | "featherShade" | "wax";
type Palette = Record<MaterialKey, THREE.MeshStandardMaterial>;
type Point = [number, number, number];

function palette(): Palette {
  const material = (name: string, color: number, roughness = 0.83, metalness = 0) => {
    const result = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    result.name = name;
    return result;
  };
  return {
    oak: material("Workshop oak@heartwood", 0x72523b),
    oakDark: material("Workshop oak@aged frame", 0x4c3629),
    oakLight: material("Workshop oak@planed plank", 0x967455),
    endGrain: material("Workshop oak@end grain", 0xad8862),
    iron: material("Workshop forged iron", 0x363b3c, 0.52, 0.52),
    ironEdge: material("Workshop honed steel", 0x92958d, 0.39, 0.6),
    leather: material("Workshop worn leather", 0x654739),
    cord: material("Workshop linen cord", 0xb7a98a),
    shaft: material("Workshop ash shafts", 0xb49a70),
    feather: material("Workshop pale feathers", 0xddd2af, 0.94),
    featherShade: material("Workshop grey feather quills", 0x9b9e8b, 0.94),
    wax: material("Workshop amber wax", 0xa78149, 0.69),
  };
}

function alignTimberUv(geometry: THREE.BufferGeometry, size: Point): void {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  const axes = [0, 1, 2] as const;
  for (let i = 0; i < position.count; i++) {
    const faceAxis = axes.reduce((best, axis) => Math.abs(normal.getComponent(i, axis)) > Math.abs(normal.getComponent(i, best)) ? axis : best, 0 as 0 | 1 | 2);
    const faceAxes = axes.filter((axis) => axis !== faceAxis);
    const lengthAxis = size[faceAxes[0]!] >= size[faceAxes[1]!] ? faceAxes[0]! : faceAxes[1]!;
    const widthAxis = faceAxes[0] === lengthAxis ? faceAxes[1]! : faceAxes[0]!;
    // The long direction of each visible side carries the grain. End faces
    // receive their own planar projection rather than stretching a side UV.
    uv.setXY(i,
      position.getComponent(i, lengthAxis) / size[lengthAxis] + 0.5,
      position.getComponent(i, widthAxis) / size[widthAxis] + 0.5);
  }
  uv.needsUpdate = true;
}

function part(group: THREE.Group, name: string, geometry: THREE.BufferGeometry, material: THREE.Material, position?: Point): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  if (position) mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function timber(group: THREE.Group, name: string, size: Point, position: Point, material: THREE.Material, radius = 0.012): THREE.Mesh {
  const geometry = new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map((v) => v / 5)));
  alignTimberUv(geometry, size);
  return part(group, name, geometry, material, position);
}

function cylinder(group: THREE.Group, name: string, radiusTop: number, radiusBottom: number, height: number, position: Point, material: THREE.Material, segments = 12): THREE.Mesh {
  return part(group, name, new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material, position);
}

function rod(group: THREE.Group, name: string, a: Point, b: Point, radius: number, material: THREE.Material, sides = 8): THREE.Mesh {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const delta = end.clone().sub(start);
  const mesh = part(group, name, new THREE.CylinderGeometry(radius, radius, delta.length(), sides), material);
  mesh.position.copy(start.add(end).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return mesh;
}

function curvedRod(group: THREE.Group, name: string, points: Point[], radius: number, material: THREE.Material, tubularSegments = 20): void {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
  part(group, name, new THREE.TubeGeometry(curve, tubularSegments, radius, 7, false), material);
}

function peg(group: THREE.Group, name: string, position: Point, materials: Palette): void {
  cylinder(group, `${name}-pin`, 0.009, 0.009, 0.014, position, materials.iron, 8);
  cylinder(group, `${name}-head`, 0.015, 0.015, 0.005, [position[0], position[1] + 0.009, position[2]], materials.ironEdge, 10);
}

function apronAndLegs(group: THREE.Group, materials: Palette, topY: number, width: number, depth: number, legWidth: number): void {
  const legX = width / 2 - 0.13, legZ = depth / 2 - 0.105;
  for (const x of [-legX, legX]) for (const z of [-legZ, legZ]) {
    timber(group, "mortised-square-leg", [legWidth, topY - 0.075, legWidth], [x, (topY - 0.075) / 2, z], materials.oakDark, 0.018);
    timber(group, "leg-foot-wear", [legWidth + 0.006, 0.045, legWidth + 0.006], [x, 0.023, z], materials.oak);
    timber(group, "visible-through-tenon", [0.048, 0.009, 0.044], [x, topY + 0.027, z], materials.endGrain, 0.003);
  }
  for (const z of [-legZ, legZ]) {
    timber(group, "long-mortised-apron", [width - 0.22, 0.145, 0.055], [0, topY - 0.14, z], materials.oak);
    timber(group, "lower-stretcher", [width - 0.2, 0.075, 0.06], [0, 0.20, z], materials.oakDark);
  }
  for (const x of [-legX, legX]) {
    timber(group, "end-apron", [0.055, 0.145, depth - 0.2], [x, topY - 0.14, 0], materials.oak);
    timber(group, "cross-stretcher", [0.06, 0.07, depth - 0.2], [x, 0.20, 0], materials.oakDark);
  }
}

function shelf(group: THREE.Group, materials: Palette, width: number, z: number, depth: number, y: number): void {
  const count = 5;
  for (let i = 0; i < count; i++) {
    const x = -width / 2 + (i + 0.5) * width / count;
    timber(group, "shelf-board-with-open-seam", [width / count - 0.009, 0.038, depth], [x, y, z], i % 2 ? materials.oak : materials.oakLight, 0.006);
  }
}

function surface(group: THREE.Group, materials: Palette, width: number, depth: number, y: number): void {
  const count = 5;
  for (let i = 0; i < count; i++) {
    const z = -depth / 2 + (i + 0.5) * depth / count;
    timber(group, "joined-top-plank", [width, 0.068, depth / count - 0.007], [0, y, z], i === 1 || i === 4 ? materials.oakLight : materials.oak, 0.009);
    for (const x of [-width / 2 + 0.09, width / 2 - 0.09]) peg(group, "forged-top-nail", [x, y + 0.037, z], materials);
  }
  for (const x of [-width / 2 + 0.025, width / 2 - 0.025]) {
    timber(group, "end-grain-breadboard", [0.05, 0.076, depth + 0.013], [x, y, 0], materials.endGrain, 0.007);
  }
}

/** Front faces +Z; the worktop is 0.94 m high. */
export function buildCraftingTable(): THREE.Group {
  const group = new THREE.Group();
  group.name = "town-crafting-table";
  const m = palette();
  apronAndLegs(group, m, 0.89, 1.72, 0.97, 0.12);
  shelf(group, m, 1.40, 0, 0.65, 0.31);
  surface(group, m, 1.72, 0.97, 0.91);
  // Heavy front vise: two distinct wooden jaws, a long screw and turned handle.
  timber(group, "fixed-vise-jaw", [0.39, 0.20, 0.052], [-0.43, 0.78, 0.465], m.oakLight, 0.015);
  timber(group, "moving-vise-jaw", [0.39, 0.20, 0.045], [-0.43, 0.78, 0.515], m.oakDark, 0.014);
  rod(group, "vise-iron-screw", [-0.43, 0.76, 0.505], [-0.43, 0.76, 0.55], 0.022, m.iron, 12);
  const screw = cylinder(group, "vise-turning-hub", 0.036, 0.036, 0.024, [-0.43, 0.76, 0.555], m.ironEdge, 12);
  screw.rotation.x = Math.PI / 2;
  rod(group, "vise-cross-handle", [-0.51, 0.76, 0.565], [-0.35, 0.76, 0.565], 0.012, m.oakLight);
  for (const x of [-0.52, -0.34]) cylinder(group, "turned-handle-knob", 0.018, 0.018, 0.018, [x, 0.76, 0.565], m.endGrain);
  // Leather work mat is recessed into the visual field, with stitched edges.
  timber(group, "worn-leather-work-mat", [0.68, 0.014, 0.49], [0.28, 0.954, 0.075], m.leather, 0.009);
  for (const x of [-0.035, 0.595]) {
    rod(group, "mat-edge-stitch", [x, 0.963, -0.14], [x, 0.963, 0.29], 0.0025, m.cord, 5);
  }
  for (const z of [-0.14, 0.29]) rod(group, "mat-edge-stitch", [-0.03, 0.963, z], [0.59, 0.963, z], 0.0025, m.cord, 5);
  // A gouge, two chisels, awl and mallet sit at readable angles on the mat.
  for (let i = 0; i < 3; i++) {
    const z = -0.07 + i * 0.075;
    rod(group, "turned-chisel-handle", [0.02, 0.977, z], [0.18, 0.977, z - 0.008], 0.013, m.oakLight, 10);
    rod(group, "chisel-shank", [0.17, 0.977, z - 0.008], [0.34, 0.977, z - 0.018], 0.006, m.ironEdge, 7);
    timber(group, "chisel-flat-edge", [0.055, 0.005, 0.025], [0.35, 0.977, z - 0.018], m.ironEdge, 0.002);
  }
  rod(group, "awl-wooden-handle", [0.07, 0.981, 0.22], [0.20, 0.981, 0.22], 0.014, m.oakDark);
  rod(group, "awl-point", [0.2, 0.981, 0.22], [0.34, 0.981, 0.22], 0.004, m.ironEdge);
  rod(group, "mallet-handle", [0.45, 0.986, -0.34], [0.45, 0.986, -0.05], 0.019, m.oakLight);
  timber(group, "mallet-block-head", [0.19, 0.07, 0.085], [0.45, 1.00, -0.32], m.endGrain, 0.014);
  // Thread spool and beeswax dish occupy the opposite rear corner.
  for (let i = 0; i < 2; i++) {
    const x = -0.60 + i * 0.12;
    cylinder(group, "linen-thread-spool", 0.033, 0.033, 0.048, [x, 0.99, -0.30], m.cord, 12);
    cylinder(group, "spool-top-flange", 0.047, 0.047, 0.009, [x, 1.018, -0.30], m.endGrain, 12);
    cylinder(group, "spool-bottom-flange", 0.047, 0.047, 0.009, [x, 0.963, -0.30], m.endGrain, 12);
  }
  cylinder(group, "small-wax-dish", 0.065, 0.052, 0.026, [-0.27, 0.966, -0.32], m.iron, 16);
  cylinder(group, "amber-beeswax", 0.045, 0.045, 0.008, [-0.27, 0.983, -0.32], m.wax, 16);
  // Open storage under the top is visible through the apron.
  timber(group, "low-tool-chest", [0.39, 0.20, 0.29], [0.43, 0.43, -0.07], m.oakDark, 0.012);
  timber(group, "chest-front-panel", [0.34, 0.145, 0.01], [0.43, 0.43, 0.08], m.oakLight, 0.008);
  rod(group, "chest-pull", [0.38, 0.46, 0.089], [0.48, 0.46, 0.089], 0.006, m.ironEdge);
  return group;
}

function feather(group: THREE.Group, name: string, x: number, y: number, z: number, angle: number, length: number, m: Palette): void {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(-length * 0.28, length * 0.16, -length * 0.55, length * 0.08);
  shape.quadraticCurveTo(-length * 0.87, length * 0.015, -length, 0);
  shape.quadraticCurveTo(-length * 0.62, -length * 0.075, -length * 0.30, -length * 0.09);
  shape.quadraticCurveTo(-length * 0.10, -length * 0.05, 0, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.003, bevelEnabled: false, curveSegments: 5 });
  const mesh = part(group, name, geometry, m.feather);
  mesh.position.set(x, y, z);
  mesh.rotation.set(-Math.PI / 2, 0, angle);
  rod(group, `${name}-quill`, [x, y + 0.004, z], [x - length * Math.cos(angle), y + 0.004, z + length * Math.sin(angle)], 0.0025, m.featherShade, 5);
}

/** Front faces +Z; the high rear rack stays below 1.55 m. */
export function buildFletchingBench(): THREE.Group {
  const group = new THREE.Group();
  group.name = "town-fletching-bench";
  const m = palette();
  apronAndLegs(group, m, 0.86, 1.74, 0.88, 0.095);
  shelf(group, m, 1.46, 0.02, 0.57, 0.30);
  surface(group, m, 1.74, 0.88, 0.89);
  // Fine rear rack, with open rails and individually pegged tools.
  for (const x of [-0.73, 0.73]) {
    timber(group, "rack-upright", [0.055, 0.57, 0.055], [x, 1.19, -0.36], m.oakDark, 0.007);
    peg(group, "rack-dowel", [x, 1.43, -0.327], m);
  }
  timber(group, "rack-top-rail", [1.52, 0.065, 0.062], [0, 1.455, -0.36], m.oakLight, 0.009);
  timber(group, "rack-peg-rail", [1.48, 0.063, 0.047], [0, 1.23, -0.345], m.oak, 0.008);
  for (let i = 0; i < 7; i++) {
    const x = -0.58 + i * 0.19;
    rod(group, "tool-rack-wooden-peg", [x, 1.225, -0.32], [x, 1.225, -0.22], 0.011, m.endGrain);
  }
  // Hanging nippers and a fletching knife have separate grips and metal heads.
  for (const x of [-0.54, -0.33]) {
    rod(group, "hanging-tool-grip", [x, 1.19, -0.275], [x, 1.07, -0.275], 0.012, m.oakDark);
    rod(group, "hanging-steel-blade", [x, 1.07, -0.275], [x, 1.005, -0.275], 0.006, m.ironEdge);
  }
  // A bow stave is sprung across two blocks. Its curved outline makes this bench distinct at range.
  for (const x of [-0.61, 0.61]) {
    timber(group, "stave-jig-cradle", [0.11, 0.13, 0.13], [x, 1.005, -0.12], m.oakDark, 0.014);
    rod(group, "jig-clamp-pin", [x, 1.075, -0.18], [x, 1.075, -0.055], 0.012, m.iron);
  }
  curvedRod(group, "arched-bow-stave", [[-0.66, 1.10, -0.10], [-0.42, 1.13, -0.16], [0, 1.17, -0.21], [0.42, 1.13, -0.16], [0.66, 1.10, -0.10]], 0.024, m.oakLight, 30);
  rod(group, "bowstring-for-alignment", [-0.66, 1.105, -0.10], [0.66, 1.105, -0.10], 0.0028, m.cord, 7);
  for (const x of [-0.62, 0.62]) timber(group, "stave-tip-lashing", [0.042, 0.014, 0.052], [x, 1.112, -0.10], m.cord, 0.003);
  // Loose shafts lie parallel in a grooved tray at the front right.
  timber(group, "arrow-shaft-tray", [0.88, 0.04, 0.31], [0.32, 0.953, 0.22], m.oakDark, 0.009);
  for (let i = 0; i < 5; i++) {
    const z = 0.095 + i * 0.055;
    rod(group, "straight-ash-arrow-shaft", [-0.085, 0.981, z], [0.68, 0.981, z], 0.008, m.shaft, 8);
    cylinder(group, "arrow-nock-collar", 0.012, 0.012, 0.018, [-0.08, 0.981, z], m.oakDark, 9).rotation.z = Math.PI / 2;
    const head = part(group, "slim-forged-arrowhead", new THREE.ConeGeometry(0.014, 0.067, 7), m.ironEdge, [0.712, 0.981, z]);
    head.rotation.z = -Math.PI / 2;
    feather(group, "pale-fletch-on-shaft", -0.015, 0.993, z, 0.03, 0.092, m);
  }
  // Grouped feather bundles are set in a low cup, beside wax and linen cord.
  cylinder(group, "feather-cup", 0.061, 0.046, 0.10, [-0.60, 0.993, 0.22], m.leather, 14);
  for (let i = 0; i < 8; i++) {
    const x = -0.64 + i * 0.011;
    const z = 0.19 + (i % 3) * 0.021;
    rod(group, "loose-feather-quill", [x, 1.01, z], [x + (i % 2 ? 0.018 : -0.018), 1.16 + (i % 3) * 0.018, z], 0.003, m.featherShade, 5);
    timber(group, "loose-pale-feather", [0.022, 0.09, 0.005], [x, 1.12 + (i % 3) * 0.017, z], i % 3 ? m.feather : m.featherShade, 0.003).rotation.z = i % 2 ? -0.2 : 0.2;
  }
  cylinder(group, "cord-spool", 0.036, 0.036, 0.045, [-0.37, 0.99, 0.26], m.cord);
  cylinder(group, "cord-spool-cap", 0.052, 0.052, 0.008, [-0.37, 1.015, 0.26], m.endGrain);
  cylinder(group, "pitch-pot", 0.055, 0.048, 0.052, [-0.23, 0.983, 0.27], m.iron);
  cylinder(group, "warm-pitch-surface", 0.044, 0.044, 0.005, [-0.23, 1.012, 0.27], m.wax);
  // Quiver and an unfinished stock of long shafts rest on the lower shelf.
  const quiver = cylinder(group, "shelf-leather-quiver", 0.088, 0.065, 0.31, [-0.53, 0.49, 0.0], m.leather, 12);
  quiver.rotation.z = -0.13;
  cylinder(group, "quiver-rim", 0.096, 0.096, 0.022, [-0.51, 0.65, 0], m.oakDark, 12).rotation.z = -0.13;
  for (let i = 0; i < 5; i++) rod(group, "shelf-unfinished-shaft", [0.0, 0.357 + i * 0.011, -0.15 + i * 0.04], [0.62, 0.357 + i * 0.011, -0.15 + i * 0.04], 0.006, m.shaft, 7);
  return group;
}
