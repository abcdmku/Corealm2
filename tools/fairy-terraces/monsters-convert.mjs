import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { convertUnityAnimation } from '../creature-bodies/unity-anim.mjs';

const PATHS = { position: 'translation', quaternion: 'rotation', scale: 'scale' };

/** The source rig without textures (the build keeps production materials) or helper objects. */
async function loadFbx(url) {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((resource) => /\.(png|jpe?g|tga|bmp)$/i.test(resource)
    ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' : resource);
  const root = await new FBXLoader(manager).loadAsync(url);
  const helpers = [];
  root.traverse(node => { if (node.isLine || node.isPoints || node.isCamera || node.isLight) helpers.push(node); });
  for (const node of helpers) node.removeFromParent();
  return root;
}

/**
 * Reads PixeliusVita source takes and returns their keys unchanged apart from removing horizontal
 * root travel. No floor sealing, no loop-end overwrite, no resampling of FBX takes.
 * spec: { number, model, animationBase?, takes: [[clipName, takeSuffix]] }
 */
window.extractPixeliusTakes = async function(spec) {
  const root = await loadFbx(spec.model);
  const deforming = new Set(), bind = {};
  root.traverse(node => {
    if (!node.isSkinnedMesh) return;
    // Same inverse bind matrix GLTFExporter writes for this joint.
    node.skeleton.bones.forEach((bone, i) => {
      deforming.add(bone.name);
      bind[bone.name] = node.skeleton.boneInverses[i].clone().multiply(node.bindMatrix).toArray();
    });
  });
  const rest = {};
  root.traverse(node => {
    if (!node.name) return;
    if (rest[node.name]) throw new Error(`Duplicate source node name ${node.name}`);
    rest[node.name] = { translation: node.position.toArray(), rotation: node.quaternion.toArray(), scale: node.scale.toArray() };
  });
  const available = root.animations.map(clip => clip.name);
  const clips = [];
  for (const [name, suffix] of spec.takes) {
    let clip, source;
    if (spec.animationBase) {
      source = `Monster${spec.number}_${suffix}.anim`;
      const response = await fetch(`${spec.animationBase}/${source}`);
      if (!response.ok) throw new Error(`Missing source animation ${source}`);
      clip = convertUnityAnimation(await response.text(), root, name);
    } else {
      const take = root.animations.find(c => c.name === `Monster${spec.number}_${suffix}_InPlace`)
        ?? root.animations.find(c => c.name === `Monster${spec.number}_${suffix}`);
      if (!take) throw new Error(`Monster${spec.number} has no ${suffix} take; available ${available.join(', ')}`);
      source = take.name;
      clip = take.clone();
      // FBX takes carry curves for helper nodes too; only skeleton joints deform the mesh.
      clip.tracks = clip.tracks.filter(track => deforming.has(track.name.split('.')[0]));
    }
    // Simulation owns travel: horizontal root translation stays at rest, vertical motion is kept.
    for (const track of clip.tracks) {
      const [node, property] = track.name.split('.');
      if (property !== 'position' || !['root', 'rootx'].includes(node)) continue;
      const restPosition = rest[node].translation;
      for (let i = 0; i < track.values.length; i += 3) { track.values[i] = restPosition[0]; track.values[i + 2] = restPosition[2]; }
    }
    clips.push({ name, source, duration: clip.duration, tracks: clip.tracks.map(track => {
      const [node, property] = track.name.split('.');
      if (!PATHS[property]) throw new Error(`Unsupported track ${track.name}`);
      if (track.getInterpolation() !== THREE.InterpolateLinear) throw new Error(`Non-linear track ${track.name}`);
      return { node, path: PATHS[property], times: Array.from(track.times), values: Array.from(track.values) };
    }) });
  }
  return { rest, bind, available, clips };
};
