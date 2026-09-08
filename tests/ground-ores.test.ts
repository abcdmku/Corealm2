import { createHash } from "node:crypto";
import { NodeIO } from "@gltf-transform/core";
import { Box3, Mesh, Vector3, type BufferGeometry, type Group } from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGroundOreAsset, buildGroundOreGeometry, GROUND_ORE_ASSET_IDS, GROUND_ORE_SPECS, groundOreOutputPaths } from "../tools/build-ground-ores.js";

const FAMILIES = ["grithe", "corven", "kaldite", "emberite", "stone", "kilnstone"] as const;
const IDS = FAMILIES.flatMap(family => [`corealm_ore_${family}`, `corealm_ore_${family}_spent`]);
const AXES = ["x", "y", "z"] as const;
type Specimen = { root: Group; geometry: BufferGeometry; bounds: Box3 };
const positionKey = (point: Vector3): string => point.toArray().map(value => value.toFixed(5)).join(",");

/** Weld geometry across mineral and planar texture seams without relying on source vertex indices. */
function vertexIds(geometry: BufferGeometry): number[] {
  const position = geometry.getAttribute("position"), exact = new Map<string, number>(), cells = new Map<string, number[]>(), points: Vector3[] = [];
  const result: number[] = [];
  for (let index = 0; index < position.count; index++) {
    const point = new Vector3().fromBufferAttribute(position, index), key = point.toArray().join(",");
    let id = exact.get(key);
    if (id === undefined) {
      const [x, y, z] = point.toArray().map(value => Math.floor(value / 1e-5)) as [number, number, number];
      find: for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        for (const candidate of cells.get(`${x + dx},${y + dy},${z + dz}`) ?? []) if (point.distanceToSquared(points[candidate]!) <= 1e-10) { id = candidate; break find; }
      }
      if (id === undefined) { id = points.length; points.push(point); const cell = `${x},${y},${z}`, values = cells.get(cell) ?? []; values.push(id); cells.set(cell, values); }
      exact.set(key, id);
    }
    result.push(id);
  }
  return result;
}

function groundPoints(specimen: Specimen): string[] {
  const points = specimen.geometry.getAttribute("position"), ground = new Set<string>();
  for (let index = 0; index < points.count; index++) if (Math.abs(points.getY(index)) < 1e-6) ground.add(positionKey(new Vector3().fromBufferAttribute(points, index)));
  return [...ground].sort();
}

