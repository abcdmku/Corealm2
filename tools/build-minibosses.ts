/**
 * Converts the PixeliusVita Monster02 rig into the four miniboss variants, and the two Blink
 * weapon meshes into the shared rare drops they guard.
 *
 * ONE RIG, FOUR SKINS. Galeskin, Mossbound, Tideworn and Cinderwake are one silhouette wearing
 * four palettes, for the same reason the orb bosses share the rhino: a silhouette is learned once
 * and read forever, and the recolour carries the flavour. The pack ships each palette as its own
 * finished PNG, so unlike the bosses there is no texture staging step at all - the build reads
 * the raw staged files directly.
 *
 * ONE FBX, ELEVEN TAKES. This is the pipeline's first source whose motions live as named
 * AnimStacks inside the rig file rather than one-file-one-take, and it is why the converter grew
 * its `take` selector. Each clip entry names its AnimStack; a name that does not resolve fails the
 * build here (see the clip-report check below) rather than shipping whichever take the loader
 * happened to put first.
 *
 * The conversion itself is `tools/animals/convert.js` in headless Chromium, unchanged pipeline:
 * root-motion strip by bone identity, non-deforming-track drop, loop resealing, stride
 * measurement, then gltf-transform post-processing. The weapons ride the same page's static path
 * (`convertStatic`) - no rig, no clips, authored normal/emissive maps kept.
 *
 * Usage:
 *   npx tsx tools/build-minibosses.ts
 *   npx tsx tools/build-minibosses.ts --only miniboss_galeskin,miniboss_sword
 *   npx tsx tools/build-minibosses.ts --keep-raw
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
import { MINIBOSSES, MINIBOSS_PACK, SWORD_PACK, STAFF_PACK, WEAPONS } from "./minibosses/catalog.mjs";

interface MinibossSpec {
  id: string;
  is: string;
  tags: string[];
  texture: string;
  extraScale: number;
  clips: { take: string; name: string }[];
}

interface WeaponSpec {
  id: string;
  pack: string;
  is: string;
  tags: string[];
  mesh: string;
  baseColor: string;
  normal?: string;
  emissive?: string;
  emissiveColor?: [number, number, number];
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  extraScale: number;
  recenterXZ: boolean;
}

const CACHE_DIR = path.join(repoRoot, ".asset-cache");
const MONSTER_DIR = "miniboss-pack/raw/Assets/Stylized3DMonster/Monster02";
const OUT_DIR = path.join(gameRoot, "public", "assets");
const MINIBOSS_DIR = path.join(OUT_DIR, "models", "miniboss");
const MANIFEST_FILE = path.join(OUT_DIR, "manifest.json");
const SIDECAR = path.join(repoRoot, "tools", "data", "miniboss-assets.json");

const PACKS = [MINIBOSS_PACK, SWORD_PACK, STAFF_PACK] as { id: string }[];
const PACK_IDS = new Set(PACKS.map((pack) => pack.id));

/** Same 512 px ceiling every other pack gets; a miniboss is one entity and a sword is smaller. */
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
  walkClipSeconds?: number;
  impliedRunMps?: number;
  runClipSeconds?: number;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function readableSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Post-processes one exported GLB. Identical reasoning to `tools/build-bosses.ts: optimize`. */
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

/** Length of a named locomotion clip in seconds, or undefined when the asset has none. */
function clipSeconds(document: Document, name: "walk" | "run"): number | undefined {
  const pattern = name === "walk" ? /^walk/i : /^run/i;
  const clip = document.getRoot().listAnimations().find((entry) => pattern.test(entry.getName()));
  if (!clip) return undefined;
  let duration = 0;
  for (const sampler of clip.listSamplers()) {
    const times = sampler.getInput()?.getArray();
    if (times && times.length > 0) duration = Math.max(duration, Number(times[times.length - 1]));
  }
  return duration > 0 ? Math.round(duration * 1000) / 1000 : undefined;
}

