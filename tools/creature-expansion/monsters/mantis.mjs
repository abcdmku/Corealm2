import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { groundMantisAnimations } from './mantis/grounded.mjs';

const SOURCE_BASE = '/test-results/creature-expansion/sources/monsters/mantis/Assets/Stylized3DMonster/Monster09/';
const CLIP_SOURCES = [
  ['Idle', 'Idle'], ['Walk', 'Walk'], ['Run', 'Run'],
  ['Attack', 'Attack02'], ['Hit', 'GetHit'], ['Death', 'Die'],
];

function vector(text) {
  return [...text.matchAll(/[xyzw]:\s*([^,}\s]+)/g)].map((match) => Number(match[1]));
}

/** Read only the runtime transform curves, never their duplicated editor curves. */
export function parseMantisUnityAnimation(text) {
  text = text.replace(/\r\n/g, '\n');
  const duration = Number(text.match(/^    m_StopTime: (.+)$/m)?.[1]);
  if (!(duration > 0)) throw new Error('Monster09 animation has no valid stop time');
  const sections = text.split(/^  (m_\w+):/m);
  const curves = [];
  for (let i = 1; i < sections.length; i += 2) {
    const property = ({ m_RotationCurves: 'quaternion', m_PositionCurves: 'position', m_ScaleCurves: 'scale' })[sections[i]];
    if (!property) continue;
    for (const block of sections[i + 1].split('\n  - curve:').slice(1)) {
      const path = block.match(/^    path: (.*)$/m)?.[1]?.trim();
      if (!path) throw new Error('Monster09 transform curve has no bone path');
      const keys = [];
      for (const match of block.matchAll(/        time: ([^\n]+)\n        value: (\{[^\n]+\})\n        inSlope: (\{[^\n]+\})\n        outSlope: (\{[^\n]+\})/g)) {
        keys.push({ time: Number(match[1]), value: vector(match[2]), incoming: vector(match[3]), outgoing: vector(match[4]) });
      }
      if (!keys.length) throw new Error(`Monster09 curve ${path}.${property} has no keys`);
      curves.push({ path, property, keys });
    }
  }
  if (!curves.length) throw new Error('Monster09 animation has no transform curves');
  return { duration, curves };
}

function sampleCurve(curve, time) {
  const keys = curve.keys;
  if (time <= keys[0].time) return [...keys[0].value];
  if (time >= keys.at(-1).time) return [...keys.at(-1).value];
  let index = 0;
  while (index + 1 < keys.length && keys[index + 1].time <= time) index++;
  const a = keys[index];
  const b = keys[index + 1];
  const span = b.time - a.time;
  const u = (time - a.time) / span;
  const u2 = u * u;
  const u3 = u2 * u;
  return a.value.map((value, component) => {
    if (!Number.isFinite(a.outgoing[component]) || !Number.isFinite(b.incoming[component])) return value;
    return (2 * u3 - 3 * u2 + 1) * value + (u3 - 2 * u2 + u) * span * a.outgoing[component]
      + (-2 * u3 + 3 * u2) * b.value[component] + (u3 - u2) * span * b.incoming[component];
  });
}

