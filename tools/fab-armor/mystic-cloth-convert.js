import * as THREE from '/node_modules/three/build/three.module.js';
import { GLTFLoader } from '/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from '/node_modules/three/examples/jsm/exporters/GLTFExporter.js';

// Candidate authoring only. These assets retain the production host skeleton and
// replace the rigid Kwang silhouette with fitted garments and continuous cloth UVs.
const families = { 50: 'tideweave', 70: 'nightweave', 90: 'frostweave' };
const loader = new GLTFLoader();
const vector = () => new THREE.Vector3();
const smooth = THREE.MathUtils.smoothstep;

function material(panel, name = panel) {
  const result = new THREE.MeshStandardMaterial({
    name: `Mystic_${name}`, color: 0xb4b4b4, roughness: .8,
    metalness: 0, side: THREE.DoubleSide,
  });
  result.userData = { fabRole: panel === 'soft-leather' ? 'leather' : 'cloth', fabMysticPanel: panel };
  return result;
}

function weights(entries, indices) {
  const combined = new Map();
  for (const [name, weight] of entries) if (weight > 0) {
    if (!indices.has(name)) throw new Error(`Missing host bone ${name}`);
    combined.set(indices.get(name), (combined.get(indices.get(name)) || 0) + weight);
  }
  const sorted = [...combined].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = sorted.reduce((sum, entry) => sum + entry[1], 0);
  return { index: Array.from({ length: 4 }, (_, n) => sorted[n]?.[0] || 0), weight: Array.from({ length: 4 }, (_, n) => (sorted[n]?.[1] || 0) / total) };
}

function torsoWeights(y, bones) {
  const chain = ['pelvis', 'spine_01', 'spine_02', 'spine_03'];
  for (let n = 0; n < chain.length - 1; n++) {
    const a = bones.get(chain[n]).y, b = bones.get(chain[n + 1]).y;
    if (y <= b) { const t = THREE.MathUtils.clamp((y - a) / (b - a), 0, 1); return [[chain[n], 1 - t], [chain[n + 1], t]]; }
  }
  return [['spine_03', 1]];
}

function skirtWeights(x, y, bones) {
  const left = smooth(x, -.075, .075);
  // Pelvis weighting ends before calf weighting begins, so the continuous
  // left/right blend always fits within the host's four-influence contract.
  // Following the lower leg keeps a raised walking boot inside the robe.
  const pelvis = smooth(y, .60, bones.get('pelvis').y + .05);
  const calf = (1 - smooth(y, .20, .60)) * .86;
  const thigh = 1 - pelvis - calf;
  return [['pelvis', pelvis], ['thigh_l', thigh * left], ['thigh_r', thigh * (1 - left)], ['calf_l', calf * left], ['calf_r', calf * (1 - left)]];
}

