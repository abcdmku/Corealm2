/**
 * Unity `.anim` transform curves as a three.js clip, for studio packs whose takes exist only as
 * Unity animation assets (PixeliusVita monsters). Format conversion only: each curve is sampled
 * with its own Hermite tangents, Unity's FBX X mirror and metre conversion are undone, and the
 * Unity `root` object keeps its Y while its XZ travel is removed. Runs in Node and in the browser.
 */
import * as THREE from 'three';

function vector(text) {
  return [...text.matchAll(/[xyzw]:\s*([^,}\s]+)/g)].map((match) => Number(match[1]));
}

/** Read only the runtime transform curves, never their duplicated editor curves. */
function parseUnityAnimation(text) {
  text = text.replace(/\r\n/g, '\n');
  const duration = Number(text.match(/^    m_StopTime: (.+)$/m)?.[1]);
  if (!(duration > 0)) throw new Error('Unity animation has no valid stop time');
  const sections = text.split(/^  (m_\w+):/m);
  const curves = [];
  for (let i = 1; i < sections.length; i += 2) {
    const property = ({ m_RotationCurves: 'quaternion', m_PositionCurves: 'position', m_ScaleCurves: 'scale' })[sections[i]];
    if (!property) continue;
    for (const block of sections[i + 1].split('\n  - curve:').slice(1)) {
      const path = block.match(/^    path: (.*)$/m)?.[1]?.trim();
      if (!path) throw new Error('Unity transform curve has no bone path');
      const keys = [];
      for (const match of block.matchAll(/        time: ([^\n]+)\n        value: (\{[^\n]+\})\n        inSlope: (\{[^\n]+\})\n        outSlope: (\{[^\n]+\})/g)) {
        keys.push({ time: Number(match[1]), value: vector(match[2]), incoming: vector(match[3]), outgoing: vector(match[4]) });
      }
      if (!keys.length) throw new Error(`Unity curve ${path}.${property} has no keys`);
      curves.push({ path, property, keys });
    }
  }
  if (!curves.length) throw new Error('Unity animation has no transform curves');
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

/** One `.anim` take bound to the bones of `object` (an FBXLoader rig in centimetres). */
export function convertUnityAnimation(text, object, name, sampleRate = 60) {
  const source = parseUnityAnimation(text);
  const tracks = [];
  const frames = Math.ceil(source.duration * sampleRate);
  const times = Array.from({ length: frames + 1 }, (_, i) => source.duration * i / frames);
  for (const curve of source.curves) {
    const nodeName = THREE.PropertyBinding.sanitizeNodeName(curve.path.split('/').at(-1));
    const node = object.getObjectByName(nodeName);
    if (!node) throw new Error(`Clip ${name} addresses missing bone ${curve.path}`);
    const values = [];
    let previousQuaternion;
    for (const time of times) {
      let value = sampleCurve(curve, time);
      if (curve.property === 'position') {
        value = [-value[0] * 100, value[1] * 100, value[2] * 100];
        // Simulation owns world travel; the root keeps its authored vertical motion.
        if (curve.path === 'root') value = [0, value[1], 0];
      } else if (curve.property === 'quaternion') {
        const q = new THREE.Quaternion(value[0], -value[1], -value[2], value[3]).normalize();
        if (previousQuaternion && previousQuaternion.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        previousQuaternion = q.clone();
        value = q.toArray();
      }
      if (!value.every(Number.isFinite)) throw new Error(`Non-finite ${name}/${nodeName} transform`);
      values.push(...value);
    }
    const Track = curve.property === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    tracks.push(new Track(`${nodeName}.${curve.property}`, times, values).optimize());
  }
  return new THREE.AnimationClip(name, source.duration, tracks);
}
