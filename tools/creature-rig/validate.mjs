/**
 * Step 4: deformation and motion checks measured against the BIND pose (the raw vertex positions a
 * skin is authored on), not against the node rest. A pose baked into the rest is therefore visible.
 *
 * Per clip, over every key time:
 *   edge stretch and compression percentiles (deformed edge length / bind edge length)
 *   mesh volume ratio to bind
 *   non-root bone length change (distance to parent joint vs bind; the one translating joint is
 *     the root of motion and is exempt)
 *   scale channels, translation channels on non-root joints
 *   loop seam (largest vertex jump from the last key back to the first, as a share of height)
 *   planted feet: joints that reach the floor; in an in-place clip a planted foot moves backwards
 *     at the ground speed, so slip is the spread of its velocity while planted (and its sideways
 *     drift), and the ground speed is reported for the runtime's move-speed tables
 *
 *   node tools/creature-rig/validate.mjs <glb> [<glb> ...] [--json out.json]
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { accessor, readGlb } from "./glb.mjs";
import { isMain } from "./paths.mjs";

const slerp = (a, b, t) => {
  let [ax, ay, az, aw] = a;
  let [bx, by, bz, bw] = b;
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  if (dot < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; dot = -dot; }
  if (dot > 0.9995) {
    const o = [ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, aw + (bw - aw) * t];
    const l = Math.hypot(...o);
    return o.map((v) => v / l);
  }
  const th = Math.acos(dot);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return [ax * wa + bx * wb, ay * wa + by * wb, az * wa + bz * wb, aw * wa + bw * wb];
};

function trs(t, r, s) {
  const [x, y, z, w] = r;
  const [sx, sy, sz] = s;
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}

function mul(a, b) {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) {
    let v = 0;
    for (let k = 0; k < 4; k += 1) v += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = v;
  }
  return o;
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

export function validate(file) {
  const glb = readGlb(file);
  const { json } = glb;
  const skin = json.skins?.[0];
  if (!skin) throw new Error(`${file} has no skin`);
  const nodes = json.nodes;
  const meshNode = nodes.find((n) => n.skin !== undefined && n.mesh !== undefined);
  const ibm = accessor(glb, skin.inverseBindMatrices);
  const jointIndex = new Map(skin.joints.map((n, i) => [n, i]));

  // Bind geometry: every skinned primitive, positions as authored.
  const prims = json.meshes[meshNode.mesh].primitives.map((p) => ({
    pos: accessor(glb, p.attributes.POSITION),
    J: accessor(glb, p.attributes.JOINTS_0),
    W: accessor(glb, p.attributes.WEIGHTS_0),
    idx: p.indices === undefined ? null : accessor(glb, p.indices),
  }));
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of prims) for (let i = 1; i < p.pos.length; i += 3) { minY = Math.min(minY, p.pos[i]); maxY = Math.max(maxY, p.pos[i]); }
  const height = maxY - minY;

  const edges = [];
  for (const [pi, p] of prims.entries()) {
    const tri = p.idx ?? Float64Array.from({ length: p.pos.length / 3 }, (_, i) => i);
    const seen = new Set();
    for (let t = 0; t < tri.length; t += 3) for (const [a, b] of [[tri[t], tri[t + 1]], [tri[t + 1], tri[t + 2]], [tri[t + 2], tri[t]]]) {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = Math.hypot(p.pos[a * 3] - p.pos[b * 3], p.pos[a * 3 + 1] - p.pos[b * 3 + 1], p.pos[a * 3 + 2] - p.pos[b * 3 + 2]);
      if (d > 1e-6) edges.push([pi, a, b, d]);
    }
  }
  const signedVolume = (P) => {
    let v = 0;
    prims.forEach((p, pi) => {
      const tri = p.idx;
      if (!tri) return;
      const X = P[pi];
      for (let t = 0; t < tri.length; t += 3) {
        const [a, b, c] = [tri[t] * 3, tri[t + 1] * 3, tri[t + 2] * 3];
        v += X[a] * (X[b + 1] * X[c + 2] - X[b + 2] * X[c + 1]) - X[a + 1] * (X[b] * X[c + 2] - X[b + 2] * X[c]) + X[a + 2] * (X[b] * X[c + 1] - X[b + 1] * X[c]);
      }
    });
    return v / 6;
  };
  const bindVolume = signedVolume(prims.map((p) => p.pos));

  const parent = glb.parent;
  const restTRS = nodes.map((n) => ({ t: n.translation ?? [0, 0, 0], r: n.rotation ?? [0, 0, 0, 1], s: n.scale ?? [1, 1, 1] }));
  const bindJointPos = skin.joints.map((_, i) => {
    // Inverse of the IBM's translation part, for a rigid IBM: -R^T t.
    const m = ibm.subarray(i * 16, i * 16 + 16);
    return [-(m[0] * m[12] + m[1] * m[13] + m[2] * m[14]), -(m[4] * m[12] + m[5] * m[13] + m[6] * m[14]), -(m[8] * m[12] + m[9] * m[13] + m[10] * m[14])];
  });

  const report = { file: path.basename(file), height, joints: skin.joints.length, clips: [] };
  // A clip's bind-relative uniform scale (1 for a bind-consistent file) is reported per clip.
  for (const anim of json.animations ?? []) {
    const channels = anim.channels.map((c) => {
      const sampler = anim.samplers[c.sampler];
      return { node: c.target.node, path: c.target.path, times: accessor(glb, sampler.input), values: accessor(glb, sampler.output), interp: sampler.interpolation ?? "LINEAR" };
    });
    const times = [...new Set(channels.flatMap((c) => Array.from(c.times)))].sort((a, b) => a - b);
    const scaleChannels = channels.filter((c) => c.path === "scale").length;
    const translated = new Set(channels.filter((c) => c.path === "translation").map((c) => c.node));
    const movingTranslations = channels.filter((c) => c.path === "translation" && Array.from(c.values).some((v, i) => Math.abs(v - c.values[i % 3]) > 1e-6));
    const motionRoots = new Set(movingTranslations.map((c) => c.node));

    const ratios = [];
    let scale = null;
    let volumeMin = Infinity;
    let volumeMax = -Infinity;
    let boneChange = 0;
    const jointTracks = skin.joints.map(() => []);
    let firstPose = null;
    let lastPose = null;
    for (const time of times) {
      const local = restTRS.map((x) => ({ t: x.t, r: x.r, s: x.s }));
      for (const c of channels) {
        const w = c.path === "rotation" ? 4 : 3;
        const n = c.times.length;
        let k = 0;
        while (k < n - 1 && c.times[k + 1] <= time) k += 1;
        const at = (i) => Array.from(c.values.subarray(i * w, i * w + w));
        let value;
        if (time <= c.times[0] || n === 1) value = at(0);
        else if (k >= n - 1) value = at(n - 1);
        else {
          const f = c.interp === "STEP" ? 0 : (time - c.times[k]) / (c.times[k + 1] - c.times[k]);
          value = c.path === "rotation" ? slerp(at(k), at(k + 1), f) : at(k).map((v, i) => v + (at(k + 1)[i] - v) * f);
        }
        local[c.node] = { ...local[c.node], [c.path === "rotation" ? "r" : c.path === "translation" ? "t" : "s"]: value };
      }
      const world = new Array(nodes.length);
      const worldOf = (i) => {
        if (world[i]) return world[i];
        const m = trs(local[i].t, local[i].r, local[i].s);
        world[i] = parent[i] === undefined ? m : mul(worldOf(parent[i]), m);
        return world[i];
      };
      const skinM = skin.joints.map((n, i) => mul(worldOf(n), ibm.subarray(i * 16, i * 16 + 16)));
      const P = prims.map((p) => {
        const out = new Float64Array(p.pos.length);
        for (let v = 0; v < p.pos.length / 3; v += 1) {
          const [x, y, z] = [p.pos[v * 3], p.pos[v * 3 + 1], p.pos[v * 3 + 2]];
          for (let c = 0; c < 4; c += 1) {
            const w = p.W[v * 4 + c];
            if (!w) continue;
            const m = skinM[p.J[v * 4 + c]];
            out[v * 3] += w * (m[0] * x + m[4] * y + m[8] * z + m[12]);
            out[v * 3 + 1] += w * (m[1] * x + m[5] * y + m[9] * z + m[13]);
            out[v * 3 + 2] += w * (m[2] * x + m[6] * y + m[10] * z + m[14]);
          }
        }
        return out;
      });
      const frameRatios = edges.map(([pi, a, b, d]) => {
        const X = P[pi];
        return Math.hypot(X[a * 3] - X[b * 3], X[a * 3 + 1] - X[b * 3 + 1], X[a * 3 + 2] - X[b * 3 + 2]) / d;
      });
      // A file whose presentation scale is not in its inverse binds renders at a uniform scale of
      // its bind; measure deformation net of that one factor.
      if (scale === null) scale = [...frameRatios].sort((a, b) => a - b)[frameRatios.length >> 1];
      for (const r of frameRatios) ratios.push(r / scale);
      const vol = signedVolume(P) / bindVolume / scale ** 3;
      volumeMin = Math.min(volumeMin, vol);
      volumeMax = Math.max(volumeMax, vol);
      skin.joints.forEach((n, i) => {
        const m = worldOf(n);
        jointTracks[i].push([m[12], m[13], m[14]]);
        const p = parent[n];
        if (p === undefined || !jointIndex.has(p) || motionRoots.has(n)) return;
        const pm = worldOf(p);
        const now = Math.hypot(m[12] - pm[12], m[13] - pm[13], m[14] - pm[14]);
        const bind = Math.hypot(...bindJointPos[i].map((v, k) => v - bindJointPos[jointIndex.get(p)][k]));
        boneChange = Math.max(boneChange, Math.abs(now - bind));
      });
      if (!firstPose) firstPose = P;
      lastPose = P;
    }
    let seam = 0;
    firstPose.forEach((X, pi) => { for (let i = 0; i < X.length; i += 3) seam = Math.max(seam, Math.hypot(X[i] - lastPose[pi][i], X[i + 1] - lastPose[pi][i + 1], X[i + 2] - lastPose[pi][i + 2])); });

    // Planted joints: those that come within 4% of height of the floor. While a joint is within
    // 1% of height of its own lowest point it is planted; its velocity then should be one constant
    // backwards speed (in place) with no sideways drift.
    const dt = times.length > 1 ? times[1] - times[0] : 1;
    const feet = [];
    jointTracks.forEach((track, i) => {
      const low = Math.min(...track.map((p) => p[1]));
      if (low > minY + 0.04 * height) return;
      const planted = track.map((p) => p[1] <= low + 0.01 * height);
      const vz = [];
      const vx = [];
      for (let f = 1; f < track.length; f += 1) if (planted[f] && planted[f - 1]) {
        vz.push((track[f][2] - track[f - 1][2]) / dt);
        vx.push((track[f][0] - track[f - 1][0]) / dt);
      }
      if (vz.length < 3) return;
      const mean = vz.reduce((a, b) => a + b, 0) / vz.length;
      const spread = Math.sqrt(vz.reduce((a, b) => a + (b - mean) ** 2, 0) / vz.length);
      const side = Math.max(...vx.map(Math.abs));
      feet.push({ joint: nodes[skin.joints[i]].name, plantedShare: +(planted.filter(Boolean).length / planted.length).toFixed(2), groundSpeed: +(-mean).toFixed(3), speedSpread: +spread.toFixed(3), sideways: +side.toFixed(3) });
    });

    ratios.sort((a, b) => a - b);
    report.clips.push({
      name: anim.name,
      uniformScale: +scale.toFixed(3),
      duration: +times[times.length - 1].toFixed(3),
      keys: times.length,
      scaleChannels,
      translatedJoints: [...translated].map((n) => nodes[n].name),
      stretch: { p001: +percentile(ratios, 0.001).toFixed(3), p01: +percentile(ratios, 0.01).toFixed(3), p50: +percentile(ratios, 0.5).toFixed(3), p99: +percentile(ratios, 0.99).toFixed(3), p999: +percentile(ratios, 0.999).toFixed(3), max: +ratios[ratios.length - 1].toFixed(3) },
      volume: [+volumeMin.toFixed(3), +volumeMax.toFixed(3)],
      boneLengthChange: +boneChange.toExponential(2),
      loopSeamShareOfHeight: +(seam / height).toFixed(4),
      feet,
    });
  }
  return report;
}

export function summarise(report) {
  const lines = [`${report.file}  height ${report.height.toFixed(2)} m  ${report.joints} joints`];
  for (const c of report.clips) {
    const feet = c.feet.filter((f) => /foot|ball|toe/i.test(f.joint)).map((f) => `${f.joint} v${f.groundSpeed}±${f.speedSpread} side${f.sideways}`).join("; ");
    lines.push(`  ${c.name.padEnd(8)} ${String(c.duration).padStart(5)}s  stretch p0.1 ${c.stretch.p001} p99.9 ${c.stretch.p999} max ${c.stretch.max}  vol ${c.volume.join("..")}  boneΔ ${c.boneLengthChange}  scaleCh ${c.scaleChannels}  moved ${c.translatedJoints.join(",") || "-"}  seam ${c.loopSeamShareOfHeight}${feet ? `\n           feet ${feet}` : ""}`);
  }
  return lines.join("\n");
}

if (isMain(import.meta)) {
  const args = process.argv.slice(2);
  const out = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
  const files = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--json");
  const reports = files.map(validate);
  for (const r of reports) console.log(summarise(r));
  if (out) writeFileSync(out, JSON.stringify(reports, null, 1));
}
