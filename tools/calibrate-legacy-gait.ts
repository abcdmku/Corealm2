/** Read shipped legacy clips, stage gait metadata only; never rewrite public assets. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as THREE from "three";
import { loadGeometryGlb } from "./player-locomotion-audit.js";

export interface ContactOptions {
  assetId?: string; groups?: string[][]; samples?: number; heightM?: number; axis?: "x" | "z"; direction?: 1 | -1;
}
export interface ContactMeasurement {
  speedMps: number | null; reason: string | null; method?: string; duration?: number; sampleCount?: number;
  axis?: string; direction?: number; heightM?: number;
  feet: { bones: string[]; samples: number; medianMps: number | null; p10Mps: number | null; p90Mps: number | null }[];
  contacts?: { bone: string; minY: number; maxY: number; samples: number; medianMps: number | null; p10Mps: number | null; p90Mps: number | null; lateralMedianMps: number | null; phases: number[] }[];
}
type Helpers = {
  legacyContactProfile(root: THREE.Object3D, assetId?: string): ContactOptions;
  measureContactGait(root: THREE.Object3D, clip: THREE.AnimationClip | undefined, options?: ContactOptions): ContactMeasurement;
};
interface AssetEntry { id: string; file: string; animations?: string[]; impliedWalkMps?: number; impliedRunMps?: number; walkClipSeconds?: number; runClipSeconds?: number; [key: string]: unknown }
const ROOT = path.resolve(import.meta.dirname, "..");
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The converter owns the canonical implementation; no second copy of its math lives here. */
export async function loadContactHelpers(): Promise<Helpers> {
  const source = await readFile(path.join(ROOT, "tools/animals/convert.js"), "utf8");
  const start = "// CONTACT_GAIT_HELPERS_START", end = "// CONTACT_GAIT_HELPERS_END";
  const first = source.indexOf(start), last = source.indexOf(end);
  if (first < 0 || last <= first || source.indexOf(start, first + 1) !== -1) throw new Error("Canonical converter contact block is missing or ambiguous");
  return new Function("THREE", `${source.slice(first + start.length, last)}\nreturn { legacyContactProfile, measureContactGait };`)(THREE) as Helpers;
}

