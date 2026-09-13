import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type * as THREE from 'three';
import { viewerRegistry } from './registry.js';
import { creatureClipGroups, initialCreatureClip } from './clips.js';
import type { ViewerModel, ViewerSource } from './types.js';

export async function loadAssetModel(source: Exclude<ViewerSource, { mode: 'outfit' }>): Promise<ViewerModel> {
  if (source.mode === 'glb') {
    const gltf = await new GLTFLoader().loadAsync(source.url);
    const names = gltf.animations.map(clip => clip.name);
    return { root: gltf.scene, animationRoot: gltf.scene, clips: gltf.animations, clipGroups: creatureClipGroups(names),
      initialClip: initialCreatureClip(names), manifestSize: source.manifestSize, parts: [], attachments: [], missingBones: [],
      dispose() {
        const geometries = new Set<THREE.BufferGeometry>();
        const materials = new Set<THREE.Material>();
        const textures = new Set<THREE.Texture>();
        gltf.scene.traverse(object => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          geometries.add(mesh.geometry);
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            materials.add(material);
            for (const value of Object.values(material)) if (value && typeof value === 'object' && 'isTexture' in value) textures.add(value);
          }
        });
        for (const geometry of geometries) geometry.dispose();
        for (const material of materials) material.dispose();
        for (const texture of textures) texture.dispose();
        gltf.scene.removeFromParent();
      } };
  }
  const assets = await viewerRegistry();
  const original = await assets.load(source.assetId);
  const root = clone(original);
  const clips = assets.clipsOf(source.assetId);
  const names = clips.map(clip => clip.name);
  return { root, animationRoot: root, clips, clipGroups: creatureClipGroups(names), initialClip: initialCreatureClip(names),
    manifestSize: assets.entry(source.assetId)?.size, parts: [], attachments: [], missingBones: [], dispose() { root.removeFromParent(); } };
}
