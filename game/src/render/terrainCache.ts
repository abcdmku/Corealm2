import * as THREE from "three";

type ArrayData = Float32Array | Uint8Array | Uint16Array | Uint32Array;
export type GeometryData = {
  attributes: Record<string, { array: ArrayData; itemSize: number; normalized: boolean }>;
  index: Uint16Array | Uint32Array | null;
};
export interface GridData {
  heights: Float32Array; cols: number; rows: number; minX: number; minZ: number;
  step?: number; stepX?: number; stepZ?: number;
}
export interface TerrainCacheData {
  input: string;
  ranges: { min: number; max: number }[];
  lattice: GridData | null;
  chunks: Record<string, GeometryData>;
  coast: { grid: GridData; geometry: GeometryData; dryGeometry: GeometryData } | null;
}

export function captureGeometry(geometry: THREE.BufferGeometry): GeometryData {
  return {
    attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, {
      array: attribute.array.slice() as ArrayData, itemSize: attribute.itemSize, normalized: attribute.normalized,
    }])),
    index: geometry.index?.array.slice() as Uint16Array | Uint32Array ?? null,
  };
}

export function restoreGeometry(data: GeometryData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(data.attributes)) {
    geometry.setAttribute(name, new THREE.BufferAttribute(attribute.array, attribute.itemSize, attribute.normalized));
  }
  if (data.index) geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function validGrid(value: GridData): boolean {
  return value?.heights instanceof Float32Array && Number.isInteger(value.cols) && value.cols > 1
    && Number.isInteger(value.rows) && value.rows > 1 && value.heights.length === value.cols * value.rows
    && value.heights.every(Number.isFinite) && [value.minX, value.minZ].every(Number.isFinite)
    && (value.step !== undefined ? Number.isFinite(value.step) && value.step > 0
      : Number.isFinite(value.stepX) && Number.isFinite(value.stepZ) && value.stepX! > 0 && value.stepZ! > 0);
}

function validGeometry(value: GeometryData): boolean {
  const position = value?.attributes?.position;
  if (!position || position.itemSize !== 3 || !(position.array instanceof Float32Array)) return false;
  const vertices = position.array.length / 3;
  if (!Number.isInteger(vertices) || vertices < 1) return false;
  if (value.index !== null && (!(value.index instanceof Uint16Array || value.index instanceof Uint32Array)
    || value.index.length % 3 !== 0 || value.index.some(index => index >= vertices))) return false;
  return Object.values(value.attributes).every(attribute =>
    (attribute.array instanceof Float32Array || attribute.array instanceof Uint8Array
      || attribute.array instanceof Uint16Array || attribute.array instanceof Uint32Array)
    && Number.isInteger(attribute.itemSize) && attribute.itemSize > 0 && attribute.itemSize <= 4
    && typeof attribute.normalized === "boolean"
    && attribute.array.length === vertices * attribute.itemSize
    && (!(attribute.array instanceof Float32Array) || attribute.array.every(Number.isFinite)));
}

export function validTerrainCache(value: unknown, input: string): value is TerrainCacheData {
  const data = value as TerrainCacheData;
  const surface = (geometry: GeometryData) => validGeometry(geometry)
    && Object.entries({ normal: 3, color: 3, aSplatA: 4, aSplatB: 4, aGround: 4, aPaved: 1 })
      .every(([name, size]) => geometry.attributes[name]?.itemSize === size);
  return data?.input === input && Array.isArray(data.ranges)
    && data.ranges.every(range => Number.isFinite(range.min) && Number.isFinite(range.max))
    && !!data.lattice && validGrid(data.lattice) && !!data.chunks
    && Object.keys(data.chunks).length > 0 && Object.values(data.chunks).every(surface)
    && (data.coast === null || validGrid(data.coast.grid) && surface(data.coast.geometry) && validGeometry(data.coast.dryGeometry));
}
