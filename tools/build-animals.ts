/**
 * Converts the Animal pack deluxe FBX rigs into optimized GLBs under
 * game/public/assets/models/animal/, and folds their entries into
 * game/public/assets/manifest.json.
 *
 * Why this is a separate tool from build-assets.ts: that one reads Quaternius glTF out of zips in
 * .asset-cache/ and never unpacks anything. This source is a Unity .unitypackage of binary FBX with
 * external TGA textures, which is a different problem end to end. Sharing a file would have meant
 * one tool with two unrelated halves.
 *
 * The conversion itself runs in headless Chromium (tools/animals/convert.js) because three's
 * FBXLoader and GLTFExporter both need DOM APIs Node does not have. Playwright is already a
 * dependency for playtests. Everything after the GLB comes back is ordinary gltf-transform work.
 *
 * Prepare the source once with:
 *   npx tsx tools/build-animals.ts --stage
 * which extracts the .unitypackage and converts its TGA base-colour maps to 512px PNG. The staged
 * tree lives in .asset-cache/animal-pack/ and is gitignored, exactly like the Quaternius zips.
 *
 * Usage:
 *   npx tsx tools/build-animals.ts             build every animal and update the manifest
 *   npx tsx tools/build-animals.ts --only bear,deer   build a subset, still updates the manifest
 *   npx tsx tools/build-animals.ts --keep-raw  also keep the pre-optimization GLB for inspection
 */
import path from "node:path";
import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { Document, Logger, NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, weld, resample, textureCompress, getBounds } from "@gltf-transform/functions";
import sharp from "sharp";
import { repoRoot, gameRoot } from "./lib/paths.js";
// @ts-expect-error - plain ESM data module, deliberately not TypeScript
import { ANIMALS } from "./animals/catalog.mjs";
// @ts-expect-error - plain ESM helper, deliberately not TypeScript
import { startServer } from "./animals/serve.mjs";

interface AnimalSpec {
  id: string;
  rig: string;
  texture: string;
  is: string;
  tags: string[];
  clips: [string, string, [number, number]?][];
  synthAttack?: { reach?: number; dip?: number; ms?: number; base?: "Idle" | "Attack" };
  substitutes?: Record<string, string>;
}

interface ManifestAsset {
  id: string;
  file: string;
  pack: string;
  category: string;
  is: string;
  tags: string[];
  bytes: number;
  size: { x: number; y: number; z: number };
  base: { x: number; y: number; z: number };
  animations: string[];
  materials: string[];
  /**
   * Ground speed the Walk cycle looks like it travels at, metres per second.
   *
   * `render/entityViews.ts` divides the speed the simulation actually moves an enemy by this to get
   * the playback rate that keeps the feet on the ground. Measured from the feet, because these
   * cycles are authored in place and carry no root travel to read a stride from.
   */
  impliedWalkMps?: number;
  walkClipSeconds?: number;
  impliedRunMps?: number;
  runClipSeconds?: number;
}

const STAGE_DIR = path.join(repoRoot, ".asset-cache", "animal-pack");
const OUT_DIR = path.join(gameRoot, "public", "assets");
const ANIMAL_DIR = path.join(OUT_DIR, "models", "animal");
const SIDECAR = path.join(repoRoot, "tools", "data", "animal-assets.json");

/** Recorded in the manifest so the pack's provenance travels with the assets. */
export const ANIMAL_PACK = {
  id: "animal-pack-deluxe",
  name: "Animal pack deluxe",
  author: "janpec",
  // Same shape the imported Unity weapon and rock packs use, because the same rules apply: a real
  // HTTPS product page, the Standard EULA spelled exactly as `validateGatheringProduction` matches
  // on, and no archive hash — per-file `sha256` on each asset row is the audit.
  // TODO: pin the exact package URL once the purchasing account can be checked; this search URL
  // resolves to the product but is not the permanent product id.
  source: "https://assetstore.unity.com/?q=Animal%20pack%20deluxe",
  license: "Standard Unity Asset Store EULA; project owner must confirm entitlement",
};

