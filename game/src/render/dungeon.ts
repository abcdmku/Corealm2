/**
 * Dungeon interior geometry.
 *
 * The Gravelmaw was authored as chamber centres, radii and floor offsets — positions with nothing
 * underneath them. Everything in it therefore sat in mid-air over Karrowmoor's surface: entering
 * the dungeon snapped the player back up to the terrain, and Ordrun chased them, decided he was too
 * far from home, and walked back. A dungeon needs a floor before it can be a place.
 *
 * The interior is built rather than placed because the free asset library has no modular dungeon
 * kit (see `runs/corealm/asset-report.md`).
 *
 * Rebuilt in the world-polish wave, because the round-1 version was three separate rooms that could
 * not have worked. Measured from the authored data in `content/regions.ts`: chamber centres sit
 * 20.6 m and 19.7 m apart with wall radii of 12.2, 13.2 and 13.2 m, so consecutive chambers OVERLAP
 * by 4.8 m and 6.7 m. Three consequences followed, and all three are fixed here:
 *
 *  - Each chamber got a full 360-degree wall ring, so every ring drove a solid wall straight through
 *    the middle of its neighbour's room and sealed the two apart. The comment that used to sit on
 *    that code claimed the rings had "a gap where a corridor meets it". They did not; there was no
 *    gap logic anywhere in the file.
 *  - Each chamber got a flat floor disc at its own height, and consecutive discs overlap, so the
 *    upper disc hung 4 m above the lower one as an unreachable shelf (`NAV_CONFIG.walkableClimb` is
 *    2 voxels = 0.4 m).
 *  - Corridors ran centre to centre at a linear slope, which put the first 9.3 m of every ramp
 *    UNDERNEATH the floor disc it started from, with less than the 1.8 m of clearance Recast needs.
 *
 * The replacement is one continuous cavern surface: a single height field over the union of the
 * chamber footprints, blended between the authored floor heights, with the walls following the
 * outline of that union rather than each chamber's own circle. The chambers keep their authored
 * centres, radii and floor heights; what changes is that the space between them is now floor.
 */
import * as THREE from "three";
import { mergeGeometries, mergeVertices, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { caveEnvelopeSampler, caveSourceCoordinates } from './caveSourceDomain.js';
import type { RegionId, SolidVolume, Vec3 } from "../contracts.js";
import type { MaterialLibrary } from "./materials.js";
import { REGION_PALETTES } from "./materials.js";
import { Rng } from "../core/rng.js";
import { applyCorealmSurfaceMaterials, type CorealmSurfaceTextures } from "./corealmSurfaceMaterials.js";

export interface ChamberSpec {
  id: string;
  name: string;
  /** World-space centre. */
  centre: [number, number];
  radius: number;
  /** Absolute floor height. */
  floorY: number;
  lit: boolean;
}

export interface CorridorSpec {
  from: [number, number];
  to: [number, number];
  fromY: number;
  toY: number;
  width: number;
}

export interface DungeonSpec {
  regionId: RegionId;
  chambers: ChamberSpec[];
  corridors: CorridorSpec[];
  /** Interior height, floor to ceiling. */
  wallHeight: number;
}

export interface BuiltDungeon {
  group: THREE.Group;
  /** The cavern floor — the surface the navmesh is generated from. One mesh, not one per chamber. */
  walkable: THREE.Mesh[];
  /** Walls and ceilings, which must block the navmesh without being walked on. */
  blockers: THREE.Mesh[];
  triangles: number;
}

/** How far the rock wall stands outside a chamber's play radius. */
const WALL_THICKNESS = 1.2;

/**
 * Floor grid resolution.
 *
 * 1.25 m is finer than Recast's own 0.45 m large-world cell only needs, but the grid also carries
 * the vertex-colour contact darkening, and at 2.5 m the darkening banded visibly across a chamber.
 */
const FLOOR_CELL_METRES = 1.25;

/**
 * How far the floor runs past the wall line.
 *
 * The floor is a square grid and the wall is an arc, so their edges cannot coincide. Running the
 * floor 1.6 m past the wall puts the ragged grid edge behind opaque rock from every point a player
 * can stand, which is cheaper than clipping the grid to the circle and produces no seam.
 */
const FLOOR_MARGIN_METRES = 1.6;

/** Arc resolution of a chamber wall. Chord at the Gravelmaw's 12.2 m radius is 1.91 m. */
const WALL_SEGMENTS = 40;

/** Metres the wall overlaps the floor below and the ceiling above, so no hairline gap can show. */
const WALL_OVERLAP = 0.5;

/**
 * How much of the sky's image lighting reaches a cave.
 *
 * `scene.environment` is global in three — it lights every standard material in the scene no matter
 * where the geometry is. Left at 1.0 the Gravelmaw is lit by the sky it is buried under. 0.12 keeps
 * a trace so the rock is not a flat silhouette between torches.
 */
const INTERIOR_ENV_INTENSITY = 0.12;

/**
 * Opt-in wiring the dungeon cannot work out for itself.
 *
 * `ceilingAt` is the one that matters. `wallHeight` is authored as 13 m in `boot.ts` with the note
 * "tall enough to reach the terrain above", and it overshoots: with chamber floors at 17.9, 13.9 and
 * 9.9 m the ceilings land at 30.9, 26.9 and 22.9 m, and Karrowmoor's surface above them is lower
 * than that. The chamber volume comes out of the moor, and because a terrain backface is culled the
 * player looks THROUGH the hillside at daylight — two bright green wedges, measured in
 * `sky-dungeon-chamber3-up.png`. Hand this the terrain sampler and the roof stops where the rock
 * does.
 */
export interface DungeonOptions {
  /** The highest a ceiling may sit at this world XZ. Normally the terrain height less a margin. */
  ceilingAt?: (x: number, z: number) => number;
  /** Preloaded shared stone maps. UVs use metres; the maps supply their authored tile size. */
  surfaceTextures?: CorealmSurfaceTextures;
  /** Prepared licensed source geometry. Omit for the structural-shell fallback. */
  rockSource?: CaveRockSource;
  /** Use the authored scanned-rock envelope while its detailed facing is still unloaded. */
  rockEnvelope?: boolean;
}

export interface CaveRockSource {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  provenance: string;
  continuousEnvelope?: boolean;
  domainWarp?: { columns: number; rows: number };
}

/** Root preloads this beside the other shared assets; no asynchronous work occurs during build. */
export async function loadCaveRockSource(url: string): Promise<CaveRockSource> {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  let mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | undefined;
  gltf.scene.traverse(object => {
    if (!mesh && object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) mesh = object;
  });
  if (!mesh) throw new Error('Cave rock source must contain a standard-material mesh');
  return { geometry: mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), material: mesh.material,
    continuousEnvelope: gltf.scene.userData.caveContinuousEnvelope === true,
    domainWarp: gltf.scene.userData.caveDomainWarp,
    provenance: 'Poly Haven Rock Face 01, Dario Barresi, CC0-1.0' };
}

/** Never squash a chamber below this, whatever `ceilingAt` says. A cave you cannot stand in is worse. */
const MIN_HEADROOM = 4;

interface FloorGrid {
  minX: number;
  minZ: number;
  cells: number;
  columns: number;
  rows: number;
  /** Per grid corner, in row-major order over (rows + 1) x (columns + 1). */
  height: Float32Array;
  depth: Float32Array;
  /** Whether the cell at [row * columns + column] is inside the cavern. */
  filled: Uint8Array;
}

/**
 * Builds a dungeon's interior.
 *
 * Returns three meshes: one floor, one merged wall, one merged ceiling. Round 1 returned eleven
 * (three floors, three walls, three ceilings, two corridor decks); the merge is possible because
 * every wall now shares one material and one winding, and it costs the interior 3 draw calls
 * instead of 11 whenever the player is underground.
 */
