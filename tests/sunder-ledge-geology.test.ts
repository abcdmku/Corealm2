import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO, type Document, type Primitive } from "@gltf-transform/core";
import { Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import type { AssetEntry } from "../game/src/render/assets.js";
import { agilityDurationOf, resolveShortcutEndpoints } from "../game/src/systems/agility.js";
import { assetSolidFromMeasurements, buildWorld, type WorldPorts } from "../game/src/world/regionBuilder.js";
import {
  buildGeologyAsset,
  GEOLOGY_ASSET_IDS,
  geologyOutputPaths,
  parseGeologyBuildOptions,
  type GeologyAssetEntry,
} from "../tools/build-corealm-geology.js";
import { repoRoot } from "../tools/lib/paths.js";

const SOURCE_ID = "corealm_cliff_strata_1";
const SUNDER_ID = "corealm_sunder_ledge";
const REPLACEMENTS = [
  {
    id: SUNDER_ID, legacyId: "cliff_step_2", entityId: "sunder_ledge",
    base: { x: -4.702, y: -0.19, z: -2.909 }, size: { x: 9.319, y: 4.448, z: 6.735 },
    translation: [-0.0425, -0.19, 0.4585],
    entrance: [170, 0.23, -74], exit: [176, 0, -114], scale: 1.2, rotationY: 0.4,
    reqLevel: 10, durationMs: 6_000, savesMeters: 142, oneWay: false,
    from: "highcairn_bank", to: "upper_karrow_seam",
    approach: [150, -70],
  },
  {
    id: "corealm_scree_slide", legacyId: "cliff_step_3", entityId: "scree_slide",
    base: { x: -2.941, y: -0.124, z: -2.318 }, size: { x: 5.996, y: 4.382, z: 5.44 },
    translation: [0.057, -0.124, 0.402],
    entrance: [96, 0.16, -170], exit: [108, 0, -24], scale: 1.3, rotationY: 0,
    reqLevel: 12, durationMs: 3_200, savesMeters: 168, oneWay: true,
    from: "great_cairn", to: "karrowmoor_terraces",
    approach: [140, -176],
  },
] as const;
type GeneratedAsset = { glb: Uint8Array; entry: GeologyAssetEntry };
const AXES = ["x", "y", "z"] as const;
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function singlePrimitive(document: Document): Primitive {
  const meshes = document.getRoot().listMeshes();
  expect(meshes).toHaveLength(1);
  expect(meshes[0]!.listPrimitives()).toHaveLength(1);
  return meshes[0]!.listPrimitives()[0]!;
}

/** Welded UV seams can change indices without changing triangle order or topology. */
function triangleCorners(primitive: Primitive, semantic: string): number[][] {
  const attribute = primitive.getAttribute(semantic)!;
  expect(attribute, semantic).toBeTruthy();
  const indices = primitive.getIndices();
  return Array.from({ length: indices?.getCount() ?? attribute.getCount() }, (_, corner) =>
    attribute.getElement(indices?.getScalar(corner) ?? corner, []));
}

function faceNormal(corners: number[][], offset: number): Vector3 {
  const a = new Vector3().fromArray(corners[offset]!);
  const b = new Vector3().fromArray(corners[offset + 1]!);
  const c = new Vector3().fromArray(corners[offset + 2]!);
  return b.sub(a).cross(c.sub(a)).normalize();
}

type SurfaceCrossing = { position: number; direction: number };

type ProjectionIndex = {
  minX: number; maxX: number; minZ: number; maxZ: number;
  cellWidth: number; cellDepth: number; bins: number[][];
};
const projectionIndices = new WeakMap<number[][], ProjectionIndex>();

/** Bin triangle bounds once so repeated stance and silhouette rays inspect nearby faces. */
function verticalRayTriangles(corners: number[][], x: number, z: number): number[] {
  const divisions = 32;
  let index = projectionIndices.get(corners);
  if (!index) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const corner of corners) {
      minX = Math.min(minX, corner[0]!); maxX = Math.max(maxX, corner[0]!);
      minZ = Math.min(minZ, corner[2]!); maxZ = Math.max(maxZ, corner[2]!);
    }
    const cellWidth = (maxX - minX) / divisions, cellDepth = (maxZ - minZ) / divisions;
    const bins = Array.from({ length: divisions * divisions }, () => [] as number[]);
    const cell = (value: number, minimum: number, span: number) =>
      Math.max(0, Math.min(divisions - 1, Math.floor((value - minimum) / span)));
    for (let offset = 0; offset < corners.length; offset += 3) {
      const a = corners[offset]!, b = corners[offset + 1]!, c = corners[offset + 2]!;
      const firstX = cell(Math.min(a[0]!, b[0]!, c[0]!) - 0.000001, minX, cellWidth);
      const lastX = cell(Math.max(a[0]!, b[0]!, c[0]!) + 0.000001, minX, cellWidth);
      const firstZ = cell(Math.min(a[2]!, b[2]!, c[2]!) - 0.000001, minZ, cellDepth);
      const lastZ = cell(Math.max(a[2]!, b[2]!, c[2]!) + 0.000001, minZ, cellDepth);
      for (let row = firstZ; row <= lastZ; row++) {
        for (let column = firstX; column <= lastX; column++) bins[row * divisions + column]!.push(offset);
      }
    }
    index = { minX, maxX, minZ, maxZ, cellWidth, cellDepth, bins };
    projectionIndices.set(corners, index);
  }
  if (x < index.minX || x > index.maxX || z < index.minZ || z > index.maxZ) return [];
  const column = Math.min(divisions - 1, Math.floor((x - index.minX) / index.cellWidth));
  const row = Math.min(divisions - 1, Math.floor((z - index.minZ) / index.cellDepth));
  return index.bins[row * divisions + column]!;
}

