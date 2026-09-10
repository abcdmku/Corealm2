/**
 * The ground reticle for area invocations: a ring laid on the terrain where the spell will land.
 *
 * Built from a polygon whose vertices each sample the ground height, so it follows a slope rather
 * than cutting through it, plus a faint disc for the footprint and a short post at the centre so
 * the aim point reads on flat ground too. In range it wears the element's own core colour; out of
 * range it turns red, which is the one thing the player has to read from it at a glance.
 *
 * `pickGroundAlongRay` is the lab's picker: the world already raycasts its walkable meshes through
 * `input/picking.ts`, but the transient spell range only has a height function, so the ray is
 * marched until it crosses the sampled ground.
 */
import * as THREE from "three";
import type { SpellElement, Vec3 } from "../contracts.js";
import { ELEMENT_COLOURS } from "./spellVfx.js";

const SEGMENTS = 72;
const OUT_OF_RANGE = 0xff5a44;
const LIFT = 0.06;

export class AimReticle {
  readonly group = new THREE.Group();
  private readonly ring: THREE.Line;
  private readonly inner: THREE.Line;
  private readonly disc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly post: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly ringMaterial: THREE.LineBasicMaterial;
  private readonly innerMaterial: THREE.LineBasicMaterial;
  private radius = 3;
  private colour = 0xffffff;
  private inRange = true;

  constructor(parent: THREE.Object3D, private readonly ground: (x: number, z: number) => number) {
    this.group.name = "aim-reticle";
    this.group.visible = false;
    this.group.renderOrder = 40;
    const positions = new Float32Array((SEGMENTS + 1) * 3);
    this.ringMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false });
    this.innerMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthTest: false });
    this.ring = new THREE.Line(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(positions, 3)), this.ringMaterial);
    this.inner = new THREE.Line(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 3), 3)), this.innerMaterial);
    this.ring.frustumCulled = this.inner.frustumCulled = false;
    this.disc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.disc.rotation.x = -Math.PI / 2;
    this.post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1.2, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }),
    );
    this.post.position.y = 0.6;
    this.group.add(this.disc, this.ring, this.inner, this.post);
    parent.add(this.group);
  }

  show(radius: number, element: SpellElement): void {
    this.radius = Math.max(0.6, radius);
    this.colour = ELEMENT_COLOURS[element].core;
    this.group.visible = true;
    this.applyColour();
  }

  /** Moves the reticle to a ground point and recolours it for range. */
  move(point: Vec3, inRange: boolean): void {
    if (!this.group.visible) return;
    if (this.inRange !== inRange) {
      this.inRange = inRange;
      this.applyColour();
    }
    const base = this.ground(point[0], point[2]);
    this.group.position.set(point[0], base + LIFT, point[2]);
    this.disc.scale.setScalar(this.radius);
    this.writeRing(this.ring, this.radius, point, base);
    this.writeRing(this.inner, Math.max(0.3, this.radius * 0.18), point, base);
  }

  hide(): void {
    this.group.visible = false;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  dispose(): void {
    this.ring.geometry.dispose();
    this.inner.geometry.dispose();
    this.disc.geometry.dispose();
    this.disc.material.dispose();
    this.post.geometry.dispose();
    this.post.material.dispose();
    this.ringMaterial.dispose();
    this.innerMaterial.dispose();
    this.group.removeFromParent();
  }

  private applyColour(): void {
    const colour = this.inRange ? this.colour : OUT_OF_RANGE;
    this.ringMaterial.color.setHex(colour);
    this.innerMaterial.color.setHex(colour);
    this.disc.material.color.setHex(colour);
    this.post.material.color.setHex(colour);
    this.disc.material.opacity = this.inRange ? 0.1 : 0.16;
  }

  private writeRing(line: THREE.Line, radius: number, centre: Vec3, base: number): void {
    const attribute = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let index = 0; index <= SEGMENTS; index += 1) {
      const angle = (index / SEGMENTS) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      // Vertices are group-relative; the height is sampled in world space and lifted off the ground.
      attribute.setXYZ(index, x, this.ground(centre[0] + x, centre[2] + z) - base, z);
    }
    attribute.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  }
}

/**
 * Where a screen ray meets a height-field ground, or null past 200 m.
 *
 * Coarse march then bisection: cheap enough to run on every pointer move, and exact enough that the
 * reticle sits on the terrain rather than floating above a slope.
 */
export function pickGroundAlongRay(
  camera: THREE.Camera,
  ndcX: number,
  ndcY: number,
  ground: (x: number, z: number) => number,
): Vec3 | null {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const origin = raycaster.ray.origin;
  const direction = raycaster.ray.direction;
  const at = (t: number): THREE.Vector3 => origin.clone().addScaledVector(direction, t);
  const above = (t: number): number => { const p = at(t); return p.y - ground(p.x, p.z); };
  let previous = 0;
  let previousAbove = above(0);
  if (previousAbove <= 0) return null;
  for (let t = 0.5; t <= 200; t += 0.5) {
    const current = above(t);
    if (current <= 0) {
      let low = previous;
      let high = t;
      for (let step = 0; step < 18; step += 1) {
        const mid = (low + high) / 2;
        if (above(mid) > 0) low = mid; else high = mid;
      }
      const hit = at((low + high) / 2);
      return [hit.x, ground(hit.x, hit.z), hit.z];
    }
    previous = t;
    previousAbove = current;
  }
  return null;
}
