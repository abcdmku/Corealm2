import * as THREE from 'three';
import { sampleRiverChannel, riverSections, riverSurfaceHeight, RIVER_FILL_DEPTH, type RiverChannel } from '../world/riverChannels.js';
import type { MaterialLibrary } from './materials.js';

/** Sampled-footprint water meshes. Earlier channels own overlaps at lake outlets. */
export function createRiverSurface(channels: readonly RiverChannel[], materials: MaterialLibrary,
  heightAt?: (x: number, z: number) => number): {
  group: THREE.Group; update(seconds: number): void; dispose(): void;
} {
  const group = new THREE.Group();
  group.name = 'crownward-river';
  const source = materials.water('crownward');
  const material = source.clone();
  const time = { value: 0 };
  material.name = 'crownward-flowing-freshwater';
  material.normalScale.set(.16, .16);
  material.roughness = .25;
  material.opacity = 1;
  material.depthWrite = true;
  material.onBeforeCompile = (shader, renderer) => {
    source.onBeforeCompile(shader, renderer);
    // Keep world-space sampling through pool caps and confluences. Centreline
    // transport collapses a broad lake into stripes at its nearest-point seams.
    shader.uniforms.uTime = time;
    shader.uniforms.uWaveScrollA = { value: new THREE.Vector2(-.003, .0005) };
    shader.uniforms.uWaveScrollB = { value: new THREE.Vector2(-.005, -.001) };
    shader.uniforms.uEdgeFade = { value: .045 };
  };
  material.customProgramCacheKey = () => source.customProgramCacheKey() + '-river-world-ripples-v2';
  for (const [channelIndex, channel] of channels.entries()) {
    const rows = riverSections(channel, .75);
    const positions: number[] = [], depth: number[] = [], transport: number[] = [], clipped: number[] = [];
    const earlier = channels.slice(0, channelIndex);
    const clearance = (x: number, z: number): number => {
      const own = sampleRiverChannel(channel, x, z);
      const footprint = (other: RiverChannel): number => {
        const sample = sampleRiverChannel(other, x, z);
        return Math.min((heightAt ? 2.5 : 0) - sample.signedDistance,
          heightAt ? riverSurfaceHeight(other, sample.centreProgress) - heightAt(x, z) : Infinity);
      };
      return Math.min(footprint(channel),
        ...earlier.map(other => -footprint(other)),
        channel.oceanLevel === undefined ? Infinity
          : riverSurfaceHeight(channel, own.centreProgress) - channel.oceanLevel - .025);
    };
    type Point = { x: number; z: number; clearance: number };
    const add = (point: Point): number => {
      const { x, z } = point;
      const sample = sampleRiverChannel(channel, x, z);
      const index = positions.length / 3;
      const level = riverSurfaceHeight(channel, sample.centreProgress);
      positions.push(x, level, z);
      let waterDepth = 0;
      // The receiving lake's shore is submerged where the outlet cuts through it.
      for (const other of channels) {
        const cross = sampleRiverChannel(other, x, z);
        if (cross.signedDistance > .002) continue;
        const ratio = cross.centreDistance / Math.max(.001, cross.centreDistance - cross.signedDistance);
        const t = Math.max(0, Math.min(1, (ratio - .55) / .45));
        const floor = riverSurfaceHeight(other, cross.centreProgress) - RIVER_FILL_DEPTH
          + RIVER_FILL_DEPTH * t * t * (3 - 2 * t);
        waterDepth = Math.max(waterDepth, level - floor);
      }
      if (heightAt) waterDepth = Math.max(0, level - heightAt(x, z));
      depth.push(waterDepth);
      transport.push(x, z);
      return index;
    };
    // Global alignment means adjacent channel meshes intersect the shared ownership
    // boundary on the same triangle edges. The sampled footprint includes round end
    // caps and broad pool lobes that a centreline cross-section ribbon cannot cover.
    const step = 1.25;
    const width = (channel.lake?.radius ?? Math.max(...rows.flatMap(row => [row.leftHalfWidth, row.rightHalfWidth]))) + step + 2.5;
    const xs = channel.lake ? [channel.lake.centre[0]] : rows.map(row => row.x);
    const zs = channel.lake ? [channel.lake.centre[1]] : rows.map(row => row.z);
    const minX = Math.floor((Math.min(...xs) - width) / step) * step;
    const minZ = Math.floor((Math.min(...zs) - width) / step) * step;
    const cols = Math.ceil((Math.max(...xs) + width - minX) / step);
    const countZ = Math.ceil((Math.max(...zs) + width - minZ) / step);
    const rowAt = (row: number): Point[] => Array.from({ length: cols + 1 }, (_, col) => {
      const x = minX + col * step, z = minZ + row * step;
      return { x, z, clearance: clearance(x, z) };
    });
    const emit = (triangle: Point[]): void => {
      if (triangle.every(point => point.clearance < 0)) return;
      const polygon: Point[] = [];
      for (let edge = 0; edge < 3; edge++) {
        const a = triangle[(edge + 2) % 3]!, b = triangle[edge]!;
        const aInside = a.clearance >= 0, bInside = b.clearance >= 0;
        if (aInside !== bInside) {
          let lo = 0, hi = 1;
          for (let k = 0; k < 16; k++) {
            const t = (lo + hi) / 2;
            if ((clearance(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) >= 0) === aInside) lo = t;
            else hi = t;
          }
          const t = (lo + hi) / 2;
          polygon.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, clearance: 0 });
        }
        if (bInside) polygon.push(b);
      }
      const vertices = polygon.map(add);
      for (let p = 1; p + 1 < vertices.length; p++) clipped.push(vertices[0]!, vertices[p]!, vertices[p + 1]!);
    };
    let previous = rowAt(0);
    for (let row = 1; row <= countZ; row++) {
      const current = rowAt(row);
      for (let col = 1; col <= cols; col++) {
        // Positive-Y winding, identical diagonal for every channel.
        emit([previous[col - 1]!, current[col - 1]!, previous[col]!]);
        emit([previous[col]!, current[col - 1]!, current[col]!]);
      }
      previous = current;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aWaterDepth', new THREE.Float32BufferAttribute(depth, 1));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(transport, 2));
    geometry.setIndex(clipped);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `river-water:${channel.id}`;
    mesh.renderOrder = 2;
    group.add(mesh);
  }
  // The environment loop supplies absolute seconds, not a frame delta.
  return { group, update(seconds) { time.value = seconds; }, dispose() {
    group.traverse(object => { if ((object as THREE.Mesh).isMesh) (object as THREE.Mesh).geometry.dispose(); });
    material.dispose(); group.clear();
  } };
}
