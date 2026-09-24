import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Matrix4, Vector3 } from 'three';
import { deformedBounds } from '../../../../../../tools/creature-motion/validate-deformation.ts';
import { applyClip, restorePose, storedPose } from '../../../../../../tools/creature-motion/pose.ts';

const dir = 'assets/art/tripo/imports/creatures/audit-polish-dragons';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const builderSha256 = sha(await readFile(new URL(import.meta.url)));
const manifest = JSON.parse(await readFile(`${dir}/source-manifest.json`, 'utf8'));
const measurements = JSON.parse(await readFile('assets/art/wilderness-dragons/source-and-measurements.json', 'utf8'));
const xyz = a => ({ x: a[0], y: a[1], z: a[2] });
await mkdir(`${dir}/models`, { recursive: true });

// Coordinates are in the source dragon's rest world, in metres. The builder
// converts each facet to its parent's bone space; the native skin, wing joints,
// and all animation channels remain untouched.
const specs = [
  {
    id: 'creature_amethyst_dragon', expected: 'ebd8008e01a38becaef193e72def2a11ddcf686be94ca985e5c89707ee99ea87',
    title: 'Amethyst Dragon', palette: [
      [0.23, 0.10, 0.40], [0.38, 0.19, 0.62], [0.65, 0.42, 0.83], [0.84, 0.69, 0.94],
    ],
    spikes: [
      ['Spine01',[0,1.54,-1.45],[0,2.04,-1.55],.18],
      ['Spine01',[-.37,1.45,-1.39],[-.53,1.84,-1.51],.14],
      ['Spine01',[.37,1.45,-1.39],[.53,1.84,-1.51],.14],
      ['Spine02',[0,1.83,-.55],[0,2.61,-.64],.24],
      ['Spine02',[-.46,1.62,-.47],[-.64,2.17,-.55],.16],
      ['Spine02',[.46,1.62,-.47],[.64,2.17,-.55],.16],
      ['Chest',[0,1.96,.36],[0,2.80,.44],.27],
      ['Chest',[-.51,1.80,.42],[-.75,2.40,.49],.17],
      ['Chest',[.51,1.80,.42],[.75,2.40,.49],.17],
      ['Neck01',[0,1.77,1.13],[0,2.20,1.24],.15],
      ['Head',[-.22,1.55,2.57],[-.35,2.12,2.49],.15],
      ['Head',[.22,1.55,2.57],[.35,2.12,2.49],.15],
    ],
    changes: 'Native layered amethyst scale atlas, normal map, 119-joint skin, wings and seven clips retained. Added 12 faceted violet crystal spires bound to spine, chest, neck and head bones for a readable amethyst crown and high-tier dorsal silhouette.',
    recommendation: 'Keep current 3.42 m native rest height; the taller dorsal crystals should make level 125-130 read without enlarging encounter footprint.',
  },
  {
    id: 'creature_purple_wilderness_dragon', expected: '7a533b8765632aeff027bb76fa085f9a35d79bb39c4261ab61cc6ec2ed307186',
    title: 'Violet Dreadwing', palette: [
      [0.06, 0.045, 0.10], [0.16, 0.11, 0.21], [0.31, 0.25, 0.34], [0.55, 0.50, 0.56],
    ],
    spikes: [
      ['Tail3',[0,.67,-3.42],[0,1.06,-3.68],.15],
      ['Tail2',[0,1.01,-2.68],[0,1.51,-2.92],.18],
      ['Tail1',[0,1.42,-1.97],[0,2.04,-2.21],.21],
      ['Spine1',[0,1.69,-1.10],[0,2.31,-1.33],.22],
      ['Spine2',[0,1.85,-.29],[0,2.51,-.51],.23],
      ['Chest',[0,1.95,.29],[0,2.47,.04],.20],
      ['Chest',[-.56,1.70,.15],[-.81,2.15,-.15],.19],
      ['Chest',[.56,1.70,.15],[.81,2.15,-.15],.19],
      ['Head',[-.34,2.79,1.13],[-.72,3.43,.55],.19],
      ['Head',[.34,2.79,1.13],[.72,3.43,.55],.19],
      ['UpperHead1',[-.17,2.94,1.38],[-.28,3.25,1.65],.11],
      ['UpperHead1',[.17,2.94,1.38],[.28,3.25,1.65],.11],
    ],
    changes: 'Native violet and umber scale atlas, pale wing membranes, normal map, 83-joint skin and seven clips retained. Added 12 dark bone and shale thorns bound to tail, back, shoulders and head, with swept twin crown horns for a distinct wilderness silhouette.',
    recommendation: 'Keep native 3.37 m rest height and 3.7 m encounter footprint; hooked horns extend the top silhouette but not body radius.',
  },
];

