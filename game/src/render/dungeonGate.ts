/** Metre-scale dungeon masonry and a forged sliding gate, shared by the world and feature lab. */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  applyCorealmSurfaceMaterials, loadCorealmSurfaceTextures, type CorealmSurfaceTextures,
} from "./corealmSurfaceMaterials.js";
import { MaterialLibrary } from "./materials.js";

export const DUNGEON_GATE_ASSET_IDS = {
  closed: "corealm_dungeon_portcullis",
  open: "corealm_dungeon_portcullis_open",
  frame: "corealm_dungeon_gate_frame",
} as const;

export const DUNGEON_GATE_DIMENSIONS = Object.freeze({
  clearWidth: 3.2,
  clearHeight: 3.4,
  springHeight: 2.15,
  leafDepth: 0.32,
  frameWidth: 4.5,
  frameHeight: 4.15,
  frameDepth: 1.2,
  dressedDepth: 1.32,
  openLift: 3.6,
});

export interface DungeonGateMaterials {
  stone: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  fittings: THREE.MeshStandardMaterial;
}

/** Materials are shared by both leaf states, the frame, and the adjoining masonry runs. */
export function createDungeonGateMaterials(
  textures?: CorealmSurfaceTextures,
  metalSource?: THREE.MeshStandardMaterial,
): DungeonGateMaterials {
  let stone = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0 });
  stone.name = "Corealm weathered strata";
  if (textures) {
    const geometry = new THREE.BufferGeometry();
    const sample = new THREE.Mesh(geometry, stone);
    applyCorealmSurfaceMaterials(sample, textures);
    const authored = sample.material;
    if (authored !== stone) stone.dispose();
    stone = authored;
    geometry.dispose();
  }
  const source = metalSource ?? new MaterialLibrary().metal(1);
  const metal = source.clone();
  metal.name = "dungeon-gate-forged-iron";
  metal.color.setHex(0x59636a);
  metal.roughness = 0.53;
  metal.metalness = 0.64;
  metal.vertexColors = true;
  metal.emissive.setHex(0);
  metal.emissiveIntensity = 0;
  const fittings = metal.clone();
  fittings.name = "dungeon-gate-worn-fittings";
  fittings.color.setHex(0x929797);
  fittings.roughness = 0.37;
  fittings.metalness = 0.73;
  if (!metalSource) source.dispose();
  return { stone, metal, fittings };
}

interface BuiltAssetSink { registerBuilt(id: string, group: THREE.Group): void }

/** Register once before any threshold entity requests its model. No generated image is needed. */
export async function registerDungeonGateAssets(
  sink: BuiltAssetSink,
  materials?: DungeonGateMaterials,
): Promise<readonly string[]> {
  const surfaces = materials ?? createDungeonGateMaterials(await loadCorealmSurfaceTextures());
  const built = buildDungeonGateAssets(surfaces);
  for (const key of ["closed", "open", "frame"] as const) sink.registerBuilt(DUNGEON_GATE_ASSET_IDS[key], built[key]);
  return Object.values(DUNGEON_GATE_ASSET_IDS);
}

/** Y-up, +Z approach. Open/closed roots are identical; only the leaf's vertex heights change. */
export function buildDungeonGateAssets(materials = createDungeonGateMaterials()): {
  closed: THREE.Group; open: THREE.Group; frame: THREE.Group;
} {
  const closed = buildPortcullis(materials);
  const open = new THREE.Group();
  open.name = DUNGEON_GATE_ASSET_IDS.open;
  for (const child of closed.children) {
    const source = child as THREE.Mesh;
    const geometry = source.geometry.clone().translate(0, DUNGEON_GATE_DIMENSIONS.openLift, 0);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = source.clone();
    mesh.geometry = geometry;
    open.add(mesh);
  }
  open.userData.dungeonGate = { ...closed.userData.dungeonGate, state: "open" };
  return { closed, open, frame: buildFrame(materials) };
}