/** Unity reflects FBX X and converts centimetres to metres. Undo that at every joint. */
export function convertMantisUnityAnimation(text, object, name, sampleRate = 60) {
  const source = parseMantisUnityAnimation(text);
  const tracks = [];
  const frames = Math.ceil(source.duration * sampleRate);
  const times = Array.from({ length: frames + 1 }, (_, i) => source.duration * i / frames);
  for (const curve of source.curves) {
    const nodeName = THREE.PropertyBinding.sanitizeNodeName(curve.path.split('/').at(-1));
    const node = object.getObjectByName(nodeName);
    if (!node) throw new Error(`Monster09 clip ${name} addresses missing bone ${curve.path}`);
    const values = [];
    let previousQuaternion;
    for (const time of times) {
      let value = sampleCurve(curve, time);
      if (curve.property === 'position') {
        value = [-value[0] * 100, value[1] * 100, value[2] * 100];
        // Source locomotion travels forward. Simulation owns world travel, while
        // the pelvis retains its authored weight transfer and vertical movement.
        if (curve.path === 'root') value = [0, value[1], 0];
      } else if (curve.property === 'quaternion') {
        const q = new THREE.Quaternion(value[0], -value[1], -value[2], value[3]).normalize();
        if (previousQuaternion && previousQuaternion.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        previousQuaternion = q.clone();
        value = q.toArray();
      }
      if (!value.every(Number.isFinite)) throw new Error(`Non-finite Monster09 ${name}/${nodeName} transform`);
      values.push(...value);
    }
    const Track = curve.property === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    tracks.push(new Track(`${nodeName}.${curve.property}`, times, values).optimize());
  }
  const clip = new THREE.AnimationClip(name, source.duration, tracks);
  const rootMotion = source.curves.find((curve) => curve.path === 'root' && curve.property === 'position');
  const start = rootMotion?.keys[0].value ?? [0, 0, 0];
  const end = rootMotion?.keys.at(-1).value ?? [0, 0, 0];
  clip.userData = { source: `Monster09_${({ Attack: 'Attack02', Hit: 'GetHit', Death: 'Die' })[name] ?? name}.anim`, rootTravelMetres: Math.hypot(end[0] - start[0], end[2] - start[2]) };
  return clip;
}

function directionalHit(source, name, side) {
  const clip = source.clone();
  clip.name = name;
  const q = new THREE.Quaternion();
  const offset = new THREE.Quaternion();
  for (const track of clip.tracks) {
    const weight = ({ 'spine_01x.quaternion': 0.08, 'spine_02x.quaternion': 0.10, 'spine_03x.quaternion': 0.10, 'neckx.quaternion': 0.07 })[track.name];
    if (!weight) continue;
    for (let i = 0; i < track.times.length; i++) {
      const phase = track.times[i] / clip.duration;
      const impact = phase < 0.24 ? Math.sin(phase / 0.24 * Math.PI / 2) : Math.cos((phase - 0.24) / 0.76 * Math.PI / 2) ** 2;
      q.fromArray(track.values, i * 4);
      offset.setFromEuler(new THREE.Euler(side * weight * impact * 0.4, side * weight * impact, side * weight * impact * 0.6));
      q.multiply(offset).normalize().toArray(track.values, i * 4);
    }
  }
  return clip;
}

export async function buildMantis({ sourceBase = SOURCE_BASE, textureVariant = '01' } = {}) {
  const response = await fetch(`${sourceBase}Monster09.fbx`);
  if (!response.ok) throw new Error(`Monster09 FBX fetch failed: ${response.status}`);
  const object = new FBXLoader().parse(await response.arrayBuffer(), sourceBase);
  object.name = 'gorge_mantis';
  object.scale.setScalar(0.01);
  const texture = await new THREE.TextureLoader().loadAsync(`${sourceBase}Shader_Texture/Texture/Monster09_${textureVariant}.png`);
  texture.name = `Monster09_${textureVariant}_source_albedo`;
  texture.colorSpace = THREE.SRGBColorSpace;
  // FBX UVs expect TextureLoader's default flipY=true. GLTFExporter bakes it.
  texture.flipY = true;
  const material = new THREE.MeshStandardMaterial({
    name: 'gorge_mantis_authored_chitin', map: texture, roughness: 0.76, metalness: 0.08,
  });
  object.traverse((node) => {
    if (!node.isMesh) return;
    node.material = material;
    node.castShadow = true;
    node.receiveShadow = true;
    if (node.isSkinnedMesh) node.normalizeSkinWeights();
  });
  let clips = await Promise.all(CLIP_SOURCES.map(async ([name, file]) => {
    const clipResponse = await fetch(`${sourceBase}Anim/Monster09_${file}.anim`);
    if (!clipResponse.ok) throw new Error(`Monster09 ${file} animation fetch failed: ${clipResponse.status}`);
    return convertMantisUnityAnimation(await clipResponse.text(), object, name);
  }));
  const hit = clips.find((clip) => clip.name === 'Hit');
  clips.push(directionalHit(hit, 'HitLeft', -1), directionalHit(hit, 'HitRight', 1));
  clips = groundMantisAnimations(object, clips);
  clips.sort((a, b) => ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'HitLeft', 'HitRight', 'Death'].indexOf(a.name) - ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'HitLeft', 'HitRight', 'Death'].indexOf(b.name));
  object.animations = clips;
  object.updateMatrixWorld(true);
  const walk = clips.find((clip) => clip.name === 'Walk');
  const run = clips.find((clip) => clip.name === 'Run');
  const attack = clips.find((clip) => clip.name === 'Attack');
  return {
    object,
    clips,
    meta: {
      id: 'gorge_mantis',
      is: 'A tall insectoid with jointed claws, a blue-grey shell, and folded reddish wings.',
      tags: ['creature', 'monster', 'mantis', 'insectoid', 'ground', 'chitin', 'claws'],
      provenance: {
        author: 'PixeliusVita', package: 'Fantasy Monster 09 Game Ready Rigged Animations PixeliusVita',
        sourceRig: 'Assets/Stylized3DMonster/Monster09/Monster09.fbx',
        sourceTexture: `Assets/Stylized3DMonster/Monster09/Shader_Texture/Texture/Monster09_${textureVariant}.png`,
        sourceAnimations: CLIP_SOURCES.map(([, file]) => `Monster09_${file}.anim`),
      },
      attackSeconds: attack.duration,
      contactNormalized: 0.316667,
      impliedWalkMps: 0.70 / (0.61 * walk.duration),
      impliedRunMps: 1.02 / (0.54 * run.duration),
      gaitFootBones: ['footl', 'footr'],
      walkClipSeconds: walk.duration,
      runClipSeconds: run.duration,
      notes: [
        'Original FBX geometry, UVs, vertex normals, inverse binds, and native 2048px texture preserved.',
        'Source package has no normal texture. The actual _BumpMap is empty; its legacy _NORMAL_MAP refers to an albedo texture and is not imported as a normal map.',
        'Original Unity quaternion, position, and scale curves resampled with cubic Hermite tangents at 60 Hz, with X handedness and metre-to-centimetre conversion.',
        'Source locomotion is a hovering animation. This ground adaptation replaces pelvis and leg poses with two-bone IK and alternating planted contacts. Foot sweeps are 0.70 m over 61% of Walk and 1.02 m over 54% of Run; implied speeds match those stance velocities.',
        'Both source wing pairs are folded down the back in every clip. Each baked frame corrects root Y against the actual skinned minimum. Source upper-body animation is retained.',
        'Root X/Z is fixed across all clips, including the source Die clip, whose original backward travel is removed for an in-place collapse.',
        'HitLeft and HitRight retain source GetHit recoil, adding a small directional torso bend. No flight clips are used.',
        'Attack contact at normalized 0.316667 is the sampled peak forward reach of the right middle claw, 1.061 m from origin. Production feature-lab acceptance remains required.',
      ],
    },
  };
}