export function buildDungeon(
  spec: DungeonSpec,
  // Retained so `boot.ts` compiles unchanged. The dungeon builds its own two materials now: both
  // need vertex colours for the contact darkening, and both need a near-zero `envMapIntensity`,
  // neither of which can be asked of the shared library without changing the surface world too.
  _materials: MaterialLibrary,
  options?: DungeonOptions,
): BuiltDungeon {
  const group = new THREE.Group();
  group.name = `dungeon-${spec.regionId}`;
  const walkable: THREE.Mesh[] = [];
  const blockers: THREE.Mesh[] = [];
  let triangles = 0;

  const palette = REGION_PALETTES[spec.regionId] ?? REGION_PALETTES.gravelmaw;
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.97, metalness: 0,
    envMapIntensity: INTERIOR_ENV_INTENSITY, side: THREE.DoubleSide,
  });
  floorMaterial.name = "dungeon-floor";
  const rockMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0, flatShading: false,
    // Camera collision can briefly place the eye outside the shell. Keep both sides opaque;
    // triangle winding still identifies the floor and inward blockers for navigation.
    envMapIntensity: INTERIOR_ENV_INTENSITY, side: THREE.DoubleSide,
  });
  rockMaterial.name = "dungeon-rock";

  const grid = buildFloorGrid(spec);
  const shellGrid = expandedShellGrid(spec, grid);

  const floorGeometry = buildFloorGeometry(grid, palette.groundLow, false);
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.name = "dungeon-floor";
  floor.receiveShadow = true;
  group.add(floor);
  walkable.push(floor);
  triangles += triangleCount(floorGeometry);

  const roofGrid = buildFloorGeometry(shellGrid, palette.rock, true, spec.wallHeight, options);
  const ceilingGeometry = toCreasedNormals(roofGrid, 0.38);
  roofGrid.dispose();
  const ceiling = new THREE.Mesh(ceilingGeometry, rockMaterial);
  ceiling.name = "dungeon-ceiling";
  ceiling.castShadow = true;
  ceiling.receiveShadow = true;
  group.add(ceiling);
  blockers.push(ceiling);
  triangles += triangleCount(ceilingGeometry);

  const wallFaces = buildWallGeometry(spec, shellGrid, palette.rock, options);
  const apronGrid = { ...shellGrid, filled: shellGrid.filled.slice() };
  for (let row = 0; row < shellGrid.rows; row++) for (let column = 0; column < shellGrid.columns; column++) {
    const oldColumn = Math.round((shellGrid.minX - grid.minX) / FLOOR_CELL_METRES) + column;
    const oldRow = Math.round((shellGrid.minZ - grid.minZ) / FLOOR_CELL_METRES) + row;
    if (oldColumn >= 0 && oldColumn < grid.columns && oldRow >= 0 && oldRow < grid.rows
      && grid.filled[oldRow * grid.columns + oldColumn]) apronGrid.filled[row * shellGrid.columns + column] = 0;
  }
  const apronIndexed = buildFloorGeometry(apronGrid, palette.groundLow, false);
  const apron = apronIndexed.toNonIndexed();
  apronIndexed.dispose();
  // Keep the original navigation floor byte-identical. This outer apron is part of opaque rock
  // dressing, and its upward triangles meet the grid without a coplanar duplicate in the play area.
  const apronPosition = apron.getAttribute('position'), apronUv = apron.getAttribute('uv');
  for (let i = 0; i < apronPosition.count; i++) apronUv.setXY(i, apronPosition.getX(i), apronPosition.getY(i));
  const wallGeometry = mergeGeometries([wallFaces, apron])!;
  wallGeometry.userData.wallVertexCount = wallFaces.getAttribute('position').count;
  wallGeometry.userData.outerContours = cavernBoundary(spec);
  wallFaces.dispose(); apron.dispose();
  const wall = new THREE.Mesh(wallGeometry, rockMaterial);
  wall.name = "dungeon-wall";
  wall.receiveShadow = true;
  wall.castShadow = true;
  group.add(wall);
  blockers.push(wall);
  triangles += triangleCount(wallGeometry);

  if (options?.surfaceTextures) {
    // Use the same measured-mean albedo modulation as the exposed rock library. It retains the
    // cave's vertex palette and contact darkening while sharing the authored PBR textures.
    floorMaterial.name = "Corealm weathered strata@dungeon-floor";
    rockMaterial.name = "Corealm weathered strata@dungeon-rock";
    applyCorealmSurfaceMaterials(group, options.surfaceTextures);
    floor.material.name = "dungeon-floor";
    floor.material.roughness = floorMaterial.roughness;
    ceiling.material.name = "dungeon-rock";
    ceiling.material.roughness = rockMaterial.roughness;
    applyCaveRockProjection(ceiling.material, options.surfaceTextures.stone.tileMetres);
    // The helper clones materials but retains shared maps. Only the unused originals are owned here.
    floorMaterial.dispose();
    rockMaterial.dispose();
  }

  if (options?.rockSource) {
    const facing = buildSourceRockFacing(spec, shellGrid, options.rockSource, options);
    group.add(facing);
    blockers.push(facing);
    triangles += triangleCount(facing.geometry);
  }

  return { group, walkable, blockers, triangles };
}

/** The original detailed facing, attached once after the structural shell is ready. */
export function attachDungeonRockFacing(
  dungeon: BuiltDungeon, spec: DungeonSpec, source: CaveRockSource, options: DungeonOptions,
): THREE.Mesh {
  const existing = dungeon.group.getObjectByName("dungeon-rock-facing") as THREE.Mesh | undefined;
  if (existing) return existing;
  const facing = buildSourceRockFacing(spec, expandedShellGrid(spec, buildFloorGrid(spec)), source,
    { ...options, rockSource: source });
  dungeon.group.add(facing);
  dungeon.blockers.push(facing);
  dungeon.triangles += triangleCount(facing.geometry);
  return facing;
}

/** The scan decorates the closed rock shell outside the authored walking footprint. */
export function dungeonNavigationBlockers(blockers: readonly THREE.Mesh[]): THREE.Mesh[] {
  return blockers.filter(mesh => mesh.name !== "dungeon-rock-facing");
}

