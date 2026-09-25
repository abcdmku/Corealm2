import * as THREE from "three";

/** The per-pass draw list `BatchedMesh` keeps in its private fields, which r185 does not type. */
interface DrawList {
  _multiDrawStarts: Int32Array;
  _multiDrawCounts: Int32Array;
  _multiDrawCount: number;
  _indirectTexture: THREE.DataTexture;
}

/**
 * A `BatchedMesh` whose camera draw list survives the sun-shadow pass and whose draws follow it
 * when it grows.
 *
 * `BatchedMesh` culls its instances into one shared draw list (starts, counts and the indirect
 * texture that maps each draw to its instance) in `onBeforeRender`, for whichever camera is drawing.
 * The WebGPU renderer draws the sun shadow map from inside the main pass: the first shadow-receiving
 * object's `updateBefore` runs the whole shadow render between that object's `onBeforeRender` and
 * its draw. When that object is a batch, the shadow pass re-culls the same list for the light camera
 * and the camera pass then draws the shadow camera's list. Instances outside the 96 m shadow box
 * vanish from view, and which batch is first changes with the camera, so a material's pieces in
 * a cell can blink out as the view turns or the player walks.
 *
 * The shadow pass keeps its own culling; the camera's list is restored after it. Marking the
 * indirect texture for upload again is what makes the GPU see the camera's list: the shadow pass
 * has been submitted by then, and the main pass uploads the texture when it binds this object.
 */
export function createEntityBatchMesh(maxInstances: number, maxVertices: number, maxIndices: number,
  material: THREE.Material): THREE.BatchedMesh {
  const mesh = new THREE.BatchedMesh(maxInstances, maxVertices, maxIndices, material);
  const list = mesh as unknown as DrawList;
  let starts = new Int32Array(0), counts = new Int32Array(0), indirect = new Uint32Array(0);
  let saved = -1;
  const castShadow = mesh.onBeforeShadow;
  mesh.onBeforeShadow = function (...args) {
    const count = list._multiDrawCount;
    // The arrays grow with the batch; the saved copies follow.
    if (starts.length < list._multiDrawStarts.length) {
      starts = new Int32Array(list._multiDrawStarts.length);
      counts = new Int32Array(list._multiDrawStarts.length);
      indirect = new Uint32Array(list._multiDrawStarts.length);
    }
    starts.set(list._multiDrawStarts.subarray(0, count));
    counts.set(list._multiDrawCounts.subarray(0, count));
    indirect.set((list._indirectTexture.image.data as Uint32Array).subarray(0, count));
    saved = count;
    castShadow.apply(this, args);
  };
  mesh.onAfterShadow = function () {
    if (saved < 0) return;
    list._multiDrawStarts.set(starts.subarray(0, saved));
    list._multiDrawCounts.set(counts.subarray(0, saved));
    (list._indirectTexture.image.data as Uint32Array).set(indirect.subarray(0, saved));
    list._multiDrawCount = saved;
    list._indirectTexture.needsUpdate = true;
    saved = -1;
  };
  // Growing swaps in new matrices, indirect and colour textures, but a compiled WebGPU draw binds
  // the textures its shader was built with, and the renderer only re-keys a draw when its material
  // version changes. A batch that grew after its first frame kept drawing through the old textures:
  // an instance map and matrices frozen at the moment of growth, against the current draw list, so
  // parts landed on other instances' transforms. Bumping the version rebuilds this batch's draws;
  // other draws of the shared material re-key once and keep their pipelines.
  const grow = mesh.setInstanceCount;
  mesh.setInstanceCount = function (maxInstanceCount) {
    grow.call(this, maxInstanceCount);
    (this.material as THREE.Material).needsUpdate = true;
  };
  return mesh;
}