describe("fractured mineral deposits", () => {
  const specimens = new Map<string, Specimen>();
  beforeAll(() => {
    for (const id of IDS) {
      const root = buildGroundOreGeometry(id), geometry = (root.children[0] as Mesh).geometry;
      geometry.computeBoundingBox(); specimens.set(id, { root, geometry, bounds: geometry.boundingBox!.clone() });
    }
  }, 120_000);
  afterAll(() => {
    for (const { root, geometry } of specimens.values()) { geometry.dispose(); const mesh = root.children[0] as Mesh;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose(); }
  });

  it("preserves all resource identities and keeps deposits below 1.05 metres at native scale", () => {
    expect(GROUND_ORE_ASSET_IDS).toEqual(IDS);
    for (const spec of GROUND_ORE_SPECS) { expect(spec.size[1]).toBeLessThanOrEqual(1.05); expect(spec.size[0]).toBeLessThanOrEqual(1.60); }
    expect(GROUND_ORE_SPECS.find(spec => spec.family === "grithe")!.size).toEqual([1.55, 0.94, 1.12]);
  });

  it.each(IDS)("keeps %s closed, solid, grounded, and valid through mineral boundaries and planar texture seams", id => {
    const { root, geometry, bounds } = specimens.get(id)!, size = bounds.getSize(new Vector3());
    const spec = GROUND_ORE_SPECS.find(entry => id === `corealm_ore_${entry.family}` || id === `corealm_ore_${entry.family}_spent`)!;
    expect(root.children).toHaveLength(1); expect(geometry.index).toBeNull();
    expect(bounds.min.y).toBeCloseTo(0, 6); expect(bounds.min.x + bounds.max.x).toBeCloseTo(0, 5); expect(bounds.min.z + bounds.max.z).toBeCloseTo(0, 5);
    for (const [index, axis] of AXES.entries()) expect(size[axis]).toBeCloseTo(spec.size[index]!, 5);
    expect(size.y / size.x, "a full boulder, not a flat layer cake").toBeGreaterThanOrEqual(0.50);
    const position = geometry.getAttribute("position"), ids = vertexIds(geometry), edges = new Map<string, { count: number; winding: number }>(), parents = new Map<number, number>();
    const find = (id: number): number => { const parent = parents.get(id); if (parent === undefined) { parents.set(id, id); return id; } if (parent === id) return id; const root = find(parent); parents.set(id, root); return root; };
    let volume = 0, minimumArea = Infinity, collapsedEdges = 0;
    for (let offset = 0; offset < position.count; offset += 3) {
      const [a, b, c] = [0, 1, 2].map(corner => new Vector3().fromBufferAttribute(position, offset + corner));
      minimumArea = Math.min(minimumArea, b!.clone().sub(a!).cross(c!.clone().sub(a!)).length() * 0.5);
      volume += a!.dot(b!.clone().cross(c!)) / 6;
      for (let corner = 0; corner < 3; corner++) {
        const start = ids[offset + corner]!, end = ids[offset + (corner + 1) % 3]!; if (start === end) collapsedEdges++;
        const key = [start, end].sort((a, b) => a - b).join(","), edge = edges.get(key) ?? { count: 0, winding: 0 };
        edge.count++; edge.winding += start < end ? 1 : -1; edges.set(key, edge); parents.set(find(start), find(end));
      }
    }
    expect(collapsedEdges).toBe(0); expect(minimumArea).toBeGreaterThan(1e-10);
    expect([...edges.values()].filter(edge => edge.count !== 2 || edge.winding !== 0)).toEqual([]);
    expect(new Set(ids.map(find)).size).toBe(6); expect(new Set(ids).size - edges.size + position.count / 3).toBe(12);
    expect(volume / (size.x * size.y * size.z)).toBeGreaterThan(0.30);
    const ground = groundPoints(specimens.get(id)!); expect(ground.length).toBeGreaterThan(20);
    const normals = geometry.getAttribute("normal"), uv = geometry.getAttribute("uv1"), albedoUv = geometry.getAttribute("uv");
    for (const attribute of [position, normals, uv, geometry.getAttribute("color")]) expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
    let maximumNormalError = 0, minimumUvArea = Infinity;
    for (let index = 0; index < normals.count; index++) maximumNormalError = Math.max(maximumNormalError, Math.abs(Math.hypot(normals.getX(index), normals.getY(index), normals.getZ(index)) - 1));
    for (let offset = 0; offset < uv.count; offset += 3) minimumUvArea = Math.min(minimumUvArea, Math.abs((uv.getX(offset + 1) - uv.getX(offset)) * (uv.getY(offset + 2) - uv.getY(offset))
      - (uv.getY(offset + 1) - uv.getY(offset)) * (uv.getX(offset + 2) - uv.getX(offset))) * 0.5);
    // Keep the original UV validity threshold on the actual normal-map atlas.
    // Quiet albedo coordinates deliberately sample a smaller interior region.
    expect(maximumNormalError).toBeLessThan(1e-4); expect(minimumUvArea).toBeGreaterThan(1e-10);
    let maximumAlbedoUvError = 0;
    for (let index = 0; index < uv.count; index++) {
      maximumAlbedoUvError = Math.max(maximumAlbedoUvError,
        Math.abs(albedoUv.getX(index) - (0.34 + uv.getX(index) * 0.10)),
        Math.abs(albedoUv.getY(index) - (0.32 + uv.getY(index) * 0.10)));
    }
    expect(maximumAlbedoUvError).toBeLessThan(1e-6);
  });

  it.each(FAMILIES)("gives %s broad exposed mineral seams readable at gameplay distance", family => {
    const specimen = specimens.get(`corealm_ore_${family}`)!, geometry = specimen.geometry, position = geometry.getAttribute("position"), ids = vertexIds(geometry);
    const flags = (specimen.root.children[0] as Mesh).userData.mineralFaces as boolean[], adjacency = new Map<number, Set<number>>(), coordinates = new Map<number, Vector3>();
    let totalArea = 0, mineralArea = 0;
    for (let offset = 0; offset < position.count; offset += 3) {
      const points = [0, 1, 2].map(corner => new Vector3().fromBufferAttribute(position, offset + corner));
      const area = points[1]!.clone().sub(points[0]!).cross(points[2]!.clone().sub(points[0]!)).length() * 0.5; totalArea += area;
      if (!flags[offset / 3]) continue; mineralArea += area;
      for (let corner = 0; corner < 3; corner++) { const a = ids[offset + corner]!, b = ids[offset + (corner + 1) % 3]!;
        coordinates.set(a, points[corner]!); const neighbours = adjacency.get(a) ?? new Set<number>(); neighbours.add(b); adjacency.set(a, neighbours); }
    }
    expect(mineralArea / totalArea).toBeGreaterThan(0.15); expect(mineralArea / totalArea).toBeLessThan(0.50);
    const remaining = new Set(adjacency.keys()); let components = 0, largestSpan = 0;
    while (remaining.size) { components++; const pending = [remaining.values().next().value!], bounds = new Box3(); remaining.delete(pending[0]!);
      while (pending.length) { const id = pending.pop()!; bounds.expandByPoint(coordinates.get(id)!); for (const next of adjacency.get(id) ?? []) if (remaining.delete(next)) pending.push(next); }
      largestSpan = Math.max(largestSpan, bounds.getSize(new Vector3()).length()); }
    expect(components, "mineral exposures across the fractured deposit").toBeGreaterThan(1); expect(largestSpan, "visible seams rather than subpixel flecks").toBeGreaterThan(0.55);
  });

  it.each(FAMILIES)("depletes %s without moving its body or ground contact", family => {
    const active = specimens.get(`corealm_ore_${family}`)!, spent = specimens.get(`corealm_ore_${family}_spent`)!;
    for (const bound of ["min", "max"] as const) for (const axis of AXES) expect(spent.bounds[bound][axis]).toBeCloseTo(active.bounds[bound][axis], 6);
    expect(groundPoints(spent)).toEqual(groundPoints(active));
    const a = active.geometry.getAttribute("position"), b = spent.geometry.getAttribute("position"); expect(a.count).toBe(b.count);
    let changed = 0, outward = 0;
    for (let index = 0; index < a.count; index++) if (a.getZ(index) > 0.2 && a.getY(index) > 0.1) { const recession = a.getZ(index) - b.getZ(index); if (recession > 0.0001) changed++; if (recession < -0.00001) outward++; }
    expect(changed).toBeGreaterThan(5); expect(outward).toBe(0);
  });

  it("exports original granular stone detail and distinguishes metallic mineral from its non-emissive host", async () => {
    for (const id of IDS) {
      const { glb, entry } = await buildGroundOreAsset(id), doc = await new NodeIO().readBinary(glb), spent = id.endsWith("_spent");
      const family = id.slice("corealm_ore_".length).replace(/_spent$/, "");
      expect(entry.sha256).toBe(createHash("sha256").update(glb).digest("hex"));
      expect(entry.pack).toBe("corealm-original-ground-ores");
      expect(entry.materials).toEqual(spent ? ["Corealm ground host stone"] : ["Corealm ground host stone", `Corealm exposed ${family} mineral`]);
      for (const material of doc.getRoot().listMaterials()) { expect(material.getName()).not.toMatch(/essence|seam|weathered strata/); expect(material.getEmissiveFactor()).toEqual([0, 0, 0]);
        expect(material.getBaseColorTexture()).toBeNull(); expect(material.getRoughnessFactor()).toBeGreaterThanOrEqual(0.24); expect(material.getMetallicFactor()).toBeLessThanOrEqual(1);
        if (material.getName() === "Corealm ground host stone") { expect(material.getMetallicFactor()).toBe(0); expect(material.getRoughnessFactor()).toBe(0.92); }
        expect(material.getNormalScale()).toBe(material.getName() === "Corealm ground host stone" ? 0.70 : 0.28); if (material.getNormalTexture()) expect(material.getNormalTextureInfo()!.getTexCoord()).toBe(1); }
      for (const texture of doc.getRoot().listTextures()) { expect(texture.getName()).toBe("Original granular fracture normals"); expect(texture.getMimeType()).toBe("image/png"); expect(texture.getImage()!.byteLength).toBeGreaterThan(10000); }
      const bounds = new Box3(); for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) { const p = primitive.getAttribute("POSITION")!;
        for (let index = 0; index < p.getCount(); index++) bounds.expandByPoint(new Vector3().fromArray(p.getElement(index, []))); }
      for (const axis of AXES) { expect(bounds.min[axis]).toBeCloseTo(entry.base![axis], 5); expect(bounds.getSize(new Vector3())[axis]).toBeCloseTo(entry.size[axis], 5); }
    }
  });

  it("restricts output to disposable results or this package's unpromoted candidate directory", () => {
    expect(groundOreOutputPaths().models).toMatch(/test-results[\\/]ground-ores[\\/]models[\\/]corealm[\\/]geology$/);
    expect(groundOreOutputPaths("art/rebuild/candidates/finish-mining").catalog).toMatch(/finish-mining[\\/]ground-ores.json$/);
    for (const out of ["game/public/assets", "test-results/../../game/public/assets", "", "../ground-ores", "art/rebuild/candidates/finish-mining/../other", "art/rebuild/candidates/finish-mining-sibling"]) expect(() => groundOreOutputPaths(out)).toThrow(/inside test-results/);
  });
});
