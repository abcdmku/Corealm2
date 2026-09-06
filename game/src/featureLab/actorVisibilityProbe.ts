import * as THREE from "three";

/** Actual draw callbacks, so a resident actor with stale bounds cannot pass as visible. */
export function watchActorVisibility(scene: THREE.Scene, entityId: string) {
  const before = scene.onBeforeRender, after = scene.onAfterRender;
  const originals = new Map<THREE.Mesh, THREE.Mesh["onBeforeRender"]>();
  const frames: { draws: number; meshes: number; hidden: number; skinnedCulling: number }[] = [];
  let draws = 0;
  let current: THREE.Mesh[] = [];
  scene.onBeforeRender = function (...args) {
    before.apply(this, args);
    draws = 0;current = [];
    scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.entityId !== entityId) return;
      current.push(mesh);
      if (originals.has(mesh)) return;
      const original = mesh.onBeforeRender;
      originals.set(mesh, original);
      mesh.onBeforeRender = function (...drawArgs) { draws++;original.apply(this, drawArgs); };
    });
  };
  scene.onAfterRender = function (...args) {
    after.apply(this, args);
    frames.push({ draws, meshes: current.length, hidden: current.filter(mesh => !mesh.visible).length,
      skinnedCulling: current.filter(mesh => (mesh as THREE.SkinnedMesh).isSkinnedMesh && mesh.frustumCulled).length });
    if (frames.length > 240) frames.shift();
  };
  return {
    read: () => frames.map(frame => ({ ...frame })),
    stop: () => {
      scene.onBeforeRender = before;scene.onAfterRender = after;
      for (const [mesh, original] of originals) mesh.onBeforeRender = original;
    },
  };
}