function makeFacetMesh(doc, spec, parent, spikes) {
  const inverse = new Matrix4().fromArray(parent.getWorldMatrix()).invert();
  const positions = [], normals = [], colors = [], indices = [];
  const append = (a, b, c, color) => {
    const va = new Vector3().fromArray(a).applyMatrix4(inverse);
    const vb = new Vector3().fromArray(b).applyMatrix4(inverse);
    const vc = new Vector3().fromArray(c).applyMatrix4(inverse);
    const n = new Vector3().subVectors(vb, va).cross(new Vector3().subVectors(vc, va)).normalize();
    const start = positions.length / 3;
    for (const v of [va,vb,vc]) { positions.push(...v.toArray()); normals.push(...n.toArray()); colors.push(...color); }
    indices.push(start, start+1, start+2);
  };
  for (const [base, tip, radius] of spikes) {
    const axis = new Vector3().fromArray(tip).sub(new Vector3().fromArray(base)).normalize();
    const guide = Math.abs(axis.y) > .9 ? new Vector3(0,0,1) : new Vector3(0,1,0);
    const u = new Vector3().crossVectors(axis, guide).normalize();
    const v = new Vector3().crossVectors(axis, u).normalize();
    const start = new Vector3().fromArray(base), end = new Vector3().fromArray(tip);
    const middle = start.clone().lerp(end,.57);
    const ring = (center, r, k) => Array.from({length:6}, (_,i) => {
      const t = (i+.5)*Math.PI/3;
      return center.clone().addScaledVector(u,Math.cos(t)*r).addScaledVector(v,Math.sin(t)*r).toArray();
    });
    const lower = ring(start, radius,0), upper = ring(middle,radius*.78,1);
    for (let i=0;i<6;i++) {
      const next=(i+1)%6;
      const baseColor=spec.palette[i%2];
      const midColor=spec.palette[1+i%2];
      const tipColor=spec.palette[2+i%2];
      append(lower[i],lower[next],upper[next],baseColor);
      append(lower[i],upper[next],upper[i],midColor);
      append(upper[i],upper[next],end.toArray(),tipColor);
    }
  }
  const buffer = doc.getRoot().listBuffers()[0];
  const a = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const material = doc.createMaterial(`${spec.title} faceted hornstone`)
    .setBaseColorFactor([1,1,1,1]).setMetallicFactor(spec.id.includes('amethyst') ? .30 : .12)
    .setRoughnessFactor(spec.id.includes('amethyst') ? .24 : .52).setDoubleSided(true);
  const primitive = doc.createPrimitive().setMaterial(material)
    .setAttribute('POSITION',a('VEC3',Float32Array.from(positions)))
    .setAttribute('NORMAL',a('VEC3',Float32Array.from(normals)))
    .setAttribute('COLOR_0',a('VEC3',Float32Array.from(colors)))
    .setIndices(a('SCALAR',Uint16Array.from(indices)));
  const mesh = doc.createMesh(`${spec.title} bone-bound facets`).addPrimitive(primitive);
  const node = doc.createNode(`${spec.title} facets ${parent.getName()}`).setMesh(mesh);
  parent.addChild(node);
  return { triangles: indices.length/3, vertices: positions.length/3 };
}

