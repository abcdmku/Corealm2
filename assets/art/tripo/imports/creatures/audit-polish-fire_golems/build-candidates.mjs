import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const directory = 'assets/art/tripo/imports/creatures/audit-polish-fire_golems';
const manifest = JSON.parse(await readFile(`${directory}/source-manifest.json`, 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const builderSha256 = sha256(await readFile(`${directory}/build-candidates.mjs`));
const bump = (value, center, radius) => Math.exp(-(((value - center) / radius) ** 2));

// Sculpt the existing skinned Regent surface. The modest, smooth changes keep
// all topology, UVs, weights and native animation channels intact.
function sculptRegent(primitive) {
  const position = primitive.getAttribute('POSITION');
  const coordinates = Float32Array.from(position.getArray());
  const before = Float32Array.from(coordinates);
  for (let i = 0; i < coordinates.length; i += 3) {
    const x = before[i], y = before[i + 1], z = before[i + 2];
    const side = Math.abs(x), sign = Math.sign(x);
    const shoulder = bump(y, 1.56, .27) * Math.min(1, side / .55);
    const crest = bump(side, .56, .23) * bump(y, 1.66, .19);
    const crown = bump(side, .24, .11) * bump(y, 1.77, .12);
    const chest = bump(y, 1.31, .30) * bump(side, .28, .35);
    coordinates[i] = x * (1 + .13 * shoulder) + sign * .025 * crown;
    coordinates[i + 1] = y + .11 * crest + .13 * crown;
    coordinates[i + 2] = z * (1 + .09 * chest);
  }
  position.setArray(coordinates);
  const indices = primitive.getIndices().getArray();
  const normals = new Float32Array(coordinates.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const abx = coordinates[b] - coordinates[a], aby = coordinates[b + 1] - coordinates[a + 1], abz = coordinates[b + 2] - coordinates[a + 2];
    const acx = coordinates[c] - coordinates[a], acy = coordinates[c + 1] - coordinates[a + 1], acz = coordinates[c + 2] - coordinates[a + 2];
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    for (const vertex of [a, b, c]) { normals[vertex] += nx; normals[vertex + 1] += ny; normals[vertex + 2] += nz; }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= length; normals[i + 1] /= length; normals[i + 2] /= length;
  }
  primitive.getAttribute('NORMAL').setArray(normals);
  return { changedVertices: before.filter((value, index) => value !== coordinates[index]).length / 3,
    maximumYIncrease: Math.max(...coordinates.filter((_, index) => index % 3 === 1)) - Math.max(...before.filter((_, index) => index % 3 === 1)),
    description: 'Existing mesh shoulders widened and lifted into a crest, crown shoulders raised into paired rocky points, chest given extra depth; topology, UVs, weights, and rig unchanged.' };
}
const definitions = [
  {
    id: 'creature_furnace_regent', name: 'Furnace Regent',
    image: 'textures/furnace-regent-imagegen.png',
    description: 'High-tier forge lord with wider plated shoulders, paired crown peaks and deeper chest; black obsidian, gold mineral strata and a concentrated molten core.',
    content: 'Keep furnace_regent_t50 as the high-tier L90/L149 Furnace Regent identity; the candidate retains its 3.4 m boss height. Reserve this identity for major encounters.',
  },
  {
    id: 'creature_kiln_marrow', name: 'Kiln Marrow',
    image: 'textures/kiln-marrow-imagegen-v2.png', targetHeight: 2.2,
    description: 'Lower-tier cooled kiln construct: crisp chipped ash plates, dark seams, sparse banked embers and a legible stone face.',
    content: 'Use the smaller 2.2 m asset for kiln_marrow_t20 and pack_kilnhalt_clinker_southern_approach_west at L25/L28; review any L77 use because it now reads as an ordinary kiln construct. The ashback_bears and cinder_ravager_residents IDs still need content identity review.',
  },
  {
    id: 'creature_lava_golem', name: 'Lava Golem',
    image: 'textures/lava-golem-imagegen.png',
    description: 'Distinct spindly C4 fire creature with volcanic mosaic replacing its multicolor atlas; its silhouette still reads demonic, so this is a surface polish only.',
    content: 'For lava_golem_t10 at L13, set presentation scale near 0.78 of this 2.2 m asset, or give it a smaller dedicated base. fire_golem_t20 Kilncrust at L28 can retain this 2.2 m candidate. Its demonic anatomy remains distinct from Regent and Marrow.',
  },
];

const lab = { schema: 'corealm-lab-asset-candidates/1', assets: [], files: {} };
const promotion = { schema: 'corealm-creature-polish-promotion/1', group: 'fire_golems', builder: { file: `${directory}/build-candidates.mjs`, sha256: builderSha256 }, candidates: [] };
for (const definition of definitions) {
  const sourceFile = `${directory}/sources/${definition.id}.glb`;
  const sourceBytes = await readFile(sourceFile);
  const sourceRecord = manifest.assets.find(asset => asset.id === definition.id);
  if (!sourceRecord || sha256(sourceBytes) !== sourceRecord.sha256) throw new Error(`Production source changed: ${definition.id}`);
  const doc = await io.readBinary(sourceBytes);
  const root = doc.getRoot();
  const mesh = root.listMeshes()[0];
  const primitive = mesh.listPrimitives()[0];
  const originalGeometry = Object.fromEntries(['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'].map(name => [name, sha256(Buffer.from(primitive.getAttribute(name).getArray().buffer))]));
  const originalIndices = sha256(Buffer.from(primitive.getIndices().getArray().buffer));
  const sculpt = definition.id === 'creature_furnace_regent' ? sculptRegent(primitive) : null;
  const originalClipNames = root.listAnimations().map(clip => clip.getName());
  const material = root.listMaterials()[0];
  const imageBytes = await readFile(`${directory}/${definition.image}`);
  let atlas;
  if (definition.id === 'creature_lava_golem') {
    atlas = await sharp(imageBytes).resize(2048, 2048, { fit: 'fill' }).png().toBuffer();
  } else {
    const original = material.getBaseColorTexture().getImage();
    atlas = await sharp(original).composite([{ input: imageBytes, blend: 'over' }]).removeAlpha().png().toBuffer();
  }
  const texture = material.getBaseColorTexture();
  texture.setImage(atlas).setMimeType('image/png').setName(`${definition.name} layered image-generated albedo`);
  material.setName(`${definition.name} layered stone`);
  if (definition.targetHeight) {
    const ratio = definition.targetHeight / sourceRecord.size.y;
    const modelRoot = root.listNodes().find(node => node.getName() === 'lava_golem');
    if (!modelRoot) throw new Error('Unexpected golem scene scale hierarchy.');
    modelRoot.setScale([ratio, ratio, ratio]);
  }
  const output = `${definition.id}-candidate.glb`;
  const outputFile = `${directory}/${output}`;
  const bytes = await io.writeBinary(doc);
  await writeFile(outputFile, bytes);
  const verified = (await io.readBinary(bytes)).getRoot();
  const exportedPrimitive = verified.listMeshes()[0].listPrimitives()[0];
  for (const [name, hash] of Object.entries(originalGeometry)) {
    if (sculpt && (name === 'POSITION' || name === 'NORMAL')) continue;
    if (sha256(Buffer.from(exportedPrimitive.getAttribute(name).getArray().buffer)) !== hash) throw new Error(`${definition.id} ${name} changed.`);
  }
  if (sculpt && sha256(Buffer.from(exportedPrimitive.getAttribute('POSITION').getArray().buffer)) === originalGeometry.POSITION) throw new Error('Regent silhouette sculpt was lost.');
  if (sha256(Buffer.from(exportedPrimitive.getIndices().getArray().buffer)) !== originalIndices) throw new Error(`${definition.id} indices changed.`);
  const clips = verified.listAnimations().map(clip => ({ name: clip.getName(), seconds: Math.max(...clip.listSamplers().map(sampler => sampler.getInput().getArray().at(-1))) }));
  if (JSON.stringify(clips.map(clip => clip.name)) !== JSON.stringify(originalClipNames)) throw new Error(`${definition.id} clips changed.`);
  const ratio = definition.targetHeight ? definition.targetHeight / sourceRecord.size.y : 1;
  const sourceBounds = sourceRecord.bounds ?? { min: [sourceRecord.base.x, sourceRecord.base.y, sourceRecord.base.z], max: [sourceRecord.base.x + sourceRecord.size.x, sourceRecord.base.y + sourceRecord.size.y, sourceRecord.base.z + sourceRecord.size.z] };
  const bounds = { min: sourceBounds.min.map(v => v * ratio), max: sourceBounds.max.map(v => v * ratio) };
  if (sculpt) bounds.max[1] += sculpt.maximumYIncrease * sourceRecord.size.y / 1.8686859351582825;
  const size = Object.fromEntries(['x','y','z'].map((axis,index) => [axis, bounds.max[index] - bounds.min[index]]));
  const acceptance = { sourceIdentityVerified: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false };
  const candidate = {
    id: definition.id, name: definition.name, status: 'awaiting-root-lab-review', candidateFile: outputFile,
    sha256: sha256(bytes), bytes: bytes.length, sourceFile, sourceSha256: sourceRecord.sha256,
    provenance: sourceRecord.sourceProvenance, builderSha256,
    imagegen: { file: `${directory}/${definition.image}`, sha256: sha256(imageBytes), promptMode: 'built-in edit', runtimeAtlasSha256: sha256(atlas), dimensions: await sharp(atlas).metadata().then(({width,height})=>[width,height]) },
    geometry: { vertices: exportedPrimitive.getAttribute('POSITION').getCount(), triangles: exportedPrimitive.getIndices().getCount()/3, topologyAndSkinAttributesPreserved: true, sculpt },
    rig: { joints: verified.listSkins()[0].listJoints().length, originalWeightsPreserved: true },
    size, bounds, materials: verified.listMaterials().map(item => item.getName()), clips,
    attackSeconds: sourceRecord.attackSeconds ?? clips.find(clip => clip.name === 'Attack')?.seconds,
    contactNormalized: sourceRecord.contactNormalized ?? null,
    identity: definition.description, contentRecommendation: definition.content, acceptance,
  };
  promotion.candidates.push(candidate);
  lab.assets.push({ id: definition.id, file: `models/creature/${definition.id}.glb`, pack: 'corealm-tripo-audit-polish-fire-golems', category: 'character', is: definition.name,
    tags: ['creature','golem','fire','image-generated-texture','polish-candidate'], bytes: candidate.bytes, sha256: candidate.sha256,
    size, base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] }, bounds, groundY: 0,
    triangles: candidate.geometry.triangles, animations: clips.map(clip => clip.name), materials: candidate.materials,
    walkClipSeconds: clips.find(clip => clip.name === 'Walk')?.seconds, runClipSeconds: clips.find(clip => clip.name === 'Run')?.seconds,
    attackSeconds: candidate.attackSeconds, contactNormalized: candidate.contactNormalized,
    gaitCalibration: { status: 'uncalibrated', impliedWalkMps: null, impliedRunMps: null },
    sourceProvenance: { sourceFile, sourceSha256: candidate.sourceSha256, candidateFile: outputFile, candidateSha256: candidate.sha256, license: sourceRecord.sourceProvenance?.license }, acceptance });
  lab.files[definition.id] = output;
}
await writeFile(`${directory}/lab-catalog.json`, JSON.stringify(lab, null, 2) + '\n');
await writeFile(`${directory}/promotion.json`, JSON.stringify(promotion, null, 2) + '\n');
console.log(JSON.stringify(promotion.candidates.map(({id,sha256,size,attackSeconds,contactNormalized}) => ({id,sha256,size,attackSeconds,contactNormalized})), null, 2));
