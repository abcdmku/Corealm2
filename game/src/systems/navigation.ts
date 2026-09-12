/**
 * Navigation: the navmesh, path queries, and the route graph that sits above it.
 *
 * The navmesh handles ordinary walking only. Agility shortcuts are NOT Detour off-mesh links —
 * they are route-graph edges (runs/corealm/architecture.md, correction R2), because
 * `threeToSoloNavMesh` gives no supported way to author off-mesh connections and a pillar of the
 * design should not rest on a library detail.
 *
 * Round 1 measured the generator question rather than guessing it. Against the real 700 x 400 m
 * three-region terrain (140k triangles, 39 m of terraced verticality in Karrowmoor):
 *
 *   solo   cs 0.30   4579 ms   1066 polys           connected, bank -> Upper Karrow 428.5 m
 *   tiled  cs 0.30   3150 ms   1361 polys 209 tiles connected, 427.2 m
 *   solo   cs 0.45   1308 ms   2213 polys           connected, 430.3 m
 *   tiled  cs 0.45   1337 ms   2485 polys  91 tiles connected, 429.5 m
 *   solo   cs 0.60    739 ms   2870 polys           connected but 556.7 m — routes lost
 *
 * So: **a solo navmesh does cope with Karrowmoor.** All four terraces stay on one connected mesh
 * and the Coldbrace-to-Upper-Karrow path lands inside the PRD's 380-460 m acceptance window. Tiled
 * buys nothing here and adds tile-boundary vertices to every path, so solo stays the default and
 * tiled is the automatic fallback if solo ever fails.
 *
 * Cell size is the real lever: at the root's authored cs of 0.3 the build costs 4.6 s, which does
 * not fit a 6 s cold boot. Worlds wider than 320 m therefore generate at cs 0.45, which is 3.5x
 * faster and produces paths within 0.5% of the fine build. cs 0.60 is too coarse — it drops
 * walkable ground on the terrace risers and inflates the cross-world route by 30%.
 */
import * as THREE from "three";
import type { NavMesh, NavMeshQuery } from "@recast-navigation/core";
import type { EntityId, RegionId, SolidVolume, Vec3 } from "../contracts.js";
import { NAV_CONFIG, PLAYER_SPEED } from "../app/config.js";
import { distance, distanceXZ, pathLength } from "../core/math.js";
import { NAVMESH_AUTHORING_INPUTS } from "../generated/navmeshFingerprint.js";
import {
  decodeNavigationArtifact,
  encodeNavigationArtifact,
  fingerprintNavigationGeometry,
  fingerprintNavigationInputs,
  navigationMeshPositions,
  type NavigationArtifactSettings,
  type NavigationAuthoredInputs,
} from "./navigationArtifact.js";

type RecastCoreModule = typeof import("@recast-navigation/core");
type RecastGeneratorsModule = typeof import("@recast-navigation/generators");
type RecastCoreRuntime = Pick<RecastCoreModule, "init" | "NavMeshQuery" | "importNavMesh" | "exportNavMesh">;
type RecastGeneratorsRuntime = Pick<RecastGeneratorsModule, "generateSoloNavMesh" | "generateTiledNavMesh" | "mergePositionsAndIndices">;

let recastRuntime: { core: RecastCoreRuntime; generators: RecastGeneratorsRuntime } | null = null;
let recastInitialization: Promise<void> | null = null;

function requireRecast(): { core: RecastCoreRuntime; generators: RecastGeneratorsRuntime } {
  if (!recastRuntime) throw new Error("Recast is not initialized. Await Navigation.initLibrary() first.");
  return recastRuntime;
}

/** Convert production mesh triangles without importing Recast's unused Three debug renderers. */
function navigationGeometry(meshes: readonly THREE.Mesh[]): [Float32Array, Uint32Array] {
  const inputs: Parameters<RecastGeneratorsRuntime["mergePositionsAndIndices"]>[0] = [];
  for (const mesh of meshes) {
    const positions = navigationMeshPositions(mesh);
    if (!positions) continue;
    const indices = mesh.geometry.getIndex()?.array
      ?? Uint32Array.from({ length: positions.length / 3 }, (_, index) => index);
    inputs.push({ positions, indices });
  }
  // Keep the generator package's vertex welding and triangle order. Cached navmesh artifacts and
  // runtime regeneration must see the same triangles for indexed and non-indexed source meshes.
  return requireRecast().generators.mergePositionsAndIndices(inputs);
}

export type NavStatus = "uninitialized" | "building" | "ready" | "failed";

export type NavStrategy = "auto" | "solo" | "tiled";

/** Tile edge in voxels. 128 voxels at cs 0.3 is a 38 m tile: ~200 tiles over the round-1 world. */
const TILE_SIZE_VOXELS = 128;

/** Above this world extent in metres, generation drops to the coarser cell size. */
const LARGE_WORLD_EXTENT = 320;

/** Cell size used for large worlds. Measured: 3.5x faster than 0.3 with equivalent paths. */
const LARGE_WORLD_CELL_SIZE = 0.45;

/**
 * Search box for snapping a world point onto the mesh.
 *
 * Deliberately tall. Callers routinely ask about a point whose y they do not know — the world
 * builder places an entity at ground level by asking for the ground, the route graph is authored in
 * plan view — and Karrowmoor climbs 39 m, so a 1 m default box silently fails on three of the four
 * terraces. Nearest-polygon is still resolved by true 3D distance, so a tall box costs accuracy
 * nothing.
 */
const QUERY_HALF_EXTENTS = { x: 4, y: 40, z: 4 } as const;

/**
 * How far short of the requested destination a computed path may finish and still count as having
 * arrived. Same number as `isConnected`'s default tolerance, and for the same reason: Detour never
 * fails a query, it returns a partial path to the nearest reachable polygon, so "a path exists" is
 * not proof of anything.
 */
const ARRIVAL_TOLERANCE = 2.5;

/**
 * Below this gap the snapped destination is appended to the path, above it the path is left
 * ending where Detour actually stopped.
 *
 * This used to be unconditional, and it is the single worst movement bug measured in Phase 1:
 * `findPath` from inside `coldbrace_house_3` to the town square returned 3 points whose last leg
 * was a 26 m straight line, and `Movement.followPath` walked it literally — out through the
 * cottage wall and then through the Forge Shed footprint at (-150.8, -97.7) and (-151.4, -96.5).
 * The reverse trip reported a valid 28.34 m path and parked the player at (-146, -103.8), inside
 * the building. 0.6 m is a little over one cell at the large-world cs of 0.45, which is the real
 * size of the "destination sits just off-mesh" case the append was written for.
 */