/** Base-colour cap, matching the 512 px ceiling build-assets.ts applies to every other pack. */
const TEXTURE_LIMIT = 512;

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Post-processes one exported GLB.
 *
 * `prune` keeps leaves on purpose. Every animal here is skinned and its clips address bones by
 * node name, and a bone tip is an empty leaf node: dropping leaves silently deletes the last joint
 * of every limb and the clip that targets it stops resolving. build-assets.ts hit the same wall
 * with the shared animation library and documents the same fix.
 *
 * Quantization is skipped for the same reason build-assets.ts skips it on skinned meshes: it
 * cannot put the de-normalizing scale on the node, because a node matrix is ignored when skinning,
 * so it folds the correction into the inverse-bind matrices instead. Correct, but not worth the
 * risk on twenty-two rigs for a few hundred kilobytes.
 */
async function optimize(document: Document): Promise<void> {
  await document.transform(
    dedup(),
    prune({ keepAttributes: false, keepLeaves: true, keepSolidTextures: false }),
    weld(),
    resample(),
    // Pass 1: base colour that does not need alpha becomes JPEG, roughly 8x smaller than PNG here.
    textureCompress({ encoder: sharp, targetFormat: "jpeg", resize: [TEXTURE_LIMIT, TEXTURE_LIMIT], quality: 85 }),
    // Pass 2: anything still PNG genuinely needs its alpha. Resize and re-encode only those.
    textureCompress({
      encoder: sharp, targetFormat: "png", resize: [TEXTURE_LIMIT, TEXTURE_LIMIT],
      quality: 90, effort: 100, formats: /image\/png/,
    }),
  );
}


/**
 * Length of the asset's walk cycle in seconds, or undefined when it has none.
 *
 * Recorded because CADENCE is what decides whether a gait reads: `render/entityViews.ts` caps a
 * walk at `MAX_WALK_CADENCE_HZ` cycles per second, and cycles per second needs the clip's length as
 * well as its playback rate. `content/enemies.ts` solves each creature's `moveSpeedMps` against the
 * same two numbers, and `tests/creature-gait.test.ts` checks the result, so this is a build input
 * rather than a diagnostic.
 */
function walkClipSeconds(document: Document): number | undefined {
  return clipSeconds(document, "walk");
}

