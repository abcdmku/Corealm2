import * as THREE from "three";
import { GLTFLoader, type GLTF, type GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { AssetCategory, AssetEntry } from "./assets.js";

/**
 * Measures a GLB the way `tools/build-assets.ts` does, anywhere three.js runs: in devdocs, when an
 * author uploads a model, and in node. The fields are the build's: `bytes`, the default scene's
 * world-space bounds as `size` and `base` (minimum corner), animation and material names in file
 * order, and the walk and run clip lengths `tools/build-animals.ts` records.
 *
 * Textures are not decoded: a measurement reads geometry and names, and a page or a node process may
 * not be able to decode every image format a model carries.
 */
export interface ModelMeasurement {
  bytes: number;
  size: { x: number; y: number; z: number };
  base: { x: number; y: number; z: number };
  animations: string[];
  materials: string[];
  walkClipSeconds?: number;
  runClipSeconds?: number;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

/** Every texture resolves to none, before any image is fetched or decoded, whichever extension carries it. */
function noTextures(parser: GLTFParser) {
  const dependency = parser.getDependency.bind(parser);
  parser.getDependency = ((type: string, index: number) => type === "texture" ? Promise.resolve(null) : dependency(type, index)) as GLTFParser["getDependency"];
  return { name: "corealm_measure_only" };
}

export async function parseModel(bytes: ArrayBuffer): Promise<GLTF> {
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(noTextures);
  return loader.parseAsync(bytes, "");
}

/** The length of the first clip whose name starts with `walk` or `run`, as the build rounds it. */
function clipSeconds(clips: readonly THREE.AnimationClip[], pattern: RegExp): number | undefined {
  const clip = clips.find(entry => pattern.test(entry.name));
  return clip && clip.duration > 0 ? round(clip.duration) : undefined;
}

export async function measureModel(bytes: ArrayBuffer): Promise<ModelMeasurement> {
  const gltf = await parseModel(bytes);
  const json = gltf.parser.json as { materials?: { name?: string }[]; animations?: { name?: string }[] };
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  // The build's `getBounds`: every mesh vertex through its node's world matrix, bind pose, no skinning.
  const box = new THREE.Box3(), point = new THREE.Vector3();
  scene.traverse(node => {
    const mesh = node as THREE.Mesh;
    const position = mesh.isMesh ? mesh.geometry.getAttribute("position") : undefined;
    if (!position) return;
    for (let index = 0; index < position.count; index++) box.expandByPoint(point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld));
  });
  const measured = !box.isEmpty() && [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(Number.isFinite);
  const walk = clipSeconds(gltf.animations, /^walk/i), run = clipSeconds(gltf.animations, /^run/i);
  return {
    bytes: bytes.byteLength,
    size: measured ? { x: round(box.max.x - box.min.x), y: round(box.max.y - box.min.y), z: round(box.max.z - box.min.z) } : { x: 0, y: 0, z: 0 },
    base: measured ? { x: round(box.min.x), y: round(box.min.y), z: round(box.min.z) } : { x: 0, y: 0, z: 0 },
    animations: (json.animations ?? []).map(animation => animation.name ?? ""),
    materials: (json.materials ?? []).map(material => material.name ?? ""),
    ...(walk === undefined ? {} : { walkClipSeconds: walk }),
    ...(run === undefined ? {} : { runClipSeconds: run }),
  };
}

/** What an author chooses for an uploaded model. */
export interface ModelIdentity {
  id: string;
  category: AssetCategory;
  pack: string;
  /** What the mesh is, one word (see `AssetEntry.is`). */
  is: string;
  tags: string[];
  /** Authored contact height, when the lowest vertex is not where it stands. */
  groundY?: number;
}

/** Where an uploaded model's file lives under `assets/`. */
export function modelFile(category: AssetCategory, id: string): string {
  return `models/${category}/${id}.glb`;
}

/** The manifest entry for a measured model. */
export function modelEntry(measurement: ModelMeasurement, identity: ModelIdentity): AssetEntry {
  return {
    id: identity.id, file: modelFile(identity.category, identity.id), pack: identity.pack, category: identity.category,
    is: identity.is, tags: [...identity.tags], ...measurement,
    ...(identity.groundY === undefined ? {} : { groundY: identity.groundY }),
  };
}
