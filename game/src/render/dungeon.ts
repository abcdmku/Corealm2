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
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
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
    color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true,
    // Camera collision can briefly place the eye outside the shell. Keep both sides opaque;
    // triangle winding still identifies the floor and inward blockers for navigation.
    envMapIntensity: INTERIOR_ENV_INTENSITY, side: THREE.DoubleSide,
  });
  rockMaterial.name = "dungeon-rock";

  const grid = buildFloorGrid(spec);

  const floorGeometry = buildFloorGeometry(grid, palette.groundLow, false);
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.name = "dungeon-floor";
  floor.receiveShadow = true;
  group.add(floor);
  walkable.push(floor);
  triangles += triangleCount(floorGeometry);

  const roofGrid = buildFloorGeometry(grid, palette.rock, true, spec.wallHeight, options);
  const ceilingGeometry = toCreasedNormals(roofGrid, 0.38);
  roofGrid.dispose();
  const ceiling = new THREE.Mesh(ceilingGeometry, rockMaterial);
  ceiling.name = "dungeon-ceiling";
  group.add(ceiling);
  blockers.push(ceiling);
  triangles += triangleCount(ceilingGeometry);

  const wallGeometry = buildWallGeometry(spec, grid, palette.rock, options);
  const wall = new THREE.Mesh(wallGeometry, rockMaterial);
  wall.name = "dungeon-wall";
  wall.receiveShadow = true;
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
    // The helper clones materials but retains shared maps. Only the unused originals are owned here.
    floorMaterial.dispose();
    rockMaterial.dispose();
  }

  return { group, walkable, blockers, triangles };
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
  const grid = buildFloorGrid(spec);
  for (const [loopIndex, loop] of cavernBoundary(spec).entries()) {
    for (let index = 0; index < loop.length; index++) {
      const a = loop[index]!;
      const b = loop[(index + 1) % loop.length]!;
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const chord = Math.hypot(dx, dz);
      // Shift the volume into the rock. Its inner face covers the shallow lower ledges without
      // consuming the authored chamber radius or corridor width.
      const x = (a[0] + b[0]) / 2 + dz / chord * 0.3;
      const z = (a[1] + b[1]) / 2 - dx / chord * 0.3;
      const base = Math.min(sampleGridHeight(grid, a[0], a[1]), sampleGridHeight(grid, b[0], b[1])) - WALL_OVERLAP;
      const top = Math.max(ceilingHeightAt(spec, a[0], a[1], options), ceilingHeightAt(spec, b[0], b[1], options)) + WALL_OVERLAP;
      volumes.push({
        kind: "box",
        id: `dungeon-wall-${loopIndex}-${index}`,
        position: [x, base, z],
        size: [chord + 0.08, top - base, WALL_THICKNESS],
        rotationY: -Math.atan2(dz, dx),
      });
    }
  }
  for (const chamber of includeCeilings ? spec.chambers : []) {
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
  const ambient = new THREE.HemisphereLight(0x4a4038, 0x1a1614, 0.9);
  ambient.name = "dungeon-ambient";
  group.add(ambient);

  for (const chamber of spec.chambers) {
    // Underground has no sun, so the only light is what the chamber provides. These are much
    // brighter than a surface fill because the scene's directional light contributes nothing here,
    // and a decay of 1.0 rather than 1.6 keeps the chamber edges readable instead of pitch black.
    const light = new THREE.PointLight(
      chamber.lit ? 0xffc07a : 0xd07a45,
      chamber.lit ? 90 : 55,
      chamber.radius * 3.4,
      1.0,
    );
    const floorY = dungeonFloorHeight(spec, chamber.centre[0], chamber.centre[1]);
    light.position.set(chamber.centre[0], floorY + 4.5, chamber.centre[1]);
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
      const y = lift === 0 ? base : roofCornerHeight(base, x, z, lift, limit);
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
      const shade = 0.5 + 0.5 * clamp01((grid.depth[corner] ?? 0) / 3.0);
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
      const radius = (chamber.radius + WALL_THICKNESS) * jitter(index);
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
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.25));
      for (let step = 0; step < steps; step++) sampled.push([
        a[0] + (b[0] - a[0]) * step / steps, a[1] + (b[1] - a[1]) * step / steps,
      ]);
    }
    loops.push(sampled);
  }
  return loops;
}

