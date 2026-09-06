import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { TRAVERSAL_CONTACTS, type ContactTraversalKind } from "../systems/traversalContacts.js";
import { buildDungeonGateMasonryWall, createDungeonGateMaterials, type DungeonGateMaterials } from "./dungeonGate.js";

/** Original metre-scale contact props. Final worlds can use these same IDs and dimensions. */
export function buildTraversalContactAsset(kind: ContactTraversalKind, materials = createDungeonGateMaterials()): THREE.Group {
  const d = TRAVERSAL_CONTACTS[kind];
  const group = new THREE.Group();
  group.name = d.assetId;
  if (kind === "climb" || kind === "vault") {
    group.add(buildDungeonGateMasonryWall({ minX: -d.width / 2, maxX: d.width / 2,
      height: d.rise, depth: d.depth, bottomAt: () => 0 }, materials));
  } else if (kind === "slide") {
    const geometry = new THREE.BoxGeometry(d.width, 1, d.depth, 4, 1, 8);
    const positions = geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const top = d.rise * (0.5 - positions.getZ(i) / d.depth) + 0.025;
      positions.setY(i, positions.getY(i) > 0 ? top : -0.05);
    }
    const colors = new Float32Array(positions.count * 3).fill(0.92);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    group.add(new THREE.Mesh(geometry, materials.stone));
  } else {
    const timber = new THREE.MeshStandardMaterial({ color: 0x67503a, roughness: 0.9 });
    timber.name = "Corealm worn balance timber";
    const geometry = new RoundedBoxGeometry(d.width, d.rise, d.depth, 2, 0.018);
    geometry.translate(0, d.rise / 2, 0);
    group.add(new THREE.Mesh(geometry, timber));
    const seamMaterial = new THREE.MeshStandardMaterial({ color: 0x3c3026, roughness: 1 });
    // Shallow parallel checks show the grain direction without thick decorative bands.
    for (const x of [-0.09, 0.065]) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.001, d.depth - 0.12), seamMaterial);
      seam.position.set(x, d.rise + 0.001, 0);
      group.add(seam);
    }
  }
  group.traverse((node) => { if ((node as THREE.Mesh).isMesh) { node.castShadow = true; node.receiveShadow = true; } });
  group.userData.traversalContact = { kind, ...d };
  return group;
}

export function registerTraversalContactAssets(
  registry: { registerBuilt(id: string, group: THREE.Group): void },
  materials?: DungeonGateMaterials,
): void {
  const shared = materials ?? createDungeonGateMaterials();
  for (const kind of Object.keys(TRAVERSAL_CONTACTS) as ContactTraversalKind[]) {
    registry.registerBuilt(TRAVERSAL_CONTACTS[kind].assetId, buildTraversalContactAsset(kind, shared));
  }
}
