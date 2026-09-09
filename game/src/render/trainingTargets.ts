import * as THREE from "three";
import type { ElementalTarget } from "../systems/elementalAttacks.js";

/** Reusable training dummy view; health and statuses come from the attack system. */
export class TrainingTargets {
  readonly group = new THREE.Group();
  private readonly bodies: THREE.Mesh[] = [];
  private readonly pivots: THREE.Group[] = [];
  private readonly seenHits: number[] = [];
  private readonly hitTimes: number[] = [];
  private readonly details: THREE.BufferGeometry[] = [];
  private readonly labels: HTMLDivElement[] = [];
  private readonly point = new THREE.Vector3();
  private readonly geometry = new THREE.SphereGeometry(1, 14, 10);
  private readonly post = new THREE.CylinderGeometry(0.065, 0.085, 1.6, 8);
  private readonly postMaterial = new THREE.MeshStandardMaterial({
    color: 0x57412d,
    roughness: 1,
  });
  constructor(parent: THREE.Object3D, targets: readonly ElementalTarget[]) {
    this.group.name = "spell-training-targets";
    parent.add(this.group);
    const armGeometry = new THREE.CylinderGeometry(0.055, 0.07, 1.35, 7),
      ringGeometry = new THREE.TorusGeometry(0.21, 0.018, 5, 20),
      headGeometry = new THREE.SphereGeometry(0.19, 12, 8);
    this.details.push(armGeometry, ringGeometry, headGeometry);
    for (const target of targets) {
      const root = new THREE.Group();
      const pivot = new THREE.Group();
      pivot.position.y = 1.15;
      const material = new THREE.MeshStandardMaterial({
        color: 0xb9a077,
        roughness: 1,
      });
      const body = new THREE.Mesh(this.geometry, material);
      body.scale.set(0.34, 0.46, 0.25);
      body.castShadow = true;
      const head = new THREE.Mesh(headGeometry, material);
      head.position.y = 0.62;
      head.scale.set(0.94, 1.18, 0.87);
      head.castShadow = true;
      const arms = new THREE.Mesh(armGeometry, this.postMaterial);
      arms.rotation.z = Math.PI / 2;
      arms.position.y = 0.23;
      arms.castShadow = true;
      const ring = new THREE.Mesh(ringGeometry, this.postMaterial);
      ring.position.set(0, 0.02, -0.246);
      const seam = new THREE.Mesh(armGeometry, this.postMaterial);
      seam.scale.set(0.22, 0.5, 0.22);
      seam.position.set(0.03, 0, -0.252);
      pivot.add(body, head, arms, ring, seam);
      const post = new THREE.Mesh(this.post, this.postMaterial);
      post.position.y = 0.8;
      post.castShadow = true;
      root.add(post, pivot);
      this.group.add(root);
      this.bodies.push(body);
      this.pivots.push(pivot);
      this.seenHits.push(0);
      this.hitTimes.push(-10000);
      const label = document.createElement("div");
      label.className = "spell-target-label";
      label.dataset["target"] = target.id;
      document.body.append(label);
      this.labels.push(label);
    }
  }
  update(
    targets: readonly ElementalTarget[],
    camera: THREE.Camera,
    ground: (x: number, z: number) => number,
  ): void {
    const placed: { x: number; y: number; width: number }[] = [];
    targets.forEach((target, i) => {
      const root = this.group.children[i]!,
        body = this.bodies[i]!,
        label = this.labels[i]!;
      root.position.set(
        target.position[0],
        ground(target.position[0], target.position[2]),
        target.position[2],
      );
      const now = performance.now() / 1000;
      if (target.hits !== this.seenHits[i]) {
        this.seenHits[i] = target.hits;
        this.hitTimes[i] = target.hits ? now : -10000;
      }
      const age = now - this.hitTimes[i]!;
      this.pivots[i]!.rotation.z =
        target.health === 0
          ? Math.PI / 2
          : Math.sin(age * 27) * Math.exp(-age * 6) * 0.2;
      (body.material as THREE.MeshStandardMaterial).color.setHex(
        target.status === "freeze"
          ? 0xacc9cc
          : target.status === "burn"
            ? 0xa8886b
            : target.status === "root"
              ? 0x98866c
              : 0xb9a077,
      );
      this.point.copy(root.position);
      this.point.y += 2.23;
      this.point.project(camera);
      label.hidden =
        this.point.z < -1 ||
        this.point.z > 1 ||
        Math.abs(this.point.x) > 1 ||
        Math.abs(this.point.y) > 1;
      label.textContent = `${target.id} · ${target.health}${target.status ? ` · ${target.status}` : ""}`;
      const screenX = (this.point.x * 0.5 + 0.5) * innerWidth;
      let screenY = (-this.point.y * 0.5 + 0.5) * innerHeight;
      const width = label.textContent.length * 6 + 12;
      if (!label.hidden) {
        for (let attempt = 0; attempt < targets.length; attempt++) {
          if (
            !placed.some(
              (box) =>
                Math.abs(box.x - screenX) < (box.width + width) / 2 + 4 &&
                Math.abs(box.y - screenY) < 24,
            )
          )
            break;
          screenY -= 24;
        }
        placed.push({ x: screenX, y: screenY, width });
      }
      label.style.left = `${screenX}px`;
      label.style.top = `${screenY}px`;
      label.style.setProperty(
        "--hp",
        `${(target.health / target.maxHealth) * 100}%`,
      );
    });
  }
  dispose(): void {
    this.group.removeFromParent();
    this.geometry.dispose();
    this.post.dispose();
    for (const geometry of this.details) geometry.dispose();
    this.postMaterial.dispose();
    for (const body of this.bodies) (body.material as THREE.Material).dispose();
    for (const label of this.labels) label.remove();
  }
}