/** Oriented intersections along the unsampled axis. Sampled axes are in ascending order. */
function surfaceCrossings(
  corners: number[][],
  axes: readonly [number, number],
  coordinates: readonly [number, number],
  outputAxis: number,
): SurfaceCrossing[] {
  const hits: SurfaceCrossing[] = [];
  const offsets = axes[0] === 0 && axes[1] === 2
    ? verticalRayTriangles(corners, coordinates[0], coordinates[1])
    : Array.from({ length: corners.length / 3 }, (_, index) => index * 3);
  for (const offset of offsets) {
    const a = corners[offset]!, b = corners[offset + 1]!, c = corners[offset + 2]!;
    const b0 = b[axes[0]]! - a[axes[0]]!, b1 = b[axes[1]]! - a[axes[1]]!;
    const c0 = c[axes[0]]! - a[axes[0]]!, c1 = c[axes[1]]! - a[axes[1]]!;
    const determinant = b0 * c1 - b1 * c0;
    if (Math.abs(determinant) < 1e-12) continue;
    const p0 = coordinates[0] - a[axes[0]]!, p1 = coordinates[1] - a[axes[1]]!;
    const u = (p0 * c1 - p1 * c0) / determinant;
    const v = (b0 * p1 - b1 * p0) / determinant;
    if (u < -1e-7 || v < -1e-7 || u + v > 1 + 1e-7) continue;
    const value = a[outputAxis]! + u * (b[outputAxis]! - a[outputAxis]!)
      + v * (c[outputAxis]! - a[outputAxis]!);
    hits.push({ position: value, direction: Math.sign(determinant) * (outputAxis === 1 ? -1 : 1) });
  }
  return hits;
}

function surfaceHits(
  corners: number[][],
  axes: readonly [number, number],
  coordinates: readonly [number, number],
  outputAxis: number,
): number[] {
  return surfaceCrossings(corners, axes, coordinates, outputAxis).map(hit => hit.position);
}

/** A ray crossing a shared triangle edge still crosses that face only once. */
function uniqueCrossings(crossings: SurfaceCrossing[]): SurfaceCrossing[] {
  const unique = new Map<string, SurfaceCrossing>();
  for (const crossing of crossings) unique.set(`${crossing.position.toFixed(5)}:${crossing.direction}`, crossing);
  return [...unique.values()];
}

function solidAtHeight(crossings: SurfaceCrossing[], height: number): boolean {
  return crossings.filter(hit => hit.position > height + 0.00001)
    .reduce((winding, hit) => winding + hit.direction, 0) > 0;
}

