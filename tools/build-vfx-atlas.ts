/**
 * Bakes the spell VFX sprite atlas from Hovl Studio's "Magic Effects FREE" Unity package.
 *
 * WHY AN ATLAS AND NOT 16 TEXTURES. `render/vfx.ts` documents the constraint this whole layer
 * lives under: Highcairn measures 397 draw calls against a 400 budget, so world ambience was built
 * as ONE additive InstancedMesh and the spell layer has to hold the same line. Sixteen separate
 * particle materials would be sixteen more draw calls. One 4x4 atlas plus a per-instance UV offset
 * is one, and the offset rides an InstancedBufferAttribute rather than a uniform, so a fire impact
 * and a water impact in the same frame still batch together.
 *
 * WHAT COMES OUT, and why it is not just a copy of the source PNGs:
 *
 *  - The sources disagree about where the shape lives. Ten of the sixteen are RGBA with the shape
 *    in the alpha channel; six are RGB-only, additive-authored, with the shape in luminance and no
 *    alpha at all (measured: Splat, CraterFree1, Snowflake, MagicCircle, Star, Circle2). Sampling
 *    `.a` uniformly would render six of the sixteen as solid squares.
 *  - So every cell is normalised to ONE convention: intensity = luminance * (alpha or 1), written
 *    to RGB, with alpha pinned to 255. That is the convention `THREE.AdditiveBlending` wants —
 *    it blends (SrcAlpha, One), so the drawn contribution is rgb * a, and pinning a to 1 makes the
 *    per-instance tint multiply the shape LINEARLY. Store intensity in both and the tint would be
 *    squared, which crushes every soft edge in the pack.
 *  - Unity's particle shaders drive these through an HDR `_Color` of {2, 2, 2} — the textures are
 *    deliberately dim so the material can push them past white. Nothing here compensates for that;
 *    `render/spellVfx.ts` carries the gain, where it can be tuned against the real scene exposure.
 *  - A 3 px border of each cell is forced to zero. The atlas is mipmapped (a spell lands 40 m away
 *    as often as 4 m), and without the guard band mip level 4 and beyond bleeds a neighbouring
 *    cell's corner into the sprite. Every source already falls to black at its own border, so the
 *    band costs nothing visible.
 *
 * The output PNG is COMMITTED. This tool exists so the bake is reproducible and so the provenance
 * of every cell is written down, not because the game needs the .unitypackage present at build
 * time — it does not, and it must not, since that file is a local Asset Store download.
 *
 * Usage:
 *   npx tsx tools/build-vfx-atlas.ts                 # default Asset Store path
 *   npx tsx tools/build-vfx-atlas.ts --package <p>   # explicit .unitypackage
 *   npx tsx tools/build-vfx-atlas.ts --check         # verify the committed atlas matches
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { homedir } from "node:os";
import path from "node:path";
import sharp from "sharp";
// Named type imports rather than `sharp.OverlayOptions`: the package's default export is a callable,
// so the `sharp` binding is a VALUE here and a `sharp.X` type reference does not resolve.
import type { OutputInfo, OverlayOptions } from "sharp";

/** Cell edge in pixels. 4x4 at 256 gives a 1024 atlas, which is one mip chain and 1.3 MB of VRAM. */
const CELL = 256;
const GRID = 4;
const ATLAS = CELL * GRID;
/** Forced-black border per cell, in pixels. See the header: this is the mip guard band. */
const GUARD = 3;

/**
 * The sixteen cells, in atlas order (index = row * 4 + col, row 0 at the TOP of the image).
 *
 * `id` is the name `render/spellVfx.ts` imports; `source` is the file inside the package. The
 * grouping is by job rather than by element, because an element is a TINT here, not a sprite:
 * the same `streak` cell is drawn amber for fire and pale blue for water, which is the whole
 * reason four elements cost one atlas.
 */