const APPEND_TOLERANCE = 0.6;

/**
 * Vertical extent added BELOW a solid volume's base when it is carved out of the navmesh.
 *
 * The ring has to intersect the terrain triangles or Recast never merges the two spans and the
 * ground under the volume stays walkable. Volume bases come from the analytic height field and the
 * drawn mesh is a 2 m lattice sampled from it, so they differ by a few centimetres on flat ground
 * and by more on a ridge; 1.5 m covers it everywhere measured.
 */
const CARVE_SKIRT = 1.5;

/**
 * Shortest ring a carve may be.
 *
 * Recast merges spans within walkableClimb. Keep obstacle rings above that threshold even when
 * the slope rasterisation allowance changes, or short props disappear from route planning.
 */
const MIN_CARVE_HEIGHT = NAV_CONFIG.walkableClimb * NAV_CONFIG.ch + 0.6;

/** Sides on a cylinder carve. 10 gives a decagon within 5% of the circle it stands in for. */
const CYLINDER_SEGMENTS = 10;

/**
 * How many reachable anchors each end of a `planRouteVia` plan considers, and how many nodes it
 * probes to find them.
 *
 * Both numbers come off one measurement: the route nodes ranked by 3-D distance from
 * `gravelmaw_arena`, with the walk the mesh will actually give you and the graph route out at
 * Agility 1.
 *
 *   1  gravelmaw_arena       0.0 m   walk  0.0 m   no route out
 *   2  gravelmaw_chamber3   23.4 m   walk 23.4 m   no route out
 *   3  gravelmaw_chamber2   43.4 m   walk 44.6 m   169.12 s
 *   4  redsill_shallows     62.1 m   UNREACHABLE   (86.23 s, and worthless)
 *   5  gravelmaw_chamber1   64.3 m   walk 64.9 m   164.13 s
 *
 * The first two have no route out because the only chamber2-chamber3 link is the Agility 14 Chimney
 * Climb, so stopping at the nearest node would answer NOT_REACHABLE. Rank 4 is 62 m away through
 * solid rock, which is why the mesh filter is not optional. Rank 5 is the anchor actually chosen
 * and it beats rank 3 by 0.16 s, so five candidates is the number that finds the best answer rather
 * than merely an answer.
 *
 * Every probe is a Detour query and this only runs after a direct query has already failed, so the
 * probe ceiling bounds the worst case at fourteen queries per end instead of one per graph node.
 */
const ANCHOR_CANDIDATES = 5;
const ANCHOR_PROBES = 14;

export interface NavigationSnapshot {
  /** The harness checks this exact string. Do not rename. */
  status: NavStatus;
  polyCount: number;
  hasPath: boolean;
  pathPoints: number;
  destination: Vec3 | null;
  remainingDistance: number;
  error: string | null;
  /** Which generator produced the live mesh. JSON-safe extra; the harness ignores extras. */
  strategy: NavStrategy | null;
}

/** Escape hatch over the root's `NAV_CONFIG`, for tuning generation without editing shared config. */
export interface NavConfigOverrides {
  cs?: number;
  ch?: number;
  walkableSlopeAngle?: number;
  tileSizeVoxels?: number;
}

export type NavArtifactStatus = "not-requested" | "imported" | "runtime-fallback" | "unavailable";

export interface NavArtifactDiagnostics {
  status: NavArtifactStatus;
  url: string | null;
  fingerprint: string | null;
  reason: string | null;
  importMs: number;
  bytes: number;
}

export interface NavArtifactOptions {
  /** Releases must import their validated artifact; runtime baking is an authoring tool. */
  allowRuntimeGeneration?: boolean;
  /** Saved-world seed. A binary from another seed must never be accepted. */
  worldSeed: string | number;
  /** Generated source revisions for authored inputs not fully represented by navigation triangles. */
  authoredInputs?: NavigationAuthoredInputs;
  /** Defaults to generated/corealm-navmesh.bin beneath the page's actual base URL. */
  artifactUrl?: string;
  /** Test and tool seam which avoids a network request. */
  artifactBytes?: Uint8Array;
  loadArtifact?: () => Promise<Uint8Array>;
  signal?: AbortSignal;
}

export interface NavDiagnostics {
  status: NavStatus;
  strategy: NavStrategy | null;
  /** The strategy that was tried first, if it failed and we fell back. */
  fallbackFrom: NavStrategy | null;
  polyCount: number;
  tileCount: number;
  cellSize: number;
  buildMs: number;
  sourceMeshes: number;
  sourceTriangles: number;
  bounds: { min: Vec3; max: Vec3 } | null;
  error: string | null;
  artifact: NavArtifactDiagnostics;
}

declare global {
  interface Window {
    /** Used only by tools/build-navmesh.ts after a runtime fallback has built the canonical mesh. */
    __corealmNavigationArtifact?: (worldSeed?: string | number) => Promise<string>;
  }
}

/** A named place an agent or the UI can path to by id. */
export interface RouteNode {
  id: string;
  name: string;
  position: Vec3;
  regionId: RegionId;
}

/**
 * An edge in the route graph.
 *
 * Three kinds, and the two non-walk ones exist for the same reason: the navmesh is one connected
 * surface and some links in this world are not. A `shortcut` is an Agility obstacle. A `portal` is
 * a placement — measured, the Gravelmaw mouth stands at y 18.61 on the Karrowmoor surface while
 * chamber one's floor is at 16.61 and 4.9 m inside a cavern wall that blocks the mesh from floor to
 * ceiling, so no amount of ground can join them and Detour correctly answers NOT_REACHABLE. The
 * route graph is the only layer that can say "leave the dungeon, then walk there".
 */
export interface RouteEdge {
  from: string;
  to: string;
  /** Seconds. Walk edges are pathLength / PLAYER_SPEED; shortcuts add their traversal duration. */
  cost: number;
  kind: "walk" | "shortcut" | "portal";
  obstacleId?: EntityId;
  /** The portal entity crossed by a `portal` edge. */
  portalId?: EntityId;
  reqLevel?: number;
  /** Where the player must stand to start the shortcut or use the portal. Defaults to `from`. */
  entrance?: Vec3;
  /** Where the shortcut or portal deposits the player. Defaults to the `to` node. */
  exit?: Vec3;
  /** Traversal animation time in milliseconds, from `SemanticEntity.obstacle.durationMs`. */
  durationMs?: number;
  /** Straight-line metres this shortcut saves, for the route-flip explanation in the UI. */
  savesMeters?: number;
}