function buildPortcullis(materials: DungeonGateMaterials): THREE.Group {
  const iron: THREE.BufferGeometry[] = [];
  const fittings: THREE.BufferGeometry[] = [];
  const barXs = Array.from({ length: 13 }, (_, index) => -1.51 + index * 3.02 / 12);
  const rows = [0.45, 1.42, 2.38, 3.27];
  for (const [index, x] of barXs.entries()) {
    const bar = roundedBox(0.078, 3.22, 0.092, 0.008).translate(x, 1.79, 0);
    iron.push(paint(bar, 0xffffff, 0.94 + (index % 3) * 0.022));
    // The four-sided forged point is a separate closed profile, seated inside the rounded shaft.
    const tip = new THREE.ConeGeometry(0.055, 0.22, 4).rotateZ(Math.PI).rotateY(Math.PI / 4).translate(x, 0.11, 0);
    iron.push(paint(tip, 0xffffff, 0.92));
    for (const y of rows) for (const front of [-1, 1]) {
      const head = new THREE.SphereGeometry(0.031, 10, 6).scale(1, 1, 0.44).translate(x, y, front * 0.146);
      fittings.push(paint(head, 0xffffff, 0.94));
    }
  }
  for (const [index, y] of rows.entries()) for (const front of [-1, 1]) {
    iron.push(paint(roundedBox(3.2, index === 3 ? 0.13 : 0.104, 0.06, 0.009)
      .translate(0, y, front * 0.10), 0xffffff, 0.87 + index * 0.02));
  }
  // An escutcheon with an actual key slot, rather than a dark rectangle on the strap.
  for (const front of [-1, 1]) {
    const shield = new THREE.Shape();
    shield.moveTo(-0.17, 1.08); shield.lineTo(0, 0.97); shield.lineTo(0.17, 1.08);
    shield.lineTo(0.17, 1.65); shield.lineTo(-0.17, 1.65); shield.closePath();
    const slot = new THREE.Path();
    slot.absarc(0, 1.38, 0.031, 0, Math.PI * 2, true);
    shield.holes.push(slot);
    const plate = extrude(shield, 0.018, 0.004).translate(0, 0, front * 0.133);
    fittings.push(paint(plate, 0xffffff, 0.82));
  }
  const group = new THREE.Group();
  group.name = DUNGEON_GATE_ASSET_IDS.closed;
  group.userData.dungeonGate = { state: "closed", clearWidth: 3.2, clearHeight: 3.4, openLift: 3.6 };
  group.add(merge(iron, materials.metal, "portcullis-forged-bars-and-straps"));
  group.add(merge(fittings, materials.fittings, "portcullis-rivets-and-lock-plates"));
  return group;
}