export async function calibrateLegacyGaits(options: { only?: string[]; out?: string; samples?: number } = {}) {
  const out = path.resolve(options.out ?? path.join(ROOT, "test-results/legacy-gait"));
  if (!out.startsWith(path.join(ROOT, "test-results") + path.sep)) throw new Error("Legacy calibration output must stay inside test-results");
  await mkdir(out, { recursive: true });
  const manifestBytes = await readFile(path.join(ROOT, "game/public/assets/manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as { assets: AssetEntry[] };
  const eligible = manifest.assets.filter(entry => /^(animal_|boss_rhino_|miniboss_)/.test(entry.id)
    && entry.animations?.some(name => name === "Walk" || name === "Run"));
  for (const id of options.only ?? []) if (!eligible.some(entry => entry.id === id)) throw new Error(`Not a legacy locomotion asset: ${id}`);
  if (options.samples !== undefined && (!Number.isInteger(options.samples) || options.samples < 120 || options.samples > 7680)) throw new Error("Samples must be an integer from120 to7680");
  const entries = eligible.filter(entry => !options.only || options.only.includes(entry.id));
  const { measureContactGait } = await loadContactHelpers();
  const updates: unknown[] = [], assets: AssetEntry[] = [], audits: unknown[] = [];
  for (const entry of entries) {
    const file = path.join(ROOT, "game/public/assets", entry.file);
    const [bytes, gltf] = await Promise.all([readFile(file), loadGeometryGlb(file)]);
    const beforeClips = JSON.stringify(gltf.animations.map(clip => THREE.AnimationClip.toJSON(clip)));
    const next = { ...entry }, set: Record<string, number> = {}, unset: string[] = [];
    const gaits = [];
    for (const name of ["Walk", "Run"] as const) {
      const clip = gltf.animations.find(clip => clip.name === name);
      const key = name === "Walk" ? "impliedWalkMps" : "impliedRunMps";
      const durationKey = name === "Walk" ? "walkClipSeconds" : "runClipSeconds";
      if (!clip) {
        if (next[key] !== undefined) { delete next[key]; unset.push(key); }
        if (next[durationKey] !== undefined) { delete next[durationKey]; unset.push(durationKey); }
        continue;
      }
      const measured = measureContactGait(gltf.scene, clip, { assetId: entry.id, samples: options.samples ?? 1920 });
      const validFeet = measured.feet.flatMap(foot => foot.medianMps === null ? [] : [foot.medianMps]);
      const ratio = validFeet.length ? Math.max(...validFeet) / Math.min(...validFeet) : null;
      const variability = measured.feet.map(foot => foot.medianMps && foot.p10Mps !== null && foot.p90Mps !== null ? (foot.p90Mps - foot.p10Mps) / foot.medianMps : null);
      const quality = measured.speedMps === null ? "not-measurable-from-ground-contact"
        : ratio! > 1.1 || measured.feet.some(foot => foot.p10Mps !== null && foot.p90Mps !== null && foot.p90Mps / Math.max(foot.p10Mps, 1e-6) > 1.25)
          ? "source-contact-inconsistent" : "contact-reference";
      if (measured.speedMps !== null) { next[key] = measured.speedMps; set[key] = measured.speedMps; }
      else if (next[key] !== undefined) { delete next[key]; unset.push(key); }
      next[durationKey] = clip.duration; set[durationKey] = clip.duration;
      gaits.push({ name, previousMps: entry[key] ?? null, previousSeconds: entry[durationKey] ?? null, quality, metadataAloneProvesPlanting: false, crossFootRatio: ratio, relativeP10P90Widths: variability, ...measured });
    }
    if (beforeClips !== JSON.stringify(gltf.animations.map(clip => THREE.AnimationClip.toJSON(clip)))) throw new Error(`${entry.id}: measurement mutated clips`);
    if (sha(await readFile(file)) !== sha(bytes)) throw new Error(`${entry.id}: shipped GLB changed during calibration`);
    const audit = { id: entry.id, file: entry.file, sourceSha256: sha(bytes), sourceBytes: bytes.length, metadataOnly: true, clipsPreserved: true, gaits };
    const auditFile = `${entry.id}.json`;
    await writeFile(path.join(out, auditFile), JSON.stringify(audit, null, 2));
    updates.push({ id: entry.id, sourceSha256: sha(bytes), sourceBytes: bytes.length, set, unset, auditFile });
    assets.push(next); audits.push(audit);
    console.log(JSON.stringify({ id: entry.id, gaits: gaits.map(({ name, speedMps, quality, crossFootRatio }) => ({ name, speedMps, quality, crossFootRatio })) }));
  }
  const source = await readFile(path.join(ROOT, "tools/animals/convert.js"));
  const header = { generatedAt: new Date().toISOString(), sourceManifestSha256: sha(manifestBytes), converterSha256: sha(source), frozenExpansionUntouched: true, metadataOnly: true,
    interpretation: "Native contact-reference medians, not proof that every foot is planted. Source-contact-inconsistent gaits need motion review; no scalar can remove disagreement between simultaneous physical feet." };
  await writeFile(path.join(out, "manifest-updates.json"), JSON.stringify({ ...header, updates }, null, 2));
  await writeFile(path.join(out, "manifest-catalog.json"), JSON.stringify({ ...header, assets }, null, 2));
  await writeFile(path.join(out, "audit.json"), JSON.stringify({ ...header, audits }, null, 2));
  return { ...header, assetCount: assets.length, output: out };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const argument = (key: string) => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
  console.log(JSON.stringify(await calibrateLegacyGaits({ only: argument("--only")?.split(","), out: argument("--out"), samples: argument("--samples") ? Number(argument("--samples")) : undefined }), null, 2));
}