/** Fit the licensed scan as connected facing strips, retaining its triangles and authored UVs. */
function buildSourceRockFacing(spec: DungeonSpec, grid: FloorGrid, source: CaveRockSource, options: DungeonOptions): THREE.Mesh {
  const sourcePosition = source.geometry.getAttribute('position'), sourceUv = source.geometry.getAttribute('uv');
  let sourceIndex = source.geometry.index;
  if (!sourceUv || !sourceIndex) throw new Error('Cave source needs indexed geometry and original UVs');
  // The periodic source remains full resolution for relief sampling. Repeating its dense scan
  // topology on every wall and roof panel otherwise produces millions of rendered triangles.
  const vertices: number[] = [];
  if (source.continuousEnvelope && source.domainWarp) {
    const { columns, rows } = source.domainWarp;
    if (sourcePosition.count !== (columns + 1) * (rows + 1)) throw new Error('Unexpected cave envelope grid');
    const indices: number[] = [];
    for (let row = 0; row <= rows; row = Math.min(rows, row + 4)) {
      for (let column = 0; column <= columns; column = Math.min(columns, column + 4)) {
        const a = row * (columns + 1) + column;
        vertices.push(a);
        if (row < rows && column < columns) {
          const b = row * (columns + 1) + Math.min(columns, column + 4);
          const c = Math.min(rows, row + 4) * (columns + 1) + column;
          const d = Math.min(rows, row + 4) * (columns + 1) + Math.min(columns, column + 4);
          indices.push(a, b, d, a, d, c);
        }
        if (column === columns) break;
      }
      if (row === rows) break;
    }
    sourceIndex = new THREE.Uint32BufferAttribute(indices, 1);
  } else {
    for (let i = 0; i < sourcePosition.count; i++) vertices.push(i);
  }
  source.geometry.computeBoundingBox();
  const bounds = source.geometry.boundingBox!, size = bounds.getSize(new THREE.Vector3());
  const envelope = source.domainWarp ? caveEnvelopeSampler(source.geometry, source.domainWarp.columns, source.domainWarp.rows) : null;
  const scale = 1.3, width = size.x * scale, height = size.y * scale;
  const contours = cavernBoundary(spec);
  const positions: number[] = [], uvs: number[] = [], sourceBlend: number[] = [], indices: number[] = [];
  const borderNormals: number[] = [], borderNormalWeights: number[] = [];
  const roofBorderVertices: number[] = [];
  let wallPanels = 0, roofPanels = 0;
  const append = (map: (point: THREE.Vector3) => { position: THREE.Vector3; normal: THREE.Vector3 } | null, reverse = false): number => {
    const mapped: number[] = [];
    for (const i of vertices) {
      const local = new THREE.Vector3().fromBufferAttribute(sourcePosition, i);
      const point = map(local);
      mapped[i] = point ? positions.length / 3 : -1;
      if (!point) continue;
      positions.push(...point.position.toArray());
      borderNormals.push(...point.normal.toArray());
      uvs.push(...(source.continuousEnvelope ? [point.position.x, point.position.z] : [sourceUv.getX(i), sourceUv.getY(i)]));
      const edgeDistance = Math.min(local.x - bounds.min.x, bounds.max.x - local.x,
        local.y - bounds.min.y, bounds.max.y - local.y);
      if (point.normal.y < -0.5 && edgeDistance < 1e-5) roofBorderVertices.push(positions.length / 3 - 1);
      const weight = Math.max(0, Math.min(1, (edgeDistance - 0.18) / 0.32));
      sourceBlend.push(source.continuousEnvelope ? 0 : weight * weight * (3 - 2 * weight));
      borderNormalWeights.push(1 - Math.max(0, Math.min(1, (edgeDistance - 0.015) / 0.06)));
    }
    let count = 0;
    for (let i = 0; i < sourceIndex.count; i += 3) {
      const a = sourceIndex.getX(i), b = sourceIndex.getX(i + 1), c = sourceIndex.getX(i + 2);
      if (mapped[a]! < 0 || mapped[b]! < 0 || mapped[c]! < 0) continue;
      indices.push(mapped[a]!, mapped[reverse ? c : b]!, mapped[reverse ? b : c]!); count++;
    }
    return count;
  };
  for (const contour of contours) {
    const distances = [0];
    for (let i = 0; i < contour.length; i++) distances.push(distances[i]! + Math.hypot(
      contour[(i + 1) % contour.length]![0] - contour[i]![0], contour[(i + 1) % contour.length]![1] - contour[i]![1]));
    const perimeter = distances[distances.length - 1]!;
    const count = Math.ceil(perimeter / width), step = perimeter / count;
    const sample = (u: number): { point: BoundaryPoint; normal: BoundaryPoint } => {
      const wrapped = ((u % perimeter) + perimeter) % perimeter;
      let index = 0;
      while (distances[index + 1]! < wrapped) index++;
      const a = contour[index]!, b = contour[(index + 1) % contour.length]!;
      const t = (wrapped - distances[index]!) / (distances[index + 1]! - distances[index]!);
      const normalA = boundaryNormal(contour[(index + contour.length - 1) % contour.length]!, a, b);
      const normalB = boundaryNormal(a, b, contour[(index + 2) % contour.length]!);
      const nx = normalA[0] * (1 - t) + normalB[0] * t, nz = normalA[1] * (1 - t) + normalB[1] * t;
      const length = Math.hypot(nx, nz);
      return { point: [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t], normal: [nx / length, nz / length] };
    };
    const rows = Math.ceil(spec.wallHeight / height);
    for (let row = 0; row < rows; row++) for (let panel = 0; panel < count; panel++) {
      const centreU = (panel + 0.5) * step;
      const contributed = append(local => {
        const { point, normal } = sample(centreU + local.x / size.x * step);
        const floorY = sampleGridHeight(grid, ...point);
        const roofY = sampleGridHeight(grid, ...point, spec.wallHeight, options);
        const fraction = (row + (local.y - bounds.min.y) / size.y) / rows;
        const y = floorY - 0.06 + fraction * (roofY - floorY + 0.14);
        // Compress depth only where the original walking envelope has no room for the scan.
        // The scan's broad planes, topology and UVs remain the actual rendered source.
        const permitted = standingRockMargin(spec, ...point);
        const depth = Math.min(size.z * scale, Math.max(0, permitted - 0.06));
        const sourceDepth = envelope ? envelope(...caveSourceCoordinates(panel * size.x + local.x,
          row * size.y + local.y - bounds.min.y, point[0], y, point[1])) : local.z;
        const inset = 0.025 + (sourceDepth - bounds.min.z) / size.z * depth;
        return { position: new THREE.Vector3(point[0] + normal[0] * inset, y, point[1] + normal[1] * inset),
          normal: new THREE.Vector3(normal[0], 0, normal[1]) };
      });
      if (contributed) wallPanels++;
    }
  }
  const roofStepX = width, roofStepZ = height;
  const inside = (x: number, z: number): boolean => contours.some(contour => classifyBoundaryPoint([x, z], contour) >= 0);
  let roofRow = 0;
  for (let z = grid.minZ; z < grid.minZ + grid.rows * FLOOR_CELL_METRES; z += roofStepZ, roofRow++) {
    let roofColumn = 0;
    for (let x = grid.minX; x < grid.minX + grid.columns * FLOOR_CELL_METRES; x += roofStepX, roofColumn++) {
      // Skip cells whose complete source bounds cannot reach the authored chamber contour.
      if (![0, -width / 2, width / 2].some(dx => [0, -height / 2, height / 2].some(dz => inside(x + dx, z + dz)))) continue;
      const contributed = append(local => {
        const px = x + local.x * scale;
        const pz = z + (local.y - bounds.min.y - size.y / 2) * scale;
        if (!inside(px, pz)) return null;
        const floor = sampleGridHeight(grid, px, pz), roof = sampleGridHeight(grid, px, pz, spec.wallHeight, options);
        const inset = Math.min(0.035, Math.max(0, roof - floor - MIN_HEADROOM));
        // The roof carries the scan at the same physical amplitude as the walls. The earlier 0.88 m
        // budget stretched its relief almost twofold, which turned narrow scan fissures into
        // hard-edged black slots and made the rim motifs large enough to read as repeats.
        const depth = Math.min(size.z * scale, Math.max(0, roof - floor - MIN_HEADROOM - inset));
        const step = 0.01;
        const derivativeX = sampleGridHeight(grid, px + step, pz, spec.wallHeight, options) - sampleGridHeight(grid, px - step, pz, spec.wallHeight, options);
        const derivativeZ = sampleGridHeight(grid, px, pz + step, spec.wallHeight, options) - sampleGridHeight(grid, px, pz - step, spec.wallHeight, options);
        const sourceDepth = envelope ? envelope(...caveSourceCoordinates(px / scale, pz / scale, px, roof, pz)) : local.z;
        return { position: new THREE.Vector3(px, roof - inset - (sourceDepth - bounds.min.z) / size.z * depth, pz),
          normal: new THREE.Vector3(derivativeX, -2 * step, derivativeZ).normalize() };
      });
      if (contributed) roofPanels++;
    }
  }
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('caveSourceBlend', new THREE.Float32BufferAttribute(sourceBlend, 1));
  geometry.setIndex(indices);
  if (source.continuousEnvelope) {
    const welded = mergeVertices(geometry, 1e-5); geometry.dispose(); geometry = welded;
  }
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  for (let i = 0; !source.continuousEnvelope && i < normals.count; i++) {
    if (!borderNormalWeights[i]) continue;
    const normal = new THREE.Vector3().fromBufferAttribute(normals, i)
      .lerp(new THREE.Vector3().fromArray(borderNormals, i * 3), borderNormalWeights[i]!).normalize();
    normals.setXYZ(i, normal.x, normal.y, normal.z);
  }
  geometry.computeBoundingSphere();
  const roofPairs = new Map<string, number>();
  let roofMatchedBorderSamples = 0, roofBorderPositionGap = 0, roofBorderNormalDegrees = 0;
  const finalPosition = geometry.getAttribute('position');
  for (const vertex of source.continuousEnvelope ? [] : roofBorderVertices) {
    const p = new THREE.Vector3().fromBufferAttribute(finalPosition, vertex);
    const key = `${Math.round(p.x * 1e5)}:${Math.round(p.z * 1e5)}`;
    const previous = roofPairs.get(key);
    if (previous === undefined) { roofPairs.set(key, vertex); continue; }
    roofMatchedBorderSamples++;
    roofBorderPositionGap = Math.max(roofBorderPositionGap, p.distanceTo(new THREE.Vector3().fromBufferAttribute(finalPosition, previous)));
    roofBorderNormalDegrees = Math.max(roofBorderNormalDegrees, THREE.MathUtils.radToDeg(
      new THREE.Vector3().fromBufferAttribute(normals, vertex).angleTo(new THREE.Vector3().fromBufferAttribute(normals, previous))));
  }
  geometry.userData = { wallPanels, roofPanels, sourceTriangles: sourceIndex.count / 3,
    renderedTriangles: indices.length / 3, provenance: source.provenance,
    sourceScale: scale, sectionWidth: width, sectionHeight: height, edgeBlendSourceMetres: source.continuousEnvelope ? 0.25 : 0.18,
    continuousEnvelope: !!source.continuousEnvelope, inputVertices: positions.length / 3,
    domainWarp: !!source.domainWarp,
    weldedVertices: geometry.getAttribute('position').count,
    roofMatchedBorderSamples: source.continuousEnvelope ? null : roofMatchedBorderSamples,
    roofBorderPositionGap: source.continuousEnvelope ? null : roofBorderPositionGap,
    roofBorderNormalDegrees: source.continuousEnvelope ? null : roofBorderNormalDegrees };
  let material = source.material.clone();
  if (options.surfaceTextures) {
    // The visible source relief shares the shell's continuous metre-scaled material at every edge.
    const base = new THREE.MeshStandardMaterial({ color: (REGION_PALETTES[spec.regionId] ?? REGION_PALETTES.gravelmaw).rock });
    base.name = 'Corealm weathered strata@cave-source';
    const temporary = new THREE.Mesh(geometry, base);
    applyCorealmSurfaceMaterials(temporary, options.surfaceTextures);
    material.dispose(); material = temporary.material;
    applyCaveRockProjection(material, options.surfaceTextures.stone.tileMetres);
    if (!source.continuousEnvelope) applyCaveSourceDetail(material, source.material.map!);
    base.dispose();
  }
  material.name = 'dungeon-scanned-rock';
  material.envMapIntensity = INTERIOR_ENV_INTENSITY;
  material.roughness = 0.96; material.metalness = 0;
  material.side = THREE.DoubleSide;
  material.normalScale.setScalar(0.65);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'dungeon-rock-facing'; mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

/** Source pigment is restrained and vanishes before the joining collar; normals/roughness stay continuous. */
function applyCaveSourceDetail(material: THREE.MeshStandardMaterial, sourceMap: THREE.Texture): void {
  const inherited = material.onBeforeCompile.bind(material), inheritedKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    inherited(shader, renderer);
    shader.uniforms.caveSourceMap = { value: sourceMap };
    shader.vertexShader = `attribute float caveSourceBlend;
      varying float vCaveSourceBlend; varying vec2 vCaveSourceUv;
      ${shader.vertexShader}`.replace('#include <uv_vertex>', `#include <uv_vertex>
        vCaveSourceBlend = caveSourceBlend; vCaveSourceUv = uv;`);
    shader.fragmentShader = `uniform sampler2D caveSourceMap;
      varying float vCaveSourceBlend; varying vec2 vCaveSourceUv;
      ${shader.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>
        vec3 sourcePigment = texture2D(caveSourceMap, vCaveSourceUv).rgb;
        float sourceLuma = dot(sourcePigment, vec3(0.2126, 0.7152, 0.0722));
        float sourceDetail = clamp(sourceLuma / 0.30, 0.70, 1.30);
        diffuseColor.rgb *= mix(1.0, sourceDetail, vCaveSourceBlend * 0.35);`);
  };
  material.customProgramCacheKey = () => `${inheritedKey()}|cave-source-detail-v1`;
}

