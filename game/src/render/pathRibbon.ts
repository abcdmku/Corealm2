/**
 * The guide ribbon: a ground route that reads as paint on the ground rather than as a wire.
 *
 * `THREE.Line` with `LineBasicMaterial` is one device pixel wide on every WebGL platform
 * (`linewidth` is ignored), so the old route was a hairline that vanished at any distance and
 * looked like a debug draw when it did not. This is a strip instead: two edge vertices per sample,
 * each seated on its OWN ground height so the strip banks with the slope, and a fragment program
 * that paints a soft translucent body, a thin brighter rim, and a run of chevrons that drift toward
 * the destination so the direction of travel is legible without an arrowhead.
 *
 * A MeshBasicNodeMaterial keeps the paint in the production WebGPU graph. Live references
 * update its animation and moving head without rebuilding geometry or shaders.
 *
 * Overdraw: one ribbon under a metre wide along one route. `render/scene.ts` removed 42 road
 * ribbons that covered the whole world for overdraw; this is nothing like that scale, and it is
 * depth-tested against the ground it sits 0.22 m above rather than drawn over everything.
 */
import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { attribute, clamp, fract, materialColor, materialOpacity, mix, reference, smoothstep, varying, vec3 } from "three/tsl";

/** Full width is twice this. A little over a metre: a stripe from the follow camera, not a wire. */
export const RIBBON_HALF_WIDTH = 0.55;
/** Metres between chevrons. */
const CHEVRON_SPACING = 1.9;
/** Metres per second the chevrons drift toward the destination. */
const CHEVRON_SPEED = 1.35;
/** A corner's miter is capped here, so a hairpin does not spike. */
const MITER_LIMIT = 1.6;

export interface RibbonUniforms {
  uTime: { value: number };
  uLength: { value: number };
  /**
   * Metres along the centreline where the visible ribbon begins. Slid forward every frame from
   * the player's render position, which is what keeps a walk smooth: the geometry stands still
   * and only the fade moves, so nothing is rebuilt between re-plans and nothing pops when one
   * happens — the new ribbon starts exactly where the old one's head was.
   */
  uHead: { value: number };
}

export interface RibbonBuild {
  geometry: THREE.BufferGeometry;
  /** Metres along the centreline. */
  length: number;
  /** The centreline as (x, z, metres along) triples, for `projectAlong`. */
  centre: Float32Array;
}

/**
 * Where a world point sits against a ribbon's centreline: how far along, and how far off to the
 * side. Linear in the sample count; a route is at most a few hundred samples.
 */
export function projectAlong(centre: Float32Array, x: number, z: number): { along: number; lateral: number } {
  const count = centre.length / 3;
  let bestAlong = 0;
  let bestLateral = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < count; index += 1) {
    const ax = centre[index * 3]!;
    const az = centre[index * 3 + 1]!;
    const bx = centre[(index + 1) * 3]!;
    const bz = centre[(index + 1) * 3 + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSq)) : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const lateral = Math.hypot(x - px, z - pz);
    if (lateral < bestLateral) {
      bestLateral = lateral;
      const alongA = centre[index * 3 + 2]!;
      const alongB = centre[(index + 1) * 3 + 2]!;
      bestAlong = alongA + (alongB - alongA) * t;
    }
  }
  return { along: bestAlong, lateral: Number.isFinite(bestLateral) ? bestLateral : 0 };
}

/**
 * Strip geometry along an XZ polyline. `groundY` is called once per edge vertex.
 *
 * `aTrail` carries (metres along, -1..1 across) so the fragment program can place chevrons by
 * distance and fade the edges by position, with no dependence on the UV chunks a stock material
 * only compiles in when it has a map.
 */
