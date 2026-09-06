import * as THREE from "three";
import type { Vec3 } from "../contracts.js";

const smooth = (v: number): number => { const t = THREE.MathUtils.clamp(v, 0, 1); return t * t * (3 - 2 * t); };
export interface FishingSample { phase: "cast" | "hold" | "strike" | "reel"; ageMs: number; weight: number; lift: number; flight: number; retrieve: number; crank: number }

/** The strike peaks at the semantic roll, independent of render frame rate. */
export function sampleFishing(ageMs: number, untilRollMs: number, cycleMs: number): FishingSample {
  ageMs = Math.max(0, ageMs);
  cycleMs = Math.max(1, cycleMs);
  const since = ((cycleMs - untilRollMs) % cycleMs + cycleMs) % cycleMs;
  const cast = ageMs < 900;
  const strike = !cast && untilRollMs > 0 && untilRollMs < 140;
  const reel = !cast && since < 650;
  return { phase: cast ? "cast" : strike ? "strike" : reel ? "reel" : "hold", ageMs,
    weight: smooth(ageMs / 180),
    lift: cast ? Math.sin(smooth(ageMs / 450) * Math.PI) * 1.8 : strike ? smooth(1 - untilRollMs / 140) : reel ? 1 - smooth(since / 650) : Math.pow(Math.max(0, Math.sin(ageMs * 0.0018)), 24) * 0.045,
    flight: smooth((ageMs - 350) / 550),
    retrieve: reel ? Math.sin(Math.PI * since / 650) * 0.65 : 0,
    crank: reel ? since / 650 * Math.PI * 6 : 0 };
}

/** Writes into caller-owned storage. Endpoints remain exact; slack bows below the chord. */
export function solveFishingLine(points: Float32Array, tip: THREE.Vector3, float: THREE.Vector3, sag: number): void {
  const count = points.length / 3;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    points[i * 3] = THREE.MathUtils.lerp(tip.x, float.x, t);
    points[i * 3 + 1] = THREE.MathUtils.lerp(tip.y, float.y, t) - sag * 4 * t * (1 - t);
    points[i * 3 + 2] = THREE.MathUtils.lerp(tip.z, float.z, t);
  }
}

export function solveFishingFloat(out: THREE.Vector3, tip: THREE.Vector3, spot: THREE.Vector3, sample: FishingSample): void {
  out.lerpVectors(tip, spot, sample.flight * (1 - sample.retrieve));
  out.y += Math.sin(sample.flight * Math.PI) * 1.1;
  if (sample.flight === 1 && sample.retrieve === 0) out.y = spot.y + Math.sin(sample.ageMs * 0.004) * 0.012;
}

function aim(bone: THREE.Bone, child: THREE.Bone, target: THREE.Vector3, weight: number): void {
  if (!bone.parent) return;
  const origin = bone.getWorldPosition(new THREE.Vector3());
  const delta = new THREE.Quaternion().setFromUnitVectors(child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize(), target.clone().sub(origin).normalize());
  const desired = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
    .multiply(bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta));
  bone.quaternion.slerp(desired, weight);
  bone.updateMatrixWorld(true);
}

function reach(arm: THREE.Bone, elbow: THREE.Bone, hand: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3, weight: number): void {
  const origin = arm.getWorldPosition(new THREE.Vector3());
  const upper = origin.distanceTo(elbow.getWorldPosition(new THREE.Vector3()));
  const lower = elbow.getWorldPosition(new THREE.Vector3()).distanceTo(hand.getWorldPosition(new THREE.Vector3()));
  const axis = target.clone().sub(origin);
  const distance = THREE.MathUtils.clamp(axis.length(), 0.001, upper + lower - 0.001);
  axis.normalize();
  pole.sub(origin);
  pole.addScaledVector(axis, -pole.dot(axis)).normalize();
  const along = (upper * upper + distance * distance - lower * lower) / (2 * distance);
  const bend = origin.clone().addScaledVector(axis, along).addScaledVector(pole, Math.sqrt(Math.max(0, upper * upper - along * along)));
  aim(arm, elbow, bend, weight);
  aim(elbow, hand, target, weight);
}

