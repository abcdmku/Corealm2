import * as THREE from "three";
import type { RegionId, TownTeleportCast, UtilityAreaField, UtilitySpellId, Vec3 } from "../contracts.js";
import { groundRingGeometry, seatGroundRing } from "./groundRing.js";

const COLOURS: Partial<Record<UtilitySpellId, number>> = {
  warding_circle: 0xffd780, sanctuary: 0xffe5ad, mending_circle: 0x77ffd0,
  enfeebling_mist: 0xc4a0ff, binding_field: 0xdd93ff, stillness: 0x8bddff,
};
type Ring = THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
interface FieldVisual { group: THREE.Group; rings: Ring[]; regionId: RegionId }

/** Replicated utility state owns these marks, including their radius and lifetime. */
export class UtilityMagicVfx {
  private readonly group = new THREE.Group();
  private readonly fields = new Map<string, FieldVisual>();
  private readonly teleportBase: Ring;
  private readonly teleportProgress: Ring;
  private readonly origin = new THREE.Vector3();
  constructor(parent: THREE.Object3D, private readonly ground: (x: number, z: number, referenceY: number) => number) {
    this.group.name = "utility-magic-vfx";
    parent.add(this.group);
    this.teleportBase = this.ring(1.15, 0.11, 0xbba6ff);
    this.teleportProgress = this.ring(.97, .14, 0xe3d7ff);
    // Order all radial strips by angle so drawRange reveals one continuous charge arc.
    const index = this.teleportProgress.geometry.index!;
    const ordered: number[] = [];
    for (let angle = 0; angle < 64; angle++) for (let row = 0; row < 3; row++) {
      for (let vertex = 0; vertex < 6; vertex++) ordered.push(index.getX((row * 64 + angle) * 6 + vertex));
    }
    this.teleportProgress.geometry.setIndex(ordered);
    this.group.add(this.teleportBase, this.teleportProgress);
    this.teleportBase.visible = this.teleportProgress.visible = false;
  }
  private ring(radius: number, width: number, colour: number): Ring {
    const mesh = new THREE.Mesh(groundRingGeometry(radius, width), new THREE.MeshBasicMaterial({
      color: colour, vertexColors: true, transparent: true, opacity: .8,
      depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: false,
    }));
    mesh.renderOrder = 4;
    return mesh;
  }
  private seat(ring: Ring, point: Vec3): void {
    this.origin.set(point[0], point[1], point[2]);
    ring.position.copy(this.origin);
    seatGroundRing(ring, this.origin, this.ground);
  }
  update(fields: readonly UtilityAreaField[], cast: TownTeleportCast | null, regionId: RegionId, playerPosition: Vec3, atMs: number): void {
    const live = new Set<string>();
    for (const field of fields) {
      if (field.expiresAtMs <= atMs) continue;
      live.add(field.id);
      let visual = this.fields.get(field.id);
      if (!visual) {
        const colour = COLOURS[field.spellId] ?? 0xc4a0ff;
        const rings = [this.ring(field.radius, .16, colour), this.ring(field.radius * .91, .045, colour)];
        const group = new THREE.Group(); group.name = `utility-field:${field.spellId}`;
        for (const ring of rings) { group.add(ring); this.seat(ring, field.position); }
        visual = { group, rings, regionId: field.regionId }; this.fields.set(field.id, visual); this.group.add(group);
      }
      visual.group.visible = visual.regionId === regionId;
      const fade = Math.min(1, (field.expiresAtMs - atMs) / 800);
      visual.rings[0]!.material.opacity = fade * (.65 + .12 * Math.sin((atMs - field.startedAtMs) / 600));
      visual.rings[1]!.material.opacity = fade * .36;
    }
    for (const [id, visual] of this.fields) if (!live.has(id)) {
      for (const ring of visual.rings) { ring.geometry.dispose(); ring.material.dispose(); }
      visual.group.removeFromParent(); this.fields.delete(id);
    }
    const channeling = cast !== null && cast.endsAtMs > atMs;
    this.teleportBase.visible = this.teleportProgress.visible = channeling;
    if (cast && channeling) {
      this.seat(this.teleportBase, playerPosition); this.seat(this.teleportProgress, playerPosition);
      const progress = THREE.MathUtils.clamp((atMs - cast.startedAtMs) / Math.max(1, cast.endsAtMs - cast.startedAtMs), 0, 1);
      this.teleportProgress.geometry.setDrawRange(0, Math.floor(progress * 64) * 18);
      this.teleportBase.material.opacity = .4 + .16 * Math.sin(atMs / 140);
      this.teleportProgress.material.opacity = .95;
    }
  }
  clear(): void {
    for (const visual of this.fields.values()) {
      for (const ring of visual.rings) { ring.geometry.dispose(); ring.material.dispose(); }
      visual.group.removeFromParent();
    }
    this.fields.clear(); this.teleportBase.visible = this.teleportProgress.visible = false;
  }
  dispose(): void {
    this.clear();
    for (const ring of [this.teleportBase, this.teleportProgress]) { ring.geometry.dispose(); ring.material.dispose(); }
    this.group.removeFromParent();
  }
}
