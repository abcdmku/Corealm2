/**
 * Root-only promotion of reviewed creature motion candidates into production.
 *
 *   npx tsx tools/creature-motion/promote.ts --catalog <catalog.json> --ids a,b [--apply]
 *   npx tsx tools/creature-motion/promote.ts --catalog <catalog.json> --all [--apply]
 *
 * For each id it copies the candidate GLB over the production file, measures the GLB
 * (tools/creature-motion/measure.ts) and rewrites the manifest entry's motion fields and the
 * runtime timing tables in game/src/content/creatureMotionTiming.ts from that measurement. Motion
 * metadata left by retired repair pipelines is dropped. Dry run unless --apply.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { measureCreatureGlb, type MotionMeasurement } from "./measure.js";

const repo = path.resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const catalogPath = option("--catalog");
if (!catalogPath) throw new Error("--catalog <json> is required");
const apply = args.includes("--apply");

/** Fields written by pipelines this tool replaces. Their values describe motion that no longer ships. */
const RETIRED_FIELDS = [
  "motionRepair", "measuredGait", "gaitCalibration", "strideCalibration", "acceptanceEvidence", "candidateReview",
  "animationDurations", "rootScaleRecommendation", "attackContactNormalized", "locomotionPolicy", "maxRunCadenceHz",
  "motionSource", "builderSha256", "animationMetadata", "impliedWalkMps", "impliedRunMps", "walkClipSeconds",
  "runClipSeconds", "attackSeconds", "contactNormalized",
] as const;
/** Default reviewed cadences: 2.4 walk cycles and 3 run cycles per second. */
const WALK_CADENCE_HZ = 2.4, RUN_CADENCE_HZ = 3;

/** The Attack clip carries its contact phase in its extras, which is where a model uploaded through
 * devdocs is timed from; the build and an upload of the same file then time it identically. */
function withAttackContact(glb: Buffer, contact: number | undefined): Buffer {
  const length = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + length).toString("utf8")) as { animations?: { name?: string; extras?: Record<string, unknown> }[] };
  const attack = json.animations?.find((clip) => clip.name === "Attack");
  if (!attack || contact === undefined || attack.extras?.contactNormalized === contact) return glb;
  attack.extras = { ...attack.extras, contactNormalized: contact };
  const text = Buffer.from(JSON.stringify(json));
  const padded = Math.ceil(text.length / 4) * 4;
  const tail = glb.subarray(20 + length);
  const out = Buffer.alloc(20 + padded + tail.length, 0x20);
  glb.copy(out, 0, 0, 20);
  out.writeUInt32LE(out.length, 8); out.writeUInt32LE(padded, 12);
  text.copy(out, 20); tail.copy(out, 20 + padded);
  return out;
}

type Entry = Record<string, unknown> & { id: string; file: string };
interface Candidate { id: string; file?: string; candidateFile?: string; motionProvenance?: unknown; contactNormalized?: number; [key: string]: unknown }

const catalogFile = path.resolve(catalogPath);
const catalog = JSON.parse(await readFile(catalogFile, "utf8")) as { assets: Candidate[] };
const ids = args.includes("--all") ? catalog.assets.map((asset) => asset.id) : (option("--ids") ?? "").split(",").filter(Boolean);
if (!ids.length) throw new Error("Use --ids a,b or --all");

