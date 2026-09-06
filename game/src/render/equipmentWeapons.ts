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
    const dagger = buildEquipmentDagger(grade);
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
    if (grade === 0) {
      // An oval buckler meets the height envelope with individually cut planks and open seams.
      for (let plank = 0; plank < 7; plank++) {
        const left = -0.305 + plank * 0.61 / 7 + 0.002;
        const right = -0.305 + (plank + 1) * 0.61 / 7 - 0.002;
        const board = new THREE.Shape();
        for (let i = 0; i <= 12; i++) {
          const x = left + (right - left) * i / 12;
          const y = 0.37 * Math.sqrt(Math.max(0, 1 - (x / 0.305) ** 2));
          if (i === 0) board.moveTo(x, y); else board.lineTo(x, y);
        }
        for (let i = 12; i >= 0; i--) {
          const x = left + (right - left) * i / 12;
          board.lineTo(x, -0.37 * Math.sqrt(Math.max(0, 1 - (x / 0.305) ** 2)));
        }
        board.closePath();
        const geometry = new THREE.ExtrudeGeometry(board, { depth: 0.03, bevelEnabled: false });
        geometry.translate(0, 0, -0.015);
        add(`buckler-plank-${plank}`, geometry, "wood");
      }
    } else {
      if (grade === 1) {
        shape.moveTo(-0.30, 0.35); shape.lineTo(0.30, 0.35);
        shape.lineTo(0.27, -0.06); shape.quadraticCurveTo(0.18, -0.25, 0, -0.41);
        shape.quadraticCurveTo(-0.18, -0.25, -0.27, -0.06); shape.closePath();
      } else if (grade === 2) {
        shape.moveTo(0, 0.41); shape.quadraticCurveTo(0.32, 0.41, 0.30, 0.13);
        shape.quadraticCurveTo(0.24, -0.17, 0, -0.43);
        shape.quadraticCurveTo(-0.24, -0.17, -0.30, 0.13);
        shape.quadraticCurveTo(-0.32, 0.41, 0, 0.41); shape.closePath();
      } else {
        shape.moveTo(-0.25, 0.44); shape.lineTo(0.25, 0.44); shape.lineTo(0.31, 0.38);
        shape.lineTo(0.31, -0.38); shape.lineTo(0.25, -0.44); shape.lineTo(-0.25, -0.44);
        shape.lineTo(-0.31, -0.38); shape.lineTo(-0.31, 0.38); shape.closePath();
      }
      add("joined-board", extrude(shape, 0.030), "wood");
    }
    const strap = (name: string, start: Point, end: Point, width: number, role: Role) => {
      const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
      const mesh = add(name, new THREE.BoxGeometry(width, a.distanceTo(b), 0.016), role,
        a.clone().add(b).multiplyScalar(0.5).toArray() as [number, number, number]);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
    };
    const nail = (x: number, y: number, z: number) =>
      add(`rivet-${x}-${y}-${z}`, new THREE.SphereGeometry(0.009, 8, 6), "metal", [x, y, z]);
    if (grade === 0) {
      for (const y of [-0.19, 0.19]) {
        strap(`nailed-batten-${y}`, [-0.245, y, -0.026], [0.245, y, -0.026], 0.045, "wood");
        for (const x of [-0.22, -0.11, 0, 0.11, 0.22]) nail(x, y, 0.017);
      }
      const boss = new THREE.SphereGeometry(1, 16, 10); boss.scale(0.075, 0.075, 0.038);
      add("plain-iron-boss", boss, "metal", [0, 0, 0.02]);
    } else if (grade === 1) {
      strap("top-edge-iron", [-0.30, 0.345, 0.022], [0.30, 0.345, 0.022], 0.035, "metal");
      for (const x of [-0.27, -0.135, 0, 0.135, 0.27]) nail(x, 0.345, 0.033);
      strap("rear-cross-upright", [0, -0.29, -0.027], [0, 0.29, -0.027], 0.047, "wood");
      strap("rear-cross-arm", [-0.25, 0.09, -0.027], [0.25, 0.09, -0.027], 0.047, "wood");
      const boss = new THREE.CylinderGeometry(0.085, 0.10, 0.035, 8); boss.rotateX(Math.PI / 2);
      add("octagonal-boss", boss, "metal", [0, 0.035, 0.034]);
    } else if (grade === 2) {
      const outline = shape.getPoints(48);
      if (outline[0]!.equals(outline.at(-1)!)) outline.pop();
      const contour = outline.map(v => new THREE.Vector3(v.x, v.y, 0.015));
      add("rolled-rim", new THREE.TubeGeometry(new THREE.CatmullRomCurve3(contour, true), 128, 0.012, 8, true), "metal");
      for (const [x, y] of [[-0.265, 0.23], [0.265, 0.23], [-0.18, -0.12], [0.18, -0.12], [0, -0.36], [0, 0.36]] as const) {
        strap(`radial-strap-${x}-${y}`, [0, 0.035, 0.029], [x, y, 0.029], 0.027, "metal");
        nail(x, y, 0.041);
      }
      const boss = new THREE.SphereGeometry(1, 20, 12); boss.scale(0.11, 0.11, 0.083);
      add("raised-domed-boss", boss, "metal", [0, 0.035, 0.025]);
    } else {
      for (const y of [-0.32, -0.16, 0, 0.16, 0.32]) {
        strap(`tower-face-band-${y}`, [-0.30, y, 0.027], [0.30, y, 0.027], 0.05, "metal");
        for (const x of [-0.275, 0.275]) nail(x, y, 0.04);
      }
      for (const x of [-0.27, 0.27]) for (const y of [-0.39, 0.39]) {
        const cap = new THREE.Shape();
        cap.moveTo(x - Math.sign(x) * 0.065, y + Math.sign(y) * 0.042);
        cap.lineTo(x, y + Math.sign(y) * 0.042);
        cap.lineTo(x + Math.sign(x) * 0.035, y + Math.sign(y) * 0.007);
        cap.lineTo(x + Math.sign(x) * 0.035, y - Math.sign(y) * 0.065); cap.closePath();
        add(`corner-cap-${x}-${y}`, extrude(cap, 0.022), "metal", [0, 0, 0.026]);
      }
      for (let step = 0; step < 3; step++) {
        const boss = new THREE.CylinderGeometry(0.112 - step * 0.025, 0.112 - step * 0.025, 0.024, 8);
        boss.rotateX(Math.PI / 2);
        add(`stepped-boss-${step}`, boss, "metal", [0, 0.035, 0.045 + step * 0.024]);
      }
    }
    const grip = new THREE.CylinderGeometry(0.018, 0.018, 0.19, 12); grip.rotateZ(Math.PI / 2);
    add("rear-handgrip", grip, "leather", [0, 0, -0.065]);
    for (const x of [-0.1, 0.1]) add(`grip-standoff-${x}`, new THREE.BoxGeometry(0.023, 0.034, 0.048), "metal", [x, 0, -0.045]);
  } else {
    const staff = form === "staff";
    const start = staff ? -0.72 : -0.10;
    const neck = staff ? 0.72 : 0.205;
    const crystalY = staff ? 0.85 : 0.265;
    const crystalRadius = staff ? 0.055 : 0.025;
    const crystalHalfHeight = staff ? 0.085 : 0.042;
    const tube = (name: string, points: Point[], radius: number, role: Role) =>
      add(name, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))),
        Math.max(24, points.length * 8), radius, 8), role);
    const wrap = (name: string, low: number, high: number, radius: number, turns: number, thickness: number, role: Role, topRadius = radius) => {
      const points: Point[] = Array.from({ length: turns * 24 + 1 }, (_, i) => {
        const t = i / (turns * 24), angle = t * turns * Math.PI * 2;
        const r = radius + (topRadius - radius) * t;
        return [Math.cos(angle) * r, low + t * (high - low), Math.sin(angle) * r];
      });
      tube(name, points, thickness, role);
    };
    if (grade === 0) {
      const shaft = new THREE.CylinderGeometry(staff ? 0.024 : 0.012, staff ? 0.030 : 0.020, neck - start, 7, 12);
      const positions = shaft.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i) + (start + neck) / 2;
        // Keep the palm straight while the cut branch bends above and below it.
        const bend = Math.max(0, Math.abs(y) - 0.10);
        positions.setXYZ(i, positions.getX(i) + Math.sin(y * 13) * bend * 0.035,
          positions.getY(i), positions.getZ(i) + Math.sin(y * 21) * bend * 0.016);
      }
      shaft.computeVertexNormals();
      add("whittled-branch", shaft, "wood", [0, (start + neck) / 2, 0]);
      wrap("cord-grip", staff ? -0.12 : -0.075, staff ? 0.12 : 0.065, staff ? 0.032 : 0.021, staff ? 12 : 8, 0.003, "leather");
      for (const side of [-1, 1]) {
        tube(`bound-fork-${side}`, [[0, neck - 0.05, 0], [side * crystalRadius, crystalY - 0.04, 0],
          [side * crystalRadius * 0.8, crystalY + 0.025, 0]], staff ? 0.015 : 0.007, "wood");
      }
      wrap("crystal-lashing", neck - 0.035, neck + 0.02, staff ? 0.029 : 0.019, 4, 0.003, "leather");
      tube("crystal-tie", [[-crystalRadius, crystalY - 0.025, 0], [0, crystalY, crystalRadius * 0.8],
        [crystalRadius, crystalY - 0.025, 0], [0, crystalY - 0.045, -crystalRadius * 0.8],
        [-crystalRadius, crystalY - 0.025, 0]], 0.0025, "leather");
    } else if (grade === 1) {
      cylinder("turned-shaft", staff ? 0.027 : 0.023, staff ? 0.022 : 0.011, start, neck, "wood");
      handle(staff ? -0.12 : -0.075, staff ? 0.12 : 0.065, staff ? 0.031 : 0.025);
      band(start + 0.014, staff ? 0.032 : 0.026);
      cylinder("head-ferrule", staff ? 0.031 : 0.018, staff ? 0.036 : 0.028, neck - 0.035, neck + 0.033, "metal");
      if (!staff) {
        const socket = new THREE.TorusGeometry(0.025, 0.005, 8, 16); socket.rotateX(Math.PI / 2);
        add("crystal-socket", socket, "metal", [0, crystalY - 0.025, 0]);
      }
    } else if (grade === 2) {
      const joints = staff ? [start, -0.30, 0.22, 0.50, neck] : [start, 0.075, neck];
      for (let i = 0; i < joints.length - 1; i++) {
        const low = joints[i]!, high = joints[i + 1]!;
        add(`faceted-segment-${i}`, new THREE.CylinderGeometry(staff ? 0.025 : 0.014,
          staff ? 0.029 : 0.020, high - low, 6), "wood", [0, (low + high) / 2, 0]);
      }
      for (const y of joints) cylinder(`joint-collar-${y}`, staff ? 0.038 : 0.026,
        staff ? 0.038 : 0.026, y - 0.014, y + 0.014, "metal");
      handle(staff ? -0.12 : -0.075, staff ? 0.12 : 0.06, staff ? 0.032 : 0.024);
    } else {
      cylinder("tapered-shaft", staff ? 0.031 : 0.021, staff ? 0.018 : 0.012, start, neck, "wood");
      handle(staff ? -0.12 : -0.075, staff ? 0.12 : 0.06, staff ? 0.034 : 0.025);
      if (staff) {
        wrap("spiral-iron-vine", start + 0.03, neck, 0.033, 8, 0.006, "metal", 0.020);
      } else {
        for (let i = 0; i < 6; i++) {
          const y = 0.08 + i * 0.022;
          cylinder(`carved-shaft-rib-${i}`, 0.023 - i * 0.001, 0.022 - i * 0.001, y, y + 0.011, "wood");
        }
      }
      cylinder("cage-collar", staff ? 0.043 : 0.030, staff ? 0.040 : 0.027, neck - 0.016, neck + 0.024, "metal");
    }
    // Crowns surround the crystal in depth as well as width, leaving space between the bars.
    if (grade >= 2 || (staff && grade === 1)) {
      const prongs = grade === 1 ? 2 : grade === 2 ? (staff ? 4 : 3) : 4;
      const closed = grade === 3;
      for (let i = 0; i < prongs; i++) {
        const angle = i * Math.PI * 2 / prongs + (grade === 2 ? Math.PI / 6 : 0);
        const radial = (r: number, y: number): Point => [Math.cos(angle) * r, y, Math.sin(angle) * r];
        tube(`crown-prong-${i}`, [radial(crystalRadius * 0.35, neck),
          radial(crystalRadius * 1.48, crystalY - crystalHalfHeight * 0.25),
          radial(crystalRadius * 1.15, crystalY + crystalHalfHeight * 0.65),
          radial(closed ? 0 : crystalRadius * 0.70, crystalY + crystalHalfHeight + (closed ? 0.015 : -0.007))],
        staff ? 0.010 : 0.0045, "metal");
      }
      if (closed) {
        cylinder("cage-finial", staff ? 0.019 : 0.009, 0.001,
          crystalY + crystalHalfHeight + 0.008, crystalY + crystalHalfHeight + (staff ? 0.062 : 0.030), "metal");
      }
    }
    const gem = new THREE.OctahedronGeometry(1, 0);
    gem.scale(crystalRadius, crystalHalfHeight, crystalRadius * 0.8);
    add("set-crystal", gem, "gem", [0, crystalY, 0]);
    group.userData.elementalSocket = [0, crystalY, 0];
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
