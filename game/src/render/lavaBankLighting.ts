import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { lavaMagicAt, lavaSections, type LavaChannel } from '../content/wildernessLava.js';

/** Broad emitting strips illuminate the receiving banks without a chain of point hotspots. */
export class LavaBankLighting {
  private readonly lights: THREE.RectAreaLight[] = [];
  private readonly strips: { position: THREE.Vector3; rotation: THREE.Quaternion;
    colour: THREE.Color; width: number; length: number }[] = [];
  private readonly assigned: (number | null)[] = [null, null, null, null];
  private readonly gains = [0, 0, 0, 0];
  private lastSeconds: number | undefined;
  private readonly viewer = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private readonly sphere = new THREE.Sphere();
  constructor(parent: THREE.Object3D, channels: readonly LavaChannel[], height: (x: number, z: number) => number) {
    if (!channels.length) return;
    RectAreaLightUniformsLib.init();
    for (const channel of channels) {
      const sections = lavaSections(channel, .8);
      for (let i = 0; i < sections.length - 1; i += 30) {
        const a = sections[i]!, b = sections[Math.min(i + 30, sections.length - 1)]!;
        const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        if (length < .05) continue;
        const tx = (b.x - a.x) / length, tz = (b.z - a.z) / length;
        this.matrix.makeBasis(new THREE.Vector3(tz, 0, -tx), new THREE.Vector3(tx, 0, tz), new THREE.Vector3(0, -1, 0));
        this.strips.push({ position: new THREE.Vector3(x, height(x, z) + .19, z),
          rotation: new THREE.Quaternion().setFromRotationMatrix(this.matrix),
          colour: new THREE.Color(0xff571b).lerp(new THREE.Color(0x8e42ff), lavaMagicAt(channel, x, z)),
          width: Math.max(.15, a.halfWidth + b.halfWidth) * .85, length: length * 1.08 });
      }
    }
    for (let i = 0; i < 4; i++) {
      const light = new THREE.RectAreaLight(0xffffff, 0, 1, 1);
      light.name = `lava-bank-area-${i}`;
      parent.add(light);
      this.lights.push(light);
    }
  }
  update(camera: THREE.Camera, enabled: boolean, seconds = performance.now() / 1000): void {
    const dt = this.lastSeconds === undefined ? 1 / 60 : Math.max(0, Math.min(.1, seconds - this.lastSeconds));
    this.lastSeconds = seconds;
    if (!enabled) { this.disable(); return; }
    camera.getWorldPosition(this.viewer);
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix);
    const nearest = this.strips.map((strip, index) => {
      const distance = strip.position.distanceToSquared(this.viewer);
      this.sphere.set(strip.position, strip.length * .6 + 24);
      const visible = this.frustum.intersectsSphere(this.sphere);
      // Prefer visible water, but never drop its receiving light at a frustum edge.
      const score = distance * (visible ? 1 : 1.8) * (this.assigned.includes(index) ? .6 : 1);
      return { index, distance, score };
    }).filter(row => row.distance < 220 * 220)
      .sort((a, b) => a.score - b.score).slice(0, this.lights.length);
    const desired = new Set(nearest.map(row => row.index));
    const ease = 1 - Math.exp(-dt / .45);
    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i]!;
      let index = this.assigned[i];
      if (index !== null && index !== undefined && !desired.has(index) && this.gains[i]! < .006) {
        this.assigned[i] = index = null;
        this.gains[i] = 0;
      }
      if (index === null || index === undefined) {
        const next = nearest.find(row => !this.assigned.includes(row.index));
        if (next) this.assigned[i] = index = next.index;
      }
      if (index === null || index === undefined) { light.intensity = 0; continue; }
      const strip = this.strips[index]!;
      const distance = strip.position.distanceTo(this.viewer);
      const target = desired.has(index) ? Math.max(0, Math.min(1, (220 - distance) / 60)) : 0;
      this.gains[i]! += (target - this.gains[i]!) * ease;
      // Reassign only after the old source has faded out. Its position never jumps while bright.
      light.position.copy(strip.position); light.quaternion.copy(strip.rotation);
      light.color.copy(strip.colour); light.width = strip.width; light.height = strip.length;
      light.intensity = 20 * this.gains[i]!;
    }
  }
  disable(): void {
    for (let i = 0; i < this.lights.length; i++) { this.lights[i]!.intensity = 0; this.gains[i] = 0; }
  }
  snapshot() { return { budget: this.lights.length, active: this.lights.filter(light => light.intensity > 0).length,
    strips: this.strips.length, slots: this.lights.map((light, i) => ({ strip: this.assigned[i], intensity: light.intensity, position: light.position.toArray() })) }; }
  dispose(): void { for (const light of this.lights) { light.removeFromParent(); light.dispose(); } }
}