function manifestRow(
  spec: { id: string; is: string; tags: string[] },
  pack: string,
  category: string,
  glb: Buffer,
  document: Document,
): ManifestAsset {
  const bounds = getBounds(document.getRoot().listScenes()[0]!);
  return {
    id: spec.id,
    file: `models/miniboss/${spec.id}.glb`,
    pack,
    category,
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
    materials: document.getRoot().listMaterials().map((entry) => entry.getName()),
    // Per-file, uppercase hex, matching the imported Unity rows `tools/build-assets.ts` preserves.
    // There is no redistributable archive of ours to hash, so this is the audit that replaces
    // `archiveSha256`.
    sha256: createHash("sha256").update(glb).digest("hex").toUpperCase(),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const onlyArg = args[args.indexOf("--only") + 1];
  const only = args.includes("--only") && onlyArg
    ? new Set(onlyArg.split(",").map((entry) => entry.trim()))
    : null;
  const keepRaw = args.includes("--keep-raw");

  const monsterSpecs = (MINIBOSSES as MinibossSpec[]).filter(
    (spec) => !only || only.has(spec.id) || only.has(spec.id.replace(/^miniboss_/, "")),
  );
  const weaponSpecs = (WEAPONS as WeaponSpec[]).filter(
    (spec) => !only || only.has(spec.id) || only.has(spec.id.replace(/^miniboss_/, "")),
  );
  if (monsterSpecs.length + weaponSpecs.length === 0) throw new Error("no minibosses selected");

  const rigFile = path.join(CACHE_DIR, MONSTER_DIR, "Monster02_AllAnim.fbx");
  if (monsterSpecs.length > 0 && !existsSync(rigFile)) {
    throw new Error(`Staged rig missing at ${rigFile}. See tools/minibosses/README.md.`);
  }
  for (const spec of monsterSpecs) {
    const texture = path.join(CACHE_DIR, MONSTER_DIR, "Shader_Texture", "Texture", spec.texture);
    if (!existsSync(texture)) throw new Error(`${spec.id}: texture not staged at ${texture}`);
  }
  for (const spec of weaponSpecs) {
    for (const file of [spec.mesh, spec.baseColor, spec.normal, spec.emissive]) {
      if (file && !existsSync(path.join(CACHE_DIR, file))) {
        throw new Error(`${spec.id}: source not staged at ${path.join(CACHE_DIR, file)}`);
      }
    }
  }
  await mkdir(MINIBOSS_DIR, { recursive: true });
  await mkdir(path.dirname(SIDECAR), { recursive: true });

  const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.ERROR));
  const server = await startServer();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${server.url}/tools/animals/convert.html`);
  await page.waitForFunction(
    () => typeof (window as never as { convertStatic?: unknown }).convertStatic === "function",
    null,
    { timeout: 30_000 },
  );

  const built: ManifestAsset[] = [];
  const failures: { id: string; error: string }[] = [];
  const notes: string[] = [];

  console.log(`converting ${monsterSpecs.length} minibosses and ${weaponSpecs.length} weapons\n`);
  for (const spec of monsterSpecs) {
    try {
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
          rig: `/.asset-cache/${MONSTER_DIR}/Monster02_AllAnim.fbx`,
          texture: `/.asset-cache/${MONSTER_DIR}/Shader_Texture/Texture/${spec.texture}`,
          // The tier tint in `render/entityViews.ts` exempts /^(animal|boss)_/i, and `miniboss_*`
          // starts with neither, so the material carries a boss_ prefix on top of the full asset
          // id. Renaming the ids instead would collide with the orb bosses' namespace.
          materialName: `boss_${spec.id}_mat`,
          extraScale: spec.extraScale,
          // Six clips, one source file, six named takes. Same url every time is deliberate.
          clips: spec.clips.map((clip) => ({
            url: `/.asset-cache/${MONSTER_DIR}/Monster02_AllAnim.fbx`,
            name: clip.name,
            take: clip.take,
          })),
        },
      );

      // A failed take resolution or a non-fitting clip is a build failure, not a note. The boss
      // builder can afford a warning because its sources are one-take files that either load or
      // 404; here the failure mode is the WRONG take shipping under the right name.
      const broken = result.clips.filter((clip) => !clip.ok);
      if (broken.length > 0) {
        throw new Error(broken
          .map((clip) => `clip ${clip.name}: ${clip.reason ?? `misses bones ${clip.missing?.join(", ")}`}`)
          .join("; "));
      }
      for (const clip of result.clips) {
        if (clip.seam) {
          notes.push(`${spec.id}: ${clip.name} seam ${clip.seam.toFixed(2)} frames${clip.sealed ? " CLOSED" : ""}`);
        }
      }

      const raw = Buffer.from(result.base64, "base64");
      if (keepRaw) await writeFile(path.join(CACHE_DIR, "miniboss-pack", `${spec.id}.raw.glb`), raw);

      const document = await io.readBinary(new Uint8Array(raw));
      await optimize(document);

      // The take selector's whole job was keeping the other five AnimStacks out; prove it on the
      // file that ships rather than trusting the report.
      const shipped = document.getRoot().listAnimations().map((entry) => entry.getName()).sort();
      const expected = spec.clips.map((clip) => clip.name).sort();
      if (shipped.join(",") !== expected.join(",")) {
        throw new Error(`animations [${shipped.join(", ")}] != expected [${expected.join(", ")}]`);
      }

      const glb = Buffer.from(await io.writeBinary(document));
      await writeFile(path.join(MINIBOSS_DIR, `${spec.id}.glb`), glb);

      built.push({
        ...manifestRow(spec, MINIBOSS_PACK.id, "character", glb, document),
        ...(result.impliedWalkMps > 0.02
          ? { impliedWalkMps: Math.round(result.impliedWalkMps * 100) / 100 }
          : {}),
        ...(clipSeconds(document, "walk") === undefined ? {} : { walkClipSeconds: clipSeconds(document, "walk") }),
        ...(result.impliedRunMps > 0.02
          ? { impliedRunMps: Math.round(result.impliedRunMps * 100) / 100 }
          : {}),
        ...(clipSeconds(document, "run") === undefined ? {} : { runClipSeconds: clipSeconds(document, "run") }),
      });

      const dims = `${built.at(-1)!.size.x.toFixed(2)} x ${built.at(-1)!.size.y.toFixed(2)} x ${built.at(-1)!.size.z.toFixed(2)} m`;
      console.log(
        `built  ${spec.id.padEnd(22)} ${readableSize(raw.byteLength).padStart(9)} -> ${readableSize(glb.byteLength).padStart(9)}  ${dims}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ id: spec.id, error: message });
      console.error(`FAILED ${spec.id}: ${message}`);
    }
  }

  for (const spec of weaponSpecs) {
    try {
      const result = await page.evaluate(
        (payload) => (window as never as { convertStatic: (p: unknown) => Promise<{
          base64: string; bytes: number; size: number[]; base: number[]; meshNames: string[];
        }> }).convertStatic(payload),
        {
          id: spec.id,
          mesh: `/.asset-cache/${spec.mesh}`,
          baseColor: `/.asset-cache/${spec.baseColor}`,
          ...(spec.normal ? { normal: `/.asset-cache/${spec.normal}` } : {}),
          ...(spec.emissive ? { emissive: `/.asset-cache/${spec.emissive}` } : {}),
          emissiveColor: spec.emissiveColor,
          emissiveIntensity: spec.emissiveIntensity,
          roughness: spec.roughness,
          metalness: spec.metalness,
          // Weapons are equipment, not creatures: the tier tint never sees them, so they follow
          // the `rpg_weapon_staff_material` naming instead of the boss_ prefix.
          materialName: `${spec.id}_material`,
          extraScale: spec.extraScale,
          recenterXZ: spec.recenterXZ,
        },
      );

      const raw = Buffer.from(result.base64, "base64");
      if (keepRaw) await writeFile(path.join(CACHE_DIR, `${spec.id}.raw.glb`), raw);

      const document = await io.readBinary(new Uint8Array(raw));
      await optimize(document);
      if (document.getRoot().listAnimations().length > 0) {
        throw new Error("static weapon exported with animations");
      }
      const glb = Buffer.from(await io.writeBinary(document));
      await writeFile(path.join(MINIBOSS_DIR, `${spec.id}.glb`), glb);

      built.push(manifestRow(spec, spec.pack, "weapon", glb, document));
      const dims = `${built.at(-1)!.size.x.toFixed(2)} x ${built.at(-1)!.size.y.toFixed(2)} x ${built.at(-1)!.size.z.toFixed(2)} m`;
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
    console.error(`\n${failures.length} build(s) failed; manifest left untouched`);
    process.exitCode = 1;
    return;
  }

  // The sidecar is the durable record, like tools/data/animal-assets.json: a future manifest
  // rebuild can replay these rows without re-running Chromium.
  const sidecarPayload = only && existsSync(SIDECAR)
    ? mergeSidecar(JSON.parse(await readFile(SIDECAR, "utf8")) as { assets: ManifestAsset[] }, built)
    : built;
  await writeFile(SIDECAR, `${JSON.stringify({ packs: PACKS, assets: sidecarPayload }, null, 2)}\n`);

  await mergeIntoManifest(sidecarPayload);
}