export class FishingPoseLayer {
  private saved: { bone: THREE.Bone; quaternion: THREE.Quaternion }[] = [];
  restore(): void { for (const row of this.saved) row.bone.quaternion.copy(row.quaternion); this.saved.length = 0; }
  apply(root: THREE.Object3D, bones: ReadonlyMap<string, THREE.Bone>, sample: FishingSample | null, rod?: THREE.Object3D): void {
    if (!sample || sample.weight <= 0) return;
    for (const name of ["spine_01", "spine_02", "upperarm_l", "lowerarm_l", "hand_l", "upperarm_r", "lowerarm_r", "hand_r"]) {
      const bone = bones.get(name);
      if (bone) this.saved.push({ bone, quaternion: bone.quaternion.clone() });
    }
    const spine = bones.get("spine_02");
    if (spine) spine.rotateX((-0.10 + sample.lift * 0.13 + Math.sin(sample.ageMs * 0.002) * 0.012) * sample.weight);
    root.updateMatrixWorld(true);
    for (const side of ["r", "l"] as const) {
      const arm = bones.get(`upperarm_${side}`), elbow = bones.get(`lowerarm_${side}`), hand = bones.get(`hand_${side}`);
      if (!arm || !elbow || !hand) continue;
      const sign = side === "r" ? -1 : 1;
      const pole = root.localToWorld(new THREE.Vector3(sign * 0.45, 0.95 + sample.lift * 0.20, 0.08));
      const crank = side === "l" ? 0.045 : 0;
      const target = root.localToWorld(new THREE.Vector3(sign * 0.10 + Math.cos(sample.crank) * crank,
        1.22 + sample.lift * 0.23 + Math.sin(sample.crank) * crank, 0.43 - sample.lift * 0.23));
      reach(arm, elbow, hand, target, pole, sample.weight);
    }
    const hand = bones.get("hand_r");
    if (rod && hand?.parent) {
      const direction = new THREE.Vector3(0, 0.18 + sample.lift * 1.2, 1 - sample.lift * 0.9).normalize()
        .transformDirection(root.matrixWorld);
      const actual = new THREE.Vector3(0, 1, 0).transformDirection(rod.matrixWorld);
      const delta = new THREE.Quaternion().setFromUnitVectors(actual, direction);
      const desired = hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
        .multiply(hand.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta));
      hand.quaternion.slerp(desired, sample.weight);
    }
    root.updateMatrixWorld(true);
    const leftArm = bones.get("upperarm_l"), leftElbow = bones.get("lowerarm_l"), leftHand = bones.get("hand_l");
    if (rod && leftArm && leftElbow && leftHand) {
      const target = rod.localToWorld(new THREE.Vector3(0.055, -0.137 + Math.sin(sample.crank) * 0.025, 0.051 + Math.cos(sample.crank) * 0.025));
      reach(leftArm, leftElbow, leftHand, target, root.localToWorld(new THREE.Vector3(0.45, 0.9, 0.12)), sample.weight);
    }
    root.updateMatrixWorld(true);
  }
}