function surfaceRange(
  corners: number[][],
  axes: readonly [number, number],
  coordinates: readonly [number, number],
  outputAxis: number,
): readonly [number, number] {
  const hits = surfaceHits(corners, axes, coordinates, outputAxis);
  return [Math.min(...hits), Math.max(...hits)];
}

/** The silhouette includes every triangle at this X, even geometry behind the front face. */
function skylineHeight(corners: number[][], x: number): number {
  let highest = -Infinity;
  for (let offset = 0; offset < corners.length; offset += 3) {
    for (let edge = 0; edge < 3; edge++) {
      const a = corners[offset + edge]!, b = corners[offset + (edge + 1) % 3]!;
      if (x < Math.min(a[0]!, b[0]!) || x > Math.max(a[0]!, b[0]!)) continue;
      const span = b[0]! - a[0]!;
      if (Math.abs(span) < 1e-12) highest = Math.max(highest, a[1]!, b[1]!);
      else highest = Math.max(highest, a[1]! + (b[1]! - a[1]!) * (x - a[0]!) / span);
    }
  }
  return highest;
}

/** A horizontal solid section above the buried foot detects detached towers. */
function bodyContinuity(corners: number[][], entry: Pick<GeologyAssetEntry, "base" | "size">) {
  const columns = 31, rows = 25;
  const occupied = new Set<number>();
  for (let row = 0; row < rows; row++) {
    const z = entry.base!.z + (row + 0.5) / rows * entry.size.z;
    for (let column = 0; column < columns; column++) {
      const x = entry.base!.x + (column + 0.5) / columns * entry.size.x;
      const crossings = uniqueCrossings(surfaceCrossings(corners, [0, 2], [x, z], 1));
      if (solidAtHeight(crossings, entry.base!.y + entry.size.y * 0.25)) occupied.add(row * columns + column);
    }
  }
  const remaining = new Set(occupied);
  const components: number[][] = [];
  while (remaining.size) {
    const component = [remaining.values().next().value!];
    remaining.delete(component[0]!);
    for (let index = 0; index < component.length; index++) {
      const cell = component[index]!, row = Math.floor(cell / columns), column = cell % columns;
      const neighbours = [
        ...(column > 0 ? [cell - 1] : []), ...(column < columns - 1 ? [cell + 1] : []),
        ...(row > 0 ? [cell - columns] : []), ...(row < rows - 1 ? [cell + columns] : []),
      ];
      for (const neighbour of neighbours) {
        if (remaining.delete(neighbour)) component.push(neighbour);
      }
    }
    components.push(component);
  }
  components.sort((a, b) => b.length - a.length);
  const largest = components[0] ?? [];
  const xCells = largest.map(cell => cell % columns);
  const zCells = largest.map(cell => Math.floor(cell / columns));
  return {
    occupiedCells: occupied.size,
    largestFraction: largest.length / occupied.size,
    footprintFraction: largest.length / (columns * rows),
    widthFraction: (Math.max(...xCells) - Math.min(...xCells) + 1) / columns,
    depthFraction: (Math.max(...zCells) - Math.min(...zCells) + 1) / rows,
    componentSizes: components.map(component => component.length),
  };
}