/** World projection carries one stone scale and phase around the wall and across the roof. */
function applyCaveRockProjection(material: THREE.MeshStandardMaterial, tileMetres: number): void {
  const inherited = material.onBeforeCompile.bind(material);
  const inheritedKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    inherited(shader, renderer);
    shader.vertexShader = `varying vec3 vCavePosition;\nvarying vec3 vCaveNormal;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCavePosition = (modelMatrix * vec4(position, 1.0)).xyz;
        vCaveNormal = normalize(mat3(modelMatrix) * normal);`);
    shader.fragmentShader = `varying vec3 vCavePosition;
      varying vec3 vCaveNormal;
      vec3 caveWeights() {
        vec3 w = pow(abs(normalize(vCaveNormal)), vec3(4.0));
        return w / max(dot(w, vec3(1.0)), 0.0001);
      }
      vec4 caveTexture(sampler2D sourceMap) {
        vec3 p = vCavePosition / ${tileMetres.toFixed(6)};
        vec3 w = caveWeights();
        return texture2D(sourceMap, p.zy) * w.x
          + texture2D(sourceMap, p.xz) * w.y
          + texture2D(sourceMap, p.xy) * w.z;
      }
      ${shader.fragmentShader}`
      .replace('texture2D( map, vMapUv )', 'caveTexture(map)')
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          roughnessFactor *= caveTexture(roughnessMap).g;
        #endif`)
      .replace('#include <normal_fragment_maps>', `
        #ifdef USE_NORMALMAP
          vec3 caveP = vCavePosition / ${tileMetres.toFixed(6)};
          vec3 caveW = caveWeights();
          vec2 caveX = (texture2D(normalMap, caveP.zy).xy * 2.0 - 1.0) * normalScale;
          vec2 caveY = (texture2D(normalMap, caveP.xz).xy * 2.0 - 1.0) * normalScale;
          vec2 caveZ = (texture2D(normalMap, caveP.xy).xy * 2.0 - 1.0) * normalScale;
          vec3 caveN = normalize(vCaveNormal);
          vec3 cavePerturb = vec3(0.0, caveX.y, caveX.x) * caveW.x
            + vec3(caveY.x, 0.0, caveY.y) * caveW.y
            + vec3(caveZ.x, caveZ.y, 0.0) * caveW.z;
          cavePerturb -= caveN * dot(caveN, cavePerturb);
          normal = normalize(normal + mat3(viewMatrix) * cavePerturb);
        #endif`);
  };
  material.customProgramCacheKey = () => `${inheritedKey()}|cave-world-stone-v1:${tileMetres}`;
}

/**
 * The height of the cavern floor at a world XZ.
 *
 * Inverse-distance weighting over the authored chamber floors, cubed. The exponent is the whole
 * design: at p = 3 the surface is within 0.21 m of the authored floor height across a chamber's own
 * disc, and the steepest gradient between two chambers is `drop * p / separation` = 4 * 3 / 20.6 =
 * 30 degrees, which clears the player's 64-degree uphill limit with margin. p = 2 would flatten the
 * ramp to 21 degrees but bow each chamber floor 0.88 m below its authored height at the rim; p = 4
 * holds the floors flat but ramps at 38 degrees.
 */
export function dungeonFloorHeight(spec: DungeonSpec, x: number, z: number): number {
  let weighted = 0;
  let total = 0;
  for (const chamber of spec.chambers) {
    const distance = Math.hypot(x - chamber.centre[0], z - chamber.centre[1]);
    const weight = 1 / (distance * distance * distance + 0.05);
    weighted += chamber.floorY * weight;
    total += weight;
  }
  return total > 0 ? weighted / total : 0;
}

/** The roof height at a world XZ, clamped under the rock when a `ceilingAt` sampler is supplied. */
function ceilingHeightAt(spec: DungeonSpec, x: number, z: number, options?: DungeonOptions): number {
  const floor = dungeonFloorHeight(spec, x, z);
  const wanted = floor + spec.wallHeight;
  const limit = options?.ceilingAt?.(x, z);
  if (limit === undefined || !Number.isFinite(limit)) return wanted;
  return Math.max(floor + MIN_HEADROOM, Math.min(wanted, limit));
}

/** Where a chamber's floor actually is, for placing entities on it. */
export function chamberFloorAt(spec: DungeonSpec, point: Vec3): number | null {
  for (const chamber of spec.chambers) {
    const distance = Math.hypot(point[0] - chamber.centre[0], point[2] - chamber.centre[1]);
    // The blended surface, not `chamber.floorY`. The two differ by up to 2.4 m near the mouth of a
    // chamber that overlaps a deeper one, and returning the authored constant is what left dungeon
    // entities standing in the air over the ramp down to the next room.
    if (distance <= chamber.radius) return dungeonFloorHeight(spec, point[0], point[2]);
  }
  return null;
}

/**
 * Collision volumes for the dungeon shell, in the frozen `SolidVolume` shape.
 *
 * Why this exists: the camera films the Gravelmaw from OUTSIDE the rock. Measured over a 1,001
 * frame walk through the chamber, the occlusion probe reported 0 occluded frames and the camera sat
 * at y = 22.36 while the player stood on a floor at roughly y = 6 — because `buildDungeon`'s meshes
 * were added to the scene and never handed to `physics.addStaticBox`, so the Rapier world contained
 * nothing at all underground for a ray to hit.
 *
 * Two things a caller must know:
 *  - `position.y` is the BASE of each volume, per the contract.
 *  - Pass the same `ceilingAt` here that `buildDungeon` got, or the collision roof sits above the
 *    rendered one.
 *  - The ceiling volumes must NOT be turned into navmesh obstacles. Each one spans a whole chamber
 *    footprint, so carving it would delete the room from the navmesh. Pass
 *    `{ includeCeilings: false }` for the navmesh and the full list to physics.
 *
 * These are also the one place the "half-diagonal under INTERACT_RANGE" rule in `contracts.ts` is
 * deliberately broken: that rule exists so `moveTo({ entityId })` can still reach the entity a
 * volume wraps, and a wall wraps no entity.
 */
