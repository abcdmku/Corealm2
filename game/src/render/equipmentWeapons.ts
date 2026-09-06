/** Original equipment candidates, using the production Three material and geometry path. */
import * as THREE from "three";
import { EquipmentFaces } from "./equipmentDetails.js";
import { buildEquipmentDagger } from "./proceduralGearModels.js";

export type WeaponForm = "sword" | "dagger" | "axe" | "shield" | "staff" | "wand";
export type WeaponGrade = 0 | 1 | 2 | 3;
type Role = "blade" | "metal" | "wood" | "leather" | "gem";
type Point = readonly [number, number, number];
const METALS = [0xb77a3f, 0x7f8589, 0xbcc5cc, 0xb69c87];
const WOODS = [0x95714a, 0x60452f, 0x6f6250, 0x49372e];
const GEMS = [0xaac6cf, 0x72945e, 0x772f42, 0xb55d35];

/** Each asset uses metre dimensions and stores its measured local grip for socket fitting. */
export function buildEquipmentWeapon(form: WeaponForm, grade: WeaponGrade): THREE.Group {
  if (form === "dagger") {
    const dagger = buildEquipmentDagger();
    dagger.name = `corealm-dagger-${grade}`;
    dagger.userData.form = form;
    dagger.userData.grade = grade;
    dagger.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const material = child.material as THREE.MeshStandardMaterial;
      const role = material.userData.equipmentRole as Role;
      material.color.setHex(role === "gem" ? GEMS[grade]! : role === "leather" ? 0x483327 : METALS[grade]!);
    });
    return dagger;
  }
  const group = new THREE.Group();
  group.name = `corealm-${form}-${grade}`;
  group.userData = { form, grade, gripCenter: [0, 0, 0], source: "Corealm original" };
  const materials: Record<Role, THREE.MeshStandardMaterial> = {
    blade: new THREE.MeshStandardMaterial({ color: METALS[grade], metalness: 0.84, roughness: 0.3, vertexColors: true }),
    metal: new THREE.MeshStandardMaterial({ color: METALS[grade], metalness: 0.73, roughness: 0.4 }),
    wood: new THREE.MeshStandardMaterial({ color: WOODS[grade], metalness: 0, roughness: 0.68 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x483327, metalness: 0, roughness: 0.89 }),
    gem: new THREE.MeshPhysicalMaterial({ color: GEMS[grade], metalness: 0.02, roughness: 0.18, clearcoat: 0.8 }),
  };
  for (const [role, material] of Object.entries(materials)) {
    material.name = `corealm-weapon-${role}`;
    material.userData.equipmentRole = role;
    if (role === "wood" || role === "leather") {
      material.map = equipmentSurfaceTexture(role);
    }
  }
  const add = (name: string, geometry: THREE.BufferGeometry, role: Role, at: Point = [0, 0, 0]): THREE.Mesh => {
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials[role]);
    mesh.name = name; mesh.position.set(...at); mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh); return mesh;
  };
  const cylinder = (name: string, bottom: number, top: number, start: number, end: number, role: Role) =>
    add(name, new THREE.CylinderGeometry(top, bottom, end - start, 16), role, [0, (start + end) / 2, 0]);
  const band = (y: number, radius: number) => cylinder(`ferrule-${y}`, radius, radius, y - 0.009, y + 0.009, "metal");
  const handle = (start: number, end: number, radius: number) => {
    cylinder("leather-grip", radius, radius * 0.91, start, end, "leather");
    const turns = Math.ceil((end - start) / 0.019);
    const points = Array.from({ length: turns * 20 + 1 }, (_, i) => {
      const t = i / (turns * 20), angle = t * turns * Math.PI * 2;
      const r = radius * (1 - t * 0.09) + 0.0008;
      return new THREE.Vector3(Math.cos(angle) * r, start + t * (end - start), Math.sin(angle) * r);
    });
    add("grip-wrap", new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), turns * 20, 0.0009, 5), "leather");
    band(start, radius + 0.002); band(end, radius * 0.91 + 0.002);
  };
  if (form === "sword") {
    group.userData.gripCenter = [0, -0.1, 0];
    handle(-0.174, -0.025, 0.026);
    const lengths = [0.77, 0.86, 0.92, 0.96], widths = [0.041, 0.048, 0.045, 0.055];
    const length = lengths[grade]!, width = widths[grade]!;
    const profiles: Array<Array<[number, number]>> = [
      [[0.006, width], [0.12, width], [length * 0.76, width * 0.76], [length, 0]],
      [[0.006, width], [0.08, width], [length * 0.68, width * 0.88], [length * 0.9, width * 0.42], [length, 0]],
      [[0.006, width * 0.82], [0.12, width * 0.82], [0.15, width], [length * 0.64, width * 0.72], [length, 0]],
      [[0.006, width * 0.83], [0.1, width], [length * 0.3, width * 0.86], [length * 0.72, width * 0.65], [length, 0]],
    ];
    add("ground-blade", forgedBlade(profiles[grade]!, 0.0075 + grade * 0.0005), "blade");
    const span = 0.13 + grade * 0.012;
    const shape = new THREE.Shape();
    shape.moveTo(-span, -0.018); shape.quadraticCurveTo(-span * 0.5, -0.018 + grade * 0.008, 0, -0.015);
    shape.quadraticCurveTo(span * 0.5, -0.018 + grade * 0.008, span, -0.018);
    shape.lineTo(span + 0.005, 0.005); shape.quadraticCurveTo(span * 0.4, 0.015 + grade * 0.006, 0, 0.013);
    shape.quadraticCurveTo(-span * 0.4, 0.015 + grade * 0.006, -span - 0.005, 0.005); shape.closePath();
    add("forged-crossguard", extrude(shape, 0.025), "metal");
    const pommel = new THREE.SphereGeometry(1, 16, 10); pommel.scale(0.039, 0.028, 0.024);
    add("peened-pommel", pommel, "metal", [0, -0.202, 0]);
  } else if (form === "axe") {
    group.userData.gripCenter = [0, -0.25, 0];
    cylinder("ash-haft", 0.025, 0.021, -0.39, 0.36, "wood");
    handle(-0.35, -0.13, 0.027); band(0.29, 0.029);
    const shape = new THREE.Shape();
    shape.moveTo(-0.049, 0.37); shape.lineTo(0.07, 0.4);
    // End the forged slab at the bevel shoulder. The cutting bit occupies the remaining width.
    shape.quadraticCurveTo(0.14, 0.46, 0.232 + grade * 0.018, 0.44);
    shape.quadraticCurveTo(0.292 + grade * 0.018, 0.30, 0.227 + grade * 0.018, 0.12);
    shape.quadraticCurveTo(0.18, 0.19, 0.09, 0.235); shape.lineTo(-0.049, 0.235); shape.closePath();
    add("bearded-forged-head", extrude(shape, 0.032), "metal");
    const eye = new THREE.TorusGeometry(0.030, 0.007, 8, 20); eye.rotateX(Math.PI / 2);
    add("haft-eye", eye, "metal", [0, 0.365, 0]);
    const bit = new EquipmentFaces();
    const edgePoint = (q: number, inset: number, z: number): Point => {
      const inverse = 1 - q;
      return [inverse * inverse * 0.26 + 2 * inverse * q * 0.32 + q * q * 0.255 + grade * 0.018 - inset,
        inverse * inverse * 0.44 + 2 * inverse * q * 0.30 + q * q * 0.12, z];
    };
    for (let i = 0; i < 14; i++) {
      const t = i / 14, u = (i + 1) / 14;
      for (const side of [-1, 1]) {
        const points = [edgePoint(t, 0.028, side * 0.019), edgePoint(t, 0, side * 0.001), edgePoint(u, 0, side * 0.001), edgePoint(u, 0.028, side * 0.019)] as const;
        if (side < 0) bit.quad(...points);
        else bit.quad(points[3], points[2], points[1], points[0]);
      }
      bit.quad(edgePoint(u, 0, 0.001), edgePoint(u, 0, -0.001), edgePoint(t, 0, -0.001), edgePoint(t, 0, 0.001));
    }
    bit.quad(edgePoint(0, 0.028, 0.019), edgePoint(0, 0, 0.001), edgePoint(0, 0, -0.001), edgePoint(0, 0.028, -0.019));
    bit.quad(edgePoint(1, 0.028, -0.019), edgePoint(1, 0, -0.001), edgePoint(1, 0, 0.001), edgePoint(1, 0.028, 0.019));
    add("honed-cutting-bit", bit.geometry(), "blade");
  } else if (form === "shield") {
    group.userData.gripCenter = [0, 0, -0.065];
    const shape = new THREE.Shape();
    shape.moveTo(-0.30, 0.31); shape.quadraticCurveTo(0, 0.40, 0.30, 0.31);
    shape.lineTo(0.285, -0.02); shape.quadraticCurveTo(0.22, -0.24, 0, -0.43 - grade * 0.02);
    shape.quadraticCurveTo(-0.22, -0.24, -0.285, -0.02); shape.closePath();
    add("joined-board", extrude(shape, 0.030), "wood");
    const outline = shape.getPoints(48);
    if (outline[0]!.equals(outline.at(-1)!)) outline.pop();
    const contour = outline.map(v => new THREE.Vector3(v.x, v.y, 0.013));
    add("rolled-rim", new THREE.TubeGeometry(new THREE.CatmullRomCurve3(contour, true), 96, 0.012, 8, true), "metal");
    const boss = new THREE.SphereGeometry(0.096, 20, 12); boss.scale(1, 1, 0.58);
    add("hammered-boss", boss, "metal", [0, 0.035, 0.020]);
    for (const x of [-0.13, 0.13]) {
      const brace = new THREE.BoxGeometry(0.033, 0.49, 0.015);
      add(`rear-brace-${x}`, brace, "wood", [x, 0.0, -0.025]);
    }
    const grip = new THREE.CylinderGeometry(0.018, 0.018, 0.19, 12); grip.rotateZ(Math.PI / 2);
    add("rear-handgrip", grip, "leather", [0, 0, -0.065]);
    for (const x of [-0.1, 0.1]) add(`grip-standoff-${x}`, new THREE.BoxGeometry(0.023, 0.034, 0.048), "metal", [x, 0, -0.045]);
  } else {
    const staff = form === "staff";
    const start = staff ? -0.72 : -0.12, end = staff ? 0.87 : 0.49;
    cylinder("turned-shaft", staff ? 0.026 : 0.021, staff ? 0.021 : 0.011, start, end, "wood");
    handle(staff ? -0.14 : -0.09, staff ? 0.14 : 0.075, staff ? 0.030 : 0.024);
    band(start + 0.012, staff ? 0.029 : 0.024); band(end - 0.04, staff ? 0.026 : 0.019);
    if (staff) {
      const cradle = new THREE.TorusGeometry(0.086, 0.011, 8, 32, Math.PI * 1.65); cradle.rotateZ(-Math.PI * 0.325);
      add("open-metal-cradle", cradle, "metal", [0, end + 0.054, 0]);
      cylinder("head-tenon", 0.025, 0.019, end - 0.05, end + 0.005, "metal");
    } else {
      for (const side of [-1, 1]) {
        const points = [[side * 0.010, end - 0.04, 0], [side * 0.035, end + 0.01, 0], [side * 0.02, end + 0.074, 0]];
        add(`crown-prong-${side}`, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 12, 0.006, 8), "metal");
      }
    }
    const gem = new THREE.OctahedronGeometry(1, 0);
    gem.scale(staff ? 0.041 : 0.019, staff ? 0.067 : 0.041, staff ? 0.032 : 0.016);
    add("set-crystal", gem, "gem", [0, end + (staff ? 0.052 : 0.026), 0]);
    group.userData.elementalSocket = [0, end + (staff ? 0.052 : 0.026), 0];
  }
  return group;
}