function onBoundarySegment(point: BoundaryPoint, a: BoundaryPoint, b: BoundaryPoint): boolean {
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

  // Broad courses, narrow fractured shelves, then a corbel into the roof. The authored play
  // boundary stays clear at walking height; stronger overhangs occur only in the upper third.
  const profile = [
    [0, -0.08], [0.13, 0.02], [0.22, -0.02], [0.27, 0.30], [0.31, 0.28],
    [0.34, 0.02], [0.49, -0.06], [0.55, 0.31], [0.59, 0.27], [0.62, 0.06],
    [0.76, 0.24], [0.81, 0.48], [0.89, 0.78], [0.95, 1.12], [1, 1.35],
  ] as const;
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
      const base = sampleGridHeight(grid, point[0], point[1]) - WALL_OVERLAP;
      const column = profile.map(([fraction, inset], level): [number, number, number] => {
        const band = level <= 5 ? 0 : level <= 9 ? 1 : 2;
        const fracture = fractureField(point[0] / 2.9, point[1] / 2.9, 0x51ed + band * 101) - 0.5;
        // Shelves taper back into their parent face instead of circling the room as uniform lips.
        // Each bevel shares its band's height warp, avoiding nearly horizontal dark razor faces.
        const shelfStrength = 0.15 + 0.85 * clamp01((fractureField(point[0] / 3.8, point[1] / 3.8, 0x9247 + band * 117) - 0.22) * 2);
        const offset = (inset > 0 && fraction < 0.7 ? inset * shelfStrength : inset)
          + (level === 0 ? 0 : fracture * 0.18);
        const px = point[0] + nx * offset, pz = point[1] + nz * offset;
        const roof = sampleGridHeight(grid, px, pz, spec.wallHeight, options) + WALL_OVERLAP;
        const warp = level === 0 || level === profile.length - 1 ? 0 : fracture * 0.55;
        return [px, base + (roof - base) * fraction + warp, pz];
      });
      for (let level = 1; level < column.length; level++) {
        column[level]![1] = Math.max(column[level]![1], column[level - 1]![1] + 0.035);
      }
      return column;
    });
    let uOrigin = 0;
    for (let index = 0; index < loop.length; index++) {
      const next = (index + 1) % loop.length;
      for (let level = 0; level < profile.length - 1; level++) {
        const b0 = columns[index]![level]!, b1 = columns[next]![level]!;
        const t0 = columns[index]![level + 1]!, t1 = columns[next]![level + 1]!;
        pushTriangle(positions, b0, b1, t0);
        pushTriangle(positions, b1, t1, t0);
        pushWallQuadUvs(uvs, b0, b1, t0, t1, uOrigin);
        const low = 1 - profile[level]![0] * 0.45;
        const high = 1 - profile[level + 1]![0] * 0.45;
        pushColour(colours, tint, low, low, high);
        pushColour(colours, tint, low, high, high);
      }
      uOrigin += Math.hypot(loop[next]![0] - loop[index]![0], loop[next]![1] - loop[index]![1]);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colours), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Angular roof plates lower the nominal ceiling by at most 1.28 metres without losing headroom. */
function roofCornerHeight(base: number, x: number, z: number, lift: number, limit: number): number {
  const nominal = Math.max(base + MIN_HEADROOM, Math.min(base + lift, limit));
  const relief = 0.16 + 0.78 * fractureField(x / 3.8, z / 3.8, 0x713d)
    + 0.34 * fractureField((x + 1.7) / 1.9, (z - 0.9) / 1.9, 0x9321);
  const budget = Math.max(0, Math.min(1, (lift - 6) / 1.3));
  return Math.max(base + MIN_HEADROOM, nominal - relief * budget);
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
    return Math.fround(roofCornerHeight(base, px, pz, lift, options?.ceilingAt?.(px, pz) ?? Infinity));
  };
  const a = height(column, row), b = height(column + 1, row);
  const c = height(column, row + 1), d = height(column + 1, row + 1);
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v
    : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

/** Unfold each existing wall quad at one UV unit per metre, keeping its diagonal continuous. */
function pushWallQuadUvs(
  out: number[],
  b0: readonly [number, number, number],
  b1: readonly [number, number, number],
  t0: readonly [number, number, number],
  t1: readonly [number, number, number],
  uOrigin: number,
): void {
  const distance = (a: readonly [number, number, number], b: readonly [number, number, number]): number =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const bottom = Math.max(distance(b0, b1), 1e-6);
  const left = distance(b0, t0);
  const diagonal = Math.max(distance(b1, t0), 1e-6);
  const topX = (left * left + bottom * bottom - diagonal * diagonal) / (2 * bottom);
  const topY = Math.sqrt(Math.max(0, left * left - topX * topX));

  // A wall top leans inward and follows the ceiling. Unfold its second triangle around the
  // shared diagonal so this relief does not stretch the grain or reveal a diagonal texture seam.
  const right = distance(b1, t1);
  const top = distance(t0, t1);
  const along = (right * right + diagonal * diagonal - top * top) / (2 * diagonal);
  const across = Math.sqrt(Math.max(0, right * right - along * along));
  const dx = (topX - bottom) / diagonal;
  const dy = topY / diagonal;
  const rightX = bottom + along * dx + across * dy;
  const rightY = along * dy - across * dx;
  // The arc and absolute floor height provide a stable phase instead of restarting each panel.
  const vOrigin = b0[1];
  out.push(
    uOrigin, vOrigin,
    uOrigin + bottom, vOrigin,
    uOrigin + topX, vOrigin + topY,
    uOrigin + bottom, vOrigin,
    uOrigin + rightX, vOrigin + rightY,
    uOrigin + topX, vOrigin + topY,
  );
}

function pushTriangle(
  out: number[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
): void {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

function pushColour(out: number[], tint: THREE.Color, s0: number, s1: number, s2: number): void {
  for (const shade of [s0, s1, s2]) out.push(tint.r * shade, tint.g * shade, tint.b * shade);
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
  return (index: number) => values[index % WALL_SEGMENTS] ?? 1;
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