/**
 * One walkable step of a planned route. This is what makes a route actually walkable rather than
 * only plannable: `Movement.startRoute` consumes these in order, walking the `walk` legs over the
 * navmesh and playing the traversal for the `shortcut` and `portal` legs.
 */
export interface RouteLeg {
  kind: "walk" | "shortcut" | "portal";
  from: Vec3;
  to: Vec3;
  fromId: string;
  toId: string;
  /** Seconds. */
  cost: number;
  obstacleId?: EntityId;
  /** The portal entity a `portal` leg crosses. */
  portalId?: EntityId;
  reqLevel?: number;
  durationMs?: number;
  /**
   * Which region the player is standing in once a `portal` leg completes.
   *
   * Carried on the leg because the region is a property of the far END of the crossing, and the
   * only thing that knows it is the route node the edge points at. Without it the player walks out
   * of the Gravelmaw still tagged `gravelmaw`, and the render filter that hides dungeon interiors
   * from the surface keeps the whole cavern drawn around them.
   */
  toRegionId?: RegionId;
  /** Only populated when the caller asks for paths. */
  path?: Vec3[];
}

export interface RoutePlan {
  path: string[];
  cost: number;
  edges: RouteEdge[];
  legs: RouteLeg[];
}

export class Navigation {
  private navMesh: NavMesh | null = null;
  private query: NavMeshQuery | null = null;
  private status: NavStatus = "uninitialized";
  private error: string | null = null;
  private polyCount = 0;
  private strategy: NavStrategy | null = null;
  private fallbackFrom: NavStrategy | null = null;
  private tileCount = 0;
  private buildMs = 0;
  private sourceMeshes = 0;
  private sourceTriangles = 0;
  private bounds: { min: Vec3; max: Vec3 } | null = null;
  private artifact: NavArtifactDiagnostics = {
    status: "not-requested",
    url: null,
    fingerprint: null,
    reason: null,
    importMs: 0,
    bytes: 0,
  };

  private overrides: NavConfigOverrides = {};

  private routeNodes = new Map<string, RouteNode>();
  private routeEdges: RouteEdge[] = [];
  private pathConstraint: ((path: readonly Vec3[]) => { path: Vec3[]; blocked: boolean }) | null = null;

  /** Live barriers clip a baked route at its reachable near face until gameplay opens them. */
  setPathConstraint(constraint: ((path: readonly Vec3[]) => { path: Vec3[]; blocked: boolean }) | null): void {
    this.pathConstraint = constraint;
  }

  static async initLibrary(): Promise<void> {
    if (recastRuntime) return;
    recastInitialization ??= Promise.all([
      // Project exports at the import boundary. Retaining either module namespace also retains
      // unused crowd, tile-cache and debug drawing APIs and their Three line-rendering helpers.
      import("@recast-navigation/core").then(({ init, NavMeshQuery, importNavMesh, exportNavMesh }) =>
        ({ init, NavMeshQuery, importNavMesh, exportNavMesh })),
      import("@recast-navigation/generators").then(({ generateSoloNavMesh, generateTiledNavMesh, mergePositionsAndIndices }) =>
        ({ generateSoloNavMesh, generateTiledNavMesh, mergePositionsAndIndices })),
      typeof window === "undefined"
        ? Promise.resolve(null)
        : import("@recast-navigation/wasm/wasm"),
    ]).then(async ([core, generators, wasm]) => {
      // The dynamic boundary separates the Emscripten module evaluation from the application
      // entry task. Browser boot still starts it immediately and still uses the external WASM.
      await core.init(wasm?.default);
      recastRuntime = { core, generators };
    }).catch((error: unknown) => {
      recastInitialization = null;
      throw error;
    });
    await recastInitialization;
  }

  /**
   * Builds the navmesh from the walkable meshes currently in the scene.
   * They must already exist in the scene graph; recast reads their geometry directly.
   */
  build(
    walkable: THREE.Mesh[],
    strategy: NavStrategy = "auto",
    overrides: NavConfigOverrides = {},
  ): boolean {
    this.status = "building";
    this.error = null;
    this.fallbackFrom = null;
    this.artifact = {
      status: "not-requested",
      url: null,
      fingerprint: null,
      reason: null,
      importMs: 0,
      bytes: 0,
    };
    const startedAt = now();

    try {
      if (walkable.length === 0) throw new Error("No walkable meshes supplied");
      this.measureSource(walkable);

      this.overrides = overrides;
      const chosen = strategy === "auto" ? this.autoStrategy() : strategy;
      let navMesh = this.generate(walkable, chosen);

      if (!navMesh) {
        // Whichever generator was chosen, try the other one before giving up. A world with no
        // navmesh is unplayable; a world with a slower navmesh is merely slower.
        const alternate: NavStrategy = chosen === "solo" ? "tiled" : "solo";
        navMesh = this.generate(walkable, alternate);
        if (navMesh) {
          this.fallbackFrom = chosen;
          this.strategy = alternate;
        }
      } else {
        this.strategy = chosen;
      }

      if (!navMesh) throw new Error(this.error ?? "Navmesh generation returned no mesh");

      this.navMesh = navMesh;
      this.query = new (requireRecast().core.NavMeshQuery)(this.navMesh);
      this.polyCount = this.countPolys();
      this.buildMs = Math.round(now() - startedAt);
      this.status = "ready";
      this.installArtifactExportHook(walkable, { worldSeed: "runtime-unspecified" });
      return true;
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
      this.status = "failed";
      this.navMesh = null;
      this.query = null;
      this.strategy = null;
      this.buildMs = Math.round(now() - startedAt);
      return false;
    }
  }

