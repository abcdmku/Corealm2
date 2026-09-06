import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { NodeIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS, type IOR, type Iridescence, type Transmission, type Volume } from "@gltf-transform/extensions";
import sharp from "sharp";
import { Ray, Triangle, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { itemIconAppearance } from "../game/src/render/itemIconAppearances.js";
import {
  buildMineralItemAsset, MINERAL_ITEM_ASSET_IDS, MINERAL_ITEM_IDS, mineralItemOutputPaths,
  type MineralItemEntry,
} from "../tools/build-corealm-minerals.js";

const ITEMS = ["grithe_ore", "corven_ore", "kaldite_ore", "emberite_ore", "pale_quartz", "vell_amber", "cairn_garnet", "fire_opal"];
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
// Root accepted seven specimens after the v6/v7 production browser reviews.
// Only opal remains under revision; preserve the exact accepted bytes.
const ACCEPTED_SPECIMEN_SHA256 = {
  corealm_item_grithe_ore: "b8be5d4c1206d04a0d6807fba82fd1cccc48113367a2fe7d152f3266ff8b9106",
  corealm_item_corven_ore: "e9556dc796e75cb5556ce0bf91ba70b2f8ffdda4ac9d3f48bbbeb1bc47dd266b",
  corealm_item_kaldite_ore: "9d3d195c764699c6f3631761ea23b5a8c53abf884a3b00d255c4628d1cf8c4b4",
  corealm_item_emberite_ore: "2e3ff92e7138bc6387ddea040c7c944094f717526e9b876b337e044cb565d8a4",
  corealm_item_pale_quartz: "70d6e032e386d440651580d8f84a3541e777fbb834d86d8943d3b7a7bf9f0284",
  corealm_item_vell_amber: "62e54d611aa942b0bc9a8f20bc1d3a5fe16d314194a70b42279984927f4e7b0e",
  corealm_item_cairn_garnet: "06b0559344d4fdc80b059755a5902fd79e3a48fa1a959a7d24c6f165ae17026e",
} as const;
type SurfaceTriangle = { points: [Vector3, Vector3, Vector3]; material: string };
const pointKey = (point: Vector3): string => point.toArray().map(value => Math.round(value * 1e6)).join(",");
const edgeKey = (a: Vector3, b: Vector3): string => [pointKey(a), pointKey(b)].sort().join("|");

function surfaceTriangles(document: Document): SurfaceTriangle[] {
  return document.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives()).flatMap(primitive => {
    const positions = primitive.getAttribute("POSITION")!, indices = primitive.getIndices();
    const triangles: SurfaceTriangle[] = [];
    for (let offset = 0; offset < (indices?.getCount() ?? positions.getCount()); offset += 3) {
      triangles.push({
        points: [0, 1, 2].map(corner => new Vector3().fromArray(positions.getElement(
          indices?.getScalar(offset + corner) ?? offset + corner, [],
        ))) as [Vector3, Vector3, Vector3],
        material: primitive.getMaterial()!.getName(),
      });
    }
    return triangles;
  });
}