function mergeSidecar(existing: { assets: ManifestAsset[] }, fresh: ManifestAsset[]): ManifestAsset[] {
  const byId = new Map((existing.assets ?? []).map((asset) => [asset.id, asset]));
  for (const asset of fresh) byId.set(asset.id, asset);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Replaces every miniboss/weapon entry in the live manifest, leaving the other packs untouched.
 *
 * Filter-and-append like `tools/build-animals.ts`, NOT the boss builder's global re-sort: the live
 * manifest is not in (category, id) order everywhere, so re-sorting the whole array turns a
 * six-row change into a nine-thousand-line diff. The legacy builder imposes its own order whenever
 * it runs; until then this tool only owns its own rows.
 */
async function mergeIntoManifest(assets: ManifestAsset[]): Promise<void> {
  const manifest = JSON.parse(await readFile(MANIFEST_FILE, "utf8")) as {
    generatedAt: string;
    packs: { id: string }[];
    assets: ManifestAsset[];
  };
  manifest.assets = manifest.assets.filter((asset) => !PACK_IDS.has(asset.pack)).concat(assets);
  manifest.packs = manifest.packs.filter((pack) => !PACK_IDS.has(pack.id)).concat(PACKS);
  await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nmanifest: ${assets.length} miniboss entries, ${manifest.assets.length} assets total`);
}

await main();