export function buildRibbonGeometry(
  samples: readonly (readonly [number, number])[],
  groundY: (x: number, z: number) => number,
  halfWidth: number,
  lift: number,
): RibbonBuild | null {
  const count = samples.length;
  if (count < 2) return null;

  const positions = new Float32Array(count * 2 * 3);
  const trail = new Float32Array(count * 2 * 2);
  const indices = new Uint32Array((count - 1) * 6);
  const centre = new Float32Array(count * 3);

  let along = 0;
  for (let index = 0; index < count; index += 1) {
    const [x, z] = samples[index]!;
    const prev = samples[Math.max(index - 1, 0)]!;
    const next = samples[Math.min(index + 1, count - 1)]!;
    if (index > 0) along += Math.hypot(x - prev[0], z - prev[1]);
    centre[index * 3] = x;
    centre[index * 3 + 1] = z;
    centre[index * 3 + 2] = along;

    // The averaged tangent at a corner, and the miter that keeps the strip its full width there.
    let tx = next[0] - prev[0];
    let tz = next[1] - prev[1];
    const tangentLength = Math.hypot(tx, tz) || 1;
    tx /= tangentLength;
    tz /= tangentLength;
    let miter = 1;
    if (index > 0 && index < count - 1) {
      let ox = next[0] - x;
      let oz = next[1] - z;
      const outLength = Math.hypot(ox, oz) || 1;
      ox /= outLength;
      oz /= outLength;
      const cosHalf = tx * ox + tz * oz;
      miter = Math.min(MITER_LIMIT, 1 / Math.max(cosHalf, 1 / MITER_LIMIT));
    }
    const nx = -tz * halfWidth * miter;
    const nz = tx * halfWidth * miter;

    const left = index * 2;
    const right = left + 1;
    const leftX = x + nx;
    const leftZ = z + nz;
    const rightX = x - nx;
    const rightZ = z - nz;
    positions[left * 3] = leftX;
    positions[left * 3 + 1] = groundY(leftX, leftZ) + lift;
    positions[left * 3 + 2] = leftZ;
    positions[right * 3] = rightX;
    positions[right * 3 + 1] = groundY(rightX, rightZ) + lift;
    positions[right * 3 + 2] = rightZ;
    trail[left * 2] = along;
    trail[left * 2 + 1] = 1;
    trail[right * 2] = along;
    trail[right * 2 + 1] = -1;

    if (index < count - 1) {
      const quad = index * 6;
      indices[quad] = left;
      indices[quad + 1] = right;
      indices[quad + 2] = left + 2;
      indices[quad + 3] = right;
      indices[quad + 4] = right + 2;
      indices[quad + 5] = left + 2;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aTrail", new THREE.BufferAttribute(trail, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return { geometry, length: along, centre };
}

/**
 * The paint. Balanced against a SwiftShader capture of the Bracken Pit route (2026-09-02): at the
 * first cut the body was 0.30 alpha and the chevrons were mixed 45 % toward white, and from the
 * follow camera the result read as a string of white dashes with no band between them. The body
 * now carries the colour and the chevrons are a lighter tint of it, not white.
 */
/** One material per ribbon; live references share the existing animation state. */
export function createRibbonMaterial(colour: THREE.Color, uniforms: RibbonUniforms): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    color: colour,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  material.name = "corealm-guide-ribbon";
  const time = reference('value', 'float', uniforms.uTime);
  const length = reference('value', 'float', uniforms.uLength);
  const head = reference('value', 'float', uniforms.uHead);
  const trail = varying(attribute('aTrail', 'vec2' as const));
  const across = trail.y.abs();
  const body = smoothstep(.62, 1, across).oneMinus();
  const rim = smoothstep(.70, .80, across).mul(smoothstep(.90, 1, across).oneMinus());
  // Keep the pattern pinned to the destination, with its centre pointing forward.
  const toGo = length.sub(trail.x);
  const phase = fract(toGo.negate().sub(time.mul(CHEVRON_SPEED)).add(across.mul(.6)).div(CHEVRON_SPACING));
  const chevron = smoothstep(0, .16, phase).mul(smoothstep(.30, .46, phase).oneMinus());
  const headFade = smoothstep(0, 1.8, trail.x.sub(head));
  const tailFade = smoothstep(length.sub(1.6), length.sub(.2), trail.x).oneMinus();
  const fade = headFade.mul(mix(.15, 1, tailFade));
  material.colorNode = mix(materialColor.rgb, mix(materialColor.rgb, vec3(1), .28),
    clamp(chevron.mul(body).add(rim.mul(.6)), 0, 1));
  material.opacityNode = materialOpacity.mul(body.mul(.5).add(rim.mul(.4)).add(chevron.mul(body).mul(.35))).mul(fade);
  return material;
}
