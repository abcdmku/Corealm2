import * as THREE from "three";

type Point = readonly [number, number, number];

/** Flat faces retain the crease between ground bevels and the recessed fuller. */
export class EquipmentFaces {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];

  triangle(a: Point, b: Point, c: Point, tone = 1): void {
    this.positions.push(...a, ...b, ...c);
    for (let vertex = 0; vertex < 3; vertex++) this.colors.push(tone, tone, tone);
  }

  quad(a: Point, b: Point, c: Point, d: Point, tone = 1): void {
    this.triangle(a, b, c, tone);
    this.triangle(a, c, d, tone);
  }

  geometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/**
 * A closed, centered cut crystal with a narrow girdle, two crowns and flat tables. The aligned
 * sixteen-sided rings form planar polished facets. Its circumradius is one; return values never
 * share buffers. Held equipment should cache one result for the lifetime of the asset registry.
 */
export function buildEquipmentCoreGeometry(): THREE.BufferGeometry {
  const faces = new EquipmentFaces();
  const heights = [-0.96, -0.78, -0.41, -0.045, 0.045, 0.41, 0.78, 0.96];
  const sectors = 16;
  const point = (row: number, sector: number): Point => {
    const y = heights[row]!;
    const radius = Math.sqrt(1 - y * y);
    const angle = sector / sectors * Math.PI * 2;
    return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
  };
  for (let row = 0; row < heights.length - 1; row++) {
    for (let sector = 0; sector < sectors; sector++) {
      const tone = row === 3 ? 0.88 : 0.86 + 0.12 * Math.sin(sector * 2.4 + row * 1.7);
      faces.quad(point(row, sector), point(row + 1, sector),
        point(row + 1, sector + 1), point(row, sector + 1), tone);
    }
  }
  for (let sector = 0; sector < sectors; sector++) {
    faces.triangle([0, heights[0]!, 0], point(0, sector), point(0, sector + 1));
    const top = heights.length - 1;
    faces.triangle([0, heights[top]!, 0], point(top, sector + 1), point(top, sector));
  }
  const geometry = faces.geometry();
  geometry.name = "equipment-cut-core";
  return geometry;
}
