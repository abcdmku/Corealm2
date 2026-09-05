/** Root-run integration step. Staged assets still require feature-lab acceptance after promotion. */
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const assetsRoot = path.join(repo, "game/public/assets");
const stageRoot = path.join(repo, "runs/local-creature-rebuild/models");
const backupRoot = path.join(repo, "runs/local-creature-rebuild/backup");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

interface StagedAsset {
  id: string;
  stagedFile: string;
  productionFile: string;
  sourceSha256: string;
  sha256: string;
  bytes: number;
  animations: string[];
  attack: { seconds: number; contactNormalized: number } | null;
  groundY?: number;
  recalibratedGaits?: boolean;
  gaits: Record<string, { clipSeconds: number; impliedMps: number }>;
  validation: { geometryUvSkinBindPoseUnchanged: boolean; serializedRoundTripValid: boolean };
}

interface AssetEntry {
  id: string;
  file: string;
  bytes: number;
  animations: string[];
  sha256?: string;
  impliedWalkMps?: number;
  walkClipSeconds?: number;
  impliedRunMps?: number;
  runClipSeconds?: number;
  groundY?: number;
  [key: string]: unknown;
}

interface AssetDocument { assets: AssetEntry[]; [key: string]: unknown }

function inside(root: string, filename: string): string {
  const absolute = path.resolve(root, filename);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Path escapes ${root}: ${filename}`);
  return absolute;
}

async function firstBackup(filename: string): Promise<void> {
  const destination = inside(backupRoot, path.relative(repo, filename));
  await mkdir(path.dirname(destination), { recursive: true });
  try { await copyFile(filename, destination, constants.COPYFILE_EXCL); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

function updateEntry(entry: AssetEntry, asset: StagedAsset): void {
  entry.bytes = asset.bytes;
  entry.sha256 = asset.sha256.toUpperCase();
  entry.animations = asset.animations.slice();
  if (asset.groundY !== undefined) {
    if (!Number.isFinite(asset.groundY)) throw new Error(`${asset.id}: invalid calibrated groundY`);
    entry.groundY = asset.groundY;
  }
  // Replace measured gait fields only for imported locomotion repairs. Rhino now has a genuine
  // Walk, and Frog regains source hop height plus the authored loop recovery.
  if (asset.recalibratedGaits || asset.id.startsWith("boss_rhino_")) {
    const walk = asset.gaits.Walk, run = asset.gaits.Run;
    if (!walk || !run) throw new Error(`${asset.id}: missing measured gait metadata`);
    entry.impliedWalkMps = Number(walk.impliedMps.toFixed(6));
    entry.walkClipSeconds = Number(walk.clipSeconds.toFixed(6));
    entry.impliedRunMps = Number(run.impliedMps.toFixed(6));
    entry.runClipSeconds = Number(run.clipSeconds.toFixed(6));
  }
}

async function main(): Promise<void> {
  const report = JSON.parse(await readFile(path.join(repo, "tools/data/creature-motion-rebuild.json"), "utf8")) as { version: number; assets: StagedAsset[] };
  if (report.version !== 1) throw new Error(`Unsupported rebuild version ${report.version}`);
  const manifestFile = path.join(assetsRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as AssetDocument;
  const expected = manifest.assets.filter(a => /^animal_|^boss_rhino_/.test(a.id));
  const staged = new Map(report.assets.map(a => [a.id, a]));
  if (staged.size !== report.assets.length || expected.length !== staged.size || expected.some(a => !staged.has(a.id))) throw new Error("Rebuild report must contain the complete existing animal/rhino roster");
  const pending: { destination: string; bytes: Buffer }[] = [];
  for (const entry of expected) {
    const asset = staged.get(entry.id)!;
    if (asset.productionFile !== entry.file) throw new Error(`${entry.id}: production path changed`);
    if (!asset.validation.geometryUvSkinBindPoseUnchanged || !asset.validation.serializedRoundTripValid) throw new Error(`${entry.id}: offline acceptance missing`);
    if (asset.attack && (!Number.isFinite(asset.attack.seconds) || asset.attack.seconds <= 0 || asset.attack.contactNormalized <= 0 || asset.attack.contactNormalized >= 1)) throw new Error(`${entry.id}: invalid contact timing`);
    const source = inside(repo, asset.stagedFile);
    inside(stageRoot, path.relative(stageRoot, source));
    const bytes = await readFile(source);
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256.toLowerCase()) throw new Error(`${entry.id}: staged file differs from validated hash`);
    const destination = inside(assetsRoot, entry.file);
    const currentHash = sha256(await readFile(destination));
    if (currentHash !== asset.sourceSha256.toLowerCase() && currentHash !== asset.sha256.toLowerCase()) throw new Error(`${entry.id}: production changed after the rebuild; inspect before replacing`);
    updateEntry(entry, asset);
    pending.push({ destination, bytes });
  }
  // Keep the source catalogue sidecar consistent too; generated docs and subsequent asset
  // processing read these same records. There is no boss sidecar in this project.
  const sidecarFile = path.join(repo, "tools/data/animal-assets.json");
  const sidecar = JSON.parse(await readFile(sidecarFile, "utf8")) as AssetDocument;
  for (const entry of sidecar.assets) {
    const asset = staged.get(entry.id);
    if (asset) updateEntry(entry, asset);
  }
  const timingFile = path.join(repo, "game/src/content/creatureMotionTiming.ts");
  const timingRows = report.assets.filter(a => a.attack).sort((a, b) => a.id.localeCompare(b.id)).map(a =>
    `  ${JSON.stringify(a.id)}: { seconds: ${Number(a.attack!.seconds.toFixed(6))}, contactNormalized: ${Number(a.attack!.contactNormalized.toFixed(6))} },`);
  const timing = [
    "/** Generated from tools/data/creature-motion-rebuild.json; source reach markers and authored contact poses. */",
    "export const CREATURE_MOTION_TIMING: Record<string, { seconds: number; contactNormalized: number }> = {",
    ...timingRows,
    "};", "",
  ].join("\n");

  // All paths, hashes and metadata are checked before the first production mutation. Existing
  // backups are never overwritten, including repeated promotion after a lab iteration.
  await firstBackup(manifestFile);
  await firstBackup(sidecarFile);
  for (const item of pending) await firstBackup(item.destination);
  try { await firstBackup(timingFile); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  for (const item of pending) await writeFile(item.destination, item.bytes);
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(sidecarFile, JSON.stringify(sidecar, null, 2) + "\n");
  await writeFile(timingFile, timing);
  const promotion = { promotedAt: new Date().toISOString(), status: "working tree updated; feature-lab acceptance required", assets: report.assets.map(a => ({ id: a.id, sha256: a.sha256, bytes: a.bytes })), backup: path.relative(repo, backupRoot).replaceAll("\\", "/"), timingFile: path.relative(repo, timingFile).replaceAll("\\", "/") };
  await writeFile(path.join(repo, "runs/local-creature-rebuild/promotion.json"), JSON.stringify(promotion, null, 2) + "\n");
  console.log(`Promoted ${pending.length} creature assets for lab review; generated ${timingRows.length} contact timings. First backups retained at ${backupRoot}.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
