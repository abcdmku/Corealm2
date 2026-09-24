import { NodeIO } from '@gltf-transform/core';
import { KHRTextureTransform } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const io = new NodeIO().registerExtensions([KHRTextureTransform]);
const ids = ['bracken_tapir', 'duskoak_lynx', 'quillback_porcupine'];
const textureNames = {
  bracken_tapir: 'tapir-generated-fur.png',
  duskoak_lynx: 'lynx-generated-fur.png',
  quillback_porcupine: 'porcupine-generated-fur.png',
};
const sha = data => createHash('sha256').update(data).digest('hex');
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x-a)/(b-a))); return t*t*(3-2*t); };
const point = (accessor, i) => accessor.getElement(i, []);

async function preparedTexture(id) {
  const source = path.join(here, 'textures', textureNames[id]);
  const image = await sharp(source).resize(1024, 1024).removeAlpha().linear(
    id === 'quillback_porcupine' ? .42 : id === 'duskoak_lynx' ? .95 : .50,
    id === 'quillback_porcupine' ? 143 : id === 'duskoak_lynx' ? 30 : 120,
  ).png().toBuffer();
  const file = path.join(here, 'textures', `${id}-coat-1k.png`);
  await writeFile(file, image);
  return { image, file, source };
}

function editLynx(doc) {
  const root = doc.getRoot();
  const earJointIds = new Set();
  for (const skin of root.listSkins()) skin.listJoints().forEach((joint, index) => {
    if (/Ear_[LR]$/.test(joint.getName())) earJointIds.add(index);
  });
  let ears = 0, cheek = 0;
  for (const [meshIndex, mesh] of root.listMeshes().entries()) for (const primitive of mesh.listPrimitives()) {
    const pos = primitive.getAttribute('POSITION');
    const joints = primitive.getAttribute('JOINTS_0');
    const weights = primitive.getAttribute('WEIGHTS_0');
    if (!pos || !joints || !weights) continue;
    for (let i = 0; i < pos.getCount(); i++) {
      const p = point(pos, i), j = point(joints, i), w = point(weights, i);
      const onEar = j.some((joint, k) => earJointIds.has(joint) && w[k] > .9);
      if (onEar) {
        p[1] = 1.025 + (p[1] - 1.025) * 1.38;
        p[0] *= 1.055;
        pos.setElement(i, p);
        ears++;
      } else if (meshIndex === 0 && Math.abs(p[0]) > .095 && p[2] > .59 && p[2] < .84 && p[1] > .84 && p[1] < 1.005) {
        const lateral = smooth(.095, .15, Math.abs(p[0]));
        const fore = smooth(.59, .67, p[2]) * (1 - smooth(.79, .84, p[2]));
        const vertical = smooth(.84, .90, p[1]) * (1 - smooth(.975, 1.005, p[1]));
        const amount = .041 * lateral * fore * vertical;
        p[0] += Math.sign(p[0]) * amount;
        p[1] -= amount * .28;
        pos.setElement(i, p);
        cheek++;
      }
    }
  }
  return { ears, cheek };
}

function editTapir(doc) {
  // The coat UVs are angle/height coordinates, so a painted saddle in the
  // texture would land on both dark and pale anatomy. The existing vertex
  // saddle has the correct species boundary; strengthen its pale fibers while
  // the generated bristle map supplies color variation inside each region.
  const color = doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('COLOR_0');
  let saddle = 0;
  for (let i = 0; i < color.getCount(); i++) {
    const c = point(color, i), pale = smooth(.22, .40, (c[0]+c[1]+c[2])/3);
    if (pale < .01) continue;
    color.setElement(i, c.map(x => Math.min(.88, x*(1 + .48*pale))));
    saddle++;
  }
  return { saddleVertices: saddle };
}