  /**
   * Imports the prebaked mesh when every authored and geometric input matches. Any request,
   * container, version, hash or Detour failure falls back to the existing runtime generator.
   */
  async buildOrImport(
    walkable: THREE.Mesh[],
    options: NavArtifactOptions,
    strategy: NavStrategy = "auto",
    overrides: NavConfigOverrides = {},
  ): Promise<boolean> {
    const startedAt = now();
    this.status = "building";
    this.error = null;
    this.fallbackFrom = null;
    this.overrides = overrides;
    this.measureSource(walkable);

    const chosen = strategy === "auto" ? this.autoStrategy() : strategy;
    const artifactUrl = options.artifactUrl ?? defaultArtifactUrl();
    let expectedFingerprint: string | null = null;
    let bytes = 0;
    let importMs = 0;
    let failureReason: string | null = null;

    try {
      if (walkable.length === 0) throw new Error("No walkable meshes supplied");
      // Fetch while WebCrypto digests the Recast input. These two operations are independent, and
      // doing them serially makes cache validation itself part of the boot bottleneck.
      const [fingerprintInput, artifactBytes] = await Promise.all([
        this.artifactFingerprintInput(walkable, options, chosen),
        loadArtifactBytes(artifactUrl, options),
      ]);
      expectedFingerprint = await fingerprintNavigationInputs(fingerprintInput);

      bytes = artifactBytes.byteLength;
      const artifact = await decodeNavigationArtifact(artifactBytes);
      if (artifact.metadata.fingerprint !== expectedFingerprint) {
        throw new Error("fingerprint mismatch");
      }
      if (artifact.metadata.settings.strategy !== chosen) {
        throw new Error("generator strategy mismatch");
      }

      const { core } = requireRecast();
      const imported = core.importNavMesh(artifact.navData);
      this.navMesh = imported.navMesh;
      this.query = new core.NavMeshQuery(imported.navMesh);
      this.strategy = artifact.metadata.settings.strategy;
      this.polyCount = this.countPolys();
      if (this.polyCount <= 0) throw new Error("imported navmesh has no polygons");

      // Includes geometry hashing, request, container validation and Detour import. Reporting only
      // the final importNavMesh call would hide the main-thread work this path is meant to remove.
      importMs = Math.round((now() - startedAt) * 10) / 10;
      this.buildMs = Math.round(now() - startedAt);
      this.status = "ready";
      this.artifact = {
        status: "imported",
        url: artifactUrl,
        fingerprint: expectedFingerprint,
        reason: null,
        importMs,
        bytes,
      };
      this.installArtifactExportHook(walkable, options);
      return true;
    } catch (cause) {
      failureReason = cause instanceof Error ? cause.message : String(cause);
      importMs = Math.round((now() - startedAt) * 10) / 10;
      this.navMesh = null;
      this.query = null;
    }

    if (options.allowRuntimeGeneration === false) {
      this.status = 'failed';
      this.error = failureReason;
      this.buildMs = Math.round(now() - startedAt);
      this.artifact = { status: 'unavailable', url: artifactUrl, fingerprint: expectedFingerprint,
        reason: failureReason, importMs, bytes };
      return false;
    }
    const generated = this.build(walkable, strategy, overrides);
    this.buildMs = Math.round(now() - startedAt);
    this.artifact = {
      status: "runtime-fallback",
      url: artifactUrl,
      fingerprint: expectedFingerprint,
      reason: failureReason,
      importMs,
      bytes,
    };
    if (generated) this.installArtifactExportHook(walkable, options);
    return generated;
  }

  /** Serializes the live Detour mesh with the fingerprint used by buildOrImport(). */
  async exportArtifact(
    walkable: THREE.Mesh[],
    options: Pick<NavArtifactOptions, "worldSeed" | "authoredInputs">,
  ): Promise<Uint8Array> {
    if (!this.navMesh || !this.query || !this.strategy || this.status !== "ready") {
      throw new Error("Cannot export navigation before a mesh is ready");
    }

    this.measureSource(walkable);
    const resolvedStrategy = this.strategy === "auto" ? this.autoStrategy() : this.strategy;
    const fingerprintInput = await this.artifactFingerprintInput(walkable, options, resolvedStrategy);
    const fingerprint = await fingerprintNavigationInputs(fingerprintInput);
    return encodeNavigationArtifact({
      fingerprint,
      settings: fingerprintInput.settings,
      sourceMeshes: fingerprintInput.sourceMeshes,
      sourceTriangles: fingerprintInput.sourceTriangles,
      categories: fingerprintInput.categories,
      polyCount: this.polyCount,
      tileCount: this.tileCount,
    }, requireRecast().core.exportNavMesh(this.navMesh));
  }

  private async artifactFingerprintInput(
    walkable: readonly THREE.Mesh[],
    options: Pick<NavArtifactOptions, "worldSeed" | "authoredInputs">,
    strategy: Exclude<NavStrategy, "auto">,
  ) {
    const geometry = await fingerprintNavigationGeometry(walkable);
    return {
      worldSeed: String(options.worldSeed),
      authored: options.authoredInputs ?? NAVMESH_AUTHORING_INPUTS,
      settings: this.artifactSettings(strategy),
      geometryDigest: geometry.digest,
      sourceMeshes: this.sourceMeshes,
      sourceTriangles: this.sourceTriangles,
      categories: geometry.categories,
    };
  }

  private artifactSettings(strategy: Exclude<NavStrategy, "auto">): NavigationArtifactSettings {
    return {
      strategy,
      cs: this.worldCellSize(),
      ch: this.overrides.ch ?? NAV_CONFIG.ch,
      walkableRadius: NAV_CONFIG.walkableRadius,
      walkableClimb: NAV_CONFIG.walkableClimb,
      walkableHeight: NAV_CONFIG.walkableHeight,
      walkableSlopeAngle: this.overrides.walkableSlopeAngle ?? NAV_CONFIG.walkableSlopeAngle,
      minRegionArea: NAV_CONFIG.minRegionArea,
      tileSizeVoxels: strategy === "tiled"
        ? (this.overrides.tileSizeVoxels ?? TILE_SIZE_VOXELS)
        : null,
    };
  }

  private installArtifactExportHook(
    walkable: THREE.Mesh[],
    options: Pick<NavArtifactOptions, "worldSeed" | "authoredInputs">,
  ): void {
    if (typeof window === "undefined") return;
    window.__corealmNavigationArtifact = async (worldSeed) => bytesToBase64(await this.exportArtifact(
      walkable,
      { ...options, worldSeed: worldSeed ?? options.worldSeed },
    ));
  }

  /** Measured on the real world: solo wins. Tiled remains the fallback if solo ever fails. */
  private autoStrategy(): Exclude<NavStrategy, "auto"> {
    return "solo";
  }

  private worldExtent(): number {
    if (!this.bounds) return 0;
    return Math.max(
      this.bounds.max[0] - this.bounds.min[0],
      this.bounds.max[2] - this.bounds.min[2],
    );
  }