export class FishingLine {
  readonly root = new THREE.Group();
  readonly tip = new THREE.Vector3();
  readonly float = new THREE.Vector3();
  private readonly spot = new THREE.Vector3();
  private readonly points = new Float32Array(33 * 3);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material = new THREE.LineBasicMaterial({ color: 0xd8d4cc });
  private readonly floatMaterial = new THREE.MeshStandardMaterial({ color: 0xc98a2a, roughness: 0.6 });
  private readonly capMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d1bd, roughness: 0.6 });
  private readonly floatGeometry = new THREE.SphereGeometry(0.04, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  private readonly bobber = new THREE.Group();
  constructor() {
    this.root.name = "fishing-line-world";
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.points, 3).setUsage(THREE.DynamicDrawUsage));
    const line = new THREE.Line(this.geometry, this.material);
    line.frustumCulled = false;
    this.root.add(line, this.bobber);
    for (const [material, flip] of [[this.floatMaterial, false], [this.capMaterial, true]] as const) {
      const mesh = new THREE.Mesh(this.floatGeometry, material);
      mesh.scale.set(1, 1.2, 1); mesh.rotation.x = flip ? Math.PI : 0; this.bobber.add(mesh);
    }
    this.root.visible = false;
  }
  update(rod: THREE.Object3D | undefined, spot: Vec3 | null, sample: FishingSample | null): void {
    const anchor = rod?.userData["fishingRod"] as { lineGuide: number[]; line: number; bobber: number } | undefined;
    this.root.visible = Boolean(anchor && spot && sample);
    if (!rod || !anchor || !spot || !sample) return;
    this.root.parent?.updateWorldMatrix(true, false);
    this.root.matrixAutoUpdate = false;
    this.root.matrix.identity();
    if (this.root.parent) this.root.matrix.copy(this.root.parent.matrixWorld).invert();
    this.tip.fromArray(anchor.lineGuide).applyMatrix4(rod.matrixWorld);
    this.spot.fromArray(spot);
    solveFishingFloat(this.float, this.tip, this.spot, sample);
    this.bobber.position.copy(this.float);
    this.bobber.rotation.z = Math.sin(sample.ageMs * 0.003) * 0.10;
    solveFishingLine(this.points, this.tip, this.float, Math.min(0.24, this.tip.distanceTo(this.float) * 0.045) * (1 - sample.retrieve));
    this.geometry.getAttribute("position").needsUpdate = true;
    this.material.color.setHex(anchor.line); this.floatMaterial.color.setHex(anchor.bobber);
  }
  dispose(): void { this.root.removeFromParent(); this.geometry.dispose(); this.floatGeometry.dispose(); this.material.dispose(); this.floatMaterial.dispose(); this.capMaterial.dispose(); }
}

/** Each attached rod gets private buffers; the registry's cached icon/gear asset stays immutable. */
export class FishingRodFlex {
  private rod: THREE.Object3D | undefined;
  private rows: { mesh: THREE.Mesh; source: THREE.BufferGeometry; geometry: THREE.BufferGeometry; positions: THREE.BufferAttribute; normals: THREE.BufferAttribute }[] = [];
  private guide: number[] = [];
  update(rod: THREE.Object3D | undefined, sample: FishingSample | null): void {
    if (rod !== this.rod) {
      this.dispose();
      if (!rod?.userData["fishingRod"]) return;
      this.rod = rod;
      this.guide = [...rod.userData["fishingRod"].lineGuide];
      rod.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const source = object.geometry;
        const geometry = source.clone();
        object.geometry = geometry;
        this.rows.push({ mesh: object, source, geometry, positions: source.getAttribute("position") as THREE.BufferAttribute,
          normals: source.getAttribute("normal") as THREE.BufferAttribute });
      });
    }
    if (!this.rod) return;
    const tipY = this.guide[1]!;
    const bend = sample ? Math.max(0, sample.lift) * 0.10 : 0;
    for (const row of this.rows) {
      const p = row.geometry.getAttribute("position"), n = row.geometry.getAttribute("normal");
      for (let i = 0; i < p.count; i++) {
        const y = row.positions.getY(i), t = Math.max(0, y / tipY), slope = -2 * bend * t / tipY;
        p.setXYZ(i, row.positions.getX(i), y, row.positions.getZ(i) - bend * t * t);
        const nx = row.normals.getX(i), nz = row.normals.getZ(i), ny = row.normals.getY(i) - slope * nz;
        const length = Math.hypot(nx, ny, nz);
        n.setXYZ(i, nx / length, ny / length, nz / length);
      }
      p.needsUpdate = true; n.needsUpdate = true;
      row.geometry.computeBoundingSphere();
    }
    this.rod.userData["fishingRod"].lineGuide[2] = this.guide[2]! - bend;
  }
  dispose(): void {
    if (this.rod) this.rod.userData["fishingRod"].lineGuide = [...this.guide];
    for (const row of this.rows) { row.mesh.geometry = row.source; row.geometry.dispose(); }
    this.rows.length = 0; this.rod = undefined;
  }
}
