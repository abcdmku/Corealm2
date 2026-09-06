import * as THREE from "three";
import type { SemanticEntity, SolidVolume } from "../contracts.js";
import { seedFromText } from "../world/organicFields.js";
import { worldSitePoint, type WorldSite } from "../content/worldSites.js";
import type { AssetRegistry } from "./assets.js";
import type { WorldScene } from "./scene.js";

interface Section {
  points: THREE.Vector3[];
  plane: THREE.Plane;
  crease?: boolean;
  /** Weathering strength over the exposed lower rock. */
  lowerRelief?: number;
  /** Zero at the last cliff station, one at the buried outer end. */
  terminal?: number;
}

/** Continuous, non-periodic weathering at a chosen physical wavelength. */
function weather(value: number, salt: number): number {
  const cell = Math.floor(value);
  const fraction = value - cell;
  const hash = (index: number): number => {
    let bits = Math.imul(index ^ salt, 0x45d9f3b);
    bits = Math.imul(bits ^ (bits >>> 16), 0x45d9f3b);
    return ((bits ^ (bits >>> 16)) >>> 0) / 0xffffffff * 2 - 1;
  };
  const a = hash(cell);
  return a + (hash(cell + 1) - a) * fraction * fraction * (3 - 2 * fraction);
}

export interface MineCutFaceResult {
  /** Caller owns these geometries. Materials and their textures remain owned by AssetRegistry. */
  objects: THREE.Object3D[];
  solids: SolidVolume[];
}

/** Read the actual terrain triangle for burial without changing gameplay's height sampler. */
export function createMineBurialSampler(scene: WorldScene): (x: number, z: number) => number {
  const grids = (scene.getWalkableMeshes?.() ?? []).flatMap((mesh) => {
    const geometry = mesh.geometry as THREE.PlaneGeometry;
    const parameters = geometry.parameters;
    if (!parameters?.widthSegments || !parameters.heightSegments || !geometry.index) return [];
    const positions = geometry.getAttribute("position");
    const columns = parameters.widthSegments, rows = parameters.heightSegments;
    const stepX = positions.getX(1) - positions.getX(0);
    const stepZ = positions.getZ(columns + 1) - positions.getZ(0);
    if (stepX <= 0 || stepZ <= 0 || mesh.rotation.x || mesh.rotation.y || mesh.rotation.z) return [];
    return [{ positions, index: geometry.index, columns, rows, stepX, stepZ,
      x: positions.getX(0) + mesh.position.x, z: positions.getZ(0) + mesh.position.z,
      offset: mesh.position }];
  });
  return (x, z) => {
    for (const grid of grids) {
      const u = (x - grid.x) / grid.stepX, v = (z - grid.z) / grid.stepZ;
      if (u < 0 || v < 0 || u > grid.columns || v > grid.rows) continue;
      const col = Math.min(grid.columns - 1, Math.floor(u)), row = Math.min(grid.rows - 1, Math.floor(v));
      const first = (row * grid.columns + col) * 6;
      // Read both triangles' real indices: never assume which diagonal the renderer uses.
      for (const triangle of [0, 3]) {
        const ids = [0, 1, 2].map((corner) => grid.index.getX(first + triangle + corner));
        const points = ids.map((id) => ({ x: grid.positions.getX(id) + grid.offset.x,
          y: grid.positions.getY(id) + grid.offset.y, z: grid.positions.getZ(id) + grid.offset.z }));
        const [a, b, c] = points as [typeof points[number], typeof points[number], typeof points[number]];
        const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
        const wa = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator;
        const wb = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator;
        const wc = 1 - wa - wb;
        if (Math.min(wa, wb, wc) >= -1e-6) return wa * a.y + wb * b.y + wc * c.y;
      }
    }
    return scene.meshHeightAt(x, z);
  };
}

/**
 * A closed geological face behind the authored ground ore positions. Ore meshes remain separate
 * and never set the cliff's dimensions, relief or material. This builder borrows the cached host
 * stone material and returns its objects without changing the scene.
 */