/** Length of a named locomotion clip in seconds, or undefined when the asset has none. */
function clipSeconds(document: Document, name: "walk" | "run"): number | undefined {
  const pattern = name === "walk" ? /^walk/i : /^run/i;
  const walk = document.getRoot().listAnimations().find((entry) => pattern.test(entry.getName()));
  if (!walk) return undefined;
  let duration = 0;
  for (const sampler of walk.listSamplers()) {
    const times = sampler.getInput()?.getArray();
    if (times && times.length > 0) duration = Math.max(duration, Number(times[times.length - 1]));
  }
  return duration > 0 ? Math.round(duration * 1000) / 1000 : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--stage")) {
    console.error("--stage is documented but not implemented in this tool; see tools/animals/README.md");
    process.exitCode = 1;
    return;
  }
  const onlyArg = args[args.indexOf("--only") + 1];
  const only = args.includes("--only") && onlyArg
    ? new Set(onlyArg.split(",").map((entry) => entry.trim()))
    : null;
  const keepRaw = args.includes("--keep-raw");

  const specs = (ANIMALS as AnimalSpec[]).filter(
    (spec) => !only || only.has(spec.id) || only.has(spec.id.replace(/^animal_/, "")),
  );
  if (specs.length === 0) throw new Error("no animals selected");

  if (!existsSync(STAGE_DIR)) {
    throw new Error(`Staged source missing at ${STAGE_DIR}. See tools/animals/README.md.`);
  }
  await mkdir(ANIMAL_DIR, { recursive: true });
  await mkdir(path.dirname(SIDECAR), { recursive: true });

  // Frame ranges for every animation file, extracted from the pack's Unity .meta sidecars. Without
  // these the `_exp` rigs ship four identical clips; see tools/animals/stage-clip-ranges.py.
  const rangesFile = path.join(STAGE_DIR, "clip-ranges.json");
  if (!existsSync(rangesFile)) {
    throw new Error(`Missing ${rangesFile}. Run: python tools/animals/stage-clip-ranges.py`);
  }
  // Keyed case-insensitively. The pack mixes `.fbx` and `.FBX`, the staged copies keep the original
  // spelling, and Windows resolves either, so a literal lookup misses every `_exp` rig.
  const clipRanges = new Map<string, { clip: string; first: number; last: number }>(
    Object.entries(
      JSON.parse(await readFile(rangesFile, "utf8")) as Record<
        string, { clip: string; first: number; last: number }
      >,
    ).map(([name, range]) => [name.toLowerCase(), range]),
  );

  const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.ERROR));
  const server = await startServer();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${server.url}/tools/animals/convert.html`);
  await page.waitForFunction(() => typeof (window as never as { convertAnimal?: unknown }).convertAnimal === "function", null, { timeout: 30_000 });

  const built: ManifestAsset[] = [];
  const failures: { id: string; error: string }[] = [];
  const notes: string[] = [];

  console.log(`converting ${specs.length} animals\n`);
  for (const spec of specs) {
    try {
      const clipUrls = spec.clips.map(([source, name, window]) => {
        const lower = path.join(STAGE_DIR, "anims", `${source}.fbx`);
        const upper = path.join(STAGE_DIR, "anims", `${source}.FBX`);
        const file = existsSync(lower) ? `${source}.fbx` : existsSync(upper) ? `${source}.FBX` : null;
        if (!file) throw new Error(`clip source not found: ${source}`);
        // Unity's own range for this file, narrowed by the catalog where a motion is a substitute.
        const recorded = clipRanges.get(file.toLowerCase());
        if (!recorded) throw new Error(`no clip range recorded for ${file}; re-run stage-clip-ranges.py`);
        const frames: [number, number] = window
          ? [window[0], window[1]]
          : [recorded.first, recorded.last];
        return { url: `/.asset-cache/animal-pack/anims/${file}`, name, frames };
      });

      const result = await page.evaluate(
        (payload) => (window as never as { convertAnimal: (p: unknown) => Promise<{
          base64: string; bytes: number; size: number[]; base: number[];
          meshNames: string[];
          impliedWalkMps: number;
          impliedRunMps: number;
          clips: { name: string; ok: boolean; duration?: number; tracks?: number; missing?: string[]; reason?: string; sealed?: boolean; seam?: number }[];
        }> }).convertAnimal(payload),
        {
          id: spec.id,
          rig: `/.asset-cache/animal-pack/models/${spec.rig}`,
          texture: `/.asset-cache/animal-pack/tex/${spec.texture}`,
          clips: clipUrls,
          synthAttack: spec.synthAttack ?? null,
        },
      );

      for (const clip of result.clips) {
        if (!clip.ok) {
          notes.push(`${spec.id}: clip ${clip.name} ${clip.reason ?? `misses bones ${clip.missing?.join(", ")}`}`);
        }
        // Worth saying out loud: a sealed cycle is one the pack did not close for us, and the seam
        // is synthetic. If a walk ever looks wrong again this is the first line to check.
        if (clip.seam) notes.push(`${spec.id}: ${clip.name} seam ${clip.seam.toFixed(2)} frames${clip.sealed ? " CLOSED" : ""}`);
      }
      for (const [motion, why] of Object.entries(spec.substitutes ?? {})) {
        notes.push(`${spec.id}: ${motion} is a substitute, ${why}`);
      }

      const raw = Buffer.from(result.base64, "base64");
      if (keepRaw) await writeFile(path.join(STAGE_DIR, `${spec.id}.raw.glb`), raw);

      const document = await io.readBinary(new Uint8Array(raw));
      await optimize(document);
      const glb = Buffer.from(await io.writeBinary(document));
      const outFile = path.join(ANIMAL_DIR, `${spec.id}.glb`);
      await writeFile(outFile, glb);

      // Measure from the OPTIMIZED document, so the manifest describes the shipped file.
      const scene = document.getRoot().listScenes()[0]!;
      const bounds = getBounds(scene);

      const animations = document.getRoot().listAnimations().map((entry) => entry.getName());
      const materials = document.getRoot().listMaterials().map((entry) => entry.getName());

      built.push({
        id: spec.id,
        file: `models/animal/${spec.id}.glb`,
        pack: ANIMAL_PACK.id,
        category: "character",
        is: spec.is,
        tags: spec.tags,
        bytes: glb.byteLength,
        size: {
          x: round(bounds.max[0] - bounds.min[0]),
          y: round(bounds.max[1] - bounds.min[1]),
          z: round(bounds.max[2] - bounds.min[2]),
        },
        base: { x: round(bounds.min[0]), y: round(bounds.min[1]), z: round(bounds.min[2]) },
        animations,
        ...(walkClipSeconds(document) === undefined
          ? {}
          : { walkClipSeconds: walkClipSeconds(document) }),
        materials,
        ...(result.impliedWalkMps > 0.02
          ? { impliedWalkMps: Math.round(result.impliedWalkMps * 100) / 100 }
          : {}),
        ...(result.impliedRunMps > 0.02
          ? { impliedRunMps: Math.round(result.impliedRunMps * 100) / 100 }
          : {}),
        ...(clipSeconds(document, "run") === undefined
          ? {}
          : { runClipSeconds: clipSeconds(document, "run") }),
      });

      const dims = `${(bounds.max[0] - bounds.min[0]).toFixed(2)} x ${(bounds.max[1] - bounds.min[1]).toFixed(2)} x ${(bounds.max[2] - bounds.min[2]).toFixed(2)} m`;
      console.log(
        `built  ${spec.id.padEnd(26)} ${readableSize(raw.byteLength).padStart(9)} -> ${readableSize(glb.byteLength).padStart(9)}` +
        `  ${dims.padStart(22)}  clips=[${animations.join(", ")}]`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ id: spec.id, error: message });
      console.error(`FAILED ${spec.id}: ${message.split("\n")[0]}`);
    }
  }

  await browser.close();
  await server.close();

  if (pageErrors.length > 0) {
    console.error(`\npage errors:\n  ${pageErrors.slice(0, 8).join("\n  ")}`);
  }
  if (notes.length > 0) {
    console.log(`\nsubstitutions and clip notes (${notes.length}):`);
    for (const note of notes) console.log(`  ${note}`);
  }

  // Sweep stale animal GLBs from earlier catalog revisions, but only on a full build.
  if (!only) {
    const expected = new Set(built.map((asset) => `${asset.id}.glb`));
    for (const name of await readdir(ANIMAL_DIR)) {
      if (name.endsWith(".glb") && !expected.has(name)) {
        await rm(path.join(ANIMAL_DIR, name));
        console.log(`removed stale ${name}`);
      }
    }
  }

  // The sidecar is the durable record. build-assets.ts reads it and replays these entries, so a
  // future `npm run build-assets` cannot silently drop the animals from the manifest it rewrites.
  const sidecarPayload = only && existsSync(SIDECAR)
    ? mergeSidecar(JSON.parse(await readFile(SIDECAR, "utf8")) as { assets: ManifestAsset[] }, built)
    : built;
  await writeFile(SIDECAR, `${JSON.stringify({ pack: ANIMAL_PACK, assets: sidecarPayload }, null, 2)}\n`);

  await mergeIntoManifest(sidecarPayload);

  console.log(
    `\n${built.length}/${specs.length} animals built, ` +
    `${readableSize(built.reduce((sum, asset) => sum + asset.bytes, 0))} total`,
  );
  if (failures.length > 0) {
    console.error(`\n${failures.length} failed:`);
    for (const failure of failures) console.error(`  ${failure.id}: ${failure.error.split("\n")[0]}`);
    process.exitCode = 1;
  }
}

function mergeSidecar(existing: { assets: ManifestAsset[] }, fresh: ManifestAsset[]): ManifestAsset[] {
  const byId = new Map((existing.assets ?? []).map((asset) => [asset.id, asset]));
  for (const asset of fresh) byId.set(asset.id, asset);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Replaces every animal entry in the live manifest, leaving the other packs untouched. */
async function mergeIntoManifest(assets: ManifestAsset[]): Promise<void> {
  const file = path.join(OUT_DIR, "manifest.json");
  const manifest = JSON.parse(await readFile(file, "utf8")) as {
    generatedAt: string;
    packs: { id: string }[];
    assets: ManifestAsset[];
  };
  manifest.assets = manifest.assets.filter((asset) => asset.pack !== ANIMAL_PACK.id).concat(assets);
  manifest.packs = manifest.packs.filter((pack) => pack.id !== ANIMAL_PACK.id).concat(ANIMAL_PACK);
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest: ${assets.length} animal entries, ${manifest.assets.length} assets total`);
}

await main();