describe("authored agility geology source generation", () => {
  let generatedAssets: Map<string, GeneratedAsset>;
  let generatedDocuments: Map<string, Document>;
  let existingAssets: GeneratedAsset[];
  let sourceDocument: Document;

  beforeAll(async () => {
    const generated = await Promise.all(GEOLOGY_ASSET_IDS.map((id) => buildGeologyAsset(id)));
    generatedAssets = new Map(generated.map((asset) => [asset.entry.id, asset]));
    existingAssets = generated.filter((asset) => !REPLACEMENTS.some((replacement) => replacement.id === asset.entry.id));
    sourceDocument = await new NodeIO().readBinary(generatedAssets.get(SOURCE_ID)!.glb);
    generatedDocuments = new Map(await Promise.all(REPLACEMENTS.map(async ({ id }) =>
      [id, await new NodeIO().readBinary(generatedAssets.get(id)!.glb)] as const)));
  });

  it("regenerates all 19 accepted geology assets byte for byte from their recipes", async () => {
    expect(existingAssets).toHaveLength(19);
    for (const generated of existingAssets) {
      const shipped = await readFile(path.join(repoRoot, "game/public/assets", generated.entry.file));
      expect(digest(generated.glb), generated.entry.id).toBe(digest(shipped));
      expect(generated.entry.sha256).toBe(digest(generated.glb));
      expect(generated.entry.bytes).toBe(generated.glb.byteLength);
    }
  });

  it.each(REPLACEMENTS)("retains $id legacy bounds and deterministic source output", async (replacement) => {
    const generated = generatedAssets.get(replacement.id)!;
    expect(generated.entry).toMatchObject({
      id: replacement.id,
      file: `models/corealm/geology/${replacement.id}.glb`,
      category: "rock",
      is: "cliff",
      base: replacement.base,
      size: replacement.size,
      mineralFaces: 0,
      placement: {
        replacesAssetId: replacement.legacyId,
        translation: [...replacement.translation],
      },
    });
    expect(generated.entry.sha256).toBe(digest(generated.glb));
    expect(generated.entry.bytes).toBe(generated.glb.byteLength);
    const repeated = await buildGeologyAsset(replacement.id);
    expect(digest(repeated.glb)).toBe(digest(generated.glb));
    expect(repeated.entry).toEqual(generated.entry);
    const positions = triangleCorners(singlePrimitive(generatedDocuments.get(replacement.id)!), "POSITION");
    expect(generated.entry.triangles).toBe(positions.length / 3);
    for (const [index, axis] of AXES.entries()) {
      const values = positions.map((point) => point[index]!);
      expect(Math.min(...values), `minimum ${axis}`).toBeCloseTo(replacement.base[axis], 6);
      expect(Math.max(...values), `maximum ${axis}`).toBeCloseTo(replacement.base[axis] + replacement.size[axis], 6);
    }
  });

  it.each(REPLACEMENTS)("bakes $id placement into its geometry with no remaining node transform", ({ id }) => {
    const document = generatedDocuments.get(id)!;
    expect(document.getRoot().listNodes()).toHaveLength(1);
    for (const node of document.getRoot().listNodes()) {
      expect(node.getTranslation()).toEqual([0, 0, 0]);
      expect(node.getScale()).toEqual([1, 1, 1]);
      expect(node.getRotation()).toEqual([0, 0, 0, 1]);
    }
    expect(document.getRoot().listAnimations()).toHaveLength(0);
    expect(document.getRoot().listSkins()).toHaveLength(0);
  });

  it.each(REPLACEMENTS)("retains one weathered-stone draw and accepted material response for $id", ({ id }) => {
    const document = generatedDocuments.get(id)!;
    const sourceMaterial = singlePrimitive(sourceDocument).getMaterial()!;
    const authoredMaterial = singlePrimitive(document).getMaterial()!;
    expect(document.getRoot().listMaterials()).toHaveLength(1);
    expect(authoredMaterial.getName()).toBe(sourceMaterial.getName());
    expect(authoredMaterial.getBaseColorFactor()).toEqual(sourceMaterial.getBaseColorFactor());
    expect(authoredMaterial.getRoughnessFactor()).toBe(sourceMaterial.getRoughnessFactor());
    expect(authoredMaterial.getMetallicFactor()).toBe(sourceMaterial.getMetallicFactor());
    expect(authoredMaterial.getEmissiveFactor()).toEqual(sourceMaterial.getEmissiveFactor());
    expect(authoredMaterial.getRoughnessFactor()).toBe(0.94);
    expect(authoredMaterial.getMetallicFactor()).toBe(0);
  });

  it.each(REPLACEMENTS)("keeps $id vertex attributes finite and shading normals unit length", ({ id }) => {
    const output = singlePrimitive(generatedDocuments.get(id)!);
    for (const semantic of ["POSITION", "NORMAL", "COLOR_0", "TEXCOORD_0"]) {
      expect(Array.from(output.getAttribute(semantic)!.getArray()!).every(Number.isFinite), semantic).toBe(true);
    }
    const outputNormals = triangleCorners(output, "NORMAL");
    let greatestLengthError = 0;
    for (let corner = 0; corner < outputNormals.length; corner++) {
      const actual = new Vector3().fromArray(outputNormals[corner]!);
      greatestLengthError = Math.max(greatestLengthError, Math.abs(actual.length() - 1));
    }
    expect(greatestLengthError).toBeLessThan(0.000001);
  });

  it.each(REPLACEMENTS)("projects $id UVs in metres using authored face orientation", ({ id }) => {
    const output = singlePrimitive(generatedDocuments.get(id)!);
    const positions = triangleCorners(output, "POSITION");
    const uvs = triangleCorners(output, "TEXCOORD_0");
    let greatestUvError = 0;
    const projection = (normal: Vector3): [number, number] => Math.abs(normal.y) > 0.7
      ? [0, 2] : Math.abs(normal.x) > 0.7 ? [2, 1] : [0, 1];
    for (let offset = 0; offset < positions.length; offset += 3) {
      const authoredNormal = faceNormal(positions, offset);
      const axes = projection(authoredNormal);
      // Float32 positions can put a threshold face just across the double-precision decision.
      if (Math.abs(Math.abs(authoredNormal.y) - 0.7) < 0.00005
        || Math.abs(Math.abs(authoredNormal.x) - 0.7) < 0.00005) continue;
      for (let corner = offset; corner < offset + 3; corner++) {
        for (let channel = 0; channel < 2; channel++) {
          greatestUvError = Math.max(greatestUvError,
            Math.abs(uvs[corner]![channel]! - positions[corner]![axes[channel]!]!));
        }
      }
    }
    expect(greatestUvError).toBeLessThan(0.000001);
  });

  it("gives Sunder one off-centre western high region and a joined lower eastern shoulder", () => {
    const replacement = REPLACEMENTS[0];
    const corners = triangleCorners(singlePrimitive(generatedDocuments.get(SUNDER_ID)!), "POSITION");
    const skyline = Array.from({ length: 61 }, (_, index) => {
      const x = replacement.base.x + (index + 0.5) / 61 * replacement.size.x;
      return { x, height: skylineHeight(corners, x) - replacement.base.y };
    });
    const peak = skyline.reduce((highest, sample) => sample.height > highest.height ? sample : highest);
    const elevatedRegions = [0.55, 0.80].map(fraction => {
      const regions: { startX: number; endX: number; peakHeight: number }[] = [];
      // A shallow chip can dip across the lower contour without creating another tower.
      // Allow 0.15 m of erosion there; the high crown's 80% contour stays exact.
      const notchTolerance = fraction === 0.55 ? 0.15 : 0;
      let insideRegion = false;
      for (let index = 0; index < skyline.length; index++) {
        const sample = skyline[index]!;
        if (sample.height <= replacement.size.y * fraction - (insideRegion ? notchTolerance : 0)) {
          insideRegion = false;
          continue;
        }
        if (!insideRegion) {
          regions.push({ startX: sample.x, endX: sample.x, peakHeight: sample.height });
          insideRegion = true;
        } else {
          const region = regions.at(-1)!;
          region.endX = sample.x;
          region.peakHeight = Math.max(region.peakHeight, sample.height);
        }
      }
      return regions;
    });
    const highRegions = elevatedRegions.map(regions => regions.length);
    const shoulder = [1.4, 2, 2.6].map(x => skylineHeight(corners, x) - replacement.base.y);
    const middle = [-1.5, -0.75, 0, 0.75, 1.5].map(x => skylineHeight(corners, x) - replacement.base.y);
    const measured = JSON.stringify({ peak, highRegions, elevatedRegions, shoulder, middle });
    expect(peak.x, measured).toBeLessThan(replacement.translation[0] - replacement.size.x * 0.06);
    expect(highRegions, measured).toEqual([1, 1]);
    expect(Math.max(...shoulder), measured).toBeLessThan(replacement.size.y * 0.80);
    expect(Math.min(...shoulder), measured).toBeGreaterThan(replacement.size.y * 0.30);
    expect(Math.min(...middle), measured).toBeGreaterThan(replacement.size.y * 0.35);
  });

  it.each(REPLACEMENTS)("keeps $id a broad connected body above its ground foot", ({ id }) => {
    const corners = triangleCorners(singlePrimitive(generatedDocuments.get(id)!), "POSITION");
    const continuity = bodyContinuity(corners, generatedAssets.get(id)!.entry);
    const measured = JSON.stringify(continuity);
    expect(continuity.occupiedCells, measured).toBeGreaterThan(0);
    expect(continuity.largestFraction, measured).toBeGreaterThan(0.90);
    expect(continuity.footprintFraction, measured).toBeGreaterThan(0.15);
    expect(continuity.widthFraction, measured).toBeGreaterThan(0.55);
    expect(continuity.depthFraction, measured).toBeGreaterThan(0.35);
  });

  it.each(REPLACEMENTS)("gives $id exposed fracture undersides above the buried base", ({ id, base, size }) => {
    const corners = triangleCorners(singlePrimitive(generatedDocuments.get(id)!), "POSITION");
    let exposedUndersideArea = 0;
    for (let offset = 0; offset < corners.length; offset += 3) {
      const a = new Vector3().fromArray(corners[offset]!);
      const b = new Vector3().fromArray(corners[offset + 1]!);
      const c = new Vector3().fromArray(corners[offset + 2]!);
      const normal = b.clone().sub(a).cross(c.clone().sub(a));
      const area = normal.length() / 2;
      normal.normalize();
      const centre = a.clone().add(b).add(c).multiplyScalar(1 / 3);
      const height = centre.y - base.y;
      if (height < 0.4 || height > size.y * 0.88 || normal.y >= -0.18) continue;
      const hits = surfaceHits(corners, [0, 2], [centre.x, centre.z], 1);
      const below = hits.filter(y => y < centre.y - 0.012);
      const airGap = centre.y - (below.length ? Math.max(...below) : base.y);
      if (airGap > 0.08) exposedUndersideArea += area * -normal.y;
    }
    const measured = JSON.stringify({ exposedUndersideArea });
    expect(exposedUndersideArea, measured).toBeGreaterThan(0.08);
  });

  it.each(REPLACEMENTS)("clears the player footprint and headroom at $id's authored approach", (replacement) => {
    const corners = triangleCorners(singlePrimitive(generatedDocuments.get(replacement.id)!), "POSITION");
    const approach = new Vector3(replacement.approach[0] - replacement.entrance[0], 0,
      replacement.approach[1] - replacement.entrance[2])
      .normalize().multiplyScalar(1.9);
    const cosine = Math.cos(replacement.rotationY), sine = Math.sin(replacement.rotationY);
    const footprint = [[0, 0], ...[0.175, 0.35].flatMap(radius =>
      Array.from({ length: 16 }, (_, index) => [
        Math.cos(index / 16 * Math.PI * 2) * radius, Math.sin(index / 16 * Math.PI * 2) * radius,
      ]))];
    const ground = -replacement.entrance[1] / replacement.scale;
    const minimumClearance = replacement.base.y + 0.15;
    const headHeight = ground + 1.8 / replacement.scale;
    const intrusions: { x: number; z: number; crossings: SurfaceCrossing[]; enclosed: boolean }[] = [];
    for (const [dx, dz] of footprint) {
      // Decoded vertices include their placement translation. Undo only the world transform.
      const x = ((approach.x + dx!) * cosine - (approach.z + dz!) * sine) / replacement.scale;
      const z = ((approach.x + dx!) * sine + (approach.z + dz!) * cosine) / replacement.scale;
      const crossings = uniqueCrossings(surfaceCrossings(corners, [0, 2], [x, z], 1));
      const actorSurfaces = crossings.filter(hit => hit.position > minimumClearance && hit.position < headHeight);
      const enclosed = solidAtHeight(crossings, (minimumClearance + headHeight) / 2);
      if (actorSurfaces.length || enclosed) intrusions.push({ x, z, crossings, enclosed });
    }
    expect(intrusions, JSON.stringify({ intrusions, minimumClearance, headHeight })).toEqual([]);
  });

  it("gives Scree Slide a descending body from its rear crest to the rubble fan", () => {
    const replacement = REPLACEMENTS[1];
    const corners = triangleCorners(singlePrimitive(generatedDocuments.get(replacement.id)!), "POSITION");
    // Sample the visible envelope across each band. Detached fragments may leave gaps.
    const heights = [-0.50, 0.12, 0.48, 0.78].map(z => {
      const localZ = z * replacement.size.z / 2 + replacement.translation[2];
      const band = Array.from({ length: 17 }, (_, index) => {
        const x = -replacement.size.x * 0.43 + index / 16 * replacement.size.x * 0.86;
        return surfaceRange(corners, [0, 2], [x, localZ], 1)[1];
      });
      return Math.max(...band);
    });
    expect(heights.every(Number.isFinite), JSON.stringify(heights)).toBe(true);
    for (let level = 1; level < heights.length; level++) {
      expect(heights[level - 1]! - heights[level]!, JSON.stringify(heights)).toBeGreaterThan(0.25);
    }
    expect(heights[0]! - heights.at(-1)!, JSON.stringify(heights)).toBeGreaterThan(2);
  });

  it.each(REPLACEMENTS)("preserves $id collision, entry, route direction and crossing duration", async (replacement) => {
    const manifest = JSON.parse(await readFile(path.join(repoRoot, "game/public/assets/manifest.json"), "utf8")) as {
      assets: AssetEntry[];
    };
    const assets = new Map(manifest.assets.map((entry) => [entry.id, entry]));
    const oldLedge = assets.get(replacement.legacyId)!;
    expect(oldLedge.base).toEqual(replacement.base);
    expect(oldLedge.size).toEqual(replacement.size);
    const portsFor = (ledge: AssetEntry): WorldPorts => {
      const asset = (id: string): AssetEntry | undefined => id === oldLedge.id || id === replacement.id
        ? ledge : assets.get(id);
      return {
        heightAt: () => 0,
        baseY: (id) => asset(id)?.base?.y ?? 0,
        assetSize: (id) => asset(id)?.size ?? null,
        assetCenterXZ: (id) => {
          const entry = asset(id);
          return entry ? {
            x: (entry.base?.x ?? 0) + entry.size.x / 2,
            z: (entry.base?.z ?? 0) + entry.size.z / 2,
          } : null;
        },
      };
    };
    const beforePorts = portsFor(oldLedge);
    const afterPorts = portsFor(generatedAssets.get(replacement.id)!.entry);
    const beforeCollider = assetSolidFromMeasurements(replacement.entityId, replacement.entrance, oldLedge.id,
      replacement.scale, replacement.rotationY, true,
      { assetSize: beforePorts.assetSize!, assetCenterXZ: beforePorts.assetCenterXZ! });
    const afterCollider = assetSolidFromMeasurements(replacement.entityId, replacement.entrance, replacement.id,
      replacement.scale, replacement.rotationY, true,
      { assetSize: afterPorts.assetSize!, assetCenterXZ: afterPorts.assetCenterXZ! });
    expect(beforeCollider).not.toBeNull();
    expect(afterCollider).toEqual(beforeCollider);
    if (replacement.entityId === "sunder_ledge") {
      expect(afterCollider).toEqual({
        kind: "box", id: "sunder_ledge", position: [170.17, 0.23, -73.47],
        size: [2.27, 5.34, 1.64], rotationY: 0.4,
      });
    }

    const before = buildWorld(1337, () => 0, beforePorts);
    const after = buildWorld(1337, () => 0, afterPorts);
    const beforeEntity = before.entities.find((entity) => entity.id === replacement.entityId)!;
    const afterEntity = after.entities.find((entity) => entity.id === replacement.entityId)!;
    expect(afterEntity).toEqual(beforeEntity);
    expect(afterEntity).toMatchObject({
      position: [...replacement.entrance], interactions: ["inspect", "climb"],
      view: { scale: replacement.scale },
      obstacle: {
        reqLevel: replacement.reqLevel, exitPosition: [...replacement.exit],
        durationMs: replacement.durationMs, savesMeters: replacement.savesMeters,
      },
      meta: { oneWay: replacement.oneWay },
    });
    expect(afterEntity.view?.rotationY ?? 0).toBe(replacement.rotationY);
    const oldEdges = before.routeEdges.filter((edge) => edge.obstacleId === replacement.entityId);
    const newEdges = after.routeEdges.filter((edge) => edge.obstacleId === replacement.entityId);
    expect(newEdges).toEqual(oldEdges);
    expect(newEdges).toHaveLength(replacement.oneWay ? 1 : 2);
    expect(newEdges[0]).toMatchObject({
      from: replacement.from, to: replacement.to,
      entrance: [...replacement.entrance], exit: [...replacement.exit],
    });
    for (const edge of newEdges) {
      expect(edge).toMatchObject({
        kind: "shortcut", durationMs: replacement.durationMs, reqLevel: replacement.reqLevel,
      });
      expect(resolveShortcutEndpoints(afterEntity, edge.entrance!, edge.exit!, { closestPoint: (point) => point }))
        .toEqual({ entryPosition: edge.entrance, exitPosition: edge.exit });
    }
    expect(agilityDurationOf(afterEntity)).toBe(replacement.durationMs);
  });
});