/** Material primitives can split one closed body, so connect by geometric edges. */
function connectedSurfaces(triangles: SurfaceTriangle[]): SurfaceTriangle[][] {
  const edges = new Map<string, number[]>();
  triangles.forEach(({ points }, index) => {
    for (let corner = 0; corner < 3; corner++) {
      const key = edgeKey(points[corner]!, points[(corner + 1) % 3]!);
      const adjacent = edges.get(key) ?? [];
      adjacent.push(index); edges.set(key, adjacent);
    }
  });
  const visited = new Set<number>(), components: SurfaceTriangle[][] = [];
  for (let start = 0; start < triangles.length; start++) {
    if (visited.has(start)) continue;
    const pending = [start], component: SurfaceTriangle[] = [];
    while (pending.length) {
      const index = pending.pop()!;
      if (visited.has(index)) continue;
      visited.add(index);
      const triangle = triangles[index]!;
      component.push(triangle);
      for (let corner = 0; corner < 3; corner++) {
        for (const neighbour of edges.get(edgeKey(triangle.points[corner]!, triangle.points[(corner + 1) % 3]!))!) {
          if (!visited.has(neighbour)) pending.push(neighbour);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/** Odd/even ray intersections work for a sculpted, nonconvex host. */
function insideSurface(point: Vector3, triangles: SurfaceTriangle[]): boolean {
  const ray = new Ray(point, new Vector3(1, 0.271, 0.613).normalize()), hit = new Vector3();
  const distances: number[] = [];
  for (const { points: [a, b, c] } of triangles) {
    if (ray.intersectTriangle(a, b, c, false, hit)) {
      const distance = point.distanceTo(hit);
      if (distance < 1e-5) return false;
      if (!distances.some(existing => Math.abs(existing - distance) < 1e-7)) distances.push(distance);
    }
  }
  return distances.length % 2 === 1;
}

/** Principal volume moments measure thickness independently of pose or tessellation. */
function solidThickness(triangles: SurfaceTriangle[]): { volume: number; ratio: number } {
  let volume = 0;
  const first = [0, 0, 0], second = Array<number>(9).fill(0);
  for (const { points } of triangles) {
    const tetraVolume = points[0].dot(points[1].clone().cross(points[2])) / 6;
    const sums = points.reduce((sum, point) => sum.add(point), new Vector3()).toArray();
    volume += tetraVolume;
    for (let row = 0; row < 3; row++) {
      first[row]! += tetraVolume * sums[row]! / 4;
      for (let column = 0; column < 3; column++) {
        const products = points.reduce((sum, point) => sum + point.getComponent(row) * point.getComponent(column), 0);
        second[row * 3 + column]! += tetraVolume * (sums[row]! * sums[column]! + products) / 20;
      }
    }
  }
  const centre = first.map(value => value / volume);
  const covariance = second.map((value, index) => value / volume - centre[Math.floor(index / 3)]! * centre[index % 3]!);
  const [a, b, c, , d, e, , , f] = covariance;
  const mean = (a! + d! + f!) / 3;
  const spread = Math.sqrt(((a! - mean) ** 2 + (d! - mean) ** 2 + (f! - mean) ** 2 + 2 * (b! ** 2 + c! ** 2 + e! ** 2)) / 6);
  if (spread < 1e-12) return { volume, ratio: 1 };
  const x = (a! - mean) / spread, y = (d! - mean) / spread, z = (f! - mean) / spread;
  const u = b! / spread, v = c! / spread, w = e! / spread;
  const halfDeterminant = (x * y * z + 2 * u * v * w - x * w * w - y * v * v - z * u * u) / 2;
  const angle = Math.acos(Math.max(-1, Math.min(1, halfDeterminant))) / 3;
  const largest = mean + 2 * spread * Math.cos(angle);
  const smallest = mean + 2 * spread * Math.cos(angle + 2 * Math.PI / 3);
  return { volume, ratio: Math.sqrt(smallest / largest) };
}

describe("inventory mineral source assets", () => {
  let specimens: Array<{ document: Document; entry: MineralItemEntry; glb: Uint8Array }>;
  beforeAll(async () => {
    specimens = await Promise.all(MINERAL_ITEM_ASSET_IDS.map(async id => {
      const asset = await buildMineralItemAsset(id);
      return { ...asset, document: await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(asset.glb) };
    }));
  });

  it("regenerates all seven accepted specimens byte-for-byte while opal is revised", () => {
    for (const [assetId, acceptedHash] of Object.entries(ACCEPTED_SPECIMEN_SHA256)) {
      const specimen = specimens.find(({ entry }) => entry.id === assetId)!;
      expect(specimen, assetId).toBeTruthy();
      expect(hash(specimen.glb), assetId).toBe(acceptedHash);
    }
  });

  it("covers the four ores and four gems with eight independent, grounded specimen silhouettes", () => {
    expect(MINERAL_ITEM_IDS).toEqual(ITEMS);
    const geometryHashes = new Set<string>();
    for (const { document, entry, glb } of specimens) {
      expect(entry.file).toBe(`models/corealm/minerals/${entry.id}.glb`);
      expect(entry.pack).toBe("corealm-original-minerals");
      expect(entry.sha256).toBe(hash(glb));
      expect(entry.bytes).toBe(glb.byteLength);
      const positions = document.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives())
        .flatMap(primitive => Array.from(primitive.getAttribute("POSITION")!.getArray()!));
      geometryHashes.add(hash(new Uint8Array(new Float32Array(positions).buffer)));
      const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < positions.length; i++) {
        minimum[i % 3] = Math.min(minimum[i % 3]!, positions[i]!);
        maximum[i % 3] = Math.max(maximum[i % 3]!, positions[i]!);
      }
      expect(minimum[1], entry.id).toBeCloseTo(0, 6);
      for (const [axis, key] of (["x", "y", "z"] as const).entries()) {
        expect(maximum[axis]! - minimum[axis]!, entry.id).toBeCloseTo(entry.size[key], 6);
        expect(minimum[axis]!, entry.id).toBeCloseTo(entry.base[key], 6);
        expect(entry.size[key]).toBeGreaterThan(0.05);
        expect(entry.size[key]).toBeLessThan(0.5);
      }
      expect(document.getRoot().listNodes()).toHaveLength(1);
      expect(document.getRoot().listNodes()[0]!.getScale()).toEqual([1, 1, 1]);
      expect(document.getRoot().listAnimations()).toHaveLength(0);
      expect(document.getRoot().listSkins()).toHaveLength(0);
    }
    expect(geometryHashes.size).toBe(8);
  });

  it("exports finite unit normals, outward triangle winding and closed surfaces across material seams", () => {
    for (const { document, entry } of specimens) {
      const edges = new Map<string, number>();
      let signedVolume = 0, triangles = 0;
      let minAreaSquared = Infinity, maxNormalLengthError = 0, minNormalDot = Infinity;
      const key = (point: number[]): string => point.map(value => Math.round(value * 1e6)).join(",");
      for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
        for (const attribute of primitive.listAttributes()) expect(Array.from(attribute.getArray()!).every(Number.isFinite)).toBe(true);
        const positions = primitive.getAttribute("POSITION")!, normals = primitive.getAttribute("NORMAL")!;
        const indices = primitive.getIndices();
        expect(primitive.getAttribute("COLOR_0")).not.toBeNull();
        expect(primitive.getAttribute("TEXCOORD_0")).not.toBeNull();
        const count = indices?.getCount() ?? positions.getCount();
        for (let offset = 0; offset < count; offset += 3) {
          const ids = [0, 1, 2].map(corner => indices?.getScalar(offset + corner) ?? offset + corner);
          const points = ids.map(index => positions.getElement(index, []));
          const [a, b, c] = points.map(point => new Vector3().fromArray(point));
          const area = b!.clone().sub(a!).cross(c!.clone().sub(a!));
          minAreaSquared = Math.min(minAreaSquared, area.lengthSq());
          signedVolume += a!.dot(b!.clone().cross(c!)) / 6;
          area.normalize();
          for (const index of ids) {
            const normal = new Vector3().fromArray(normals.getElement(index, []));
            maxNormalLengthError = Math.max(maxNormalLengthError, Math.abs(normal.length() - 1));
            minNormalDot = Math.min(minNormalDot, normal.dot(area));
          }
          for (let corner = 0; corner < 3; corner++) {
            const edge = [key(points[corner]!), key(points[(corner + 1) % 3]!)].sort().join("|");
            edges.set(edge, (edges.get(edge) ?? 0) + 1);
          }
          triangles++;
        }
      }
      expect(signedVolume, entry.id).toBeGreaterThan(0.0001);
      // Check every triangle while avoiding hundreds of thousands of assertion wrappers.
      expect(minAreaSquared, `${entry.id} degenerate triangle`).toBeGreaterThan(0);
      expect(maxNormalLengthError, `${entry.id} non-unit normal`).toBeLessThan(0.000005);
      expect(minNormalDot, `${entry.id} reversed normal`).toBeGreaterThan(0.60);
      expect(triangles).toBe(entry.triangles);
      const open = [...edges.values()].filter(count => count !== 2);
      expect(open, `${entry.id} open/nonmanifold triangle edges`).toHaveLength(0);
    }
  });

  it("separates fresh mineral specular response from host rock and preserves physical gem materials", () => {
    for (const [index, { document, entry }] of specimens.entries()) {
      const materials = document.getRoot().listMaterials();
      for (const material of materials) {
        expect(material.getBaseColorFactor().every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 1)).toBe(true);
        expect(material.getEmissiveFactor()).toEqual([0, 0, 0]);
        expect(material.getDoubleSided()).toBe(false);
      }
      if (index < 4) {
        const host = materials.find(material => material.getName() === "Corealm weathered strata")!;
        const mineral = materials.find(material => /^Corealm exposed .* mineral$/.test(material.getName()))!;
        expect(host, entry.id).toBeTruthy();
        expect(mineral, entry.id).toBeTruthy();
        expect(materials.some(material => material.getName() === "Corealm mineral seam")).toBe(false);
        expect(host.getMetallicFactor()).toBe(0);
        expect(host.getRoughnessFactor()).toBe(0.94);
        expect(mineral.getMetallicFactor()).toBeGreaterThanOrEqual(0.5);
        expect(mineral.getMetallicFactor()).toBeLessThanOrEqual(0.8);
        expect(mineral.getRoughnessFactor()).toBeGreaterThan(0);
        expect(mineral.getRoughnessFactor()).toBeLessThan(host.getRoughnessFactor() / 2);
        expect(materials.every(material => material.getAlphaMode() === "OPAQUE")).toBe(true);
        expect(entry.surfaceTriangles.host).toBeGreaterThan(0);
        expect(entry.surfaceTriangles.mineral).toBeGreaterThan(0);
      } else {
        const gem = materials.find(material => material.getName().endsWith("dielectric"))!;
        expect(gem, entry.id).toBeTruthy();
        expect(materials.every(material => material.getMetallicFactor() === 0)).toBe(true);
        expect(gem.getAlphaMode()).toBe("OPAQUE");
        expect(gem.getRoughnessFactor()).toBeGreaterThan(0);
        expect(gem.getRoughnessFactor()).toBeLessThan(0.4);
        const transmission = gem.getExtension<Transmission>("KHR_materials_transmission");
        const volume = gem.getExtension<Volume>("KHR_materials_volume");
        const ior = gem.getExtension<IOR>("KHR_materials_ior");
        expect(transmission, entry.id).not.toBeNull();
        expect(volume, entry.id).not.toBeNull();
        expect(ior, entry.id).not.toBeNull();
        expect(transmission!.getTransmissionFactor()).toBeGreaterThan(0);
        expect(transmission!.getTransmissionFactor()).toBeLessThanOrEqual(1);
        expect(Number.isFinite(volume!.getThicknessFactor())).toBe(true);
        expect(volume!.getThicknessFactor()).toBeGreaterThan(0);
        expect(volume!.getAttenuationColor().every(channel => Number.isFinite(channel) && channel > 0 && channel <= 1)).toBe(true);
        expect(Number.isFinite(volume!.getAttenuationDistance())).toBe(true);
        expect(volume!.getAttenuationDistance()).toBeGreaterThan(0);
        expect(ior!.getIOR()).toBeGreaterThan(1);
        expect(ior!.getIOR()).toBeLessThan(2.5);
        expect(gem.getNormalTexture()?.getImage()?.byteLength).toBeGreaterThan(100);
        expect(gem.getMetallicRoughnessTexture()?.getImage()?.byteLength).toBeGreaterThan(100);
        expect(document.getRoot().listTextures().length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("joins exposed ore to the fracture body and roots additional growth inside that actual body", () => {
    for (const { document, entry } of specimens.slice(0, 4)) {
      const components = connectedSurfaces(surfaceTriangles(document));
      const body = components.find(component => component.some(triangle => triangle.material === "Corealm weathered strata"))!;
      expect(body, `${entry.id} fracture body`).toBeTruthy();
      const boundaries = new Map<string, { materials: Set<string>; length: number }>();
      for (const { points, material } of body) {
        for (let corner = 0; corner < 3; corner++) {
          const a = points[corner]!, b = points[(corner + 1) % 3]!, key = edgeKey(a, b);
          const boundary = boundaries.get(key) ?? { materials: new Set<string>(), length: a.distanceTo(b) };
          boundary.materials.add(material); boundaries.set(key, boundary);
        }
      }
      const sharedBoundaryLength = [...boundaries.values()].filter(({ materials }) =>
        materials.size > 1 && [...materials].some(material => /^Corealm exposed .* mineral$/.test(material)),
      ).reduce((sum, boundary) => sum + boundary.length, 0);
      expect(sharedBoundaryLength, `${entry.id} mineral exposure must share edges with the body`).toBeGreaterThan(0.02);
      for (const [index, growth] of components.entries()) {
        if (growth === body) continue;
        const vertices = [...new Map(growth.flatMap(triangle => triangle.points).map(point => [pointKey(point), point])).values()];
        expect(vertices.some(point => insideSurface(point, body)), `${entry.id} growth ${index} has no buried vertex`).toBe(true);
      }
    }
  });

  it("contains quartz and amber inclusions while leaving garnet and opal free of opaque interior plates", () => {
    for (const { document, entry } of specimens.slice(4)) {
      const triangles = surfaceTriangles(document);
      const shell = triangles.filter(triangle => triangle.material.endsWith("dielectric"));
      const internal = triangles.filter(triangle => /(?:cloud|inclusion|film)/.test(triangle.material));
      // Cortex can close part of a shell, and companion crystals may overlap it.
      const outerBodies = connectedSurfaces(triangles.filter(triangle => !/(?:cloud|inclusion|film)/.test(triangle.material)));
      expect(shell.length, `${entry.id} shell`).toBeGreaterThan(0);
      if (entry.itemId === "pale_quartz" || entry.itemId === "vell_amber") {
        expect(internal.length, `${entry.id} internal structure`).toBeGreaterThan(0);
      } else {
        // The production rejection showed that opaque inner cores and sheets read as solid cutouts.
        // Garnet and opal depth now comes from their absorbing transmitted volume, checked above.
        expect(internal, `${entry.id} opaque interior plates`).toHaveLength(0);
      }
      if (entry.itemId === "vell_amber") {
        expect(triangles.every(triangle => triangle.material.endsWith("dielectric") || triangle.material.endsWith("internal inclusion"))).toBe(true);
      }
      for (const [index, component] of connectedSurfaces(internal).entries()) {
        const centre = component.reduce((sum, triangle) => sum.add(new Triangle(...triangle.points).getMidpoint(new Vector3())), new Vector3())
          .divideScalar(component.length);
        expect(outerBodies.some(body => insideSurface(centre, body)), `${entry.id} internal component ${index} is outside the gem`).toBe(true);
      }
    }
  });

  it("shares a continuous smooth contour between the opal lens and its matrix", () => {
    const specimen = specimens.find(({ entry }) => entry.itemId === "fire_opal")!;
    const edges = new Map<string, { points: [Vector3, Vector3]; materials: Set<string> }>();
    for (const triangle of surfaceTriangles(specimen.document)) for (let i = 0; i < 3; i++) {
      const a = triangle.points[i]!, b = triangle.points[(i + 1) % 3]!, key = edgeKey(a, b);
      const edge = edges.get(key) ?? { points: [a, b], materials: new Set<string>() };
      edge.materials.add(triangle.material); edges.set(key, edge);
    }
    const contour = [...edges.values()].filter(edge => edge.materials.has("Corealm weathered strata")
      && [...edge.materials].some(material => material.endsWith("dielectric")));
    expect(contour.length).toBeGreaterThan(30);
    const vertices = new Map<string, { point: Vector3; neighbours: Vector3[] }>();
    for (const { points: [a, b] } of contour) for (const [p, neighbour] of [[a, b], [b, a]] as const) {
      const key = pointKey(p), vertex = vertices.get(key) ?? { point: p, neighbours: [] };
      vertex.neighbours.push(neighbour); vertices.set(key, vertex);
    }
    for (const { point, neighbours } of vertices.values()) {
      expect(neighbours).toHaveLength(2);
      const a = neighbours[0]!.clone().sub(point).normalize(), b = neighbours[1]!.clone().sub(point).normalize();
      // Whole-triangle masks produce repeated acute sawteeth; a authored continuous edge does not.
      expect(a.dot(b), "opal contour zigzag").toBeLessThan(-0.90);
    }
  });

  it("keeps amber inclusions small and fully enclosed by the transmitting shell", () => {
    const specimen = specimens.find(({ entry }) => entry.itemId === "vell_amber")!;
    const triangles = surfaceTriangles(specimen.document);
    const shell = triangles.filter(triangle => triangle.material.endsWith("dielectric"));
    const inclusions = triangles.filter(triangle => triangle.material.endsWith("internal inclusion"));
    const shellVolume = solidThickness(shell).volume;
    const inclusionVolume = connectedSurfaces(inclusions).reduce((sum, component) => sum + solidThickness(component).volume, 0);
    // A centre-only containment test misses a large opaque insert poking through the shell.
    // Check every unique inclusion vertex and limit the total opaque volume to one percent.
    expect(inclusionVolume).toBeGreaterThan(0);
    expect(inclusionVolume / shellVolume).toBeLessThan(0.01);
    const vertices = new Map(inclusions.flatMap(triangle => triangle.points).map(point => [pointKey(point), point]));
    for (const point of vertices.values()) expect(insideSurface(point, shell), `exposed amber inclusion at ${pointKey(point)}`).toBe(true);
  });

  it("keeps the opal exposure below surrounding matrix ridges instead of a raised button", () => {
    const specimen = specimens.find(({ entry }) => entry.itemId === "fire_opal")!;
    const triangles = surfaceTriangles(specimen.document);
    const gem = triangles.filter(triangle => triangle.material.endsWith("dielectric"));
    const host = triangles.filter(triangle => triangle.material === "Corealm weathered strata");
    // Area-weighted normal of the open gem patch measures outward relief independently of pose.
    const normal = gem.reduce((sum, { points: [a, b, c] }) =>
      sum.add(b.clone().sub(a).cross(c.clone().sub(a))), new Vector3()).normalize();
    const gemMax = Math.max(...gem.flatMap(triangle => triangle.points.map(point => point.dot(normal))));
    const hostMax = Math.max(...host.flatMap(triangle => triangle.points.map(point => point.dot(normal))));
    expect(hostMax - gemMax, "opal protrudes above its surrounding matrix").toBeGreaterThan(0.002);
  });

  it("gives opal continuous optical domains through a real thickness texture", async () => {
    const specimen = specimens.find(({ entry }) => entry.itemId === "fire_opal")!;
    const primitive = specimen.document.getRoot().listMeshes()[0]!.listPrimitives()
      .find(part => part.getMaterial()!.getName().endsWith("dielectric"))!;
    const optical = primitive.getMaterial()!.getExtension<Iridescence>("KHR_materials_iridescence")!;
    expect(primitive.getMaterial()!.getBaseColorTextureInfo()!.getTexCoord()).toBe(1);
    const colour = await sharp(primitive.getMaterial()!.getBaseColorTexture()!.getImage()!).raw().toBuffer();
    const reds = Array.from(colour).filter((_, i) => i % 3 === 0);
    const blues = Array.from(colour).filter((_, i) => i % 3 === 2);
    expect(Math.max(...reds) - Math.min(...reds)).toBeGreaterThan(90);
    expect(Math.max(...blues) - Math.min(...blues)).toBeGreaterThan(90);
    expect(optical.getIridescenceThicknessTextureInfo()!.getTexCoord()).toBe(1);
    const pixels = await sharp(optical.getIridescenceThicknessTexture()!.getImage()!).raw().toBuffer();
    const green = Array.from(pixels).filter((_, i) => i % 3 === 1);
    expect(Math.max(...green) - Math.min(...green)).toBeGreaterThan(180);
    expect(optical.getIridescenceThicknessMaximum() - optical.getIridescenceThicknessMinimum()).toBeGreaterThan(300);
    // Shared geometric vertices must use the same optical coordinate across normal-map projections.
    const positions = primitive.getAttribute("POSITION")!, uv = primitive.getAttribute("TEXCOORD_1")!;
    const seen = new Map<string, number[]>();
    for (let i = 0; i < positions.getCount(); i++) {
      const key = pointKey(new Vector3().fromArray(positions.getElement(i, []))), value = uv.getElement(i, []);
      if (seen.has(key)) expect(value).toEqual(seen.get(key));
      seen.set(key, value);
      expect(value.every(coordinate => coordinate >= 0 && coordinate <= 1)).toBe(true);
    }
  });

  it("roots the garnet intergrowth in a substantial fracture fragment instead of a thin plinth", () => {
    const specimen = specimens.find(({ entry }) => entry.itemId === "cairn_garnet")!;
    const components = connectedSurfaces(surfaceTriangles(specimen.document));
    const matrix = components.find(component => component.every(triangle => triangle.material === "Corealm weathered strata"))!;
    expect(matrix).toBeTruthy();
    expect(solidThickness(matrix).ratio).toBeGreaterThan(0.35);
    for (const component of components.filter(part => part !== matrix)) {
      const others = components.filter(part => part !== component);
      expect(component.some(triangle => triangle.points.some(point => others.some(body => insideSurface(point, body)))), "floating garnet growth").toBe(true);
    }
  });

  it("preserves substantial amber and opal thickness independently of pose", () => {
    for (const itemId of ["vell_amber", "fire_opal"]) {
      const specimen = specimens.find(({ entry }) => entry.itemId === itemId)!;
      const outer = surfaceTriangles(specimen.document).filter(triangle => !/(?:cloud|inclusion|film)/.test(triangle.material));
      const body = connectedSurfaces(outer).map(component => ({ component, ...solidThickness(component) }))
        .sort((a, b) => b.volume - a.volume)[0]!;
      expect(body.volume, itemId).toBeGreaterThan(0);
      // The rejected thin specimens measured 0.401 and 0.355; the reauthored
      // nugget and matrix measure 0.720 and 0.684. Keep a broad shape guard.
      expect(body.ratio, `${itemId} principal thickness`).toBeGreaterThan(0.50);
      if (itemId === "fire_opal") {
        expect(body.component.some(triangle => triangle.material === "Corealm weathered strata")).toBe(true);
      }
    }
  });

  it("maps each live item to its published specimen without flattening the authored colours", async () => {
    const manifest = JSON.parse(await readFile(new URL("../game/public/assets/manifest.json", import.meta.url), "utf8")) as {
      assets: Array<{ id: string; file: string }>;
    };
    for (const itemId of ITEMS) {
      const assetId = `corealm_item_${itemId}`;
      expect(itemIconAppearance(itemId).parts).toEqual([{ kind: "asset", assetId }]);
      expect(manifest.assets.find(entry => entry.id === assetId)?.file).toBe(`models/corealm/minerals/${assetId}.glb`);
    }
  });

  it("regenerates a specimen deterministically and keeps all output inside staging", async () => {
    const repeated = await buildMineralItemAsset("corealm_item_grithe_ore");
    expect(repeated.entry.sha256).toBe(specimens[0]!.entry.sha256);
    expect(mineralItemOutputPaths().catalogFile.replaceAll("\\", "/")).toContain("/test-results/mineral-items/catalog.json");
    expect(() => mineralItemOutputPaths("game/public/assets")).toThrow("test-results");
    expect(() => mineralItemOutputPaths("test-results/../game/public/assets")).toThrow("test-results");
    expect(() => mineralItemOutputPaths(" ")).toThrow("test-results");
    await expect(buildMineralItemAsset("ore_crystal_pink")).rejects.toThrow("Unknown inventory mineral");
  });
});