export function dungeonSolids(
  spec: DungeonSpec,
  options?: DungeonOptions & { includeCeilings?: boolean },
): SolidVolume[] {
  const volumes: SolidVolume[] = [];
  const includeCeilings = options?.includeCeilings ?? true;
  const grid = expandedShellGrid(spec, buildFloorGrid(spec));
  for (const [loopIndex, loop] of cavernBoundary(spec).entries()) {
    for (let index = 0; index < loop.length; index++) {
      const a = loop[index]!;
      const b = loop[(index + 1) % loop.length]!;
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const chord = Math.hypot(dx, dz);
      // Shift the volume into the rock. Its inner face covers the shallow lower ledges without
      // consuming the authored chamber radius or corridor width.
      const inwardA = standingRockMargin(spec, ...a), inwardB = standingRockMargin(spec, ...b);
      const inward = Math.max(inwardA, inwardB,
        standingRockMargin(spec, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2));
      const normalA = boundaryNormal(loop[(index + loop.length - 1) % loop.length]!, a, b);
      const normalB = boundaryNormal(a, b, loop[(index + 2) % loop.length]!);
      const alongA = (normalA[0] * dx + normalA[1] * dz) / chord * inwardA;
      const alongB = (normalB[0] * dx + normalB[1] * dz) / chord * inwardB;
      const start = Math.min(0, alongA), end = Math.max(chord, chord + alongB);
      const alongShift = (start + end - chord) / 2;
      const x = (a[0] + b[0]) / 2 + dz / chord * (0.8 - inward / 2) + dx / chord * alongShift;
      const z = (a[1] + b[1]) / 2 - dx / chord * (0.8 - inward / 2) + dz / chord * alongShift;
      const base = Math.min(sampleGridHeight(grid, a[0], a[1]), sampleGridHeight(grid, b[0], b[1])) - WALL_OVERLAP;
      const top = Math.max(ceilingHeightAt(spec, a[0], a[1], options), ceilingHeightAt(spec, b[0], b[1], options)) + WALL_OVERLAP;
      volumes.push({
        kind: "box",
        id: `dungeon-wall-${loopIndex}-${index}`,
        position: [x, base, z],
        size: [end - start + 0.16, top - base, 1.6 + inward],
        rotationY: -Math.atan2(dz, dx),
      });
    }
  }
  if (includeCeilings) {
    // Camera envelopes include high buttresses. Navigation keeps the unchanged floor-level
    // strips above; these volumes start above the player's standing headroom.
    const geometry = buildWallGeometry(spec, grid, REGION_PALETTES.gravelmaw.rock, options);
    const position = geometry.getAttribute("position");
    const columnVertices = 14 * 6;
    for (let first = 0; first < position.count; first += columnVertices) {
      const min = new THREE.Vector3(Infinity, Infinity, Infinity);
      const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      for (let vertex = first; vertex < Math.min(first + columnVertices, position.count); vertex++) {
        const point = new THREE.Vector3().fromBufferAttribute(position, vertex);
        min.min(point); max.max(point);
      }
      const x = (min.x + max.x) / 2, z = (min.z + max.z) / 2;
      const base = Math.max(...[min.x, max.x].flatMap(px => [min.z, max.z].map(pz => dungeonFloorHeight(spec, px, pz)))) + 3.4;
      if (max.y <= base) continue;
      volumes.push({ id: `dungeon-upper-rock-${first / columnVertices}`, kind: "box",
        position: [x, base, z], size: [Math.max(0.08, max.x - min.x + 0.12), max.y - base + 0.1,
          Math.max(0.08, max.z - min.z + 0.12)], rotationY: 0 });
    }
    geometry.dispose();
  }
  if (includeCeilings && options?.rockSource) {
    // The source roof sits below the opaque cap. Bound its maximum relief per floor-grid cell
    // so camera rays cannot cross the visible scan, including the outward chamber bays.
    const contours = cavernBoundary(spec);
    for (let row = 0; row < grid.rows; row++) for (let column = 0; column < grid.columns; column++) {
      const x = grid.minX + column * FLOOR_CELL_METRES, z = grid.minZ + row * FLOOR_CELL_METRES;
      const corners = [0, FLOOR_CELL_METRES].flatMap(dx => [0, FLOOR_CELL_METRES].map(dz => [x + dx, z + dz] as const));
      if (!corners.some(point => contours.some(contour => classifyBoundaryPoint([...point], contour) >= 0))) continue;
      const base = Math.min(...corners.map(point => {
        const floor = sampleGridHeight(grid, ...point), roof = sampleGridHeight(grid, ...point, spec.wallHeight, options);
        return Math.max(floor + MIN_HEADROOM, roof - 0.915);
      }));
      volumes.push({ id: `dungeon-source-ceiling-${column}-${row}`, kind: 'box',
        position: [x + FLOOR_CELL_METRES / 2, base, z + FLOOR_CELL_METRES / 2],
        size: [FLOOR_CELL_METRES + 0.01, 2.2, FLOOR_CELL_METRES + 0.01], rotationY: 0 });
    }
  }
  for (const chamber of includeCeilings && !options?.rockSource ? spec.chambers : []) {
    const outer = chamber.radius + WALL_THICKNESS;
    const ceilingBase = sampleGridHeight(grid, chamber.centre[0], chamber.centre[1], spec.wallHeight, options);
    volumes.push({
      kind: "box",
      id: `dungeon-ceiling-${chamber.id}`,
      position: [chamber.centre[0], ceilingBase, chamber.centre[1]],
      size: [outer * 2, 1.2, outer * 2],
      rotationY: 0,
    });
  }

  return volumes;
}

/** A torch-lit glow per chamber, so an unlit room reads as dark rather than as unfinished. */
export function addChamberLights(spec: DungeonSpec, group: THREE.Group): THREE.PointLight[] {
  const lights: THREE.PointLight[] = [];

  // A dim ambient floor so nothing underground is a pure black silhouette. Parented to the dungeon
  // group, which `loop.addInterior` hides whenever the player is on the surface — and three skips
  // lights under an invisible ancestor entirely, so this genuinely never leaks outdoors.
  const ambient = new THREE.HemisphereLight(0x66717a, 0x201b18, 0.42);
  ambient.name = "dungeon-ambient";
  group.add(ambient);

  for (const chamber of spec.chambers) {
    // Underground has no sun, so the only light is what the chamber provides. These are much
    // brighter than a surface fill because the scene's directional light contributes nothing here,
    // and a decay of 1.0 rather than 1.6 keeps the chamber edges readable instead of pitch black.
    const light = new THREE.PointLight(
      chamber.lit ? 0xffd0a0 : 0x97a6ae,
      chamber.lit ? 62 : 24,
      chamber.radius * 2.8,
      1.2,
    );
    const floorY = dungeonFloorHeight(spec, chamber.centre[0], chamber.centre[1]);
    light.position.set(chamber.centre[0] - chamber.radius * 0.38, floorY + 3.1, chamber.centre[1] + chamber.radius * 0.24);
    light.name = `dungeon-light-${chamber.id}`;
    group.add(light);
    lights.push(light);
  }
  return lights;
}

// ----------------------------------------------------------------- geometry

function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  return index ? index.count / 3 : geometry.getAttribute("position").count / 3;
}

/**
 * A cell grid over the union of every chamber footprint and every corridor, with the blended floor
 * height and an "how far inside the cavern is this" depth at each corner.
 */
function buildFloorGrid(spec: DungeonSpec): FloorGrid {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const chamber of spec.chambers) {
    const reach = chamber.radius + WALL_THICKNESS + FLOOR_MARGIN_METRES;
    minX = Math.min(minX, chamber.centre[0] - reach);
    maxX = Math.max(maxX, chamber.centre[0] + reach);
    minZ = Math.min(minZ, chamber.centre[1] - reach);
    maxZ = Math.max(maxZ, chamber.centre[1] + reach);
  }
  for (const corridor of spec.corridors) {
    const reach = corridor.width / 2 + FLOOR_MARGIN_METRES;
    minX = Math.min(minX, corridor.from[0] - reach, corridor.to[0] - reach);
    maxX = Math.max(maxX, corridor.from[0] + reach, corridor.to[0] + reach);
    minZ = Math.min(minZ, corridor.from[1] - reach, corridor.to[1] - reach);
    maxZ = Math.max(maxZ, corridor.from[1] + reach, corridor.to[1] + reach);
  }
  if (!Number.isFinite(minX)) {
    minX = 0; maxX = 0; minZ = 0; maxZ = 0;
  }

  const columns = Math.max(1, Math.ceil((maxX - minX) / FLOOR_CELL_METRES));
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / FLOOR_CELL_METRES));
  const height = new Float32Array((columns + 1) * (rows + 1));
  const depth = new Float32Array((columns + 1) * (rows + 1));
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const x = minX + column * FLOOR_CELL_METRES;
      const z = minZ + row * FLOOR_CELL_METRES;
      const corner = row * (columns + 1) + column;
      height[corner] = dungeonFloorHeight(spec, x, z);
      depth[corner] = cavernDepth(spec, x, z);
    }
  }

  const filled = new Uint8Array(columns * rows);
  let cells = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = minX + (column + 0.5) * FLOOR_CELL_METRES;
      const z = minZ + (row + 0.5) * FLOOR_CELL_METRES;
      if (cavernDepth(spec, x, z) < -FLOOR_MARGIN_METRES) continue;
      filled[row * columns + column] = 1;
      cells += 1;
    }
  }

  return { minX, minZ, cells, columns, rows, height, depth, filled };
}

/** Extend only the rock dressing grid, aligned with every original floor corner. */
function expandedShellGrid(spec: DungeonSpec, original: FloorGrid): FloorGrid {
  const padding = 4;
  const minX = original.minX - padding * FLOOR_CELL_METRES;
  const minZ = original.minZ - padding * FLOOR_CELL_METRES;
  const columns = original.columns + padding * 2, rows = original.rows + padding * 2;
  const height = new Float32Array((columns + 1) * (rows + 1));
  const depth = new Float32Array(height.length), filled = new Uint8Array(columns * rows);
  let cells = 0;
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
    const x = minX + column * FLOOR_CELL_METRES, z = minZ + row * FLOOR_CELL_METRES;
    const corner = row * (columns + 1) + column;
    height[corner] = dungeonFloorHeight(spec, x, z);
    depth[corner] = cavernDepth(spec, x, z);
    if (column === columns || row === rows) continue;
    if (cavernDepth(spec, x + FLOOR_CELL_METRES / 2, z + FLOOR_CELL_METRES / 2) < -5) continue;
    filled[row * columns + column] = 1; cells++;
  }
  return { minX, minZ, columns, rows, cells, height, depth, filled };
}

/**
 * Metres from a point to the outside of the cavern. Positive inside the wall line, negative past it.
 *
 * Corridors count as inside so that a spec whose chambers do NOT overlap still gets a floor between
 * them. In the authored Gravelmaw every corridor lies entirely inside the union of the chamber
 * discs (they overlap by 4.8 m and 6.7 m), so this term contributes nothing there.
 */
function cavernDepth(spec: DungeonSpec, x: number, z: number): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const chamber of spec.chambers) {
    const outer = chamber.radius + WALL_THICKNESS;
    best = Math.max(best, outer - Math.hypot(x - chamber.centre[0], z - chamber.centre[1]));
  }
  for (const corridor of spec.corridors) {
    const distance = distanceToSegment(x, z, corridor.from[0], corridor.from[1], corridor.to[0], corridor.to[1]);
    best = Math.max(best, corridor.width / 2 - distance);
  }
  return best;
}

function distanceToSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 0) return Math.hypot(x - ax, z - az);
  let t = ((x - ax) * dx + (z - az) * dz) / lengthSquared;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

