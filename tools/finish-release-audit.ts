/** Read-only release inventory. Writes disposable evidence; never promotes assets or accepts art.
 * npx tsx tools/finish-release-audit.ts [--out test-results/finish-release-audit.json]
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./lib/paths.js";
import type { AssetManifest } from "../game/src/render/assets.js";

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const relative = (file: string) => path.relative(repoRoot, file).split(path.sep).join("/");
const root = path.join(repoRoot, "game/public/assets");
const manifestBytes = await readFile(path.join(root, "manifest.json"));
const manifest = JSON.parse(manifestBytes.toString()) as AssetManifest;
const defects: Array<{ code: string; id: string; detail: string }> = [];
const notices: Array<{ code: string; id: string; detail: string }> = [];
const add = (code: string, id: string, detail: string) => defects.push({ code, id, detail });

async function inventory(directory: string): Promise<Array<{ file: string; bytes: number; sha256: string }>> {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await inventory(file));
    else if (entry.isFile()) {
      const bytes = await readFile(file);
      files.push({ file: relative(file), bytes: bytes.length, sha256: sha256(bytes) });
    }
  }
  return files;
}
const files = await inventory(root);
const byFile = new Map(files.map((file) => [file.file, file]));
const packs = [];
for (const pack of manifest.packs) {
  const missingMetadata = ["source", "license", "author"].filter((field) => !pack[field as keyof typeof pack]);
  if (missingMetadata.length) add("missing-source-metadata", pack.id, missingMetadata.join(", "));
  if (!pack.archiveSha256 && !pack.generatorSha256) {
    const members = manifest.assets.filter((asset) => asset.pack === pack.id) as Array<typeof manifest.assets[number] & { sha256?: string }>;
    const perFileVerified = pack.license.startsWith("Standard Unity Asset Store EULA") && members.length > 0 && members.every((asset) =>
      /^[0-9a-f]{64}$/i.test(asset.sha256 ?? "")
      && byFile.get(relative(path.resolve(root, asset.file)))?.sha256 === asset.sha256?.toLowerCase());
    if (perFileVerified) notices.push({ code: "verified-per-file-provenance", id: pack.id,
      detail: "Existing Unity import policy permits per-file SHA-256 provenance; every pack member matches its declared hash. Archive pin remains optional follow-up, not a release defect." });
    else add("missing-provenance-pin", pack.id, "Neither archive/generator pin nor fully verified Unity per-file provenance is available.");
  }
  let generator: { status: string; actualSha256?: string } = { status: "not-applicable" };
  if (pack.generatorSha256) {
    try {
      const actualSha256 = sha256(await readFile(path.resolve(repoRoot, pack.source)));
      generator = { status: actualSha256 === pack.generatorSha256 ? "matches-entrypoint-only" : "mismatch", actualSha256 };
      if (generator.status === "mismatch") add("generator-hash-mismatch", pack.id, "Manifest generator hash differs from current source. Reconcile only after accepted generation.");
    } catch { generator = { status: "missing-source" }; add("missing-generator", pack.id, pack.source); }
  }
  packs.push({ ...pack, generator, licenseReview: "unreviewed", archiveVerification: pack.archiveSha256 ? "declared-hash-not-rechecked-against-entitled-cache" : "no-archive-hash", dependencyClosure: "unreviewed" });
}
const ids = new Set<string>();
const assets = [];
for (const asset of manifest.assets) {
  if (ids.has(asset.id)) add("duplicate-id", asset.id, "Manifest asset IDs must be unique.");
  ids.add(asset.id);
  const filename = relative(path.resolve(root, asset.file));
  const actual = byFile.get(filename);
  if (!actual) add("missing-served-file", asset.id, asset.file);
  else if (actual.bytes !== asset.bytes) add("byte-count-mismatch", asset.id, `${asset.bytes} declared; ${actual.bytes} actual`);
  const declaredSha256 = (asset as typeof asset & { sha256?: string }).sha256;
  if (declaredSha256 !== undefined && (!/^[0-9a-f]{64}$/i.test(declaredSha256) || actual?.sha256 !== declaredSha256.toLowerCase())) {
    add("asset-hash-mismatch", asset.id, "Declared model SHA-256 does not match served bytes.");
  }
  if (!manifest.packs.some((pack) => pack.id === asset.pack)) add("missing-pack", asset.id, asset.pack);
  let glb: { materials: string[]; clips: string[]; externalUris: string[] } | null = null;
  if (actual && asset.file.endsWith(".glb")) {
    try {
      const bytes = await readFile(path.resolve(root, asset.file));
      if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF" || bytes.readUInt32LE(8) !== bytes.length) throw new Error("Invalid GLB header");
      const length = bytes.readUInt32LE(12);
      if (bytes.readUInt32LE(16) !== 0x4e4f534a || 20 + length > bytes.length) throw new Error("Missing or truncated JSON chunk");
      const json = JSON.parse(bytes.toString("utf8", 20, 20 + length)) as {
        materials?: Array<{ name?: string }>; animations?: Array<{ name?: string }>;
        images?: Array<{ uri?: string }>; buffers?: Array<{ uri?: string }>;
      };
      glb = { materials: (json.materials ?? []).map((m) => m.name ?? ""), clips: (json.animations ?? []).map((a) => a.name ?? ""),
        externalUris: [...json.images ?? [], ...json.buffers ?? []].flatMap((i) => i.uri && !i.uri.startsWith("data:") ? [i.uri] : []) };
      for (const uri of glb.externalUris) {
        const resolved = relative(path.resolve(root, path.dirname(asset.file), decodeURIComponent(uri)));
        if (!byFile.has(resolved)) add("missing-external-resource", asset.id, uri);
      }
      const sameNames = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
      if (!sameNames(asset.animations, glb.clips)) add("animation-metadata-mismatch", asset.id, "Manifest names differ from GLB animation names.");
      if (!sameNames(asset.materials, glb.materials)) add("material-metadata-mismatch", asset.id, "Manifest names differ from GLB material names.");
    } catch (error) { add("invalid-glb", asset.id, String(error)); }
  }
  assets.push({ id: asset.id, category: asset.category, pack: asset.pack, file: asset.file, declaredBytes: asset.bytes,
    actual: actual ?? null, glb, disposition: "unreviewed", visualEvidence: null, behaviorEvidence: null,
    reviewAlias: asset.file.startsWith("models/review/"), removalAllowed: false });
}
const referencedModels = new Set(manifest.assets.map((asset) => relative(path.resolve(root, asset.file))));
const unreferencedModels = files.filter((file) => file.file.endsWith(".glb") && !referencedModels.has(file.file));
const budgets = [];
for (const [file, maxBytes] of [["world-map-minimap.webp", 150_000], ["world-map-detail-4800.webp", 1_275_000], ["world-map-detail-2400.webp", 1_275_000], ["world-map-detail-1200.webp", 1_275_000]] as const) {
  let bytes: number | null = null;
  try { bytes = (await stat(path.join(repoRoot, "game/public/generated", file))).size; } catch { /* Recorded below. */ }
  budgets.push({ file, bytes, maxBytes, pass: bytes !== null && bytes <= maxBytes });
  if (bytes === null || bytes > maxBytes) add("map-budget", file, bytes === null ? "Missing rendition" : `${bytes} exceeds ${maxBytes}`);
}
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), scope: "Disk catalogue snapshot during active work. No browser, entitlement, visual, gameplay, or release acceptance is implied.",
  manifestSha256: sha256(manifestBytes), releaseAccepted: false,
  summary: { assets: assets.length, packs: packs.length, servedFiles: files.length, servedBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    unreviewedAssets: assets.length, reviewAliases: assets.filter((asset) => asset.reviewAlias).length, defects: defects.length },
  budgets: { maps: budgets, applicationInitialJsGzipBytes: 1_000_000, criticalInitialJsAndWasmGzipBytes: 1_500_000, bundleMeasurement: "not-run-use-npm-run-build" },
  packs, assets, servedFiles: files, unreferencedModels, defects, notices };
const argument = process.argv.indexOf("--out");
if (argument >= 0 && !process.argv[argument + 1]) throw new Error("--out requires a filename");
const output = path.resolve(repoRoot, argument >= 0 ? process.argv[argument + 1]! : "test-results/finish-release-audit.json");
const disposableRoot = path.join(repoRoot, "test-results") + path.sep;
if (!output.startsWith(disposableRoot)) throw new Error("Audit output must stay under test-results; promote evidence separately after root review.");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ output: relative(output), ...report.summary, defectCounts: Object.fromEntries([...new Set(defects.map((d) => d.code))].map((code) => [code, defects.filter((d) => d.code === code).length])) }, null, 2));
// A snapshot with explicit defects remains useful evidence; --strict turns technical defects into a gate.
if (process.argv.includes("--strict") && defects.length) process.exitCode = 1;
