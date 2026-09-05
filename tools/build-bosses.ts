/**
 * Converts the Fantasy Rhino rig into the three elemental orb bosses.
 *
 * ONE RIG, THREE ELEMENTS. The Tempest Roc, the Rootheart and Ordrun each guard one element's Orb
 * and each is meant to read on sight as the thing on that map which is not simply wildlife. They
 * share a model on purpose: the pack's hide is already plated with authored glowing seams, and
 * `tools/bosses/stage-textures.py` rotates those seams onto air, earth and water. Three unrelated
 * monsters would have been three silhouettes to learn; one silhouette in three powers is a rule the
 * player can read the first time and apply forever.
 *
 * The conversion itself is `tools/animals/convert.js`, unchanged apart from the emissive map it
 * grew for exactly this: three's FBXLoader and GLTFExporter both need DOM APIs Node does not have,
 * so it runs in headless Chromium. Everything about the pipeline, and the traps it already fell
 * into, is documented in `tools/animals/README.md`; this file is the same pipeline with a different
 * source pack and one extra texture slot.
 *
 * Usage:
 *   python tools/bosses/stage-textures.py     # once, after extracting the .unitypackage
 *   npx tsx tools/build-bosses.ts
 *   npx tsx tools/build-bosses.ts --only boss_rhino_earth
 *   npx tsx tools/build-bosses.ts --keep-raw
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import sharp from "sharp";
import { Document, getBounds, Logger, NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, resample, textureCompress, weld } from "@gltf-transform/functions";
import { gameRoot, repoRoot } from "./lib/paths.js";
// @ts-expect-error - plain ESM helper, deliberately not TypeScript
import { startServer } from "./animals/serve.mjs";
// @ts-expect-error - plain ESM data module, deliberately not TypeScript
import { BOSSES, BOSS_PACK } from "./bosses/catalog.mjs";

interface BossSpec {
  id: string;
  is: string;
  tags: string[];
  clips: [string, string][];
  emissiveIntensity: number;
  extraScale: number;
}

const STAGE_DIR = path.join(repoRoot, ".asset-cache", "boss-pack");
const OUT_DIR = path.join(gameRoot, "public", "assets");
const BOSS_DIR = path.join(OUT_DIR, "models", "boss");
const MANIFEST_FILE = path.join(OUT_DIR, "manifest.json");

/** Same 512 px base-colour ceiling every other pack gets. A boss is one entity, not a crowd. */
const TEXTURE_LIMIT = 512;

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
  sha256: string;
  impliedWalkMps?: number;
  impliedRunMps?: number;
  walkClipSeconds?: number;
  runClipSeconds?: number;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function readableSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Post-processes one exported GLB. Identical reasoning to `tools/build-animals.ts: optimize`.
 *
 * `keepLeaves` matters here too: the rig is skinned, clips address bones by node name, and a bone
 * tip is an empty leaf that pruning would delete along with the clip track pointing at it.
 *
 * `keepSolidTextures: false` is the one difference worth calling out. The emissive map is mostly
 * black with bright seams, which is emphatically not solid, so it survives — but if an element's
 * recolour ever collapsed to a flat colour this is what would silently drop it, and the manifest's
 * `materials` line is where that would show.
 */
