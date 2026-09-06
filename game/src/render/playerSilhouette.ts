import * as THREE from "three";
import { PlayerDepthVisibility } from "./playerDepthVisibility.js";

/** Draw only the occluded part of the animated player, using the completed scene depth. */
export class PlayerSilhouette {
  private readonly scene = new THREE.Scene();
  private readonly copies = new Map<THREE.Mesh, THREE.Mesh>();
  private readonly mask = new THREE.MeshBasicMaterial({
    colorWrite: false, depthWrite: false, depthFunc: THREE.LessEqualDepth,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
  });
  private readonly fill = new THREE.MeshBasicMaterial({
    color: 0x92a6a8, transparent: true, opacity: 0.24, toneMapped: false, fog: false,
    depthWrite: false, depthFunc: THREE.GreaterDepth,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
  });
  source: THREE.Object3D | null = null;
  private readonly visibility = new PlayerDepthVisibility();
  private active = false;
  private lastOpacityAt: number | null = null;
  private opacity = 0;
  snapshot(): { active: boolean; opacity: number } { return { active: this.active, opacity: this.fill.opacity }; }

  /** Ignore isolated limb and edge overlaps without delaying a substantial obstruction. */
  shouldShow(blockedSamples: number): boolean {
    return blockedSamples >= 4;
  }

  updateOpacity(blockedSamples: number, nowMs: number): number {
    const deltaMs = this.lastOpacityAt === null ? 16.667 : Math.min(50, Math.max(0, nowMs - this.lastOpacityAt));
    this.lastOpacityAt = nowMs;
    const step = deltaMs * 0.24 / 100;
    this.opacity = this.shouldShow(blockedSamples) ? Math.min(0.24, this.opacity + step) : Math.max(0, this.opacity - step);
    return this.opacity;
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    const blocked = this.visibility.sample(renderer, camera, this.source);
    this.fill.opacity = this.updateOpacity(blocked, performance.now());
    this.active = this.fill.opacity > 0;
    if (!this.active) return;
    const active = new Set<THREE.Mesh>();
    this.source?.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh)) return;
      active.add(object);
      let copy = this.copies.get(object);
      if (!copy) {
        copy = object.clone(false);
        copy.castShadow = false;
        copy.receiveShadow = false;
        copy.matrixAutoUpdate = false;
        this.copies.set(object, copy);
        this.scene.add(copy);
      }
      copy.geometry = object.geometry;
      copy.matrix.copy(object.matrixWorld);
      if (copy instanceof THREE.SkinnedMesh && object instanceof THREE.SkinnedMesh) {
        copy.skeleton = object.skeleton;
        copy.bindMatrix.copy(object.bindMatrix);
        copy.bindMatrixInverse.copy(object.bindMatrixInverse);
      }
      copy.morphTargetInfluences = object.morphTargetInfluences;
      copy.visible = true;
    });
    for (const [source, copy] of this.copies) if (!active.has(source)) {
      this.scene.remove(copy);
      this.copies.delete(source);
    }
    if (!active.size) return;
    const autoClear = renderer.autoClear;
    const infoAutoReset = renderer.info.autoReset;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    try {
      renderer.clearStencil();
      // Visible player pixels mask out self-occluded limbs and back faces.
      this.scene.overrideMaterial = this.mask;
      renderer.render(this.scene, camera);
      this.scene.overrideMaterial = this.fill;
      renderer.render(this.scene, camera);
    } finally {
      renderer.autoClear = autoClear;
      renderer.info.autoReset = infoAutoReset;
      this.scene.overrideMaterial = null;
    }
  }

  dispose(): void {
    this.visibility.dispose();
    this.scene.clear();
    this.copies.clear();
    this.mask.dispose();
    this.fill.dispose();
    this.source = null;
  }
}