function splitPorcupinePrimitive(doc, mesh, primitive, coatMaterial, quillMaterial) {
  const position = primitive.getAttribute('POSITION');
  const colors = primitive.getAttribute('COLOR_0');
  const index = primitive.getIndices();
  const root = doc.getRoot();
  if (position.getCount() !== 34366) throw new Error('Porcupine source vertex layout changed');
  const quillStart = 16226, guardEnd = quillStart + 6000, defensiveEnd = guardEnd + 11040;
  // Each defensive shaft is eight rings of six vertices. Keep the thin tips
  // but broaden the shaft and use one clear pale terminal band per cluster.
  for (let q = 0; q < 230; q++) {
    const start = guardEnd + q * 48;
    const cluster = Math.floor(q / 6);
    const pale = .84 + .13 * ((cluster * 7) % 5) / 4;
    for (let ring = 0; ring < 8; ring++) {
      const center = [0, 0, 0];
      for (let j = 0; j < 6; j++) { const p = point(position, start + ring*6 + j); for (let k = 0; k < 3; k++) center[k] += p[k]/6; }
      for (let j = 0; j < 6; j++) {
        const i = start + ring*6 + j, p = point(position, i);
        const width = ring === 7 ? 1 : 1.64;
        for (let k = 0; k < 3; k++) p[k] = center[k] + (p[k] - center[k]) * width;
        position.setElement(i, p);
        const color = ring >= 5 ? [.53*pale, .46*pale, .33*pale] : ring === 4 ? [.31, .25, .16] : [.105, .075, .047];
        colors.setElement(i, color);
      }
    }
  }
  // The original 300 fine guard hairs form visual noise at game distance.
  // Retain two thirds of them and soften their contrast against the coat.
  for (let i = quillStart; i < guardEnd; i++) {
    const color = point(colors, i);
    colors.setElement(i, color.map(x => x * .78));
  }
  const original = index.getArray();
  const bodyIndices = [], quillIndices = [];
  for (let i = 0; i < original.length; i += 3) {
    const a = original[i], b = original[i+1], c = original[i+2];
    if (Math.min(a,b,c) >= quillStart) {
      const guard = a < guardEnd;
      if (guard && Math.floor((a-quillStart)/20) % 3 === 0) continue;
      quillIndices.push(a,b,c);
    } else bodyIndices.push(a,b,c);
  }
  const indices = (name, array) => doc.createAccessor(name).setType('SCALAR').setArray(new Uint32Array(array)).setBuffer(index.getBuffer());
  const body = doc.createPrimitive().setMaterial(coatMaterial).setIndices(indices('Porcupine body indices', bodyIndices));
  const quills = doc.createPrimitive().setMaterial(quillMaterial).setIndices(indices('Porcupine quill indices', quillIndices));
  for (const attribute of primitive.listSemantics()) { const accessor = primitive.getAttribute(attribute); body.setAttribute(attribute, accessor); quills.setAttribute(attribute, accessor); }
  mesh.removePrimitive(primitive).addPrimitive(body).addPrimitive(quills);
  return { bodyTriangles: bodyIndices.length/3, quillTriangles: quillIndices.length/3, quillStart, guardEnd, defensiveEnd };
}

function editPorcupineFace(doc) {
  const mesh = doc.getRoot().listMeshes()[1];
  const primitive = mesh.listPrimitives()[0], pos = primitive.getAttribute('POSITION');
  let eyes = 0;
  for (let i = 0; i < pos.getCount(); i++) {
    const p = point(pos, i), side = Math.sign(p[0]);
    if (Math.abs(Math.abs(p[0]) - .087) < .023 && Math.abs(p[1] - .304) < .028 && Math.abs(p[2] - .589) < .025) {
      p[0] = side * (.087 + (Math.abs(p[0]) - .087)*.83);
      p[1] = .304 + (p[1] - .304)*.83;
      p[2] = .589 + (p[2] - .589)*.83;
      pos.setElement(i, p); eyes++;
    }
  }
  return { eyes };
}

async function build(id) {
  const sourceFile = path.join(here, 'sources', `creature_${id}.glb`);
  const source = await readFile(sourceFile);
  const doc = await io.read(sourceFile), root = doc.getRoot();
  const texture = await preparedTexture(id);
  const coat = root.listMaterials()[0];
  let edits = {};
  if (id === 'quillback_porcupine') {
    const newCoat = doc.createMaterial('quillback_porcupine_fur_detail').setDoubleSided(coat.getDoubleSided()).setRoughnessFactor(.92).setMetallicFactor(0);
    const tex = doc.createTexture('Image-generated coarse underfur').setMimeType('image/png').setImage(texture.image);
    newCoat.setBaseColorTexture(tex);
    edits = { ...editPorcupineFace(doc), ...splitPorcupinePrimitive(doc, root.listMeshes()[0], root.listMeshes()[0].listPrimitives()[0], newCoat, coat) };
  } else {
    const tex = doc.createTexture(id + ' image-generated coat').setMimeType('image/png').setImage(texture.image);
    coat.setBaseColorTexture(tex);
    if (id === 'duskoak_lynx') {
      const transform = doc.createExtension(KHRTextureTransform).createTransform().setScale([1,1]);
      coat.getBaseColorTextureInfo().setExtension('KHR_texture_transform', transform);
      edits = editLynx(doc);
    } else edits = editTapir(doc);
  }
  const outFile = path.join(here, `creature_${id}-candidate.glb`);
  await io.write(outFile, doc);
  const candidate = await readFile(outFile);
  return { id:`creature_${id}`, sourceFile:path.relative(repo,sourceFile).replaceAll('\\','/'), sourceSha256:sha(source), sourceBytes:source.length,
    candidateFile:path.basename(outFile), bytes:candidate.length, sha256:sha(candidate), textureFile:path.relative(repo,texture.file).replaceAll('\\','/'),
    textureSha256:sha(texture.image), generatedSourceFile:path.relative(repo,texture.source).replaceAll('\\','/'),
    generatedSourceSha256:sha(await readFile(texture.source)), edits };
}

const results = [];
for (const id of ids) { const result = await build(id); results.push(result); console.log(JSON.stringify(result)); }
await writeFile(path.join(here,'build-results.json'), JSON.stringify(results,null,2)+'\n');
