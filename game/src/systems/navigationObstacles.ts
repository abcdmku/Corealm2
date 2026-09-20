import * as THREE from "three";
import type { SolidVolume } from "../contracts.js";
import { NAV_CONFIG } from "../app/config.js";

// Source geometry for generating a navmesh. It stands apart from navigation.ts so a server that only
// queries an imported navmesh loads no renderer.

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