  /**
   * Cell size drives everything: see the measurements in the file header. The tightest gap in
   * Phase 1 is a town gate, not a corridor, so the coarser cell costs nothing playable.
   */
  private worldCellSize(): number {
    if (this.overrides.cs !== undefined) return this.overrides.cs;
    return this.worldExtent() > LARGE_WORLD_EXTENT ? LARGE_WORLD_CELL_SIZE : NAV_CONFIG.cs;
  }

  private generate(walkable: THREE.Mesh[], strategy: NavStrategy): NavMesh | null {
    const { generators } = requireRecast();
    const config = {
      cs: this.worldCellSize(),
      ch: this.overrides.ch ?? NAV_CONFIG.ch,
      walkableRadius: NAV_CONFIG.walkableRadius,
      walkableClimb: NAV_CONFIG.walkableClimb,
      walkableHeight: NAV_CONFIG.walkableHeight,
      walkableSlopeAngle: this.overrides.walkableSlopeAngle ?? NAV_CONFIG.walkableSlopeAngle,
      minRegionArea: NAV_CONFIG.minRegionArea,
    };

    try {
      const [positions, indices] = navigationGeometry(walkable);
      if (strategy === "tiled") {
        const tileSize = this.overrides.tileSizeVoxels ?? TILE_SIZE_VOXELS;
        const result = generators.generateTiledNavMesh(positions, indices, { ...config, tileSize });
        if (!result.success || !result.navMesh) {
          this.error = result.success ? "Tiled navmesh returned no mesh" : result.error;
          return null;
        }
        return result.navMesh;
      }

      const result = generators.generateSoloNavMesh(positions, indices, config);
      if (!result.success || !result.navMesh) {
        this.error = result.success ? "Solo navmesh returned no mesh" : result.error;
        return null;
      }
      return result.navMesh;
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
      return null;
    }
  }

  private measureSource(walkable: THREE.Mesh[]): void {
    this.sourceMeshes = walkable.length;
    this.sourceTriangles = 0;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const box = new THREE.Box3();

    for (const mesh of walkable) {
      const index = mesh.geometry.getIndex();
      const position = mesh.geometry.getAttribute("position");
      this.sourceTriangles += index ? index.count / 3 : position ? position.count / 3 : 0;
      box.setFromObject(mesh);
      min[0] = Math.min(min[0], box.min.x);
      min[1] = Math.min(min[1], box.min.y);
      min[2] = Math.min(min[2], box.min.z);
      max[0] = Math.max(max[0], box.max.x);
      max[1] = Math.max(max[1], box.max.y);
      max[2] = Math.max(max[2], box.max.z);
    }
    this.sourceTriangles = Math.round(this.sourceTriangles);
    this.bounds = Number.isFinite(min[0]) ? { min, max } : null;
  }

  private countPolys(): number {
    if (!this.navMesh) return 0;
    let total = 0;
    let tiles = 0;
    try {
      for (let index = 0; index < this.navMesh.getMaxTiles(); index += 1) {
        const tile = this.navMesh.getTile(index);
        const header = tile?.header();
        if (!header) continue;
        const count = header.polyCount();
        if (count > 0) tiles += 1;
        total += count;
      }
    } catch {
      this.tileCount = tiles;
      return total;
    }
    this.tileCount = tiles;
    return total;
  }

  isReady(): boolean {
    return this.status === "ready" && this.query !== null;
  }

  /** Nearest point actually on the navmesh. Returns null when the mesh is not built. */
  closestPoint(point: Vec3): Vec3 | null {
    if (!this.query) return null;
    try {
      const found = this.query.findClosestPoint(
        { x: point[0], y: point[1], z: point[2] },
        { halfExtents: QUERY_HALF_EXTENTS },
      );
      // `success` matters: a miss still returns a `point`, and it is (0, 0, 0). Trusting it puts
      // the player at the world origin and makes every path from there look plausible.
      if (!found?.success || !found.point) return null;
      return [found.point.x, found.point.y, found.point.z];
    } catch {
      return null;
    }
  }

  /** Nearest walkable point, but only if it is within `maxDistance`. Used by stuck recovery. */
  nearestWalkable(point: Vec3, maxDistance = 3): Vec3 | null {
    const snapped = this.closestPoint(point);
    if (!snapped) return null;
    return distanceXZ(snapped, point) <= maxDistance ? snapped : null;
  }

  /**
   * A walkable path between two points, snapped to the navmesh. Null when unreachable OR when the
   * best Detour could do stops more than `ARRIVAL_TOLERANCE` short of where it was asked to go.
   *
   * That second case used to return a path with a fabricated straight last leg. It is why
   * click-to-move walked through cottage walls, and why a destination inside a building reported a
   * successful path. Callers that need to distinguish "no route" from "route that stops short"
   * call `findPathDetailed`.
   */
  findPath(from: Vec3, to: Vec3): Vec3[] | null {
    const detailed = this.findPathDetailed(from, to);
    if (!detailed || detailed.partial) return null;
    return detailed.path;
  }

  /**
   * The honest version of `findPath`: the path Detour actually computed, plus how far short of the
   * request it stopped. Nothing is ever invented here except the last 0.6 m, and only when the
   * destination genuinely sits just off-mesh.
   *
   * `Movement.startPath` needs `partial` so it can emit `navigation.failed { reason:
   * "unreachable" }` rather than walk a straight line into a wall, and it needs `arrivalGap` so a
   * walk-into-interaction-range still counts as arrival when the destination is an ore rock whose
   * own footprint is carved out of the mesh.
   */
  findPathDetailed(from: Vec3, to: Vec3): { path: Vec3[]; partial: boolean; arrivalGap: number } | null {
    if (!this.query) return null;
    try {
      const start = this.query.findClosestPoint(
        { x: from[0], y: from[1], z: from[2] },
        { halfExtents: QUERY_HALF_EXTENTS },
      );
      const end = this.query.findClosestPoint(
        { x: to[0], y: to[1], z: to[2] },
        { halfExtents: QUERY_HALF_EXTENTS },
      );
      if (!start?.success || !start.point || !end?.success || !end.point) return null;

      const result = this.query.computePath(start.point, end.point);
      if (!result?.success || !result.path || result.path.length === 0) return null;

      const points: Vec3[] = result.path.map((point) => [point.x, point.y, point.z] as Vec3);
      const last = points[points.length - 1]!;
      const snappedEnd: Vec3 = [end.point.x, end.point.y, end.point.z];
      const arrivalGap = distanceXZ(last, snappedEnd);

      // Only close the gap when it is one navmesh cell wide. Anything larger is Detour telling us
      // the destination is on a polygon island it cannot reach, and the straight line across it
      // goes through whatever made the island.
      if (arrivalGap <= APPEND_TOLERANCE && distance(last, snappedEnd) > 0.05) {
        points.push(snappedEnd);
      }
      const constrained = this.pathConstraint?.(points);
      if (constrained?.blocked) {
        const reachableEnd = constrained.path.at(-1);
        if (!reachableEnd) return null;
        return { path: constrained.path, partial: true, arrivalGap: distanceXZ(reachableEnd, snappedEnd) };
      }
      return { path: points, partial: arrivalGap > ARRIVAL_TOLERANCE, arrivalGap };
    } catch {
      return null;
    }
  }

