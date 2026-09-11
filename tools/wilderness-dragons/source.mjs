import * as THREE from 'three';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

/** Retain source FBX Model IDs, including repeated left/right limb names. */
export async function sourceLoader() {
  let code = await readFile(fileURLToPath(import.meta.resolve('three/addons/loaders/FBXLoader.js')), 'utf8');
  const marker = 'tracks = tracks.concat( scope.generateTracks( rawTracks ) );';
  if (!code.includes(marker)) throw new Error('FBX identity hook changed');
  code = code.replace(marker, 'const generated = scope.generateTracks(rawTracks); for (const track of generated) track.sourceNodeId = rawTracks.ID; tracks = tracks.concat(generated);');
  for (const [specifier, resolved] of [
    ['three', import.meta.resolve('three')],
    ['../libs/fflate.module.js', import.meta.resolve('three/addons/libs/fflate.module.js')],
    ['../curves/NURBSCurve.js', import.meta.resolve('three/addons/curves/NURBSCurve.js')],
  ]) code = code.replace(`from '${specifier}'`, `from ${JSON.stringify(resolved)}`);
  const {FBXLoader} = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`);
  const manager = new THREE.LoadingManager();
  manager.addHandler(/.*/, {path:'',setPath(){return this;},load: () => new THREE.Texture()});
  return new FBXLoader(manager);
}

export async function readFbx(loader, path) {
  const bytes = await readFile(path);
  try { return loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''); }
  catch (error) { throw new Error(`FBX parse ${path}: ${error.message}`); }
}

export function identities(root) {
  const byId = new Map(), byPath = new Map();
  root.traverse(node => {
    if (node.ID === undefined) return;
    const parts = [];
    for (let cursor = node; cursor && cursor !== root; cursor = cursor.parent) parts.unshift(cursor.name);
    const path = parts.join('/');
    if (byPath.has(path)) throw new Error(`Ambiguous dragon ancestry: ${path}`);
    byPath.set(path, node); byId.set(node.ID, path);
  });
  return {byId, byPath};
}

export function nameRig(root, identity) {
  const counts = new Map(); root.traverse(n => counts.set(n.name, (counts.get(n.name) ?? 0) + 1));
  for (const [path, node] of identity.byPath) if (counts.get(node.name) > 1) node.name = path.replace(/[^a-zA-Z0-9_]/g, '__');
}

export function importClip(source, targetIds, name, tempo = 1) {
  const sourceIds = identities(source), take = source.animations.find(a => a.name === 'Take 001') ?? source.animations[0];
  if (!take) throw new Error(`Missing dragon clip ${name}`);
  const seen = new Set();
  const tracks = take.tracks.map(original => {
    const path = sourceIds.byId.get(original.sourceNodeId), target = targetIds.byPath.get(path);
    if (!target) throw new Error(`Unbound ${name} source ${path}`);
    const track = original.clone(), property = track.name.slice(track.name.lastIndexOf('.') + 1);
    track.name = `${target.name}.${property}`;
    if (seen.has(track.name)) throw new Error(`Duplicate dragon channel ${track.name}`); seen.add(track.name);
    track.times = Float32Array.from(track.times, t => t * tempo);
    if (/^Root(?:_Pelvis)?$/i.test(target.name) && property === 'position') for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] = target.position.x; track.values[i + 2] = target.position.z;
    }
    return track;
  });
  return new THREE.AnimationClip(name, take.duration * tempo, tracks);
}