export async function buildMineCutFace(
  scene: WorldScene,
  assets: AssetRegistry,
  site: WorldSite,
  actualResourceEntities: readonly SemanticEntity[],
): Promise<MineCutFaceResult> {
  const cut = site.cutFace;
  if (!cut || cut.stations.length === 0) return { objects: [], solids: [] };
  const setback = cut.frontSetback ?? 2.4;
  const burialHeightAt = createMineBurialSampler(scene);
  if (site.kind !== "mine" || ![cut.backDepth, cut.buryDepth, setback].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error(`Mine cut ${site.id} requires positive back and burial depths.`);
  }
  const entities = new Map(actualResourceEntities.map((entity) => [entity.id, entity]));
  const used = new Set<string>();
  const sections: Section[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const seed = seedFromText(site.id);
  const siteRight = new THREE.Vector3(Math.cos(site.rotationY), 0, -Math.sin(site.rotationY));
  const siteForward = new THREE.Vector3(Math.sin(site.rotationY), 0, Math.cos(site.rotationY));
  const stations = cut.stations.map((station) => {
    const id = `${station.clusterId}_${station.index}`;
    const slot = site.resourceSlots.find((candidate) => candidate.clusterId === station.clusterId && candidate.index === station.index);
    if (!slot || ![slot.x, slot.z, slot.yaw].every(Number.isFinite)) {
      throw new Error(`Mine cut ${site.id} has no authored cliff station ${id}.`);
    }
    const [x, z] = worldSitePoint(site, slot.x, slot.z);
    return { station, slot, centre: new THREE.Vector3(x, 0, z).addScaledVector(siteForward, -setback) };
  });
  for (const [stationIndex, anchor] of stations.entries()) {
    const { station, slot } = anchor;
    const id = `${station.clusterId}_${station.index}`;
    const entity = entities.get(id);
    if (!entity || entity.archetype !== "ore" || used.has(id)) {
      throw new Error(`Mine cut ${site.id} has an invalid or duplicate ore station ${id}.`);
    }
    if (!Number.isFinite(station.crestHeight) || station.crestHeight <= 0) {
      throw new Error(`Mine cut ${site.id}/${id} has no crest height.`);
    }
    used.add(id);
    // Station spacing sets physical widths. Depletion, new ore models and resource scale must
    // not rebuild a different cliff behind a stationary mine.
    const distances = [stations[stationIndex - 1], stations[stationIndex + 1]]
      .filter((neighbour) => neighbour !== undefined).map((neighbour) => neighbour.centre.distanceTo(anchor.centre));
    const halfWidth = Math.max(0.9, Math.min(1.9, (distances.length ? Math.min(...distances) : 3.4) * 0.44));
    const origin = anchor.centre.clone();
    origin.y = scene.meshHeightAt(origin.x, origin.z);
    const rotation = new THREE.Quaternion().setFromAxisAngle(up, site.rotationY + slot.yaw);
    const transform = new THREE.Matrix4().compose(origin, rotation, new THREE.Vector3(1, 1, 1));
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      front, origin,
    );
    const crest = origin.y + station.crestHeight;
    const columns = Math.max(8, Math.ceil(halfWidth * 2 / 0.28));
    // A continuous sampled face replaces the repeated flat mineral rectangles.
    const columnsX = Array.from({ length: columns + 1 }, (_, column) => halfWidth * (column / columns * 2 - 1));
    for (const offsetX of columnsX) {
      const x = offsetX;
      const at = new THREE.Vector3(x, 0, 0).applyMatrix4(transform).dot(siteRight);
      const fracture = weather(at * 0.29, seed) * 0.42 + weather(at * 1.15, seed + 7) * 0.12
        - Math.pow(Math.max(0, weather(at * 0.76, seed + 19)), 2) * 0.23;
      const shoulderZ = -(0.46 + weather(at * 0.48, seed + 13) * 0.17);
      const rearZ = -cut.backDepth * (0.96 + 0.04 * weather(at * 0.25, seed + 23));
      const point = (y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z).applyMatrix4(transform);
      const atHeight = (height: number, z: number): THREE.Vector3 => {
        const origin = point(0, z);
        return point(height - origin.y, z);
      };
      const buried = (z: number): THREE.Vector3 => {
        const foot = point(0, z);
        foot.y = burialHeightAt(foot.x, foot.z) - cut.buryDepth;
        return foot;
      };
      const windowTop = atHeight(origin.y + station.crestHeight * (0.43 + weather(at * 0.37, seed + 41) * 0.06),
        -0.10 - Math.abs(weather(at * 0.53, seed + 43)) * 0.15);
      const top = Math.max(crest + fracture, windowTop.y + 0.28);
      const section: Section = {
        plane,
        lowerRelief: 1,
        points: [
          buried(0), windowTop, atHeight(top, shoulderZ),
          atHeight(top - 0.2 + weather(at * 0.4, seed + 37) * 0.08, rearZ), buried(rearZ),
        ],
      };
      sections.push(section);
    }
  }

  // Taper the two exposed ends into low, buried toes. Squared endcaps made the isolated fixture
  // read as a concrete block even when the mineral attachment itself was correct.
  for (const end of [0, 1]) {
    const edge = end === 0 ? sections[0]! : sections.at(-1)!;
    const neighbour = end === 0 ? sections[1]! : sections.at(-2)!;
    const direction = edge.points[0]!.clone().sub(neighbour.points[0]!);
    direction.y = 0; direction.normalize().multiplyScalar(end === 0 ? 1.2 : 1.45);
    const points = edge.points.map((point) => point.clone().add(direction));
    const ground = burialHeightAt(points[0]!.x, points[0]!.z);
    points[0]!.y = ground - cut.buryDepth;
    points[1]!.y = ground + 0.35;
    points[2]!.y = ground + (end === 0 ? 1.0 : 0.72);
    points[3]!.y = burialHeightAt(points[3]!.x, points[3]!.z) + 0.48;
    points[4]!.y = burialHeightAt(points[4]!.x, points[4]!.z) - cut.buryDepth;
    const toe = { points, plane: edge.plane, lowerRelief: 1, terminal: 1 };
    if (end === 0) sections.unshift(toe);
    else sections.push(toe);
  }
  // Unequal station planes meet in recessed fractures across the same continuous rock shell.
  const drawnSections: Section[] = [];
  for (let i = 0; i < sections.length; i++) {
    const left = sections[i]!; const right = sections[i + 1];
    drawnSections.push(left);
    if (!right || left.plane === right.plane || left.points[0]!.distanceTo(right.points[0]!) < 0.7) continue;
    for (const [step, t] of [0.18, 0.39, 0.57, 0.81].entries()) {
      const forward = left.plane.normal.clone().lerp(right.plane.normal, t).normalize();
      const points = left.points.map((point, index) => point.clone().lerp(right.points[index]!, t));
      const recess = [0.06, 0.38, 0.19, 0.10][step]!;
      points[0]!.addScaledVector(forward, -recess * 0.22);
      points[1]!.addScaledVector(forward, -recess);
      points[2]!.addScaledVector(forward, -recess * 1.3);
      points[2]!.y -= [0.08, 0.41, 0.24, 0.12][step]!;
      points[3]!.y -= recess * 0.4;
      drawnSections.push({ points, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(forward, points[0]!),
        crease: step === 1 || step === 2, lowerRelief: Math.sin(Math.PI * t) });
    }
  }

  // Long connectors and tapered ends need the same physical detail density as a cliff station.
  const detailed: Section[] = [];
  for (let i = 0; i < drawnSections.length; i++) {
    const left = drawnSections[i]!; const right = drawnSections[i + 1];
    detailed.push({ ...left });
    if (!right) continue;
    const divisions = Math.ceil(left.points[0]!.distanceTo(right.points[0]!) / 0.28);
    for (let step = 1; step < divisions; step++) {
      const ratio = step / divisions;
      const points = left.points.map((point, index) => point.clone().lerp(right.points[index]!, ratio));
      detailed.push({ points, plane: left.plane === right.plane ? left.plane
        : new THREE.Plane().setFromNormalAndCoplanarPoint(left.plane.normal.clone().lerp(right.plane.normal, ratio).normalize(), points[0]!),
      lowerRelief: THREE.MathUtils.lerp(left.lowerRelief ?? 0, right.lowerRelief ?? 0, ratio),
      terminal: THREE.MathUtils.lerp(left.terminal ?? 0, right.terminal ?? 0, ratio) });
    }
  }

  // The visible shoulder disappears into sampled terrain. Collider generation below consumes
  // these final sections, including the collapsed rear depth and buried terminal caps.
  const arc = [0];
  for (let i = 1; i < detailed.length; i++) arc.push(arc[i - 1]! + detailed[i]!.points[0]!.distanceTo(detailed[i - 1]!.points[0]!));
  const length = arc.at(-1)!;
  for (const [index, section] of detailed.entries()) {
    section.points = section.points.map((point) => point.clone());
    const [foot, window, crest, rear, rearFoot] = section.points as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
    const endDistance = Math.min(arc[index]!, length - arc[index]!);
    const shoulder = 1 - THREE.MathUtils.smoothstep(endDistance, 0, Math.min(3.8, length * 0.28));
    crest.y = THREE.MathUtils.lerp(crest.y, Math.min(crest.y, window.y + 0.20), shoulder * 0.88);
    const terminal = section.terminal ?? 0;
    if (terminal <= 0) continue;
    const shrink = 0.012 + 0.988 * (1 - terminal) ** 2;
    for (const point of [crest, rear, rearFoot]) {
      point.x = THREE.MathUtils.lerp(foot.x, point.x, shrink);
      point.z = THREE.MathUtils.lerp(foot.z, point.z, shrink);
    }
    const settle = THREE.MathUtils.smoothstep(terminal, 0, 1);
    crest.addScaledVector(section.plane.normal, -0.38 * Math.sin(Math.PI * terminal));
    window.x = THREE.MathUtils.lerp(window.x, foot.x, settle);
    window.z = THREE.MathUtils.lerp(window.z, foot.z, settle);
    for (const [point, burial] of [[window, 0.24], [crest, 0.14], [rear, 0.16]] as const) {
      point.y = THREE.MathUtils.lerp(point.y, burialHeightAt(point.x, point.z) - burial, settle);
    }
    rearFoot.y = burialHeightAt(rearFoot.x, rearFoot.z) - cut.buryDepth;
    // Retain a finite shell below the ground at the end, rather than collapsing triangles to
    // zero-area vertices. The visible geometry above it narrows smoothly into the earth.
    if (terminal === 1) {
      foot.y = burialHeightAt(foot.x, foot.z) - cut.buryDepth;
      window.y = burialHeightAt(window.x, window.z) - 0.24;
      crest.y = burialHeightAt(crest.x, crest.z) - 0.14;
      rear.y = burialHeightAt(rear.x, rear.z) - 0.16;
    }
  }

  const hostId = site.dressing.find((piece) => /^corealm_(?:rock|cliff)_/.test(piece.assetId))?.assetId;
  if (!hostId) throw new Error(`Mine cut ${site.id} has no authored host stone.`);
  const source = await assets.load(hostId, { priority: "visible-spawn", primary: true });
  let material: THREE.Material | undefined;
  const colour = new THREE.Color(0, 0, 0);
  let colourCount = 0;
  source.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const stone = materials.find((entry) => entry.name.split("@", 1)[0] === "Corealm weathered strata");
    if (!stone) return;
    material ??= stone;
    const colours = mesh.geometry.getAttribute("color");
    if (colours) for (let i = 0; i < colours.count; i++) {
      colour.r += colours.getX(i); colour.g += colours.getY(i); colour.b += colours.getZ(i);
      colourCount++;
    }
  });
  if (!material) throw new Error(`Mine cut ${site.id} cannot borrow the host's stone material.`);
  if (colourCount) colour.multiplyScalar(1 / colourCount);
  else colour.setRGB(1, 1, 1);

  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];
  const uvs: number[] = [];
  const frontAxis = detailed.at(-1)!.points[0]!.clone().sub(detailed[0]!.points[0]!);
  frontAxis.y = 0; frontAxis.normalize();
  const depthAxis = new THREE.Vector3(-frontAxis.z, 0, frontAxis.x);
  type Projection = "front" | "top" | "end";
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3,
    projection: Projection, authoredNormals?: readonly THREE.Vector3[]): void => {
    const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    for (const [index, point] of [a, b, c].entries()) {
      positions.push(point.x, point.y, point.z);
      const vertexNormal = authoredNormals?.[index] ?? normal;
      normals.push(vertexNormal.x, vertexNormal.y, vertexNormal.z);
      const tone = 0.98 + weather(point.dot(frontAxis) * 0.36, seed + 71) * 0.035
        + weather(point.y * 1.8, seed + 81) * 0.025;
      colours.push(colour.r * tone, colour.g * tone, colour.b * tone);
      // Metres, with a stable projection for each main surface. Small bevel normal changes must
      // not rotate the texture on every triangle. The shared material owns the physical repeat.
      if (projection === "top") uvs.push(point.x, point.z);
      else uvs.push(point.dot(projection === "end" ? depthAxis : frontAxis), point.y);
    }
  };

  const projections: Projection[] = [];
  const rings = detailed.map((section, sectionIndex) => {
    const [foot, window, crest, oldRear, rearFoot] = section.points as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
    const ring = [foot.clone()];
    const push = (point: THREE.Vector3, projection: Projection = "front"): void => {
      if (section.terminal === 1) point.y = Math.min(point.y, burialHeightAt(point.x, point.z) - 0.12);
      ring.push(point);
      if (sectionIndex === 0) projections.push(projection);
    };
    const across = window.dot(frontAxis);
    const height = crest.y - window.y;
    const outward = section.plane.normal;
    const exposedDetail = 1 - THREE.MathUtils.smoothstep(section.terminal ?? 0, 0, 0.30);
    // Faults move obliquely through several beds, with unequal widths and offsets. These are
    // recessed breakout planes, not a second regular grid of joints over the horizontal beds.
    const faultAt = (y: number): number => {
      const cell = Math.floor(across / 3.7);
      let recess = 0;
      for (let offset = -1; offset <= 1; offset++) {
        const index = cell + offset;
        const centre = (index + 0.5 + weather(index, seed + 127) * 0.42) * 3.7
          + y * (0.11 + weather(index, seed + 129) * 0.15);
        const width = 0.19 + (weather(index, seed + 131) + 1) * 0.16;
        const distance = Math.abs(across - centre);
        recess = Math.max(recess, Math.pow(Math.max(0, 1 - distance / width), 1.5));
      }
      return recess;
    };

    // Broken bedding continues across the entire lower face, with no flat mineral windows.
    for (const [index, t] of [0.08, 0.17, 0.25, 0.29, 0.35, 0.48, 0.60, 0.65, 0.71, 0.83, 0.92, 1].entries()) {
      const point = foot.clone().lerp(window, t);
      const envelope = Math.sin(Math.PI * t);
      const exposed = (section.lowerRelief ?? 0) * exposedDetail;
      const joint = index === 2 || index === 6;
      const body = -0.10 - Math.abs(weather(across * 0.72 + t * 1.3, seed + 89)) * 0.22;
      const shelf = joint ? -0.19 - weather(across * 0.7 + index, seed + 91) * 0.07
        : Math.sin(t * Math.PI * 2.5 + across * 0.8) * 0.065;
      point.y += weather(across * 0.61 + index * 3, seed + 93) * 0.07 * envelope * exposed;
      point.addScaledVector(outward, (body + shelf - faultAt(point.y) * 0.26) * envelope * exposed);
      push(point);
    }

    // Variable bed thickness and pinching joints keep this a broken outcrop rather than a
    // cornice. Different beds weather away over different spans, exposing broad sloping faces.
    const weights = [0.13, 0.26, 0.15, 0.29, 0.17].map((weight, band) => weight
      * (1 + weather(across * 0.43 + band * 13, seed + 101) * 0.42));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let start = 0;
    for (const [band, weight] of weights.entries()) {
      const end = start + weight / total;
      const strength = THREE.MathUtils.smoothstep(weather(across * 0.48 + band * 9, seed + 97), -0.04, 0.48);
      const depth = 0.10 + (weather(across * 0.77 + band * 3.1, seed + 99) + 1) * 0.055;
      const samples = [0.08, 0.18, 0.39, 0.62, 0.84, 0.94, 1];
      for (const within of samples) {
        const t = band === weights.length - 1 && within === 1 ? 1 : THREE.MathUtils.lerp(start, end, within);
        const point = window.clone().lerp(crest, t);
        const envelope = Math.sin(Math.PI * t);
        const joint = within <= 0.08 || within >= 0.94;
        const bulge = Math.sin((within - 0.08) / 0.86 * Math.PI);
        let relief = joint ? -depth * strength
          : bulge * (0.11 + weather(across * 0.8 + band * 11, seed + 113) * 0.065) * strength;
        relief += weather(across * 0.34 + t * 1.8, seed + 115) * 0.19;
        relief -= faultAt(point.y) * (0.19 + (band % 2) * 0.085);
        point.y += weather(across * 0.81 + t * 4, seed + 117) * Math.min(0.085, height * 0.04) * envelope * exposedDetail;
        if (t === 1) relief = 0;
        point.addScaledVector(outward, relief * envelope * exposedDetail);
        push(point);
      }
      start = end;
    }
    // The rear seam must actually disappear into terrain. The previous toe used ground+0.48,
    // which could never be buried by raising the terrain and showed daylight under quarry ends.
    const rear = oldRear.clone();
    rear.y = Math.max(rearFoot.y + 0.08, Math.min(rear.y, burialHeightAt(rear.x, rear.z) - 0.12));
    const rearDistance = Math.hypot(rear.x - crest.x, rear.z - crest.z);
    // Meet the bank where its drawn surface reaches the crest. Burying within one metre
    // while the bank is still at work-floor height leaves a steep exposed rear wall.
    // Flat fixtures without a receiving bank keep a short, buried shoulder.
    let shoulderDepth = 0.85 + weather(across * 0.29, seed + 137) * 0.15;
    for (let sample = 1; sample <= 40; sample++) {
      const point = crest.clone().lerp(rear, sample / 40);
      if (burialHeightAt(point.x, point.z) >= crest.y - 0.30) {
        shoulderDepth = Math.max(shoulderDepth, rearDistance * sample / 40);
        break;
      }
    }
    // Rows crowd toward the crest, where the exposed back slope actually is.
    let previousRoofY = crest.y;
    for (let row = 1; row <= 20; row++) {
      const t = (row / 20) ** 1.6;
      const point = crest.clone().lerp(rear, t);
      const ground = burialHeightAt(point.x, point.z);
      const depth = t * rearDistance;
      const buried = THREE.MathUtils.smoothstep(depth, 0, shoulderDepth);
      point.y = THREE.MathUtils.lerp(crest.y, ground - 0.30, buried);
      point.y += (1 - buried) * Math.sin(Math.PI * Math.min(1, depth / shoulderDepth)) * exposedDetail
        * (weather(across * 0.65 + t * 5, seed + 139) * 0.17
          + weather(across * 1.7 - t * 8, seed + 141) * 0.05);
      // Weathered rock falls away from the crest before the receiving bank rises to meet it. Without
      // this the roof waits at crest height for the two to four metres the real bank takes to climb,
      // and the shell reads as a flat grey plane laid over the hillside.
      point.y = Math.min(point.y, Math.max(ground - 0.30, crest.y - 1.7 * depth));
      // Uneven erosion breaks the exposed soil contact so the rock-to-grass line is not a chord.
      // The displacement is constant down a section, so no row overtakes the one before it.
      if (point.y > ground) {
        point.addScaledVector(outward, (weather(across / 2.8, seed + 143) * 0.17
          + weather(across / 0.8, seed + 149) * 0.08) * exposedDetail * (1 - buried));
      }
      // No uphill shelf along the back slope, but a rising bank must still carry the buried roof up
      // with it: pinning a deep row to a shallower row's height drives it through the underside and
      // turns the shell inside out.
      point.y = Math.min(point.y, Math.max(previousRoofY, ground - 0.30));
      point.y = Math.max(point.y, ground - cut.buryDepth + 0.05);
      previousRoofY = point.y;
      push(point, "top");
    }
    push(rearFoot.clone());
    // Close beneath the actual heightfield, not with a ten-metre chord between the feet.
    // That chord crossed a convex bank and rendered as detached triangular stone strips.
    // Sampling the underside also keeps collision slices inside a genuinely buried shell.
    for (let row = 1; row < 32; row++) {
      const point = rearFoot.clone().lerp(foot, row / 32);
      point.y = burialHeightAt(point.x, point.z) - cut.buryDepth;
      push(point, "top");
    }
    if (sectionIndex === 0) projections.push("top");
    return ring;
  });

  const faceNormals = rings.slice(0, -1).map((left, column) => left.map((point, row) => {
    const next = (row + 1) % left.length;
    const right = rings[column + 1]!;
    return new THREE.Vector3().crossVectors(right[row]!.clone().sub(point), right[next]!.clone().sub(point))
      .add(new THREE.Vector3().crossVectors(right[next]!.clone().sub(point), left[next]!.clone().sub(point))).normalize();
  }));
  const cornerNormal = (column: number, row: number, faceColumn: number, edge: number): THREE.Vector3 => {
    const normal = new THREE.Vector3();
    const rows = [row, (row + projections.length - 1) % projections.length];
    const columns = detailed[column]!.crease ? [faceColumn] : [column - 1, column];
    const face = faceNormals[faceColumn]![edge]!;
    for (const col of columns) for (const candidate of rows) {
      const adjacent = faceNormals[col]?.[candidate];
      // Preserve physical fracture edges. A vanished joint has no artificial smoothing-group
      // border, so the same bed can finish in a continuous weathered face.
      if (adjacent && adjacent.dot(face) > 0.82) normal.add(adjacent);
    }
    return normal.lengthSq() > 1e-8 ? normal.normalize() : faceNormals[faceColumn]![edge]!.clone();
  };
  for (let column = 0; column < rings.length - 1; column++) {
    const left = rings[column]!; const right = rings[column + 1]!;
    for (let edge = 0; edge < left.length; edge++) {
      const next = (edge + 1) % left.length;
      const a = cornerNormal(column, edge, column, edge);
      const b = cornerNormal(column + 1, edge, column, edge);
      const c = cornerNormal(column + 1, next, column, edge);
      const d = cornerNormal(column, next, column, edge);
      triangle(left[edge]!, right[edge]!, right[next]!, projections[edge]!, [a, b, c]);
      triangle(left[edge]!, right[next]!, left[next]!, projections[edge]!, [a, c, d]);
    }
  }
  const solids = collisionFromDrawnRings(site, scene, detailed, rings);
  for (const [ring, direction] of [[rings[0]!, -1], [rings.at(-1)!, 1]] as const) {
    // The buried end profile is a narrow, star-shaped section with no weathering displacement.
    // A centre fan retains every boundary vertex; ear clipping can discard the collinear
    // terrain-contact vertices and leave T-junctions along the closed shell.
    const centre = ring[0]!.clone().lerp(ring.at(-1)!, 0.5);
    centre.y = (Math.max(...ring.map((point) => point.y)) + Math.min(...ring.map((point) => point.y))) / 2;
    for (let edge = 0; edge < ring.length; edge++) {
      let a = ring[edge]!; let b = ring[(edge + 1) % ring.length]!;
      const normal = new THREE.Vector3().crossVectors(a.clone().sub(centre), b.clone().sub(centre));
      if (normal.dot(frontAxis) * direction < 0) [a, b] = [b, a];
      triangle(centre, a, b, "end");
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${site.id}:cut-face`;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.worldSiteId = site.id;
  mesh.userData.ownedGeometry = true;
  return { objects: [mesh], solids };
}

interface ProfilePoint { across: number; depth: number; y: number }

/** Vertical slice through a drawn cross-section, including its weathered face and buried roof. */
function profileInterval(profile: readonly ProfilePoint[], depth: number): {
  bottom: number; top: number; minimumAcross: number; maximumAcross: number;
} | null {
  const crossings: number[] = [];
  let minimumAcross = Infinity; let maximumAcross = -Infinity;
  for (let edge = 0; edge < profile.length; edge++) {
    const a = profile[edge]!; const b = profile[(edge + 1) % profile.length]!;
    const delta = b.depth - a.depth;
    if (Math.abs(delta) < 1e-8) continue;
    // Half-open edges preserve paired crossings at tangent corners. A recessed face can have
    // several disjoint solid intervals at one depth; min/max would fill their intervening air.
    if (depth < Math.min(a.depth, b.depth) || depth >= Math.max(a.depth, b.depth)) continue;
    const t = (depth - a.depth) / delta;
    const y = THREE.MathUtils.lerp(a.y, b.y, t);
    const across = THREE.MathUtils.lerp(a.across, b.across, t);
    crossings.push(y);
    minimumAcross = Math.min(minimumAcross, across); maximumAcross = Math.max(maximumAcross, across);
  }
  crossings.sort((a, b) => a - b);
  for (let index = 0; index + 1 < crossings.length; index += 2) {
    const bottom = crossings[index]!; const top = crossings[index + 1]!;
    if (top - bottom > 1e-7) return { bottom, top, minimumAcross, maximumAcross };
  }
  return null;
}

/**
 * Inscribe yaw-only boxes in the finalized shell. The old full-depth boxes were captured before
 * end tapering and roof burial, leaving invisible walls beyond the rendered cliff. These short
 * strips sample every intervening drawn section and every profile corner within each depth band.
 */
function collisionFromDrawnRings(
  site: WorldSite, scene: WorldScene, sections: readonly Section[], rings: readonly THREE.Vector3[][],
): SolidVolume[] {
  const solids: SolidVolume[] = [];
  for (let first = 0; first < rings.length - 1;) {
    let last = first + 1;
    while (last < rings.length - 1 && rings[first]![0]!.distanceTo(rings[last]![0]!) < 1.0) last++;
    const origin = rings[first]![0]!;
    const along = rings[last]![0]!.clone().sub(origin); along.y = 0;
    if (along.length() < 0.08) { first = last; continue; }
    along.normalize();
    const outward = new THREE.Vector3(-along.z, 0, along.x);
    if (outward.dot(sections[first]!.plane.normal) < 0) outward.negate();
    const profiles = rings.slice(first, last + 1).map((ring) => ring.map((point): ProfilePoint => {
      const relative = point.clone().sub(origin);
      return { across: relative.dot(along), depth: relative.dot(outward), y: point.y };
    }));
    const front = Math.min(...profiles.map((profile) => Math.max(...profile.map((point) => point.depth)))) - 0.025;
    const rear = Math.max(...profiles.map((profile) => Math.min(...profile.map((point) => point.depth)))) + 0.025;
    for (let near = front; near > rear + 0.08;) {
      const width = front - near < 0.65 ? 0.22 : front - near < 1.8 ? 0.60 : 1.2;
      const far = Math.max(rear, near - width);
      const depths = [far, (far + near) / 2, near,
        ...profiles.flatMap((profile) => profile.map((point) => point.depth).filter((depth) => depth > far && depth < near))];
      let bottom = -Infinity; let top = Infinity;
      let left = -Infinity; let right = Infinity;
      let complete = true;
      for (const depth of depths) {
        for (const [index, profile] of profiles.entries()) {
          const interval = profileInterval(profile, depth);
          if (!interval) { complete = false; break; }
          bottom = Math.max(bottom, interval.bottom);
          top = Math.min(top, interval.top);
          if (index === 0) left = Math.max(left, interval.maximumAcross);
          if (index === profiles.length - 1) right = Math.min(right, interval.minimumAcross);
        }
        if (!complete) break;
      }
      left += 0.035; right -= 0.035; bottom += 0.02; top -= 0.045;
      if (complete && right - left > 0.08 && top - bottom > 0.10 && near - far > 0.08) {
        const centre = origin.clone().addScaledVector(along, (left + right) / 2).addScaledVector(outward, (near + far) / 2);
        let lowestGround = scene.meshHeightAt(centre.x, centre.z);
        for (const across of [left, right]) for (const depth of [far, near]) {
          const corner = origin.clone().addScaledVector(along, across).addScaledVector(outward, depth);
          lowestGround = Math.min(lowestGround, scene.meshHeightAt(corner.x, corner.z));
        }
        // Entirely buried terminal profiles and rear shoulders need no extra obstacle over terrain.
        if (top > lowestGround + 0.08) {
          solids.push({
            kind: "box", id: `${site.id}:cut-face:${solids.length}`,
            position: [centre.x, bottom, centre.z], size: [right - left, top - bottom, near - far],
            rotationY: Math.atan2(outward.x, outward.z),
          });
        }
      }
      near = far;
    }
    first = last;
  }
  return solids;
}