describe("geology generation staging options", () => {
  it("accepts readonly exact-ID staging arguments without changing the supplied array", () => {
    const args = Object.freeze(["--only", SUNDER_ID, "--out", "test-results/sunder-ledge/source"]);
    const options = parseGeologyBuildOptions(args);
    expect(options.only).toEqual([SUNDER_ID]);
    expect(geologyOutputPaths(options.out)).toEqual({
      modelsDirectory: path.join(repoRoot, "test-results/sunder-ledge/source/models/corealm/geology"),
      catalogFile: path.join(repoRoot, "test-results/sunder-ledge/source/corealm-geology.json"),
    });
    expect(args).toEqual(["--only", SUNDER_ID, "--out", "test-results/sunder-ledge/source"]);
  });

  it("keeps legacy default destinations and subset switches", () => {
    expect(geologyOutputPaths()).toEqual({
      modelsDirectory: path.join(repoRoot, "game/public/assets/models/corealm/geology"),
      catalogFile: path.join(repoRoot, "tools/data/corealm-geology.json"),
    });
    expect(parseGeologyBuildOptions(["--ores-only"]).oresOnly).toBe(true);
    expect(parseGeologyBuildOptions(["--representative"]).representative).toBe(true);
    expect(parseGeologyBuildOptions(["--only", `${SOURCE_ID},corealm_cliff_strata_2`]).only)
      .toEqual([SOURCE_ID, "corealm_cliff_strata_2"]);
    expect(parseGeologyBuildOptions(["--only", REPLACEMENTS.map(({ id }) => id).join(",")]).only)
      .toEqual(REPLACEMENTS.map(({ id }) => id));
  });

  it("rejects explicit public output and paths that escape the staging root", () => {
    for (const output of [
      "game/public/assets", "tools/data", "test-results-other/sunder", "test-results/../game/public/assets",
      path.join(repoRoot, "../outside-geology-stage"), path.parse(repoRoot).root,
    ]) {
      expect(() => geologyOutputPaths(output), output).toThrow();
      expect(() => parseGeologyBuildOptions(["--only", SUNDER_ID, "--out", output]), output).toThrow();
    }
    expect(geologyOutputPaths(path.join(repoRoot, "test-results/sunder-ledge/absolute"))).toEqual({
      modelsDirectory: path.join(repoRoot, "test-results/sunder-ledge/absolute/models/corealm/geology"),
      catalogFile: path.join(repoRoot, "test-results/sunder-ledge/absolute/corealm-geology.json"),
    });
  });

  it("rejects malformed options and unknown source IDs", async () => {
    for (const args of [
      ["--out"], ["--only"], ["--only", ""], ["--unknown"], ["--out", "--only", SUNDER_ID],
      ["--only", `${SUNDER_ID},${SUNDER_ID}`], ["--only", "corealm_no_such_ledge"],
      ["--only", SUNDER_ID, "--ores-only"], ["--ores-only", "--representative"],
      ["--out", "test-results/one", "--out", "test-results/two"],
    ]) {
      expect(() => parseGeologyBuildOptions(args), args.join(" ")).toThrow();
    }
    await expect(buildGeologyAsset("corealm_no_such_ledge")).rejects.toThrow();
  });
});
