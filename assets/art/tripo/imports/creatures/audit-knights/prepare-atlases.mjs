import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const base = 'assets/art/tripo/imports/creatures/audit-knights';
for (const [kind, mix] of [['pearl', 0.78], ['revenant', 0.86]]) {
  const dir = `${base}/${kind}`;
  const source = await sharp(await readFile(`${dir}/source-atlas.png`)).resize(2048, 2048).removeAlpha().raw().toBuffer();
  const generated = await sharp(await readFile(`${dir}/imagegen-atlas.png`)).resize(2048, 2048).removeAlpha().raw().toBuffer();
  if (source.length !== generated.length) throw new Error(`Atlas size mismatch for ${kind}`);
  const result = Buffer.alloc(source.length);
  for (let i = 0; i < result.length; i++) result[i] = Math.round(source[i] * (1 - mix) + generated[i] * mix);
  await writeFile(`${dir}/runtime-atlas.jpg`, await sharp(result, { raw: { width: 2048, height: 2048, channels: 3 } })
    .jpeg({ quality: 93, chromaSubsampling: '4:4:4' }).toBuffer());
  console.log(kind, `image-generated coverage ${mix}`);
}
