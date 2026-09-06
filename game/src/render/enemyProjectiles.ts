import * as THREE from "three";
import type { Vec3 } from "../contracts.js";
import type { CombatAttackStart } from "../systems/combat.js";

interface Flight {
  attack: CombatAttackStart;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

/** Enemy attack visuals follow the simulation contact clock and never apply damage. */
export class EnemyProjectiles {
  private readonly mesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 6, 4),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    128,
  );
  private readonly flights: Flight[] = [];
  private readonly pose = new THREE.Object3D();
  private readonly direction = new THREE.Vector3();
  private readonly axis = new THREE.Vector3(0, 0, 1);
  private readonly color = new THREE.Color();

  constructor(parent: THREE.Object3D) {
    this.mesh.name = "enemy-projectiles";
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    parent.add(this.mesh);
  }

  start(attack: CombatAttackStart, source: Vec3, target: Vec3): void {
    if (attack.attacker !== "enemy" || attack.kind === "melee") return;
    if (this.flights.some(flight => flight.attack.id === attack.id)) return;
    if (this.flights.length >= 128) this.flights.shift();
    this.flights.push({
      attack,
      from: new THREE.Vector3(source[0], source[1] + 1.1, source[2]),
      to: new THREE.Vector3(target[0], target[1] + 0.9, target[2]),
    });
  }

  /** `valid` cancels interrupted windups, dead actors, and attacks on another realm. */
  update(simNowMs: number, valid: (sourceId: string) => boolean, targetPosition?: (targetId: string) => Vec3 | undefined): void {
    let count = 0;
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const flight = this.flights[i]!;
      const attack = flight.attack;
      if (simNowMs >= attack.contactAtMs || !valid(attack.sourceId)) {
        this.flights.splice(i, 1);
        continue;
      }
      const launchAtMs = attack.atMs + (attack.contactAtMs - attack.atMs) * 0.35;
      if (simNowMs < launchAtMs) continue;
      const target = targetPosition?.(attack.targetId);
      if (target) flight.to.set(target[0], target[1] + 0.9, target[2]);
      const progress = THREE.MathUtils.clamp((simNowMs - launchAtMs) / (attack.contactAtMs - launchAtMs), 0, 1);
      this.pose.position.lerpVectors(flight.from, flight.to, progress);
      this.direction.subVectors(flight.to, flight.from).normalize();
      this.pose.quaternion.setFromUnitVectors(this.axis, this.direction);
      const magic = attack.kind === "magic";
      this.pose.scale.set(magic ? 0.15 : 0.035, magic ? 0.15 : 0.035, magic ? 0.24 : 0.4);
      this.pose.updateMatrix();
      this.mesh.setMatrixAt(count, this.pose.matrix);
      this.mesh.setColorAt(count, this.color.setHex(magic ? 0x91e4ff : 0xe8cf9c));
      count++;
    }
    this.mesh.count = count;
    this.mesh.visible = count > 0;
    if (count) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  clear(): void {
    this.flights.length = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.clear();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