const CELLS: readonly { id: string; source: string; note: string }[] = [
  { id: "glow", source: "GlowFree1.png", note: "soft radial core: charge-up, projectile heart, impact bloom" },
  { id: "flash", source: "FlashFree2.png", note: "hard starburst, the frame a spell lands on" },
  // Point1, not Star. The pack's OWN spark effects use this: every prefab under `Prefabs/Sparks/`
  // (flashing, exploding, and the plain coloured ones) references `Point.mat`, whose `_MainTex` is
  // `Point1.png`, driven through an HDR `_Color` of 6.35. A star outline is a shape a spark does not
  // have — real sparks are bright points with a motion streak — and it read as clip art next to the
  // rest of the set. It is only 32x32, which is fine: it is a soft radial falloff with no detail to
  // lose, and it is drawn a few pixels across.
  //
  // No size change was needed with it, which is worth recording because the opposite looked true:
  // the cell is a full-bleed gradient with no transparent margin, so it READS as though it fills
  // more than the star did. Measured as the radius containing half the sprite's intensity, Point1 is
  // 0.453 of the cell against Star's 0.599 — it is the TIGHTER mark, at 0.76x the apparent size for
  // the same quad. A per-cell size factor was drafted to compensate and then thrown away.
  { id: "spark", source: "Point1.png", note: "bright point mote for scatter and embers (the pack's own spark texture)" },
  { id: "smoke", source: "SmokeFree1.png", note: "billow, for the settle after an impact" },

  { id: "streak", source: "ProjectileFree1.png", note: "comet head with a tail: the bolt/burst projectile body" },
  { id: "trail", source: "Trail67.png", note: "thin tapered ribbon dropped behind a projectile" },
  { id: "arc", source: "Electro.png", note: "branching discharge — wind's signature cell" },
  { id: "flake", source: "Snowflake.png", note: "crystal facet — water's signature cell" },

  { id: "shard", source: "Stone.png", note: "opaque chunk — earth's signature cell" },
  { id: "splat", source: "Splat.png", note: "wet spatter, water impacts" },
  { id: "scorch", source: "CraterFree1.png", note: "ground scorch decal under an impact" },
  { id: "crack", source: "Crack.png", note: "ground fracture decal, earth impacts" },

  { id: "ring", source: "Circle2.png", note: "thin ring: the expanding shockwave" },
  { id: "rune", source: "MagicCircle.png", note: "cast circle drawn flat at the caster's feet" },
  // NOT TechCircle2, which is the obvious pick by name and is wrong: baked and looked at, it is a
  // printed-circuit trace pattern. Corealm's magic is stone, garnet and weather, and a motherboard
  // under the player's feet reads as a different game. MagicCircle2 is the pack's second runic ring.
  { id: "glyph", source: "MagicCircle2.png", note: "inner counter-rotating ring of the cast circle" },
  { id: "slash", source: "Slash.png", note: "wide arc sweep, the surge rung's opening frame" },
];

const DEFAULT_PACKAGE = path.join(
  homedir(),
  "AppData", "Roaming", "Unity", "Asset Store-5.x",
  "Hovl Studio", "Particle SystemsMagic", "Magic Effects FREE.unitypackage",
);