async function optimize(document: Document): Promise<void> {
  await document.transform(
    dedup(),
    prune({ keepAttributes: false, keepLeaves: true, keepSolidTextures: false }),
    weld(),
    resample(),
    textureCompress({ encoder: sharp, targetFormat: "jpeg", resize: [TEXTURE_LIMIT, TEXTURE_LIMIT], quality: 85 }),
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
function walkClipSeconds(document: Document, name = "Walk"): number | undefined {
  const walk = document.getRoot().listAnimations().find((entry) => entry.getName().toLowerCase() === name.toLowerCase());
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
  const onlyArg = args[args.indexOf("--only") + 1];
  const only = args.includes("--only") && onlyArg
    ? new Set(onlyArg.split(",").map((entry) => entry.trim()))
    : null;
  const keepRaw = args.includes("--keep-raw");

  const specs = (BOSSES as BossSpec[]).filter(
    (spec) => !only || only.has(spec.id) || only.has(spec.id.replace(/^boss_rhino_/, "")),
  );
  if (specs.length === 0) throw new Error("no bosses selected");

  const rigFile = path.join(STAGE_DIR, "raw", "Assets", "Rhino", "Mesh", "Rino_mesh.FBX");
  if (!existsSync(rigFile)) {
    throw new Error(`Staged rig missing at ${rigFile}. See tools/bosses/README.md.`);
  }
  if (!existsSync(path.join(STAGE_DIR, "tex"))) {
    throw new Error("Textures not staged. Run: python tools/bosses/stage-textures.py");
  }
  await mkdir(BOSS_DIR, { recursive: true });

  const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.ERROR));
  const server = await startServer();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${server.url}/tools/animals/convert.html`);
  await page.waitForFunction(
    () => typeof (window as never as { convertAnimal?: unknown }).convertAnimal === "function",
    null,
    { timeout: 30_000 },
  );

  const built: ManifestAsset[] = [];
  const failures: { id: string; error: string }[] = [];
  const notes: string[] = [];

  console.log(`converting ${specs.length} bosses\n`);
  for (const spec of specs) {
    try {
      // No frame windows. Every rhino animation is its own FBX holding one motion, so the take IS
      // the clip — unlike the animal pack's `_exp` rigs, which need Unity's recorded ranges to tell
      // four motions apart inside one long take.
      const clips = spec.clips.map(([source, name]) => ({
        url: `/.asset-cache/boss-pack/raw/Assets/Rhino/animation/${source}.FBX`,
        name,
      }));
      for (const clip of spec.clips) {
        const file = path.join(STAGE_DIR, "raw", "Assets", "Rhino", "animation", `${clip[0]}.FBX`);
        if (!existsSync(file)) throw new Error(`clip source not found: ${clip[0]}`);
      }

      const result = await page.evaluate(
        (payload) => (window as never as { convertAnimal: (p: unknown) => Promise<{
          base64: string; bytes: number; size: number[]; base: number[];
          meshNames: string[];
          impliedWalkMps: number;
          impliedRunMps: number;
          clips: { name: string; ok: boolean; reason?: string; missing?: string[]; sealed?: boolean; seam?: number }[];
        }> }).convertAnimal(payload),
        {
          id: spec.id,
          rig: "/.asset-cache/boss-pack/raw/Assets/Rhino/Mesh/Rino_mesh.FBX",
          texture: `/.asset-cache/boss-pack/tex/${spec.id}_albedo.png`,
          emissive: `/.asset-cache/boss-pack/tex/${spec.id}_emissive.png`,
          emissiveIntensity: spec.emissiveIntensity,
          extraScale: spec.extraScale,
          clips,
          synthAttack: null,
        },
      );

      for (const clip of result.clips) {
        if (!clip.ok) {
          notes.push(`${spec.id}: clip ${clip.name} ${clip.reason ?? `misses bones ${clip.missing?.join(", ")}`}`);
        }
        if (clip.seam) {
          notes.push(`${spec.id}: ${clip.name} seam ${clip.seam.toFixed(2)} frames${clip.sealed ? " CLOSED" : ""}`);
        }
      }

      const raw = Buffer.from(result.base64, "base64");
      if (keepRaw) await writeFile(path.join(STAGE_DIR, `${spec.id}.raw.glb`), raw);

      const document = await io.readBinary(new Uint8Array(raw));
      await optimize(document);
      const glb = Buffer.from(await io.writeBinary(document));
      await writeFile(path.join(BOSS_DIR, `${spec.id}.glb`), glb);

      const scene = document.getRoot().listScenes()[0]!;
      const bounds = getBounds(scene);
      built.push({
        id: spec.id,
        file: `models/boss/${spec.id}.glb`,
        pack: BOSS_PACK.id,
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
        animations: document.getRoot().listAnimations().map((entry) => entry.getName()),
        ...(walkClipSeconds(document) === undefined
          ? {}
          : { walkClipSeconds: walkClipSeconds(document) }),
        materials: document.getRoot().listMaterials().map((entry) => entry.getName()),
        // Per-file, uppercase hex, matching the imported Unity rows `tools/build-assets.ts`
        // preserves. There is no redistributable archive of ours to hash for a Unity pack, so this
        // is the audit that replaces `archiveSha256`.
        sha256: createHash("sha256").update(glb).digest("hex").toUpperCase(),
        ...(result.impliedWalkMps > 0.02
          ? { impliedWalkMps: Math.round(result.impliedWalkMps * 100) / 100 }
          : {}),
        ...(result.impliedRunMps > 0.02
          ? { impliedRunMps: Math.round(result.impliedRunMps * 100) / 100 }
          : {}),
        ...(walkClipSeconds(document, "Run") === undefined
          ? {}
          : { runClipSeconds: walkClipSeconds(document, "Run") }),
      });

      const dims = `${(bounds.max[0] - bounds.min[0]).toFixed(2)} x ${(bounds.max[1] - bounds.min[1]).toFixed(2)} x ${(bounds.max[2] - bounds.min[2]).toFixed(2)} m`;
      console.log(
        `built  ${spec.id.padEnd(22)} ${readableSize(raw.byteLength).padStart(9)} -> ${readableSize(glb.byteLength).padStart(9)}  ${dims}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ id: spec.id, error: message });
      console.error(`FAILED ${spec.id}: ${message}`);
    }
  }

  await browser.close();
  await server.close();

  if (notes.length > 0) {
    console.log("\nnotes:");
    for (const note of notes) console.log(`  ${note}`);
  }
  if (pageErrors.length > 0) {
    console.log("\npage errors:");
    for (const error of pageErrors) console.log(`  ${error}`);
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} boss(es) failed; manifest left untouched`);
    process.exitCode = 1;
    return;
  }

  await mergeIntoManifest(built);
}

/** Replaces every boss entry in the live manifest, leaving the other packs untouched. */
async function mergeIntoManifest(assets: ManifestAsset[]): Promise<void> {
  const manifest = JSON.parse(await readFile(MANIFEST_FILE, "utf8")) as {
    generatedAt: string;
    packs: { id: string }[];
    assets: ManifestAsset[];
  };
  manifest.assets = manifest.assets
    .filter((asset) => asset.pack !== BOSS_PACK.id)
    .concat(assets)
    .sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
  manifest.packs = manifest.packs.filter((pack) => pack.id !== BOSS_PACK.id).concat(BOSS_PACK);
  await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nmanifest: ${assets.length} boss entries, ${manifest.assets.length} assets total`);
}

await main();