const manifestPath = path.join(repo, "game/public/assets/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { assets: Entry[] };
const timingPath = path.join(repo, "game/src/content/creatureMotionTiming.ts");
const timing = await import(`file:///${timingPath.replace(/\\/g, "/")}?t=${Date.now()}`) as {
  CREATURE_MOTION_TIMING: Record<string, { seconds: number; contactNormalized: number }>;
  CREATURE_PURSUIT_CEILING_MPS: Record<string, number>;
  CREATURE_WALK_CEILING_MPS: Record<string, number>;
};
const motionTiming = { ...timing.CREATURE_MOTION_TIMING };
const pursuit = { ...timing.CREATURE_PURSUIT_CEILING_MPS };
const walkCeiling = { ...timing.CREATURE_WALK_CEILING_MPS };

const report: unknown[] = [];
for (const id of ids) {
  const candidate = catalog.assets.find((asset) => asset.id === id);
  if (!candidate) throw new Error(`${id}: not in catalog`);
  const index = manifest.assets.findIndex((asset) => asset.id === id);
  const existing = index >= 0 ? manifest.assets[index]! : undefined;
  const destinationRelative = (candidate.file ?? existing?.file) as string;
  if (!destinationRelative?.startsWith("models/") || !destinationRelative.endsWith(".glb")) throw new Error(`${id}: bad destination ${destinationRelative}`);
  const source = path.resolve(path.dirname(catalogFile), candidate.candidateFile ?? candidate.file!);
  const m: MotionMeasurement = await measureCreatureGlb(source);
  const { candidateFile: _c, contactNormalized: authoredContact, groundY: authoredGround, ...fields } = candidate;
  const contact = typeof authoredContact === "number" ? authoredContact : m.contactNormalized;
  const bytes = withAttackContact(await readFile(source), contact);
  const entry: Entry = { ...(existing ?? {}), ...fields, id, file: destinationRelative } as Entry;
  for (const field of RETIRED_FIELDS) delete entry[field];
  Object.assign(entry, {
    bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    size: m.size, base: m.base, triangles: m.triangles, animations: m.animations,
    // A hovering or wading body stands on its authored origin, not on its lowest idle point.
    groundY: typeof authoredGround === "number" ? authoredGround : m.groundY,
  });
  if (m.walkClipSeconds) entry.walkClipSeconds = m.walkClipSeconds;
  if (m.runClipSeconds) entry.runClipSeconds = m.runClipSeconds;
  if (m.impliedWalkMps) entry.impliedWalkMps = m.impliedWalkMps;
  if (m.impliedRunMps) entry.impliedRunMps = m.impliedRunMps;
  if (m.attackSeconds) { entry.attackSeconds = m.attackSeconds; entry.contactNormalized = contact; }

  // Timing tables. Pursuit plays Run, or Walk when the body has no Run.
  if (m.attackSeconds && contact) motionTiming[id] = { seconds: m.attackSeconds, contactNormalized: contact };
  else delete motionTiming[id];
  const walkStride = m.impliedWalkMps && m.walkClipSeconds ? m.impliedWalkMps * m.walkClipSeconds : undefined;
  const runStride = m.impliedRunMps && m.runClipSeconds ? m.impliedRunMps * m.runClipSeconds : m.runClipSeconds ? undefined : walkStride;
  if (walkStride) walkCeiling[id] = +(WALK_CADENCE_HZ * walkStride).toFixed(6); else delete walkCeiling[id];
  if (runStride) pursuit[id] = +(RUN_CADENCE_HZ * runStride).toFixed(4); else delete pursuit[id];

  report.push({ id, source: path.relative(repo, source), before: existing?.sha256, after: entry.sha256, animations: m.animations,
    walk: m.impliedWalkMps, run: m.impliedRunMps, groundY: entry.groundY, attack: m.attackSeconds, contact,
    pursuitCeiling: pursuit[id], walkCeiling: walkCeiling[id] });
  if (apply) {
    await writeFile(path.join(repo, "game/public/assets", destinationRelative), bytes);
    if (index >= 0) manifest.assets[index] = entry; else manifest.assets.push(entry);
  }
}
console.log(JSON.stringify(report, null, 1));
if (!apply) { console.log("dry run; pass --apply to promote"); process.exit(0); }

// Repainted bodies record the body they were painted onto; they are rebuilt together, so the pin
// follows the promoted source.
for (const entry of manifest.assets) {
  const provenance = entry.sourceProvenance as { sourceAssetId?: string; sourceSha256?: string } | undefined;
  const source = provenance?.sourceAssetId && ids.includes(provenance.sourceAssetId)
    ? manifest.assets.find((asset) => asset.id === provenance.sourceAssetId) : undefined;
  if (source) provenance!.sourceSha256 = source.sha256 as string;
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
// Verdicts recorded against the replaced bytes no longer describe what ships: back to the review queue.
const metaPath = path.join(repo, "game/content/meta/assets.meta.json");
const meta = JSON.parse(await readFile(metaPath, "utf8")) as Record<string, { art?: unknown; history?: unknown[] }>;
const at = new Date().toISOString();
for (const id of ids) {
  const record = meta[id];
  if (!record?.art) continue;
  delete record.art;
  (record.history ??= []).push({ at, by: "claude", action: "art.review", detail: "verdicts cleared: motion rebuilt, awaiting owner review" });
}
await writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n");
const sorted = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
const text = `/** Attack duration and contact phase for each accepted production clip. */
export const CREATURE_MOTION_TIMING: Record<string, { seconds: number; contactNormalized: number }> = ${JSON.stringify(sorted(motionTiming), null, 2)};

/** Maximum pursuit speed at the reviewed Run cadence (default three cycles per second).
 * Assets without a measured planted stride use the shared movement speed instead. */
export const CREATURE_PURSUIT_CEILING_MPS: Record<string, number> = ${JSON.stringify(sorted(pursuit), null, 2)};

/** Maximum native walk speed at 2.4 planted gait cycles per second, before placement scale. */
export const CREATURE_WALK_CEILING_MPS: Record<string, number> = ${JSON.stringify(sorted(walkCeiling), null, 2)};
`;
await writeFile(timingPath, text);
console.log(`promoted ${ids.length}`);