  /** Path length in metres, or null when unreachable. */
  pathDistance(from: Vec3, to: Vec3): number | null {
    const path = this.findPath(from, to);
    return path ? pathLength(path) : null;
  }

  /**
   * Are two points genuinely on the same connected navmesh?
   *
   * Detour returns a partial path to the nearest reachable polygon rather than failing, so a path
   * existing is not proof of connectivity. This checks the path actually ARRIVES, which is what
   * PRD acceptance B3 (Coldbrace bank -> Upper Karrow seam, one mesh, 380-460 m) needs.
   */
  isConnected(from: Vec3, to: Vec3, tolerance = ARRIVAL_TOLERANCE): boolean {
    const detailed = this.findPathDetailed(from, to);
    if (!detailed || detailed.path.length === 0) return false;
    return !detailed.partial && detailed.arrivalGap <= tolerance;
  }

  /** Connectivity matrix over a set of probe points. The root asserts three-region connectivity. */
  verifyConnectivity(points: readonly { id: string; position: Vec3 }[]): {
    connected: boolean;
    pairs: { from: string; to: string; metres: number | null }[];
  } {
    const pairs: { from: string; to: string; metres: number | null }[] = [];
    let connected = true;
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i]!;
        const b = points[j]!;
        const reachable = this.isConnected(a.position, b.position);
        const metres = reachable ? this.pathDistance(a.position, b.position) : null;
        if (!reachable) connected = false;
        pairs.push({
          from: a.id,
          to: b.id,
          metres: metres === null ? null : Math.round(metres * 10) / 10,
        });
      }
    }
    return { connected, pairs };
  }

  etaMs(path: readonly Vec3[]): number {
    return Math.round((pathLength(path) / PLAYER_SPEED) * 1000);
  }

  // ---------------------------------------------------------- route graph

  setRouteGraph(nodes: RouteNode[], edges: RouteEdge[]): void {
    this.routeNodes.clear();
    for (const node of nodes) this.routeNodes.set(node.id, node);
    this.routeEdges = edges;
  }

  routeNode(id: string): RouteNode | undefined {
    return this.routeNodes.get(id);
  }

  listRouteNodes(): RouteNode[] {
    return [...this.routeNodes.values()];
  }

  listRouteEdges(): RouteEdge[] {
    return [...this.routeEdges];
  }

  /** Nearest route node to a world position, for "where am I on the graph" queries. */
  nearestRouteNode(position: Vec3): RouteNode | null {
    let best: RouteNode | null = null;
    let bestDistance = Infinity;
    for (const node of this.routeNodes.values()) {
      const gap = distanceXZ(node.position, position);
      if (gap < bestDistance) {
        bestDistance = gap;
        best = node;
      }
    }
    return best;
  }

  /**
   * Cheapest route between two named locations, honouring the player's Agility level.
   * This is where the route-optimisation metagame lives: a shortcut edge unlocked at a given
   * Agility level can flip which training spot is actually the best one.
   */
  planRoute(
    fromId: string,
    toId: string,
    agilityLevel: number,
    options: { withPaths?: boolean } = {},
  ): RoutePlan | null {
    if (!this.routeNodes.has(fromId) || !this.routeNodes.has(toId)) return null;
    if (fromId === toId) return { path: [fromId], cost: 0, edges: [], legs: [] };

    const usable = this.routeEdges.filter((edge) => edge.kind === "walk" || (edge.reqLevel ?? 0) <= agilityLevel);
    const adjacency = new Map<string, RouteEdge[]>();
    for (const edge of usable) {
      if (edge.kind === "walk" && this.pathConstraint) {
        const from = this.routeNodes.get(edge.from);
        const to = this.routeNodes.get(edge.to);
        if (!from || !to || !this.findPath(from.position, to.position)) continue;
      }
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      adjacency.get(edge.from)!.push(edge);
    }

    const best = new Map<string, number>([[fromId, 0]]);
    const cameFrom = new Map<string, RouteEdge>();
    const visited = new Set<string>();

    while (visited.size < this.routeNodes.size) {
      let current: string | null = null;
      let currentCost = Infinity;
      for (const [id, cost] of best) {
        if (!visited.has(id) && cost < currentCost) {
          current = id;
          currentCost = cost;
        }
      }
      if (current === null) break;
      if (current === toId) break;
      visited.add(current);

      for (const edge of adjacency.get(current) ?? []) {
        const next = currentCost + edge.cost;
        if (next < (best.get(edge.to) ?? Infinity)) {
          best.set(edge.to, next);
          cameFrom.set(edge.to, edge);
        }
      }
    }

    const total = best.get(toId);
    if (total === undefined) return null;

    const edges: RouteEdge[] = [];
    const path: string[] = [toId];
    let cursor = toId;
    while (cursor !== fromId) {
      const edge = cameFrom.get(cursor);
      if (!edge) return null;
      edges.unshift(edge);
      cursor = edge.from;
      path.unshift(cursor);
    }

    return { path, cost: total, edges, legs: this.toLegs(edges, options.withPaths ?? false) };
  }

  /**
   * Turns route edges into walkable legs.
   *
   * A shortcut is expanded into TWO legs: walk to the obstacle entrance, then traverse it. That is
   * the whole of correction R2 in one function — the traversal is a gameplay step with a duration
   * and a requirement, not a Detour off-mesh connection, so it is interruptible and it fires real
   * events.
   */
  toLegs(edges: readonly RouteEdge[], withPaths = false): RouteLeg[] {
    const legs: RouteLeg[] = [];

    for (const edge of edges) {
      const fromNode = this.routeNodes.get(edge.from);
      const toNode = this.routeNodes.get(edge.to);
      if (!fromNode || !toNode) continue;

      if (edge.kind === "walk") {
        legs.push(this.walkLeg(edge.from, edge.to, fromNode.position, toNode.position, edge.cost, withPaths));
        continue;
      }

      // A shortcut and a portal are the same shape of leg: walk to a spot, spend a duration
      // standing there, reappear somewhere the navmesh could not have carried you. Only what the
      // far side means differs, so they share one branch rather than growing a second mechanism.
      const entrance = this.knownToMesh(edge.entrance) ?? fromNode.position;
      const exit = this.knownToMesh(edge.exit) ?? toNode.position;
      if (distanceXZ(fromNode.position, entrance) > 0.5) {
        const approach = this.pathDistance(fromNode.position, entrance);
        legs.push(this.walkLeg(
          edge.from,
          `${edge.to}:entrance`,
          fromNode.position,
          entrance,
          (approach ?? 0) / PLAYER_SPEED,
          withPaths,
        ));
      }

      const leg: RouteLeg = {
        kind: edge.kind,
        from: entrance,
        to: exit,
        fromId: `${edge.to}:entrance`,
        toId: edge.to,
        cost: (edge.durationMs ?? 0) / 1000,
        durationMs: edge.durationMs ?? 0,
      };
      if (edge.obstacleId !== undefined) leg.obstacleId = edge.obstacleId;
      if (edge.portalId !== undefined) leg.portalId = edge.portalId;
      if (edge.reqLevel !== undefined) leg.reqLevel = edge.reqLevel;
      if (edge.kind === "portal") leg.toRegionId = toNode.regionId;
      legs.push(leg);

      if (distanceXZ(exit, toNode.position) > 0.5) {
        const tail = this.pathDistance(exit, toNode.position);
        legs.push(this.walkLeg(
          `${edge.to}:exit`,
          edge.to,
          exit,
          toNode.position,
          (tail ?? 0) / PLAYER_SPEED,
          withPaths,
        ));
      }
    }
    return legs;
  }

  /**
   * A route between two arbitrary world points, anchored onto the graph at both ends.
   *
   * `planRoute` needs two node ids. A player and an agent have a position and a thing they want to
   * reach, and neither is usually a node — so this picks the anchors, and it picks them by asking
   * the navmesh rather than by distance alone. That distinction is the whole reason it exists:
   * standing on `gravelmaw_arena` the nearest node IS the arena, and no graph edge leaves it below
   * Agility 14. Walking outward and costing each candidate lands on `gravelmaw_chamber1`, 64.9 m of
   * real walking away, for 179.58 s to the Bracken Pit. See `ANCHOR_CANDIDATES` for the full table.
   *
   * Every anchor is proved with a real path query before it is used, so this cannot invent a leg
   * through solid rock the way the old fabricated last leg did.
   */
  planRouteVia(
    from: Vec3,
    to: { locationId: string } | { position: Vec3; id?: string },
    agilityLevel: number,
    options: { withPaths?: boolean; maxWalkingMetres?: number } = {},
  ): RoutePlan | null {
    const withPaths = options.withPaths ?? false;
    const maxWalkingMetres = options.maxWalkingMetres ?? Infinity;
    const starts = this.reachableNodesNear(from, maxWalkingMetres);
    if (starts.length === 0) return null;

    let ends: { node: RouteNode; metres: number }[];
    let tail: Vec3 | null = null;
    let tailId = "destination";
    if ("locationId" in to) {
      const node = this.routeNodes.get(to.locationId);
      if (!node) return null;
      ends = [{ node, metres: 0 }];
    } else {
      ends = this.reachableNodesNear(to.position, maxWalkingMetres);
      tail = to.position;
      tailId = to.id ?? "destination";
    }
    if (ends.length === 0) return null;

    let best: {
      plan: RoutePlan;
      start: RouteNode; startMetres: number;
      end: RouteNode; endMetres: number;
      total: number;
    } | null = null;

    for (const start of starts) {
      for (const end of ends) {
        if (distance(from, start.node.position) + (tail ? distance(tail, end.node.position) : 0) > maxWalkingMetres) continue;
        const plan = this.planRoute(start.node.id, end.node.id, agilityLevel, { withPaths });
        if (!plan) continue;
        const total = (start.metres + end.metres) / PLAYER_SPEED + plan.cost;
        if (best && total >= best.total) continue;
        best = {
          plan,
          start: start.node, startMetres: start.metres,
          end: end.node, endMetres: end.metres,
          total,
        };
      }
    }
    if (!best) return null;

    const legs: RouteLeg[] = [];
    if (distanceXZ(from, best.start.position) > 0.5) {
      legs.push(this.walkLeg(
        "start", best.start.id, from, best.start.position, best.startMetres / PLAYER_SPEED, withPaths,
      ));
    }
    legs.push(...best.plan.legs);
    if (tail && distanceXZ(best.end.position, tail) > 0.5) {
      legs.push(this.walkLeg(
        best.end.id, tailId, best.end.position, tail, best.endMetres / PLAYER_SPEED, withPaths,
      ));
    }
    if (legs.length === 0) return null;

    const path = [...best.plan.path];
    if (tail) path.push(tailId);
    return { path, cost: Math.round(best.total * 100) / 100, edges: best.plan.edges, legs };
  }

  /**
   * The point, if the mesh knows about it at all; otherwise null so the caller uses the node.
   *
   * Measured: the Scree Slide's authored `exitPosition` snaps to nothing — `closestPoint` returns
   * null there, and a traversal leg that trusted it would put the player off the mesh. The node is
   * always a place the graph already claims you can stand, so it is the honest fallback.
   */
  private knownToMesh(point: Vec3 | undefined): Vec3 | null {
    if (!point) return null;
    return this.closestPoint(point) ? point : null;
  }

  /**
   * Route nodes the navmesh can genuinely walk between and `position`, nearest first.
   *
   * `pathDistance` is null on a partial path, so a node on the far side of a cavern wall is dropped
   * rather than ranked — which is what keeps a surface node from being chosen as the anchor for a
   * player standing 12 m under it in the Gravelmaw.
   */
  private reachableNodesNear(position: Vec3, maxMetres = Infinity): { node: RouteNode; metres: number }[] {
    const byDistance = [...this.routeNodes.values()]
      .map((node) => ({ node, gap: distance(node.position, position) }))
      .sort((a, b) => a.gap - b.gap);

    const hits: { node: RouteNode; metres: number }[] = [];
    for (const candidate of byDistance.slice(0, ANCHOR_PROBES)) {
      if (hits.length >= ANCHOR_CANDIDATES) break;
      if (candidate.gap > maxMetres) break;
      const metres = this.pathDistance(position, candidate.node.position);
      if (metres === null) continue;
      hits.push({ node: candidate.node, metres });
    }
    return hits;
  }

  private walkLeg(
    fromId: string,
    toId: string,
    from: Vec3,
    to: Vec3,
    cost: number,
    withPaths: boolean,
  ): RouteLeg {
    const leg: RouteLeg = { kind: "walk", from, to, fromId, toId, cost };
    if (withPaths) {
      const path = this.findPath(from, to);
      if (path) leg.path = path;
    }
    return leg;
  }

  // ------------------------------------------------------------ snapshot

  snapshot(activePath: Vec3[] | null, destination: Vec3 | null, remainingDistance: number): NavigationSnapshot {
    return {
      status: this.status,
      polyCount: this.polyCount,
      hasPath: Boolean(activePath && activePath.length > 0),
      pathPoints: activePath?.length ?? 0,
      destination,
      remainingDistance: Math.round(remainingDistance * 100) / 100,
      error: this.error,
      strategy: this.strategy,
    };
  }

  /** JSON-safe build report. The root asserts against this after boot. */
  getDiagnostics(): NavDiagnostics {
    return {
      status: this.status,
      strategy: this.strategy,
      fallbackFrom: this.fallbackFrom,
      polyCount: this.polyCount,
      tileCount: this.tileCount,
      cellSize: this.worldCellSize(),
      buildMs: this.buildMs,
      sourceMeshes: this.sourceMeshes,
      sourceTriangles: this.sourceTriangles,
      bounds: this.bounds,
      error: this.error,
      artifact: { ...this.artifact },
    };
  }

  getStatus(): NavStatus {
    return this.status;
  }
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function defaultArtifactUrl(): string {
  if (typeof document !== "undefined") {
    return new URL("generated/corealm-navmesh.bin", document.baseURI).toString();
  }
  return "/generated/corealm-navmesh.bin";
}