function buildFrame(materials: DungeonGateMaterials): THREE.Group {
  const stone: THREE.BufferGeometry[] = [];
  const guides: THREE.BufferGeometry[] = [];
  const fittings: THREE.BufferGeometry[] = [];
  const { springHeight: spring, clearHeight: crown, frameHeight: top } = DUNGEON_GATE_DIMENSIONS;
  // A filled rectangular spandrel closes the arch shoulders all the way to the roof-height header.
  const portal = new THREE.Shape();
  portal.moveTo(-2.25, -0.5); portal.lineTo(-2.25, top); portal.lineTo(2.25, top);
  portal.lineTo(2.25, -0.5); portal.lineTo(1.6, -0.5); portal.lineTo(1.6, spring);
  for (let step = 1; step <= 64; step++) {
    const angle = step / 64 * Math.PI;
    portal.lineTo(Math.cos(angle) * 1.6, spring + Math.sin(angle) * (crown - spring));
  }
  portal.lineTo(-1.6, -0.5); portal.closePath();
  // The leaf travels through this slot between the front and rear arch faces. Solid
  // full-depth piers would bury the guides and leave no opening into the lift housing.
  const slotDepth = 0.5;
  const archDepth = (DUNGEON_GATE_DIMENSIONS.frameDepth - slotDepth) / 2;
  for (const front of [-1, 1]) {
    stone.push(paint(extrude(portal, archDepth, 0, true)
      .translate(0, 0, front * (slotDepth + archDepth) / 2), 0x777974, 1, true));
  }
  for (const side of [-1, 1]) {
    stone.push(paint(roundedBox(0.53, top + 0.5, slotDepth, 0.012)
      .translate(side * 1.985, (top - 0.5) / 2, 0), 0x777974));
  }

  const courses = 6;
  for (const side of [-1, 1]) for (let row = 0; row < courses; row++) {
    const bottom = -0.5 + row * (spring + 0.5) / courses;
    const height = (spring + 0.5) / courses - 0.014;
    const cheekDepth = (DUNGEON_GATE_DIMENSIONS.dressedDepth - slotDepth) / 2;
    for (const front of [-1, 1]) {
      stone.push(paint(roundedBox(0.65, height, cheekDepth, 0.018)
        .translate(side * 1.925, bottom + height / 2, front * (slotDepth + cheekDepth) / 2),
      0x93928a, 0.94 + (row % 3) * 0.035));
    }
  }
  for (let block = 0; block < 17; block++) {
    const start = block / 17 * Math.PI + 0.0035;
    const end = (block + 1) / 17 * Math.PI - 0.0035;
    const wedge = new THREE.Shape();
    for (let step = 0; step <= 5; step++) {
      const angle = start + (end - start) * step / 5;
      const x = Math.cos(angle) * 2.23;
      const y = spring + Math.sin(angle) * 1.98;
      if (step === 0) wedge.moveTo(x, y); else wedge.lineTo(x, y);
    }
    for (let step = 5; step >= 0; step--) {
      const angle = start + (end - start) * step / 5;
      wedge.lineTo(Math.cos(angle) * 1.623, spring + Math.sin(angle) * 1.273);
    }
    wedge.closePath();
    const wedgeDepth = (1.284 - slotDepth) / 2 - 0.018;
    for (const front of [-1, 1]) {
      stone.push(paint(extrude(wedge, wedgeDepth, 0.018, true)
        .translate(0, 0, front * (slotDepth / 2 + 0.018 + wedgeDepth / 2)),
      block === 8 ? 0xb0aa9c : 0x99988f, 0.94 + (block % 4) * 0.018, true));
    }
  }
  // Recessed front/rear rails flank the 0.32m leaf. The backing strip closes each
  // channel against the outer pier; its exposed inner face reads when the leaf is up.
  for (const side of [-1, 1]) {
    guides.push(paint(roundedBox(0.038, 4.08, 0.46, 0.006)
      .translate(side * 1.712, 2.02, 0), 0xffffff, 0.72));
    for (const front of [-1, 1]) {
      guides.push(paint(roundedBox(0.104, 4.08, 0.07, 0.008)
        .translate(side * 1.658, 2.02, front * 0.208), 0xffffff, 0.87));
      for (let row = 0; row < 5; row++) {
        const y = 0.3 + row * 0.76;
        guides.push(paint(roundedBox(0.095, 0.11, 0.036, 0.006)
          .translate(side * 1.658, y, front * 0.244), 0xffffff, 0.94));
        fittings.push(paint(new THREE.SphereGeometry(0.034, 10, 6).scale(1, 1, 0.45)
          .translate(side * 1.658, y, front * 0.266), 0xffffff, 0.9));
      }
    }
  }
  const group = new THREE.Group();
  group.name = DUNGEON_GATE_ASSET_IDS.frame;
  group.add(merge(stone, materials.stone, "gate-dressed-stone-portal"));
  group.add(merge(guides, materials.metal, "gate-recessed-lift-guides"));
  group.add(merge(fittings, materials.fittings, "gate-guide-anchor-heads"));
  return group;
}

export interface DungeonGateMasonryWallOptions {
  minX: number;
  maxX: number;
  /** Actual lower surface in gate-local coordinates. Callers include their floor embedding here. */
  bottomAt: (x: number, z: number) => number;
  /** Height above the sampled bottom, including any desired cavern-roof overlap. */
  height: number;
  depth?: number;
  zCenter?: number;
}