const OUT_PNG = path.join("game", "public", "assets", "vfx", "spell-atlas.png");
const OUT_ATTRIBUTION = path.join("game", "public", "assets", "vfx", "ATTRIBUTION.md");

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const packageIndex = args.indexOf("--package");
  const packagePath = packageIndex >= 0 ? args[packageIndex + 1] ?? DEFAULT_PACKAGE : DEFAULT_PACKAGE;

  if (!existsSync(packagePath)) {
    console.error(`Magic Effects FREE package not found at:\n  ${packagePath}`);
    console.error("It is an Asset Store download, so it is not in the repo. The committed atlas at");
    console.error(`  ${OUT_PNG}\nis what the game loads; this tool only regenerates it.`);
    process.exit(existsSync(OUT_PNG) ? 0 : 1);
  }

  const byLeaf = indexPackage(packagePath);
  const missing = CELLS.filter((cell) => !byLeaf.has(cell.source));
  if (missing.length > 0) {
    throw new Error(`Package is missing ${missing.length} source(s): ${missing.map((c) => c.source).join(", ")}`);
  }

  const composites: OverlayOptions[] = [];
  const provenance: string[] = [];
  const means: { id: string; mean: number }[] = [];
  for (const [index, cell] of CELLS.entries()) {
    const source = byLeaf.get(cell.source)!;
    const { data, info } = await normaliseCell(source);
    composites.push({
      input: data,
      raw: { width: info.width, height: info.height, channels: 4 },
      left: (index % GRID) * CELL,
      top: Math.floor(index / GRID) * CELL,
    });
    const meta = await sharp(source).metadata();
    // Mean intensity of the normalised cell, reported because `render/spellVfx.ts` derives each
    // cell's `gain` from it (`36 / mean`, clamped). Without this number in the output, swapping a
    // source silently invalidates a hand-tuned constant in another file.
    let total = 0;
    for (let offset = 0; offset < data.length; offset += 4) total += data[offset]!;
    const mean = total / (data.length / 4);
    means.push({ id: cell.id, mean });
    provenance.push(
      `| ${index} | \`${cell.id}\` | ${cell.source} | ${meta.width}x${meta.height}, `
      + `${meta.channels === 4 ? "RGBA" : "RGB"} | ${mean.toFixed(1)} | ${cell.note} |`,
    );
  }

  const png = await sharp({
    create: { width: ATLAS, height: ATLAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite(composites)
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();

  mkdirSync(path.dirname(OUT_PNG), { recursive: true });
  const digest = createHash("sha256").update(png).digest("hex").slice(0, 16);

  if (check) {
    if (!existsSync(OUT_PNG)) throw new Error(`--check: ${OUT_PNG} does not exist`);
    const onDisk = createHash("sha256").update(readFileSync(OUT_PNG)).digest("hex").slice(0, 16);
    if (onDisk !== digest) throw new Error(`--check: atlas is stale (disk ${onDisk}, rebuilt ${digest})`);
    console.log(`atlas up to date (${digest})`);
    return;
  }

  writeFileSync(OUT_PNG, png);
  writeFileSync(OUT_ATTRIBUTION, attribution(provenance, digest));
  console.log(`wrote ${OUT_PNG}  ${ATLAS}x${ATLAS}  ${(png.length / 1024).toFixed(0)} KB  sha256:${digest}`);
  console.log(`wrote ${OUT_ATTRIBUTION}`);

  // The gain table `render/spellVfx.ts` needs, printed ready to paste. Normalised against `glow`,
  // which is the reference the effect layer's brightness envelopes were authored against.
  const reference = means.find((row) => row.id === "glow")?.mean ?? 1;
  console.log("");
  console.log("ATLAS_CELLS gains (36 / mean, clamped to 2.4), for render/spellVfx.ts:");
  for (const [index, row] of means.entries()) {
    const gain = Math.min(2.4, reference / Math.max(1, row.mean));
    console.log(`  ${row.id.padEnd(7)} index ${String(index).padStart(2)}  mean ${row.mean.toFixed(1).padStart(6)}  gain ${gain.toFixed(2)}`);
  }
}

/**
 * A .unitypackage is a gzipped tar of `<guid>/{asset,pathname}` triples, so the real filename of an
 * entry is only discoverable by reading its sibling `pathname`. 182 entries here.
 *
 * Read in-process rather than shelled out to `tar`. On Windows the `tar` first on PATH is GNU tar
 * from Git for Windows, which parses the `C:` in an absolute package path as a REMOTE HOST and
 * fails with "Cannot connect to C: resolve failed" — the atlas would then silently never rebuild
 * on the one machine that has the package. A 40-line USTAR reader has no such opinion.
 */
function indexPackage(packagePath: string): Map<string, Buffer> {
  const tar = gunzipSync(readFileSync(packagePath));
  /** guid -> its two members, joined once the whole archive is walked. */
  const entries = new Map<string, { pathname?: Buffer; asset?: Buffer }>();

  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    // Two consecutive zero blocks end the archive; one is enough to stop on.
    if (header[0] === 0) break;

    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    // Size is octal, space- or NUL-terminated, 12 bytes.
    const size = parseInt(header.subarray(124, 136).toString("utf8").replace(/[^0-7]/g, "") || "0", 8);
    const typeFlag = String.fromCharCode(header[156]!);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    // '0' and '\0' are both "regular file"; directories ('5') carry no payload worth reading.
    if (typeFlag !== "0" && typeFlag !== "\0") continue;
    const [guid, member] = name.split("/");
    if (!guid || (member !== "pathname" && member !== "asset")) continue;
    const slot = entries.get(guid) ?? {};
    slot[member] = Buffer.from(body);
    entries.set(guid, slot);
  }

  const byLeaf = new Map<string, Buffer>();
  for (const { pathname, asset } of entries.values()) {
    if (!pathname || !asset) continue;
    const declared = pathname.toString("utf8").split("\n")[0]!.trim();
    byLeaf.set(path.posix.basename(declared), asset);
  }
  return byLeaf;
}

/**
 * One source PNG -> one 256x256 RGBA cell in the atlas convention.
 *
 * `fit: "contain"` rather than `"fill"`: five of the sixteen are not square (Trail67 is 256x64,
 * ProjectileFree1 512x256), and stretching a 4:1 ribbon into a square would fatten the trail into
 * a smear. Contained on black, the sprite keeps its authored proportions and the quad stays
 * square, which is what lets every cell share one geometry.
 */
async function normaliseCell(source: Buffer): Promise<{ data: Buffer; info: OutputInfo }> {
  const resized = await sharp(source)
    .resize(CELL, CELL, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha(1)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = resized;

  /** Rec. 709 luminance gated by alpha. RGB-only sources read alpha 255 from `ensureAlpha`. */
  const intensityAt = (x: number, y: number): number => {
    const i = (y * info.width + x) * info.channels;
    const luma = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    return luma * (data[i + 3]! / 255);
  };

  // Black point, sampled from the cell's own border ring.
  //
  // Snowflake.png is authored on a #262626 CARD rather than on black — it is an RGB-only source, so
  // there is no alpha to cut the backing out, and copied through verbatim it renders as a visibly
  // lighter SQUARE floating around the crystal on every water impact. Subtracting the border median
  // and rescaling removes the card. Sources that already sit on black have a border median of 0,
  // where this is exactly a no-op, so it is safe to run on all sixteen rather than special-cased.
  const border: number[] = [];
  for (let x = 0; x < info.width; x += 1) {
    border.push(intensityAt(x, 0), intensityAt(x, info.height - 1));
  }
  for (let y = 1; y < info.height - 1; y += 1) {
    border.push(intensityAt(0, y), intensityAt(info.width - 1, y));
  }
  border.sort((a, b) => a - b);
  const blackPoint = border[Math.floor(border.length / 2)] ?? 0;
  const span = Math.max(1, 255 - blackPoint);

  const out = Buffer.alloc(info.width * info.height * 4);
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const o = (y * info.width + x) * 4;
      const lifted = ((intensityAt(x, y) - blackPoint) / span) * 255;

      const guarded = x < GUARD || y < GUARD || x >= info.width - GUARD || y >= info.height - GUARD;
      const value = guarded ? 0 : Math.max(0, Math.min(255, Math.round(lifted)));
      out[o] = value;
      out[o + 1] = value;
      out[o + 2] = value;
      // Pinned, not stored. Additive blending multiplies rgb by alpha; a second copy of the shape
      // here would square it. See the header.
      out[o + 3] = 255;
    }
  }
  return { data: out, info };
}