async function loadArtifactBytes(url: string, options: NavArtifactOptions): Promise<Uint8Array> {
  if (options.artifactBytes) return options.artifactBytes;
  if (options.loadArtifact) return options.loadArtifact();
  const response = await fetch(url, { signal: options.signal });
  if (!response.ok) throw new Error(`artifact request failed with HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

// ------------------------------------------------------------- nav carving

/**
 * Invisible geometry handed to Recast so it carves a footprint out of the navmesh, one mesh per
 * volume. Never rendered — `visible = false` keeps them out of every draw call while Recast still
 * reads the buffers directly, so the measured cost against the 400-call budget is zero.
 *
 * OPEN-TOPPED on purpose. The closed `BoxGeometry` this replaces rasterises its top face into a
 * perfectly flat walkable polygon, and those polygons are real: probing the navmesh at (-146, 5,
 * -104) snapped to y = 7.841 on a cottage roof, (-160, 6, -60) to y = 9.041 on the March Company
 * Hall, and teleporting there let the player walk 5 m along the ridge (screenshot
 * runs/corealm/screenshots/collision-on-hall-roof.png). Every teleport in the game — region
 * travel, debug teleport, focus camera, death respawn — routes through `closestPoint`, so a roof
 * polygon is not "harmless because nothing connects to it", which is what the old comment claimed.
 * A ring has no top face and generates no roof polygon.
 *
 * The sides are what actually block: a vertical quad exceeds `walkableSlopeAngle` 78 degrees, so
 * it rasterises with the NULL area flag, and because the ring skirts 1.5 m below the volume base
 * its span merges with the terrain span underneath and takes the ring's flag rather than the
 * ground's. That is the whole carve.
 *
 * Callers must add these to the scene graph (or otherwise leave their world matrices valid) before
 * `nav.build`; matrices are updated here, so adding them to an identity group is enough.
 */
export function solidObstacleMeshes(volumes: readonly SolidVolume[]): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  // One shared material: it is never rendered, and a material per volume would be ~900 objects
  // allocated for nothing.
  const material = new THREE.MeshBasicMaterial();

  for (const volume of volumes) {
    const skirt = volume.elevated ? 0 : CARVE_SKIRT;
    const base = volume.position[1] - skirt;
    const geometry =
      volume.kind === "box"
        ? ringGeometry(boxFootprint(volume.size[0], volume.size[2]), skirt + Math.max(volume.size[1], MIN_CARVE_HEIGHT))
        : ringGeometry(circleFootprint(volume.radius, CYLINDER_SEGMENTS), skirt + Math.max(volume.height, MIN_CARVE_HEIGHT));

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(volume.position[0], base, volume.position[2]);
    if (volume.kind === "box") mesh.rotation.y = volume.rotationY;
    mesh.name = `solid-carve-${volume.id}`;
    mesh.visible = false;
    mesh.updateMatrixWorld(true);
    meshes.push(mesh);
  }
  return meshes;
}

function boxFootprint(sizeX: number, sizeZ: number): [number, number][] {
  const hx = sizeX * 0.5;
  const hz = sizeZ * 0.5;
  return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
}

function circleFootprint(radius: number, segments: number): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return points;
}

/** A closed skirt of vertical quads around `footprint`, rising from y = 0 to y = `height`. */
function ringGeometry(footprint: readonly [number, number][], height: number): THREE.BufferGeometry {
  const count = footprint.length;
  const positions = new Float32Array(count * 2 * 3);
  const indices: number[] = [];

  for (let i = 0; i < count; i += 1) {
    const [x, z] = footprint[i]!;
    positions[i * 6 + 0] = x;
    positions[i * 6 + 1] = 0;
    positions[i * 6 + 2] = z;
    positions[i * 6 + 3] = x;
    positions[i * 6 + 4] = height;
    positions[i * 6 + 5] = z;
  }
  for (let i = 0; i < count; i += 1) {
    const a = i * 2;
    const b = a + 1;
    const c = ((i + 1) % count) * 2;
    const d = c + 1;
    indices.push(a, c, b, b, c, d);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}
