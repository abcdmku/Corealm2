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
    const before = Array.from(mesh!.instanceMatrix.array);
    root.updateMatrixWorld(true);
    expect(mesh!.matrixAutoUpdate).toBe(false);
    expect(mesh!.matrixWorldAutoUpdate).toBe(true);
    scene.scatterGroup.position.set(5, 0, 0);
    root.updateMatrixWorld(true);
    expect(mesh!.matrixWorld.elements[12]).toBe(5);
    expect(Array.from(mesh!.instanceMatrix.array)).toEqual(before);
  } finally { scene.dispose(); geometry.dispose(); material.dispose(); }
});