/** Continuous solid masonry, with staggered dressed courses merged into one stone draw. */
export function buildDungeonGateMasonryWall(
  options: DungeonGateMasonryWallOptions,
  materials?: DungeonGateMaterials,
): THREE.Group {
  const { minX, maxX, height, bottomAt, depth = 1.2, zCenter = 0 } = options;
  if (![minX, maxX, height, depth, zCenter].every(Number.isFinite) || maxX <= minX || height <= 0 || depth < 0.12) {
    throw new Error("Dungeon gate masonry needs finite ordered bounds, positive height, and depth >= 0.12m");
  }
  const width = maxX - minX;
  const pieces: THREE.BufferGeometry[] = [];
  const followFloor = (geometry: THREE.BufferGeometry): THREE.BufferGeometry => {
    const position = geometry.getAttribute("position");
    for (let vertex = 0; vertex < position.count; vertex++) {
      const floor = bottomAt(position.getX(vertex), position.getZ(vertex));
      if (!Number.isFinite(floor)) throw new Error("Dungeon gate masonry floor sample is not finite");
      position.setY(vertex, position.getY(vertex) + floor);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    const smooth = toCreasedNormals(geometry, Math.PI / 3);
    if (smooth !== geometry) geometry.dispose();
    return smooth;
  };
  const backing = new THREE.BoxGeometry(width, height, depth - 0.08, Math.max(1, Math.ceil(width / 0.6)), 1, 2)
    .translate((minX + maxX) / 2, height / 2, zCenter);
  pieces.push(paint(followFloor(backing), 0x737773));
  const rows = Math.max(1, Math.ceil(height / 0.64));
  const course = height / rows;
  for (const front of [-1, 1]) for (let row = 0; row < rows; row++) {
    const start = minX - (row % 2 ? 0.61 : 0);
    for (let column = 0; start + column * 1.22 < maxX; column++) {
      const left = Math.max(minX, start + column * 1.22);
      const right = Math.min(maxX, start + (column + 1) * 1.22);
      if (right - left < 0.03) continue;
      const gap = Math.min(0.016, (right - left) / 5);
      const brick = bevelBox(right - left - gap, course - 0.014, 0.08, 0.009)
        .translate((left + right) / 2, row * course + course / 2, zCenter + front * (depth / 2 - 0.04));
      pieces.push(paint(followFloor(brick), 0x94958c, 0.90 + ((row * 7 + column * 3) % 9) * 0.016));
    }
  }
  const group = new THREE.Group();
  group.name = "dungeon-gate-masonry-wall";
  const surfaces = materials ?? createDungeonGateMaterials();
  const mesh = merge(pieces, surfaces.stone, "gate-continuous-dressed-masonry");
  // Wings are built for one scene and discarded with that scene. Registry gate prototypes,
  // in contrast, retain their shared geometry for future entity clones.
  mesh.userData.ownedGeometry = true;
  if (!materials) {
    mesh.userData.ownedMaterial = true;
    surfaces.metal.dispose();
    surfaces.fittings.dispose();
  }
  group.add(mesh);
  return group;
}

function roundedBox(width: number, height: number, depth: number, radius: number): THREE.BufferGeometry {
  return new RoundedBoxGeometry(width, height, depth, 2, radius);
}

/** Low-cost rounded edge profile for the many broad wall faces. */
function bevelBox(width: number, height: number, depth: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const x = width / 2 - bevel;
  const y = height / 2 - bevel;
  shape.moveTo(-x, -y); shape.lineTo(x, -y); shape.lineTo(x, y); shape.lineTo(-x, y); shape.closePath();
  return extrude(shape, depth - bevel * 2, bevel);
}

/** One continuous metre coordinate around each extruded contour, including curved soffits. */
function contourUVs(shape: THREE.Shape): THREE.UVGenerator {
  const outlines = shape.extractPoints(16);
  const edges: Array<{ x: number; y: number; dx: number; dy: number; length: number; start: number }> = [];
  for (const outline of [outlines.shape, ...outlines.holes]) {
    let distance = 0;
    for (let index = 0; index < outline.length; index++) {
      const a = outline[index]!;
      const b = outline[(index + 1) % outline.length]!;
      const length = a.distanceTo(b);
      if (length < 1e-8) continue;
      edges.push({ x: a.x, y: a.y, dx: (b.x - a.x) / length, dy: (b.y - a.y) / length, length, start: distance });
      distance += length;
    }
  }
  return {
    generateTopUV(_geometry, vertices, a, b, c) {
      return [a, b, c].map(index => new THREE.Vector2(vertices[index * 3]!, vertices[index * 3 + 1]!));
    },
    generateSideWallUV(_geometry, vertices, a, b, c, d) {
      // Select the whole face's contour edge using its midpoint so both endpoints
      // use the same seam, even on bevel rings offset slightly from that contour.
      const x = (vertices[a * 3]! + vertices[b * 3]!) / 2;
      const y = (vertices[a * 3 + 1]! + vertices[b * 3 + 1]!) / 2;
      let selected = edges[0]!;
      let nearest = Infinity;
      for (const edge of edges) {
        const along = Math.max(0, Math.min(edge.length, (x - edge.x) * edge.dx + (y - edge.y) * edge.dy));
        const squared = (x - edge.x - along * edge.dx) ** 2 + (y - edge.y - along * edge.dy) ** 2;
        if (squared < nearest) { nearest = squared; selected = edge; }
      }
      // Keep the same contour endpoints through every bevel ring. Projecting each
      // offset corner independently would split the UVs at adjacent bevel faces.
      const forward = (vertices[b * 3]! - vertices[a * 3]!) * selected.dx
        + (vertices[b * 3 + 1]! - vertices[a * 3 + 1]!) * selected.dy > 0;
      const start = selected.start + (forward ? 0 : selected.length);
      const end = selected.start + (forward ? selected.length : 0);
      return [a, b, c, d].map((index, corner) => new THREE.Vector2(
        corner === 0 || corner === 3 ? start : end, vertices[index * 3 + 2]!,
      ));
    },
  };
}

function extrude(shape: THREE.Shape, depth: number, bevel = 0, continuousSides = false): THREE.BufferGeometry {
  const raw = new THREE.ExtrudeGeometry(shape, {
    depth, steps: 1, curveSegments: 16, bevelEnabled: bevel > 0,
    bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2,
    ...(continuousSides ? { UVGenerator: contourUVs(shape) } : {}),
  }).translate(0, 0, -depth / 2);
  if (!bevel) return raw;
  const smooth = toCreasedNormals(raw, Math.PI / 3);
  if (smooth !== raw) raw.dispose();
  return smooth;
}

/** Metre-based surface UVs keep the existing stone maps at their authored world density. */
function paint(source: THREE.BufferGeometry, colour: number, tone = 1, preserveUVs = false): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source;
  if (geometry !== source) source.dispose();
  const position = geometry.getAttribute("position");
  const color = new THREE.Color(colour).multiplyScalar(tone);
  const colors = new Float32Array(position.count * 3);
  const uv = new Float32Array(position.count * 2);
  for (let vertex = 0; vertex < position.count; vertex++) {
    const x = position.getX(vertex); const y = position.getY(vertex); const z = position.getZ(vertex);
    const weather = 0.97 + 0.03 * Math.sin(x * 3.7 + y * 1.9 + z * 2.1);
    colors.set([color.r * weather, color.g * weather, color.b * weather], vertex * 3);
  }
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  for (let triangle = 0; !preserveUVs && triangle < position.count; triangle += 3) {
    a.fromBufferAttribute(position, triangle);
    b.fromBufferAttribute(position, triangle + 1).sub(a);
    c.fromBufferAttribute(position, triangle + 2).sub(a);
    b.cross(c);
    const nx = Math.abs(b.x); const ny = Math.abs(b.y); const nz = Math.abs(b.z);
    // Choose one projection for the entire triangle. Changing axes at a rounded vertex can
    // collapse its UV area, which makes tangent-space normal maps invalid at the bevel.
    for (let corner = 0; corner < 3; corner++) {
      const vertex = triangle + corner;
      const x = position.getX(vertex); const y = position.getY(vertex); const z = position.getZ(vertex);
      uv[vertex * 2] = ny > Math.max(nx, nz) ? x : nx > nz ? z : x;
      uv[vertex * 2 + 1] = ny > Math.max(nx, nz) ? z : y;
    }
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  if (!preserveUVs) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.clearGroups();
  return geometry;
}

function merge(parts: THREE.BufferGeometry[], material: THREE.Material, name: string): THREE.Mesh {
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error(`Dungeon gate could not merge ${name}`);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