/**
 * The floor, or the ceiling when `flip` is set.
 *
 * Corner positions are shared between cells so `computeVertexNormals` gives the floor a smooth
 * surface across the ramps; only the cells inside the cavern are indexed, so the corners outside it
 * cost 32 bytes each and nothing else.
 */
function buildFloorGeometry(
  grid: FloorGrid,
  baseColour: number,
  flip: boolean,
  lift = 0,
  options?: DungeonOptions,
): THREE.BufferGeometry {
  const cornerColumns = grid.columns + 1;
  const cornerCount = cornerColumns * (grid.rows + 1);
  const positions = new Float32Array(cornerCount * 3);
  const colours = new Float32Array(cornerCount * 3);
  const uvs = new Float32Array(cornerCount * 2);
  const tint = new THREE.Color().setHex(baseColour, THREE.SRGBColorSpace);

  for (let row = 0; row <= grid.rows; row += 1) {
    for (let column = 0; column < cornerColumns; column += 1) {
      const corner = row * cornerColumns + column;
      const x = grid.minX + column * FLOOR_CELL_METRES;
      const z = grid.minZ + row * FLOOR_CELL_METRES;
      const base = grid.height[corner] ?? 0;
      const limit = options?.ceilingAt?.(x, z) ?? Number.POSITIVE_INFINITY;
      const y = lift === 0 ? base : roofCornerHeight(base, x, z, lift, limit, !!(options?.rockSource || options?.rockEnvelope));
      positions[corner * 3] = x;
      positions[corner * 3 + 1] = y;
      positions[corner * 3 + 2] = z;
      // World-metre projection keeps the continuous floor and its roof at one material scale,
      // including corridor slopes, without splitting vertices or changing their shared normals.
      uvs[corner * 2] = x;
      uvs[corner * 2 + 1] = z;
      // Contact darkening. Nothing in this game had any: props, rocks and walls all met the ground
      // at a hard cut with no occlusion term, which is the single biggest reason everything read as
      // floating. Ramping over the last 3.5 m before the wall costs one multiply per vertex.
      const contactShade = 0.5 + 0.5 * clamp01((grid.depth[corner] ?? 0) / 3.0);
      const shade = flip ? contactShade * (0.72 + 0.25 * fractureField(x / 3.1, z / 3.1, 0x78da)) : contactShade;
      colours[corner * 3] = tint.r * shade;
      colours[corner * 3 + 1] = tint.g * shade;
      colours[corner * 3 + 2] = tint.b * shade;
    }
  }

  const indices: number[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      if (grid.filled[row * grid.columns + column] !== 1) continue;
      const a = row * cornerColumns + column;
      const b = (row + 1) * cornerColumns + column;
      const c = row * cornerColumns + column + 1;
      const d = (row + 1) * cornerColumns + column + 1;
      // (a, b, c) and (b, d, c) wind so the normal is +Y; reversed, it is -Y for the ceiling.
      if (flip) indices.push(a, c, b, b, c, d);
      else indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

type BoundaryPoint = [number, number];
interface BoundaryEdge { a: BoundaryPoint; b: BoundaryPoint; polygon: number }

/** Split the actual outlines at intersections, then retain only the boundary of their union. */
function cavernBoundary(spec: DungeonSpec): BoundaryPoint[][] {
  const polygons: BoundaryPoint[][] = spec.chambers.map(chamber => {
    const jitter = wallJitter(chamber);
    return Array.from({ length: WALL_SEGMENTS }, (_, index): BoundaryPoint => {
      const angle = index / WALL_SEGMENTS * Math.PI * 2;
      const radius = (chamber.radius + WALL_THICKNESS) * jitter(index) + chamberBayDepth(chamber, angle);
      return [chamber.centre[0] + Math.cos(angle) * radius, chamber.centre[1] + Math.sin(angle) * radius];
    });
  });
  for (const corridor of spec.corridors) {
    const bearing = Math.atan2(corridor.to[1] - corridor.from[1], corridor.to[0] - corridor.from[0]);
    // A half-metre wall margin fits inside the unchanged floor grid, even across diagonal cells.
    const radius = corridor.width / 2 + 0.5;
    const polygon: BoundaryPoint[] = [];
    if (Math.hypot(corridor.to[0] - corridor.from[0], corridor.to[1] - corridor.from[1]) < 1e-6) {
      for (let index = 0; index < 24; index++) {
        const angle = index / 24 * Math.PI * 2;
        polygon.push([corridor.from[0] + Math.cos(angle) * radius, corridor.from[1] + Math.sin(angle) * radius]);
      }
      polygons.push(polygon);
      continue;
    }
    for (const [centre, start] of [[corridor.to, bearing - Math.PI / 2], [corridor.from, bearing + Math.PI / 2]] as const) {
      for (let index = 0; index <= 12; index++) {
        const angle = start + index / 12 * Math.PI;
        polygon.push([centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius]);
      }
    }
    polygons.push(polygon);
  }
  const edges: BoundaryEdge[] = polygons.flatMap((polygon, owner) => polygon.map((a, index) => ({
    a, b: polygon[(index + 1) % polygon.length]!, polygon: owner,
  })));
  const cross = (ax: number, az: number, bx: number, bz: number): number => ax * bz - az * bx;
  const pointKey = (point: BoundaryPoint): string => `${Math.round(point[0] * 1e6)},${Math.round(point[1] * 1e6)}`;
  const canonical = new Map<string, BoundaryPoint>();
  const vertex = (px: number, pz: number): BoundaryPoint => {
    const point: BoundaryPoint = [Math.round(px * 1e6) / 1e6, Math.round(pz * 1e6) / 1e6];
    const key = pointKey(point);
    // Intersections computed from opposite edges can straddle a rounding boundary. Weld across
    // neighbouring buckets too, rather than assigning two nodes to the same physical junction.
    for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
      const existing = canonical.get(`${Math.round(px * 1e6) + ix},${Math.round(pz * 1e6) + iz}`);
      if (existing && Math.hypot(existing[0] - point[0], existing[1] - point[1]) < 1.5e-6) return existing;
    }
    canonical.set(key, point);
    return point;
  };
  const boundary = new Map<string, BoundaryEdge>();
  for (const edge of edges) {
    const dx = edge.b[0] - edge.a[0], dz = edge.b[1] - edge.a[1];
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared < 1e-12) continue;
    const cuts = [0, 1];
    for (const other of edges) {
      if (other.polygon === edge.polygon) continue;
      const ox = other.b[0] - other.a[0], oz = other.b[1] - other.a[1];
      const ax = other.a[0] - edge.a[0], az = other.a[1] - edge.a[1];
      const denominator = cross(dx, dz, ox, oz);
      if (Math.abs(denominator) > 1e-9) {
        const t = cross(ax, az, ox, oz) / denominator;
        const u = cross(ax, az, dx, dz) / denominator;
        if (t >= -1e-8 && t <= 1 + 1e-8 && u >= -1e-8 && u <= 1 + 1e-8) cuts.push(clamp01(t));
      } else if (Math.abs(cross(ax, az, dx, dz)) < 1e-7) {
        // Collinear overlaps must split too, including same-direction duplicate outer edges.
        for (const point of [other.a, other.b]) {
          const t = ((point[0] - edge.a[0]) * dx + (point[1] - edge.a[1]) * dz) / lengthSquared;
          if (t > 0 && t < 1) cuts.push(t);
        }
      }
    }
    cuts.sort((a, b) => a - b);
    for (let index = 1; index < cuts.length; index++) {
      const from = cuts[index - 1]!, to = cuts[index]!;
      if (to - from < 1e-8) continue;
      const middle: BoundaryPoint = [edge.a[0] + dx * (from + to) / 2, edge.a[1] + dz * (from + to) / 2];
      let interior = false;
      for (let owner = 0; owner < polygons.length && !interior; owner++) {
        if (owner === edge.polygon) continue;
        const polygon = polygons[owner]!;
        const classification = classifyBoundaryPoint(middle, polygon);
        if (classification === 1) { interior = true; break; }
        if (classification !== 0) continue;
        for (let side = 0; side < polygon.length; side++) {
          const a = polygon[side]!, b = polygon[(side + 1) % polygon.length]!;
          if (!onBoundarySegment(middle, a, b)) continue;
          if (dx * (b[0] - a[0]) + dz * (b[1] - a[1]) < 0 || owner < edge.polygon) interior = true;
        }
      }
      if (interior) continue;
      const a = vertex(edge.a[0] + dx * from, edge.a[1] + dz * from);
      const b = vertex(edge.a[0] + dx * to, edge.a[1] + dz * to);
      const ak = pointKey(a), bk = pointKey(b);
      if (ak === bk) continue;
      const reverse = `${bk}|${ak}`;
      if (boundary.has(reverse)) boundary.delete(reverse);
      else boundary.set(`${ak}|${bk}`, { a, b, polygon: edge.polygon });
    }
  }
  const outgoing = new Map<BoundaryPoint, BoundaryEdge[]>();
  for (const edge of boundary.values()) {
    const bucket = outgoing.get(edge.a) ?? [];
    bucket.push(edge);
    outgoing.set(edge.a, bucket);
  }
  const remaining = new Set(boundary.values());
  const loops: BoundaryPoint[][] = [];
  while (remaining.size) {
    const first = remaining.values().next().value!;
    let current = first;
    const loop: BoundaryPoint[] = [];
    do {
      loop.push(current.a);
      remaining.delete(current);
      if (current.b === first.a) break;
      const candidates = (outgoing.get(current.b) ?? []).filter(edge => remaining.has(edge));
      if (!candidates.length) throw new Error(`Open cavern perimeter at ${pointKey(current.b)}`);
      // At a tangent junction follow the planar face, rather than joining two loops arbitrarily.
      const reverse = Math.atan2(current.a[1] - current.b[1], current.a[0] - current.b[0]);
      const clockwise = (edge: BoundaryEdge): number => {
        const angle = Math.atan2(edge.b[1] - edge.a[1], edge.b[0] - edge.a[0]);
        return ((reverse - angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      };
      candidates.sort((a, b) => clockwise(a) - clockwise(b));
      current = candidates[0]!;
    } while (loop.length <= boundary.size);
    if (loop.length < 3) continue;
    const sampled: BoundaryPoint[] = [];
    for (let index = 0; index < loop.length; index++) {
      const a = loop[index]!, b = loop[(index + 1) % loop.length]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.65));
      for (let step = 0; step < steps; step++) sampled.push([
        a[0] + (b[0] - a[0]) * step / steps, a[1] + (b[1] - a[1]) * step / steps,
      ]);
    }
    loops.push(sampled);
  }
  return loops;
}

