/** Stage the native BK triplanar rock detail as a fairy terrain stone material. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const out = 'test-results/fairy-terraces-assets/cliff-surface';
await mkdir(out, { recursive: true });
const packageInfo = JSON.parse(await readFile('.asset-cache/fairy-terraces/unity/sources.json', 'utf8'))
  .find(p => p.package.includes('Pure Nature 2'));
const base = `${packageInfo.directory}/Assets/BK/PureNature_AsianMountains`;
const sourceAlbedo = `${base}/Textures/Surfaces/_RockDetail1_a.png`;
const sourceNormal = `${base}/Textures/Surfaces/_RockDetail1_n.png`;
const sourceMaterial = `${base}/Models/AsianCliff/Textures/Materials/AsianCliff_0.mat`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const linear = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const material = await readFile(sourceMaterial, 'utf8');
if (!material.includes('d01b4490e3364606bafe37d5a2c010be') || !material.includes('527219c7d0cc430b8ab191c30b5a1286')) {
  throw Error('Native triplanar cliff detail bindings changed');
}
const nativeTiling = Number(material.match(/- _Tiling2: ([\d.]+)/)?.[1]);
if (nativeTiling !== .15) throw Error('Review changed native world-space tiling');
const smoothnessPower = Number(material.match(/- _SmoothnessPower: ([\d.]+)/)?.[1]);
if (smoothnessPower !== 0) throw Error('Review changed native roughness response');
const { data: nativeAlbedo, info } = await sharp(sourceAlbedo).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const nativeNormal = await sharp(sourceNormal).removeAlpha().raw().toBuffer();
if (nativeNormal.length !== nativeAlbedo.length) throw Error('Native albedo/normal registration differs');
const pixels = Buffer.from(nativeAlbedo), roughnessPixels = Buffer.alloc(nativeAlbedo.length, 255);
const stoneTint = [117, 124, 111];
let changed = 0;
for (let i = 0; i < pixels.length; i += 3) {
  const luma = nativeAlbedo[i] * .2126 + nativeAlbedo[i + 1] * .7152 + nativeAlbedo[i + 2] * .0722;
  // BK supplies a nearly-white multiplicative detail layer. Expand its original
  // cavity shade instead of introducing a new noise pattern or brick courses.
  const sourceCavity = clamp((255 - luma) / 24);
  // Registered native normal steepness provides faint mineral/pit shading on
  // otherwise-white faces. It does not introduce a baked light direction.
  const nativeSteepness = clamp((255 - nativeNormal[i + 2]) / 32);
  const shade = clamp(.90 - .51 * sourceCavity ** .67 - .13 * nativeSteepness ** .65, .28, .90);
  const olive = sourceCavity * .035;
  pixels[i] = Math.round(stoneTint[0] * shade * (1 - olive));
  pixels[i + 1] = Math.round(stoneTint[1] * shade);
  pixels[i + 2] = Math.round(stoneTint[2] * shade * (1 - olive * 1.4));
  if (pixels[i] !== nativeAlbedo[i] || pixels[i + 1] !== nativeAlbedo[i + 1] || pixels[i + 2] !== nativeAlbedo[i + 2]) changed++;
}
const encode = pixels => sharp(pixels, { raw: { width: info.width, height: info.height, channels: 3 } })
  .png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
const images = {
  albedo: await encode(pixels),
  normal: await readFile(sourceNormal),
  roughness: await encode(roughnessPixels),
};
const filenames = { albedo: 'corealm-stone.png', normal: 'corealm-stone-normal.png', roughness: 'corealm-stone-roughness.png' };
for (const [role, filename] of Object.entries(filenames)) await writeFile(`${out}/${filename}`, images[role]);
if (!(await sharp(images.albedo).raw().toBuffer()).equals(pixels)) throw Error('Albedo encoding changed pixels');
if (!(await sharp(images.normal).removeAlpha().raw().toBuffer()).equals(nativeNormal)) throw Error('Native normal changed');
const meanLinearRgb = [0, 0, 0], meanSrgb = [0, 0, 0], squares = [0, 0, 0];
for (let i = 0; i < pixels.length; i += 3) for (let k = 0; k < 3; k++) {
  meanLinearRgb[k] += linear(pixels[i + k] / 255); meanSrgb[k] += pixels[i + k]; squares[k] += pixels[i + k] ** 2;
}
const count = info.width * info.height;
for (let k = 0; k < 3; k++) { meanLinearRgb[k] /= count; meanSrgb[k] /= count; }
const seamAudit = data => {
  const seam = [0, 0], adjacent = [0, 0];
  for (let k = 0; k < 3; k++) {
    for (let y = 0; y < info.height; y++) {
      const at = y * info.width * 3 + k;
      seam[0] += Math.abs(data[at] - data[at + (info.width - 1) * 3]);
      adjacent[0] += Math.abs(data[at] - data[at + 3]);
    }
    for (let x = 0; x < info.width; x++) {
      const at = x * 3 + k;
      seam[1] += Math.abs(data[at] - data[at + (info.height - 1) * info.width * 3]);
      adjacent[1] += Math.abs(data[at] - data[at + info.width * 3]);
    }
  }
  return { meanBoundaryDifference: seam.map((v, k) => v / (3 * (k === 0 ? info.height : info.width))),
    meanAdjacentBoundaryDifference: adjacent.map((v, k) => v / (3 * (k === 0 ? info.height : info.width))) };
};
const profile = { meanLinearRgb, tileMetres: 4, sourceTileMetres: 1 / nativeTiling, periodic: true,
  albedoSize: info.width, pbrMapSize: info.width,
  source: sourceAlbedo, sourceSha256: hash(await readFile(sourceAlbedo)),
  suggestedFairyRockBaseSrgb: [106, 115, 103],
  paletteNote: 'The current terrain shader divides albedo by meanLinearRgb. It retains cavity contrast but needs its fairy vertex/base rock palette to set overall darkness.' };
const metadata = { version: 1, id: 'fairy-native-rounded-cliff-stone', files: filenames, ...profile,
  sourceProvenance: { package: packageInfo.package, archive: packageInfo.archive, archiveSha256: packageInfo.sha256,
    author: 'BK', license: 'Standard Unity Asset Store EULA',
    sourceFiles: await Promise.all([sourceAlbedo, `${sourceAlbedo}.meta`, sourceNormal, `${sourceNormal}.meta`, sourceMaterial]
      .map(async path => ({ path, sha256: hash(await readFile(path)) }))),
    nativeMaterial: 'BK/Standard Layered Masked: _LayerAlbedo=_RockDetail1_a, _LayerNormalMap=_RockDetail1_n; _Tiling2=.15 world-space = 6.6667m/repeat.',
    floorScaleDecision: 'Authored 4m repeat for short, close-view fairy banks; original source material uses 6.6667m/repeat.',
    modifications: ['Native repeatable texture, not a cropped cliff UV atlas; all original fissure positions and mineral shapes retained.',
      'Near-white native cavity values expanded and multiplied by muted grey/olive rock pigment. Registered normal steepness adds faint undirected pit shade.',
      'Original 2048x2048 normal PNG copied byte-for-byte; original image orientation retained for the aligned pair.',
      'Roughness is 1 throughout, matching native material _SmoothnessPower=0. It is supplied in RGB, including the green channel used by Three.js.'] },
  loader: { albedoColorSpace: 'SRGBColorSpace', normalAndRoughnessColorSpace: 'NoColorSpace',
    wrap: 'RepeatWrapping', minFilter: 'LinearMipmapLinearFilter', magFilter: 'LinearFilter',
    generateMipmaps: true, anisotropy: 8, flipY: false,
    normalDecode: 'Original RGB tangent normal; rgb*2-1. No DXT5/alpha unpacking, no green inversion.',
    setter: 'materials.setGroundStoneSurface({ ...existingCorealmTextures, stone: { albedo, normal, roughness, meanLinearRgb, tileMetres } })',
    sampling: 'setGroundStoneSurface applies 1/tileMetres to world coordinates. Texture.repeat is not an additional multiplier in this custom shader.' },
  audit: { sourceNormalBytesExact: hash(images.normal) === hash(await readFile(sourceNormal)), sourceResolutionRetained: true,
    albedoPixelsRoundtripExact: true, recoloredPixels: changed, meanSrgb,
    standardDeviationSrgb: squares.map((v, k) => Math.sqrt(v / count - meanSrgb[k] ** 2)),
    albedoPeriodicity: seamAudit(pixels), normalPeriodicity: seamAudit(nativeNormal) },
  sha256: Object.fromEntries(Object.entries(images).map(([role, bytes]) => [role, hash(bytes)])),
  bytes: Object.fromEntries(Object.entries(images).map(([role, bytes]) => [role, bytes.length])),
  acceptance: { sourceAndPixelAudit: true, labAccepted: false, worldIntegrated: false } };
await writeFile(`${out}/stone-surface.json`, JSON.stringify(metadata, null, 2) + '\n');
// Allows a lab to route just these three images and this manifest through the
// existing production loader; original bark/leaf files still come from public.
const existingManifest = JSON.parse(await readFile('game/public/assets/textures/corealm/corealm-surfaces.json', 'utf8'));
await writeFile(`${out}/corealm-surfaces.json`, JSON.stringify({ ...existingManifest,
  surfaces: { ...existingManifest.surfaces, stone: profile } }, null, 2) + '\n');
console.log(JSON.stringify({ directory: out, meanLinearRgb, tileMetres: profile.tileMetres,
  sourceTileMetres: profile.sourceTileMetres, audit: metadata.audit, bytes: metadata.bytes }, null, 2));