function attribution(provenance: readonly string[], digest: string): string {
  return `# Spell VFX atlas — sources and licence

\`spell-atlas.png\` is a 4x4, ${ATLAS}x${ATLAS} sprite sheet baked by \`tools/build-vfx-atlas.ts\`
from **Magic Effects FREE** by **Hovl Studio**, obtained from the Unity Asset Store.

Use of that pack is governed by the Unity Asset Store EULA, which grants the licensee the right to
use the assets in their own projects. The pack itself is NOT redistributed here — only this derived
atlas, and only the sixteen greyscale particle sprites listed below. No prefab, material, shader,
scene or mesh from the pack is used; Corealm draws the atlas through its own Three.js instanced
renderer in \`game/src/render/spellVfx.ts\`.

Every cell is normalised to Corealm's additive convention: RGB carries
\`luminance * alpha\` and alpha is pinned to 255, with a ${GUARD} px black guard band to stop mip
bleed between neighbours. Colour comes entirely from the per-instance tint at draw time, which is
how one sprite set serves wind, water, earth and fire.

sha256 (first 16): \`${digest}\`

\`Mean\` is the average intensity of the normalised cell; \`render/spellVfx.ts\` derives each
cell's \`gain\` from it, so that one sprite does not print four times the light of another at equal
size.

| Cell | Id | Source file | Source format | Mean | Used for |
| ---: | -- | ----------- | ------------- | ---: | -------- |
${provenance.join("\n")}

Regenerate with:

\`\`\`bash
npx tsx tools/build-vfx-atlas.ts
npx tsx tools/build-vfx-atlas.ts --check   # fails if the committed PNG is stale
\`\`\`
`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