/** Small repeatable authored grain; timber fibres follow the cylinder's long V axis. */
function equipmentSurfaceTexture(role: "wood" | "leather"): THREE.DataTexture {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * Math.PI * 2, v = y / size * Math.PI * 2;
    const grain = Math.sin(u * 13 + Math.sin(v * 2) * 0.62 + Math.sin(u * 3) * 0.22);
    const pore = Math.sin(u * 43 + Math.cos(v * 17)) * Math.sin(v * 37 + Math.cos(u * 23));
    const tone = role === "wood" ? 0.80 + grain * 0.095 + pore * 0.025 : 0.86 + pore * 0.065;
    const offset = (y * size + x) * 4;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = Math.round(tone * 255);
    pixels[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.name = `corealm-${role}-grain`;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
  return texture;
}

function extrude(shape: THREE.Shape, depth: number): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.003, bevelThickness: 0.003, curveSegments: 16 });
  geometry.translate(0, 0, -depth / 2); return geometry;
}

/** Diamond cross section has real edge thickness and forged distal taper. */
function forgedBlade(rows: ReadonlyArray<readonly [number, number]>, thickness: number): THREE.BufferGeometry {
  const faces = new EquipmentFaces();
  const rails = [-1, -0.76, 0, 0.76, 1];
  const point = (row: number, rail: number, side: number): Point => {
    const [y, width] = rows[row]!;
    const x = rails[rail]!;
    const z = Math.abs(x) === 1 ? 0.0005 : (1 - Math.abs(x) * 0.65) * thickness * (1 - row / rows.length * 0.58);
    return [x * width, y, side * (width === 0 ? 0 : z)];
  };
  for (const side of [-1, 1]) for (let row = 0; row < rows.length - 1; row++) for (let rail = 0; rail < rails.length - 1; rail++) {
    const p = [point(row, rail, side), point(row, rail + 1, side), point(row + 1, rail + 1, side), point(row + 1, rail, side)] as const;
    const tone = rail === 0 || rail === 3 ? 1 : 0.86;
    if (rows[row + 1]![1] === 0) {
      if (side > 0) faces.triangle(p[0], p[1], p[2], tone);
      else faces.triangle(p[2], p[1], p[0], tone);
    } else if (side > 0) faces.quad(...p, tone);
    else faces.quad(p[3], p[2], p[1], p[0], tone);
  }
  for (let row = 0; row < rows.length - 1; row++) for (const rail of [0, 4]) {
    const p = [point(row, rail, 1), point(row, rail, -1), point(row + 1, rail, -1), point(row + 1, rail, 1)] as const;
    if (rows[row + 1]![1] === 0) {
      if (rail === 0) faces.triangle(p[2], p[1], p[0]); else faces.triangle(p[0], p[1], p[2]);
    } else if (rail === 0) faces.quad(p[3], p[2], p[1], p[0]); else faces.quad(...p);
  }
  for (let rail = 0; rail < 4; rail++) faces.quad(point(0, rail, -1), point(0, rail + 1, -1), point(0, rail + 1, 1), point(0, rail, 1));
  return faces.geometry();
}