function onBoundarySegment(point: BoundaryPoint, a: BoundaryPoint, b: BoundaryPoint): boolean {
  // The exact test admits 1e-6 both along and across the segment. Its axis-aligned envelope
  // fits inside this 2e-6 padding, so distant roof vertices can skip the square root and divides.
  if (point[0] < Math.min(a[0], b[0]) - 2e-6 || point[0] > Math.max(a[0], b[0]) + 2e-6
    || point[1] < Math.min(a[1], b[1]) - 2e-6 || point[1] > Math.max(a[1], b[1]) + 2e-6) return false;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  if (length < 1e-8) return false;
  const px = point[0] - a[0], pz = point[1] - a[1];
  const along = (px * dx + pz * dz) / length;
  return Math.abs(px * dz - pz * dx) / length < 1e-6 && along >= -1e-6 && along <= length + 1e-6;
}

/** -1 outside, 0 boundary, 1 strictly inside. Boundary ownership is resolved by edge direction. */
function classifyBoundaryPoint(point: BoundaryPoint, polygon: BoundaryPoint[]): -1 | 0 | 1 {
  let inside = false;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]!, b = polygon[(index + 1) % polygon.length]!;
    if (onBoundarySegment(point, a, b)) return 0;
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? 1 : -1;
}

/** Connected rock courses follow the complete chamber/corridor union, including its joins. */
function buildWallGeometry(spec: DungeonSpec, grid: FloorGrid, baseColour: number, options?: DungeonOptions): THREE.BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  const uvs: number[] = [];
  const tint = new THREE.Color().setHex(baseColour, THREE.SRGBColorSpace);
  const groundTint = new THREE.Color().setHex(
    (REGION_PALETTES[spec.regionId] ?? REGION_PALETTES.gravelmaw).groundLow, THREE.SRGBColorSpace);

  // Even sampling follows oblique, continuous rock relief. Narrow horizontal bevel courses
  // made complete dark rings around every chamber, regardless of their surface texture.
  const profile = Array.from({ length: 15 }, (_, level) => [level / 14] as const);
  for (const loop of cavernBoundary(spec)) {
    // Every shared endpoint owns one complete vertical profile. No chamber-local radius or lean
    // is evaluated on either side of a join, so course seams have exactly matching positions.
    const columns = loop.map((point, index) => {
      const previous = loop[(index + loop.length - 1) % loop.length]!;
      const next = loop[(index + 1) % loop.length]!;
      const before = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
      const after = Math.hypot(next[0] - point[0], next[1] - point[1]);
      let nx = -(point[1] - previous[1]) / before - (next[1] - point[1]) / after;
      let nz = (point[0] - previous[0]) / before + (next[0] - point[0]) / after;
      const length = Math.hypot(nx, nz);
      nx /= length; nz /= length;
      const turn = Math.atan2(
        (point[0] - previous[0]) * (next[1] - point[1]) - (point[1] - previous[1]) * (next[0] - point[0]),
        (point[0] - previous[0]) * (next[0] - point[0]) + (point[1] - previous[1]) * (next[1] - point[1]));
      const shoulderInsetLimit = turn > 0.01 ? Math.min(before, after) * 0.65 / Math.tan(turn / 2) : Infinity;
      const base = sampleGridHeight(grid, point[0], point[1]) - WALL_OVERLAP;
      const standingInset = standingRockMargin(spec, point[0], point[1]);
      const shoulderRise = 4.1 + Math.sin(point[0] * 0.27 + point[1] * 0.19) * 0.55;
      const column = profile.map(([fraction], level): [number, number, number] => {
        const body = Math.sin(Math.PI * fraction);
        const crown = clamp01((fraction - 0.48) / 0.52);
        const nominalY = base + spec.wallHeight * fraction;
        const buttress = fractureField(point[0] / 4.1 - nominalY * 0.11,
          point[1] / 3.4 + nominalY * 0.09, 0x9247);
        // Upper rock rolls into the roof; local bulges run diagonally through several rows.
        // The bottom 3.4 metres preserve the walking envelope. Above it, metre-scale oblique
        // buttresses break the circular silhouette without lowering the roof clearance.
        const availableHeight = sampleGridHeight(grid, point[0], point[1], spec.wallHeight, options) + WALL_OVERLAP - base;
        const shoulderT = clamp01((availableHeight * fraction - shoulderRise) / 2.4);
        const reliefWeight = shoulderT * shoulderT * (3 - 2 * shoulderT);
        // Two slanting fracture families cut deep pockets between solid shoulders. Unlike
        // independent vertex noise, a fracture keeps its bearing from the footing to the vault.
        // Lower faces recede into the rock and keep the entire standing envelope untouched.
        const bedding = rockFault(point[0] * 0.71 + point[1] * 0.39 - nominalY * 0.65, 4.7);
        const crossJoint = rockFault(point[0] * -0.33 + point[1] * 0.86 + nominalY * 0.36, 5.3);
        const mass = clamp01(bedding * 0.78 + crossJoint * 0.48 - 0.12);
        // Each foot uses only the spare wall margin beyond the authored walking footprint.
        // The same inclined mass continues through the middle face into the upper vault.
        const offset = options?.rockSource || options?.rockEnvelope ? 0 : Math.min(shoulderInsetLimit, standingInset * (0.12 + mass * 0.78) + reliefWeight * (1.15 * crown
          + body * (0.55 + mass * 0.55 + (buttress - 0.5) * 0.15)));
        const px = point[0] + nx * offset, pz = point[1] + nz * offset;
        const roof = sampleGridHeight(grid, px, pz, spec.wallHeight, options) + WALL_OVERLAP;
        const warp = body * (fractureField(point[0] / 3.7, point[1] / 3.7, 0x872d) - 0.5) * 0.7;
        return [px, base + (roof - base) * fraction + warp, pz];
      });
      for (let level = 1; level < column.length; level++) {
        column[level]![1] = Math.max(column[level]![1], column[level - 1]![1] + 0.035);
      }
      return column;
    });
    // Limit neighbouring face displacement before triangulation. The bound follows actual edge
    // length, so a short union-intersection segment cannot grow into a stretched triangular fin.
    for (let pass = 0; pass < 5; pass++) {
      for (let index = 0; index < loop.length; index++) {
        const next = (index + 1) % loop.length;
        const edge = Math.hypot(loop[next]![0] - loop[index]![0], loop[next]![1] - loop[index]![1]);
        for (let level = 0; level < profile.length; level++) {
          const a = columns[index]![level]!, b = columns[next]![level]!;
          const da = Math.hypot(a[0] - loop[index]![0], a[2] - loop[index]![1]);
          const db = Math.hypot(b[0] - loop[next]![0], b[2] - loop[next]![1]);
          const limit = edge * 0.45;
          if (Math.abs(da - db) <= limit) continue;
          const chosen = da > db ? index : next;
          const point = columns[chosen]![level]!, boundary = loop[chosen]!;
          const old = Math.max(da, db), replacement = Math.min(da, db) + limit;
          point[0] = boundary[0] + (point[0] - boundary[0]) * replacement / old;
          point[2] = boundary[1] + (point[2] - boundary[1]) * replacement / old;
        }
      }
    }
    // The buried top edge is evaluated after contour limiting to preserve its roof overlap.
    for (const column of columns) {
      const bottom = column[0]!;
      bottom[1] = sampleGridHeight(grid, bottom[0], bottom[2]) - WALL_OVERLAP;
      for (let level = 1; level < column.length; level++) {
        const point = column[level]!, fraction = profile[level]![0];
        const roof = sampleGridHeight(grid, point[0], point[2], spec.wallHeight, options) + WALL_OVERLAP;
        point[1] = Math.max(column[level - 1]![1] + 0.035, bottom[1] + (roof - bottom[1]) * fraction);
      }
    }
    let uOrigin = 0;
    for (let index = 0; index < loop.length; index++) {
      const next = (index + 1) % loop.length;
      for (let level = 0; level < profile.length - 1; level++) {
        const b0 = columns[index]![level]!, b1 = columns[next]![level]!;
        const t0 = columns[index]![level + 1]!, t1 = columns[next]![level + 1]!;
        pushTriangle(positions, b0, b1, t0);
        pushTriangle(positions, b1, t1, t0);
        const uNext = uOrigin + Math.hypot(loop[next]![0] - loop[index]![0], loop[next]![1] - loop[index]![1]);
        // Shared profile endpoints have identical UVs across courses and panels.
        // Absolute height prevents the stone phase from restarting at every bevel.
        uvs.push(uOrigin, b0[1], uNext, b1[1], uOrigin, t0[1],
          uNext, b1[1], uNext, t1[1], uOrigin, t0[1]);
        const shade = (point: readonly number[], fraction: number): number =>
          (1 - fraction * 0.30) * (0.91 + 0.13 * fractureField(
            point[0]! / 3.2 + point[1]! * 0.17, point[2]! / 3.2 - point[1]! * 0.11, 0x47fa));
        const low0 = shade(b0, profile[level]![0]), low1 = shade(b1, profile[level]![0]);
        const high0 = shade(t0, profile[level + 1]![0]), high1 = shade(t1, profile[level + 1]![0]);
        const wallColour = (point: readonly number[], shade: number): void => {
          const rise = point[1]! - dungeonFloorHeight(spec, point[0]!, point[2]!);
          const blend = clamp01(rise / 1.3);
          const contact = 0.5 + 0.5 * blend;
          colours.push((groundTint.r * (1 - blend) + tint.r * blend) * shade * contact,
            (groundTint.g * (1 - blend) + tint.g * blend) * shade * contact,
            (groundTint.b * (1 - blend) + tint.b * blend) * shade * contact);
        };
        wallColour(b0, low0); wallColour(b1, low1); wallColour(t0, high0);
        wallColour(b1, low1); wallColour(t1, high1); wallColour(t0, high0);
      }
      uOrigin += Math.hypot(loop[next]![0] - loop[index]![0], loop[next]![1] - loop[index]![1]);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colours), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  const creased = toCreasedNormals(geometry, 0.95);
  geometry.dispose();
  creased.computeBoundingSphere();
  return creased;
}

