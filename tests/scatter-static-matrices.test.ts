import * as THREE from "three";
import { expect, it } from "vitest";
import { WorldScene } from "../game/src/render/scene.js";

it("retains exact scatter placements and propagates transformed parents without local matrix composition", () => {
  const root = new THREE.Scene();
  const scene = new WorldScene(root);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  const source = new THREE.Mesh(geometry, material);
  const [mesh] = scene.scatterInstanced(source, [
    { position: [2, 1, -4], rotationY: 0.4, scale: [1, 2, 3] },
  ], "static-proof", { castShadow: false, compactVisibility: true });
  try {
    expect(mesh!.instanceCount).toBe(1);
    expect(mesh!.sourceGeometry).toBe(geometry);
    const before = Array.from(mesh!.instanceTransforms.array);
    root.updateMatrixWorld(true);
    expect(mesh!.matrixAutoUpdate).toBe(false);
    expect(mesh!.matrixWorldAutoUpdate).toBe(true);
    // World containers are static: moving one takes an explicit matrix update, then propagates.
    expect(scene.scatterGroup.matrixAutoUpdate).toBe(false);
    scene.scatterGroup.position.set(5, 0, 0);
    scene.scatterGroup.updateMatrix();
    root.updateMatrixWorld();
    expect(mesh!.matrixWorld.elements[12]).toBe(5);
    expect(Array.from(mesh!.instanceTransforms.array)).toEqual(before);
  } finally { scene.dispose(); geometry.dispose(); material.dispose(); }
});