const entries = [], promotions = [], files = {};
for (const spec of specs) {
  const sourceFile = `${dir}/sources/${spec.id}.glb`;
  const sourceBytes = await readFile(sourceFile);
  if (sha(sourceBytes) !== spec.expected) throw new Error(`${spec.id}: source hash changed`);
  const doc = await io.readBinary(sourceBytes), root = doc.getRoot();
  const nativeClips = root.listAnimations().map(a => a.getName());
  const nativeJoints = root.listSkins().map(s => s.listJoints().map(j => j.getName()));
  const nativeMeshes = root.listMeshes().map(m => m.listPrimitives().map(p => p.getAttribute('POSITION')?.getCount()));
  const counts = [];
  for (const name of new Set(spec.spikes.map(s => s[0]))) {
    const parent = root.listNodes().find(n => n.getName() === name);
    if (!parent || !root.listSkins()[0].listJoints().includes(parent)) throw new Error(`${spec.id}: missing native bone ${name}`);
    counts.push(makeFacetMesh(doc,spec,parent,spec.spikes.filter(s => s[0] === name).map(s => s.slice(1))));
  }
  if (JSON.stringify(nativeClips) !== JSON.stringify(root.listAnimations().map(a => a.getName())) ||
      JSON.stringify(nativeJoints) !== JSON.stringify(root.listSkins().map(s => s.listJoints().map(j => j.getName()))) ||
      JSON.stringify(nativeMeshes) !== JSON.stringify(root.listMeshes().slice(0,nativeMeshes.length).map(m => m.listPrimitives().map(p => p.getAttribute('POSITION')?.getCount())))) {
    throw new Error(`${spec.id}: native rig, clips or mesh changed`);
  }
  const bytes = await io.writeBinary(doc), filename = `models/${spec.id}.glb`;
  const sourceRoot = (await io.readBinary(sourceBytes)).getRoot();
  const verifyRoot = (await io.readBinary(bytes)).getRoot();
  const digestArray = a => sha(Buffer.from(a.buffer,a.byteOffset,a.byteLength));
  const originalPrimitive = sourceRoot.listMeshes()[0].listPrimitives()[0];
  const candidatePrimitive = verifyRoot.listMeshes()[0].listPrimitives()[0];
  for (const semantic of originalPrimitive.listSemantics()) {
    if (digestArray(originalPrimitive.getAttribute(semantic).getArray()) !==
        digestArray(candidatePrimitive.getAttribute(semantic).getArray())) {
      throw new Error(`${spec.id}: native ${semantic} changed`);
    }
  }
  if (digestArray(originalPrimitive.getIndices().getArray()) !== digestArray(candidatePrimitive.getIndices().getArray())) {
    throw new Error(`${spec.id}: native indices changed`);
  }
  for (let i=0;i<nativeClips.length;i++) {
    const a = sourceRoot.listAnimations()[i].listChannels(), b = verifyRoot.listAnimations()[i].listChannels();
    if (a.length !== b.length) throw new Error(`${spec.id}: ${nativeClips[i]} channel count changed`);
    for (let j=0;j<a.length;j++) {
      if (a[j].getTargetNode().getName() !== b[j].getTargetNode().getName() ||
          a[j].getTargetPath() !== b[j].getTargetPath() ||
          digestArray(a[j].getSampler().getInput().getArray()) !== digestArray(b[j].getSampler().getInput().getArray()) ||
          digestArray(a[j].getSampler().getOutput().getArray()) !== digestArray(b[j].getSampler().getOutput().getArray())) {
        throw new Error(`${spec.id}: ${nativeClips[i]} native channel changed`);
      }
    }
  }
  for (let i=0;i<sourceRoot.listTextures().length;i++) {
    if (sha(sourceRoot.listTextures()[i].getImage()) !== sha(verifyRoot.listTextures()[i].getImage())) {
      throw new Error(`${spec.id}: source texture changed`);
    }
  }
  const candidateDoc = await io.readBinary(bytes), pose = storedPose(candidateDoc), motionBounds = {};
  for (const clip of candidateDoc.getRoot().listAnimations()) {
    const seconds = Math.max(...clip.listChannels().flatMap(c => [...c.getSampler().getInput().getArray()]));
    motionBounds[clip.getName()] = [];
    for (const fraction of [0,.5,1]) {
      restorePose(pose); applyClip(clip,seconds*fraction);
      const b = deformedBounds(candidateDoc);
      if (![...b.min,...b.max].every(Number.isFinite) || b.min[1] < -.15) {
        throw new Error(`${spec.id}: ${clip.getName()} invalid attachment bounds at ${fraction}`);
      }
      motionBounds[clip.getName()].push({fraction,min:b.min,max:b.max});
    }
  }
  restorePose(pose);
  await writeFile(`${dir}/${filename}`,bytes);
  const bounds = deformedBounds(doc), size = bounds.min.map((x,i) => bounds.max[i]-x);
  const previous = manifest.assets.find(a => a.id === spec.id);
  const sourcePack = manifest.packs.find(p => p.id === previous.pack);
  const measured = measurements.find(m => m.id === spec.id);
  const entry = {
    ...previous, pack: 'corealm-tripo-audit-polish-dragons', is: spec.title,
    tags: [...new Set([...previous.tags,'candidate','polished'])],
    bytes: bytes.length, sha256: sha(bytes), size: xyz(size), base: xyz(bounds.min), bounds, groundY: bounds.min[1],
    triangles: previous.triangles+counts.reduce((n,c)=>n+c.triangles,0),
    animations: nativeClips, materials: root.listMaterials().map(m => m.getName()), candidateFile: `${dir}/${filename}`,
    sourceProvenance: { sourceFile, sourceSha256: spec.expected, sourcePack: previous.pack, sourcePackAuthor: sourcePack.author,
      sourcePackLicense: sourcePack.license, archiveSha256: measured.provenance.archiveSha256,
      sourceMesh: measured.provenance.sourceMesh, builderFile: `${dir}/build-candidates.mjs`, builderSha256,
      changes: spec.changes, recommendation: spec.recommendation,
      verification: 'Native mesh attributes, indices, source textures, all joints and every animation channel match the source after roundtrip serialization.',
      motionBounds },
    attackSeconds: measured.measurement.clips.Attack.seconds,
    contactNormalized: measured.measurement.attackContact,
    acceptance: { sourceIdentityVerified: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
  };
  entries.push(entry);
  promotions.push({ ...entry, tags: entry.tags.filter(t=>t!=='candidate'),
    sourceProvenance: { ...entry.sourceProvenance, productionBeforeSha256: previous.sha256 },
    acceptance: { assetAudit: false, labAccepted: false, worldIntegrated: false } });
  files[spec.id]=filename;
  console.log(JSON.stringify({ id: spec.id, file: `${dir}/${filename}`, sha256: entry.sha256,
    bytes: entry.bytes, bounds, addedTriangles: counts.reduce((n,c)=>n+c.triangles,0),
    clips: nativeClips, attackSeconds: entry.attackSeconds, contactNormalized: entry.contactNormalized }));
}
await writeFile(`${dir}/lab-catalog.json`,JSON.stringify({schema:'corealm-lab-asset-candidates/1',assets:entries,files},null,2)+'\n');
await writeFile(`${dir}/promotion.json`,JSON.stringify({schema:'corealm-creature-promotion/1',packs:[{
  id:'corealm-tripo-audit-polish-dragons',name:'Corealm Wilderness Dragon Polish',author:'Corealm / Dungeon Mason',
  source:`${dir}/build-candidates.mjs`,license:'Standard Unity Asset Store EULA',generatorSha256:builderSha256,
}],assets:promotions},null,2)+'\n');
