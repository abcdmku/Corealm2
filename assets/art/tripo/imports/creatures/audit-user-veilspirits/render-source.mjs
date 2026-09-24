import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { Matrix4, Vector3 } from 'three';

const base = 'assets/art/tripo/imports/creatures/audit-user-veilspirits';
const variant = process.argv.find(arg => ['orchid', 'thistledown'].includes(arg));
const model = variant ? `${base}/${variant}-veilspirit-candidate.glb` : `${base}/sources/fantasy-elf-user-original.glb`;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(await readFile(model));
const primitive = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const texture = primitive.getMaterial().getBaseColorTexture();
const { data: pixels, info } = await sharp(texture.getImage()).raw().toBuffer({ resolveWithObject: true });
const pos = primitive.getAttribute('POSITION').getArray();
const uv = primitive.getAttribute('TEXCOORD_0').getArray();
const index = primitive.getIndices().getArray();
const world = variant ? new Matrix4().fromArray(doc.getRoot().listNodes().find(n => n.getMesh())?.getWorldMatrix()) : new Matrix4();
const size = 1100, scale = 940 / (variant === 'orchid' ? 1.65 : variant === 'thistledown' ? 1.38 : 1);
for (const side of ['front', 'back', 'left', 'right']) {
  const camera = side === 'front' ? [1, 0] : side === 'back' ? [-1, 0] : side === 'left' ? [0, 1] : [0, -1];
  const triangles = [];
  for (let i = 0; i < index.length; i += 3) {
    const verts = [index[i], index[i + 1], index[i + 2]].map(v => new Vector3(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]).applyMatrix4(world).toArray());
    const ab = verts[1].map((x, k) => x - verts[0][k]), ac = verts[2].map((x, k) => x - verts[0][k]);
    const nx = ab[1] * ac[2] - ab[2] * ac[1], nz = ab[0] * ac[1] - ab[1] * ac[0];
    const light = Math.max(.35, Math.min(1, .7 + .55 * (nx * camera[0] + nz * camera[1]) / (Math.hypot(nx, nz) || 1)));
    const tx = (uv[index[i] * 2] + uv[index[i + 1] * 2] + uv[index[i + 2] * 2]) / 3;
    const ty = (uv[index[i] * 2 + 1] + uv[index[i + 1] * 2 + 1] + uv[index[i + 2] * 2 + 1]) / 3;
    const px = Math.max(0, Math.min(info.width - 1, Math.floor(((tx % 1) + 1) % 1 * info.width)));
    const py = Math.max(0, Math.min(info.height - 1, Math.floor((1 - (((ty % 1) + 1) % 1)) * info.height)));
    const offset = (py * info.width + px) * info.channels;
    const color = [pixels[offset], pixels[offset + 1], pixels[offset + 2]].map(ch => Math.max(0, Math.min(255, Math.round(ch * light))));
    const points = verts.map(p => {
      const horizontal = camera[0] ? p[2] * camera[0] : p[0] * camera[1];
      return `${(size / 2 + horizontal * scale).toFixed(1)},${(size - 80 - p[1] * scale).toFixed(1)}`;
    }).join(' ');
    const depth = verts.reduce((sum, p) => sum + p[0] * camera[0] + p[2] * camera[1], 0) / 3;
    triangles.push({ depth, svg: `<polygon points="${points}" fill="rgb(${color.join(',')})"/>` });
  }
  triangles.sort((a, b) => a.depth - b.depth);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#30383b"/>${triangles.map(t => t.svg).join('')}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(`${base}/${variant || 'source'}-${side}.png`);
}