// Every row uses one continuous angular or longitudinal parameter. No vertex
// changes projection axes, including seams and folded hems.
function grid(nu, nv, sample, indices, flip = false) {
  const p = [], uv = [], si = [], sw = [], index = [];
  for (let y = 0; y <= nv; y++) for (let x = 0; x <= nu; x++) {
    const point = sample(x / nu, y / nv), w = weights(point.weights, indices);
    p.push(...point.position); uv.push(...point.uv); si.push(...w.index); sw.push(...w.weight);
  }
  for (let y = 0; y < nv; y++) for (let x = 0; x < nu; x++) {
    const a = y * (nu + 1) + x, b = a + 1, c = a + nu + 1, d = c + 1;
    if (flip) index.push(a, b, c, b, d, c);
    else index.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geometry.setIndex(index); geometry.computeVertexNormals();
  // Closed circular strips share a normal across the UV seam, while open robe
  // fronts deliberately keep two independent edges.
  const position = geometry.attributes.position, normal = geometry.attributes.normal;
  for (let row = 0; row <= nv; row++) {
    const a = row * (nu + 1), b = a + nu;
    const pa = vector().fromBufferAttribute(position, a), pb = vector().fromBufferAttribute(position, b);
    if (pa.distanceToSquared(pb) > 1e-10) continue;
    const n = vector().fromBufferAttribute(normal, a).add(vector().fromBufferAttribute(normal, b)).normalize();
    normal.setXYZ(a, n.x, n.y, n.z); normal.setXYZ(b, n.x, n.y, n.z);
  }
  return geometry;
}

async function fittedParts(url, skeleton, indices, filter, panel, name, report) {
  const scene = (await loader.loadAsync(url)).scene; scene.updateMatrixWorld(true);
  const output = [];
  scene.traverse(source => {
    if (!source.isSkinnedMesh) return;
    const mats = Array.isArray(source.material) ? source.material : [source.material];
    const sourceGeometry = source.geometry;
    // The donors and fitted Paragon files use a single material per primitive.
    if (mats.length !== 1) throw new Error(`Unexpected grouped donor ${source.name}`);
    if (!filter(source, mats[0])) { report.removed.push({ source: url, mesh: source.name, material: mats[0].name }); return; }
    const geometry = sourceGeometry.clone();
    geometry.applyMatrix4(source.matrixWorld);
    const skinIndex = geometry.attributes.skinIndex;
    for (let i = 0; i < skinIndex.count; i++) for (let k = 0; k < 4; k++) {
      const bone = source.skeleton.bones[skinIndex.getComponent(i, k)].name;
      if (!indices.has(bone)) throw new Error(`Donor has incompatible bone ${bone}`);
      skinIndex.setComponent(i, k, indices.get(bone));
    }
    geometry.deleteAttribute('color'); geometry.deleteAttribute('color1');
    geometry.deleteAttribute('uv1'); geometry.deleteAttribute('uv2');
    const mat = material(panel, name);
    // The retained sash keeps its original atlas and authored folds. Parent
    // materials add woven detail through its native UV0 only.
    if (url.includes('adapted-paragon')) {
      mat.map = mats[0].map;
      mat.normalMap = mats[0].normalMap;
      mat.normalScale.copy(mats[0].normalScale).multiplyScalar(.45);
      mat.aoMap = mats[0].aoMap?.channel === 0 ? mats[0].aoMap : null;
      mat.userData.fabMysticSource = mats[0].name;
    }
    const mesh = new THREE.SkinnedMesh(geometry, mat); mesh.name = `Mystic_${name}_${output.length}`;
    mesh.bind(skeleton, new THREE.Matrix4()); output.push(mesh);
    report.retained.push({ source: url, material: mats[0].name, name: mesh.name, panel, triangles: (geometry.index?.count ?? geometry.attributes.position.count) / 3 });
  });
  return output;
}

export async function convertMysticCloth(tier, gender) {
  const family = families[tier]; if (!family) throw new Error(`Invalid tier ${tier}`);
  const report = { tier, gender, family, retained: [], removed: [], authored: [], slots: {} };
  const output = {};
  const slots = tier === 90 ? ['body', 'legs', 'hands', 'feet'] : ['head', 'body', 'legs', 'hands', 'feet'];
  for (const slot of slots) {
    if (slot === 'head') continue; // Runner copies the unchanged licensed wrap.
    const host = (await loader.loadAsync(`/game/public/assets/models/character/base_${gender}.glb`)).scene;
    host.updateMatrixWorld(true);
    const hb = []; host.traverse(o => { if (o.isBone) hb.push(o); });
    const indices = new Map(hb.map((b, i) => [b.name, i]));
    const bones = new Map(hb.map(b => [b.name, b.getWorldPosition(vector())]));
    const group = new THREE.Group(); group.name = `Mystic_${gender}_${family}_${slot}`;
    group.add(hb.find(b => b.name === 'root')); group.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(hb, hb.map(b => b.matrixWorld.clone().invert()));
    const add = (geometry, panel, name) => {
      const mesh = new THREE.SkinnedMesh(geometry, material(panel, name)); mesh.name = `Mystic_${name}`;
      group.add(mesh); mesh.bind(skeleton, new THREE.Matrix4());
      report.authored.push({ slot, name, panel, vertices: geometry.attributes.position.count, triangles: geometry.index.count / 3 });
    };
    const donor = async (part, panel) => {
      const meshes = await fittedParts(`/game/public/assets/models/outfit/outfit_${gender}_peasant_${part}.glb`, skeleton, indices, () => true, panel, `${part}_base`, report);
      meshes.forEach(mesh => group.add(mesh));
    };
    const source = async (pattern, panel = 'outer') => {
      const meshes = await fittedParts(`/.asset-cache/fab-armor/adapted-paragon/fab_${gender}_${family}_${slot}.glb`, skeleton, indices, (_mesh, mat) => pattern.test(mat.name), panel, `${family}_silk`, report);
      meshes.forEach(mesh => group.add(mesh));
    };
    const scale = gender === 'female' ? .94 : 1;
    const waist = bones.get('pelvis').y + .1;
    const hem = tier === 50 ? .26 : tier === 70 ? .15 : .10;

    const skirtSample = (u, v, y0 = waist, y1 = hem, offset = 0) => {
      const y = THREE.MathUtils.lerp(y0, y1, v);
      const drop = THREE.MathUtils.clamp((waist - y) / (waist - hem), 0, 1);
      const gap = .012 + .15 * drop;
      const theta = THREE.MathUtils.lerp(gap, Math.PI * 2 - gap, u);
      const pleat = Math.cos(theta * (tier === 90 ? 18 : 14)) * (.005 + .012 * drop);
      const rx = (.19 + .09 * drop + pleat + offset) * scale;
      const rz = .13 + .045 * drop + pleat + offset;
      const rearClearance = .04 * smooth(drop, .3, 1) * smooth(-Math.cos(theta), 0, 1);
      const x = Math.sin(theta) * rx, z = Math.cos(theta) * rz - .037 - rearClearance;
      return { position: [x, y + Math.cos(theta * 7) * .008 * drop, z], uv: [u * 1.65, drop * 1.45], weights: skirtWeights(x, y, bones) };
    };
    const band = (y, height, panel, name, offset = .005) => add(grid(72, 2, (u, v) => skirtSample(u, v, y, y - height, offset), indices), panel, name);

    if (slot === 'body') {
      await donor('chest', 'outer');
      if (tier !== 90) await source(/Torso.*Silk/i, 'embroidery');
      // Rounded long sleeves replace the wide metal pauldrons and arm plates.
      for (const side of ['l', 'r']) {
        const a = bones.get(`upperarm_${side}`), b = bones.get(`lowerarm_${side}`), c = bones.get(`hand_${side}`);
        add(grid(32, 24, (u, v) => {
          const t = v * .965;
          const center = t <= .5 ? a.clone().lerp(b, t * 2) : b.clone().lerp(c, (t - .5) * 2);
          const radius = (.077 + .013 * Math.sin(t * Math.PI) - .02 * smooth(t, .76, 1)) * scale;
          const angle = u * Math.PI * 2;
          const fold = 1 + .035 * Math.cos(angle * 10) * Math.sin(t * Math.PI);
          const y = center.y + Math.cos(angle) * radius * fold;
          const z = center.z + Math.sin(angle) * radius * fold;
          const blend = smooth(t, .28, .72);
          return { position: [center.x, y, z], uv: [u * .7, t * 1.2], weights: [[`upperarm_${side}`, 1 - blend], [`lowerarm_${side}`, blend]] };
        }, indices, side === 'l'), 'outer', `flowing_sleeve_${side}`);
      }
      // A padded sash instead of an armored belt. Slightly overlaps both slots.
      band(waist + .025, .085, 'binding', 'woven_waist_sash', .012);
      if (tier === 90) {
        // Soft circular shawl, with a dipped front edge and rounded cloth folds.
        const neck = bones.get('neck_01').y;
        add(grid(72, 14, (u, v) => {
          const theta = u * Math.PI * 2;
          const rx = THREE.MathUtils.lerp(.078, .285 * scale, v);
          const rz = THREE.MathUtils.lerp(.075, .195, v);
          const sag = (.035 + .075 * Math.max(0, Math.cos(theta))) * v;
          const y = neck - .018 - sag + Math.cos(theta * 10) * .009 * Math.sin(v * Math.PI);
          const x = Math.sin(theta) * rx, z = Math.cos(theta) * rz - .035;
          return { position: [x, y, z], uv: [u * 1.7, v * .65], weights: [['spine_03', 1]] };
        }, indices), 'embroidery', 'aurora_rounded_shawl');
      }
    }
    if (slot === 'legs') {
      await donor('legs', 'lining');
      add(grid(72, 26, (u, v) => skirtSample(u, v), indices), 'outer', `${family}_pleated_robe`);
      band(hem + .075, .068, 'embroidery', 'embroidered_hem', .004);
      band(hem + .085, .012, 'binding', 'hem_piping', .005);
      if (tier !== 90) await source(tier === 50 ? /WaistArms_Silk/ : /WaistCloth/, 'embroidery');
      else {
        // The old free-hanging LowerClothes tail became a stiff triangular
        // paddle in alternating strides. This rounded lining follows the robe
        // itself, including its pleats, clearance, UVs, and skin weights.
        add(grid(24, 26, (u, v) => {
          const raisedHem = hem + .055 + .04 * Math.pow(Math.abs(u * 2 - 1), 2);
          return skirtSample(THREE.MathUtils.lerp(5 / 12, 7 / 12, u), v, waist - .035, raisedHem, .009);
        }, indices), 'lining', 'aurora_rounded_rear_lining');
        report.removed.push({ source: `/.asset-cache/fab-armor/adapted-paragon/fab_${gender}_${family}_legs.glb`, material: 'LowerClothes', reason: 'Replaced rigid free tail with robe-aligned rounded rear lining' });
      }
      if (tier >= 70) {
        // Two broad hanging stole ends. Curved in depth and subtly asymmetric.
        for (const side of [-1, 1]) {
          const length = tier === 90 ? .78 : side < 0 ? .67 : .49;
          add(grid(12, 22, (u, v) => {
            const y = waist - length * v;
            const x = side * (.086 + .02 * v) + (u - .5) * .105;
            const z = .112 + .045 * v + Math.sin(u * Math.PI) * .011;
            return { position: [x, y + Math.cos(u * Math.PI * 2) * .006 * v, z], uv: [u * .24, v * 1.25], weights: skirtWeights(x, y, bones) };
          }, indices), 'embroidery', `${family}_stole_${side}`);
        }
      }
    }
    if (slot === 'hands') {
      // The donor arm mesh is cropped at the wrist. The body owns the long
      // sleeve, and this slot owns cloth gloves and their narrow woven cuffs.
      const meshes = await fittedParts(`/game/public/assets/models/outfit/outfit_${gender}_peasant_gloves.glb`, skeleton, indices, () => true, 'soft-leather', 'soft_gloves', report);
      for (const mesh of meshes) {
        const g = mesh.geometry, sourceIndex = g.index?.array ?? Array.from({ length: g.attributes.position.count }, (_, i) => i);
        const kept = [];
        const threshold = Math.abs(bones.get('hand_l').x) - .024;
        for (let i = 0; i < sourceIndex.length; i += 3) {
          const x = [sourceIndex[i], sourceIndex[i + 1], sourceIndex[i + 2]].map(j => Math.abs(g.attributes.position.getX(j)));
          if (Math.max(...x) >= threshold) kept.push(sourceIndex[i], sourceIndex[i + 1], sourceIndex[i + 2]);
        }
        if (kept.length) { g.setIndex(kept); group.add(mesh); }
      }
      for (const side of ['l', 'r']) {
        const elbow = bones.get(`lowerarm_${side}`), wrist = bones.get(`hand_${side}`);
        add(grid(32, 4, (u, v) => {
          const t = .78 + v * .24, center = elbow.clone().lerp(wrist, t), angle = u * Math.PI * 2;
          const radius = (.06 - .004 * v) * scale;
          return { position: [center.x, center.y + Math.cos(angle) * radius, center.z + Math.sin(angle) * radius], uv: [u * .6, v * .15], weights: [[`lowerarm_${side}`, 1 - smooth(t, .95, 1.03)], [`hand_${side}`, smooth(t, .95, 1.03)]] };
        }, indices, side === 'l'), 'binding', `soft_cuff_${side}`);
      }
    }
    if (slot === 'feet') await donor('boots', 'soft-leather');

    group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(group);
    const meshes = []; group.traverse(mesh => { if (mesh.isSkinnedMesh) meshes.push(mesh); });
    if (!meshes.length) throw new Error(`No meshes for ${gender} ${family} ${slot}`);
    for (const mesh of meshes) {
      const g = mesh.geometry;
      for (let v = 0; v < g.attributes.position.count; v++) {
        const sum = [0, 1, 2, 3].reduce((n, k) => n + g.attributes.skinWeight.getComponent(v, k), 0);
        if (!Number.isFinite(sum) || Math.abs(sum - 1) > .002) throw new Error(`Invalid weights ${mesh.name} vertex ${v}: ${sum}`);
      }
    }
    const bytes = await new GLTFExporter().parseAsync(group, { binary: true, maxTextureSize: 1024 });
    output[slot] = {
      bytes: await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(new Blob([bytes])); }),
      bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
      materials: [...new Set(meshes.map(mesh => mesh.material.name))],
    };
    report.slots[slot] = { meshes: meshes.length, bones: hb.length, materials: output[slot].materials, bounds: output[slot].bounds };
  }
  return { output, report };
}