/** Intersecting roof fractures lower the nominal ceiling by at most 1.38 metres. */
function roofCornerHeight(base: number, x: number, z: number, lift: number, limit: number, sourceFacing = false): number {
  const nominal = Math.max(base + MIN_HEADROOM, Math.min(base + lift, limit));
  if (sourceFacing) return nominal;
  const fault = rockFault(x * 0.71 + z * 0.39 - nominal * 0.65, 4.7);
  const joint = rockFault(x * -0.33 + z * 0.86 + nominal * 0.36, 5.3);
  const relief = 0.04 + 1.34 * clamp01(fault * 0.78 + joint * 0.48 - 0.12);
  // The compact 8 m fixture keeps at least 7 m clearance; taller rooms use full relief.
  const budget = Math.max(0, Math.min(1, (lift - 7) / 1.4));
  return Math.max(base + MIN_HEADROOM, nominal - relief * budget);
}

/** Broad tilted beds terminate in a narrow recessed fracture; no horizontal ring courses. */
function rockFault(distance: number, spacing: number): number {
  const coordinate = distance / spacing + Math.sin(distance * 0.19) * 0.16;
  const phase = ((coordinate % 1) + 1) % 1;
  const ridge = 1 - Math.abs(phase - 0.5) * 2;
  // Long faces end in a bevel with a finite width. No single vertex is a pointed peak.
  const bevel = clamp01((ridge - 0.08) / 0.84);
  return bevel * bevel * (3 - 2 * bevel);
}

/** Rock may occupy the unused margin, never the authored playable chamber or corridor. */
function standingRockMargin(spec: DungeonSpec, x: number, z: number): number {
  const chamberClearance = Math.min(...spec.chambers.map(chamber =>
    Math.hypot(x - chamber.centre[0], z - chamber.centre[1]) - chamber.radius));
  const corridorClearance = Math.min(Infinity, ...spec.corridors.map(corridor =>
    distanceToSegment(x, z, ...corridor.from, ...corridor.to) - corridor.width / 2));
  return Math.max(0, Math.min(1.4, chamberClearance - 0.22, corridorClearance - 0.22));
}

/** Four unequal erosion bays define the chamber footprint before any vertical relief is added. */
function chamberBayDepth(chamber: ChamberSpec, angle: number): number {
  const orientation = Math.sin(chamber.centre[0] * 0.173 + chamber.centre[1] * 0.097) * 2;
  const bays = [[0.08, 0.62, 2.9], [1.66, 0.49, 1.8], [3.05, 0.75, 3.15], [4.82, 0.65, 2.35]];
  let depth = 0.2;
  for (const [bearing, width, reach] of bays) {
    const distance = Math.abs(Math.atan2(Math.sin(angle - orientation - bearing!), Math.cos(angle - orientation - bearing!)));
    const flank = clamp01((1 - distance / width!) / 0.72);
    const shoulder = flank * flank * (3 - 2 * flank);
    depth = Math.max(depth, reach! * shoulder);
  }
  return depth;
}

function boundaryNormal(previous: BoundaryPoint, point: BoundaryPoint, next: BoundaryPoint): BoundaryPoint {
  const before = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
  const after = Math.hypot(next[0] - point[0], next[1] - point[1]);
  const nx = -(point[1] - previous[1]) / before - (next[1] - point[1]) / after;
  const nz = (point[0] - previous[0]) / before + (next[0] - point[0]) / after;
  const length = Math.hypot(nx, nz);
  return [nx / length, nz / length];
}

/** Piecewise planar fracture field, fixed to world metres and independent of gameplay RNG. */
function fractureField(x: number, z: number, salt: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const u = x - ix, v = z - iz;
  const value = (px: number, pz: number): number => {
    let bits = (Math.imul(px, 73856093) ^ Math.imul(pz, 19349663) ^ salt) >>> 0;
    bits = Math.imul(bits ^ (bits >>> 16), 0x45d9f3b);
    return ((bits ^ (bits >>> 16)) >>> 0) / 0xffffffff;
  };
  const a = value(ix, iz), b = value(ix + 1, iz), c = value(ix, iz + 1), d = value(ix + 1, iz + 1);
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v
    : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

/** Sample the actual grid triangles, including Float32 roof heights, for buried shell joints. */
function sampleGridHeight(grid: FloorGrid, x: number, z: number, lift = 0, options?: DungeonOptions): number {
  const gx = Math.max(0, Math.min(grid.columns, (x - grid.minX) / FLOOR_CELL_METRES));
  const gz = Math.max(0, Math.min(grid.rows, (z - grid.minZ) / FLOOR_CELL_METRES));
  const column = Math.min(grid.columns - 1, Math.floor(gx));
  const row = Math.min(grid.rows - 1, Math.floor(gz));
  const u = gx - column, v = gz - row;
  const height = (cx: number, cz: number): number => {
    const base = grid.height[cz * (grid.columns + 1) + cx] ?? 0;
    if (lift === 0) return base;
    const px = grid.minX + cx * FLOOR_CELL_METRES, pz = grid.minZ + cz * FLOOR_CELL_METRES;
    return Math.fround(roofCornerHeight(base, px, pz, lift, options?.ceilingAt?.(px, pz) ?? Infinity, !!(options?.rockSource || options?.rockEnvelope)));
  };
  const a = height(column, row), b = height(column + 1, row);
  const c = height(column, row + 1), d = height(column + 1, row + 1);
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v
    : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

function pushTriangle(
  out: number[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
): void {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

/**
 * Per-angle radius scale, inward only.
 *
 * Inward only on purpose: a wall pushed outward would leave a gap between it and the floor grid's
 * edge, and the void would show through. The 0.95 floor keeps the wall clear of `chamber.radius`
 * (11 m against a jittered minimum of 11.59 m at the Gravelmaw), so nothing shrinks the play area.
 *
 * Seeded from the chamber's own coordinates rather than from a shared stream, so this consumes no
 * draws from any `RngStreams` stream and cannot shift a gather roll or a scatter layout by existing.
 */
function wallJitter(chamber: ChamberSpec): (index: number) => number {
  const values = sampleRing(chamber, 0x9e37, 0.95, 1.0);
  return (index: number) => {
    const start = Math.floor(index / 8) * 8;
    const t = index % 8 / 8;
    return values[start]! * (1 - t) + values[(start + 8) % WALL_SEGMENTS]! * t;
  };
}

function sampleRing(chamber: ChamberSpec, salt: number, low: number, high: number): number[] {
  const seed = (Math.imul(Math.round(chamber.centre[0] * 16), 73856093)
    ^ Math.imul(Math.round(chamber.centre[1] * 16), 19349663)
    ^ salt) >>> 0;
  const rng = new Rng(seed);
  const values: number[] = [];
  for (let index = 0; index < WALL_SEGMENTS; index += 1) values.push(rng.float(low, high));
  return values;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
