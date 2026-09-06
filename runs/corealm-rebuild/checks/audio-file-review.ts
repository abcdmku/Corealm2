/**
 * Objective review of every shipped audio file the production catalogue references.
 *
 * `npx tsx runs/corealm-rebuild/checks/audio-file-review.ts [--out test-results/audio-review]`
 *
 * For each cue variant and loop: ffprobe format, ffmpeg decode to float PCM, then duration, peak,
 * RMS, EBU R128 integrated loudness where the file is long enough, leading/trailing silence,
 * clipping runs, DC offset, spectral centroid and five-band energy split. Per cue it also computes
 * the level as played (file RMS + catalogue gain + variant gain) and the spread between variants.
 * Heuristic flags mark files that are implausible for their role. None of this is listening; the
 * script writes concatenated MP3 listening copies with timestamps so a person can do that quickly.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { COREALM_AUDIO_CATALOG } from "../../../game/src/audio/corealmCatalog.js";
import type { AudioCueDefinition } from "../../../game/src/audio/catalog.js";

const argv = process.argv.slice(2);
const arg = (flag: string, fallback: string): string => {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1]! : fallback;
};
const outRoot = arg("--out", "test-results/audio-review");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = path.join(outRoot, stamp);
await mkdir(out, { recursive: true });

const publicRoot = path.resolve("game/public");
const urlToPath = (url: string): string => path.join(publicRoot, url.replace(/^\/+/, ""));

interface Probe { codec: string; sampleRate: number; channels: number; durationS: number; bytes: number }
interface Metrics {
  durationS: number;
  peakDbfs: number;
  rmsDbfs: number;
  activeRmsDbfs: number;
  integratedLufs: number | null;
  truePeakDbtp: number | null;
  leadingSilenceMs: number;
  trailingSilenceMs: number;
  clippedRuns: number;
  dcOffsetDbfs: number;
  centroidHz: number;
  bands: { sub: number; low: number; mid: number; high: number; air: number };
  /** First 1 ms frame within 30 dB of the file peak, minus 5 ms guard. The point a trim should start. */
  onsetMs: number;
  seamJumpDbfs?: number;
  seamSampleStepDbfs?: number;
}
interface VariantRow {
  cue: string;
  file: string;
  url: string;
  probe: Probe;
  metrics: Metrics;
  cueGain: number;
  variantGain: number;
  /** Configured `startOffsetS` in milliseconds; 0 when the recording plays from its first sample. */
  trimMs: number;
  rate: number;
  asPlayedDbfs: number;
  flags: string[];
}

const db = (value: number): number => 20 * Math.log10(Math.max(Math.abs(value), 1e-12));
const round1 = (value: number): number => Math.round(value * 10) / 10;

function probe(file: string): Probe {
  const json = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries",
    "format=duration,size:stream=codec_name,sample_rate,channels", "-of", "json", file], { encoding: "utf8" }));
  const stream = json.streams[0];
  return {
    codec: stream.codec_name, sampleRate: Number(stream.sample_rate), channels: Number(stream.channels),
    durationS: Number(json.format.duration), bytes: Number(json.format.size),
  };
}

function decodeMono(file: string, sampleRate: number): Float32Array {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(sampleRate), "-f", "f32le", "pipe:1"],
    { maxBuffer: 512 * 1024 * 1024 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}

function ebur128(file: string): { integrated: number | null; truePeak: number | null } {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
  const text = result.stderr;
  const integrated = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+|-inf) LUFS/.exec(text)?.[1];
  const peak = /True peak:\s*\n\s*Peak:\s*(-?[\d.]+|-inf) dBFS/.exec(text)?.[1];
  const num = (value: string | undefined): number | null => value === undefined || value === "-inf" ? null : Number(value);
  return { integrated: num(integrated), truePeak: num(peak) };
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len;
    const wr = Math.cos(angle), wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const ar = re[i + k]!, ai = im[i + k]!;
        const br = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci;
        const bi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const next = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = next;
      }
    }
  }
}

function measure(samples: Float32Array, sampleRate: number, isLoop: boolean,
  loopPoints?: { start?: number; end?: number }): Omit<Metrics, "integratedLufs" | "truePeakDbtp"> {
  const n = samples.length;
  let peak = 0, power = 0, sum = 0, clippedRuns = 0, run = 0;
  for (let i = 0; i < n; i += 1) {
    const x = samples[i]!; const a = Math.abs(x);
    if (a > peak) peak = a; power += x * x; sum += x;
    if (a >= 0.985) { run += 1; if (run === 3) clippedRuns += 1; } else run = 0;
  }
  const mean = sum / Math.max(1, n);
  // 5 ms frames; "active" is anything within 40 dB of the file peak and above -60 dBFS.
  const frame = Math.max(1, Math.round(sampleRate * 0.005));
  const frameCount = Math.ceil(n / frame);
  const frameRms = new Float64Array(frameCount);
  for (let f = 0; f < frameCount; f += 1) {
    let s = 0; const start = f * frame; const end = Math.min(n, start + frame);
    for (let i = start; i < end; i += 1) s += samples[i]! * samples[i]!;
    frameRms[f] = Math.sqrt(s / Math.max(1, end - start));
  }
  const gateDb = Math.max(db(peak) - 40, -60);
  const onsetGate = db(peak) - 30;
  const onsetFrame = Math.max(1, Math.round(sampleRate * 0.001));
  let onsetMs = 0;
  for (let pos = 0; pos + onsetFrame <= n; pos += onsetFrame) {
    let s = 0;
    for (let i = pos; i < pos + onsetFrame; i += 1) s += samples[i]! * samples[i]!;
    if (db(Math.sqrt(s / onsetFrame)) > onsetGate) { onsetMs = Math.max(0, pos / sampleRate * 1000 - 5); break; }
  }
  let first = -1, last = -1;
  for (let f = 0; f < frameCount; f += 1) {
    if (db(frameRms[f]!) > gateDb) { if (first < 0) first = f; last = f; }
  }
  let activePower = 0, activeCount = 0;
  if (first >= 0) {
    for (let f = first; f <= last; f += 1) { if (db(frameRms[f]!) > gateDb) { activePower += frameRms[f]! ** 2; activeCount += 1; } }
  }
  // Spectrum over the active region with 2048-point Hann windows, 50% hop.
  const size = 2048;
  const mag = new Float64Array(size / 2);
  const startSample = first < 0 ? 0 : first * frame;
  const endSample = last < 0 ? n : Math.min(n, (last + 1) * frame);
  const re = new Float64Array(size), im = new Float64Array(size);
  let windows = 0;
  for (let pos = startSample; pos + size <= endSample || (windows === 0 && pos < endSample); pos += size / 2) {
    for (let i = 0; i < size; i += 1) {
      const idx = pos + i;
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1));
      re[i] = idx < n ? samples[idx]! * w : 0; im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < size / 2; k += 1) mag[k] = mag[k]! + (re[k]! * re[k]! + im[k]! * im[k]!);
    windows += 1;
    if (windows > 400) break;
  }
  let num = 0, den = 0;
  const bands = { sub: 0, low: 0, mid: 0, high: 0, air: 0 };
  for (let k = 1; k < size / 2; k += 1) {
    const hz = k * sampleRate / size; const p = mag[k]!;
    num += hz * p; den += p;
    if (hz < 150) bands.sub += p; else if (hz < 500) bands.low += p; else if (hz < 2000) bands.mid += p;
    else if (hz < 6000) bands.high += p; else bands.air += p;
  }
  for (const key of Object.keys(bands) as (keyof typeof bands)[]) bands[key] = den > 0 ? Math.round(bands[key] / den * 1000) / 10 : 0;
  const result: Omit<Metrics, "integratedLufs" | "truePeakDbtp"> = {
    durationS: n / sampleRate,
    peakDbfs: round1(db(peak)),
    rmsDbfs: round1(db(Math.sqrt(power / Math.max(1, n)))),
    activeRmsDbfs: round1(activeCount ? db(Math.sqrt(activePower / activeCount)) : -120),
    leadingSilenceMs: Math.round((first < 0 ? n : first * frame) / sampleRate * 1000),
    trailingSilenceMs: Math.round((last < 0 ? 0 : n - (last + 1) * frame) / sampleRate * 1000),
    clippedRuns,
    dcOffsetDbfs: round1(db(mean)),
    onsetMs: Math.round(onsetMs),
    centroidHz: Math.round(den > 0 ? num / den : 0),
    bands,
  };
  if (isLoop && n > sampleRate) {
    // Loop seam, measured where the loop ACTUALLY repeats.
    //
    // Web Audio jumps from `loopEnd` back to `loopStart`, not from the last sample back to the
    // first. Measuring the file's ends instead reported a 32.8 dB "seam jump" on a track whose
    // only problem was a second of run-out silence, and would keep reporting it after the loop
    // points had moved the repeat inside the music.
    const seam = Math.round(sampleRate * 0.02);
    const startIndex = Math.min(n - seam - 1, Math.max(0, Math.round((loopPoints?.start ?? 0) * sampleRate)));
    const endIndex = Math.min(n - 1, Math.max(startIndex + seam, Math.round((loopPoints?.end ?? n / sampleRate) * sampleRate)));
    let head = 0, tail = 0;
    for (let i = 0; i < seam; i += 1) { head += samples[startIndex + i]! ** 2; tail += samples[endIndex - seam + i]! ** 2; }
    result.seamJumpDbfs = round1(Math.abs(db(Math.sqrt(head / seam)) - db(Math.sqrt(tail / seam))));
    result.seamSampleStepDbfs = round1(db(samples[startIndex]! - samples[endIndex]!));
  }
  return result;
}

const rateOf = (definition: AudioCueDefinition): number => {
  const configured = definition.playbackRate;
  if (typeof configured === "number") return configured;
  if (!configured) return 1;
  return (configured[0] + configured[1]) / 2;
};

/** Role heuristics. These are sanity bands, not species identification. */
const CREATURE_EXPECTATIONS: Record<string, { centroid: [number, number]; maxDurationS: number; note: string }> = {
  "creature.bear_roar": { centroid: [150, 1800], maxDurationS: 4, note: "growl/roar: low-mid weighted" },
  "creature.cow_low": { centroid: [150, 1500], maxDurationS: 4, note: "moo: low-mid weighted" },
  "creature.hog_grunt": { centroid: [150, 2500], maxDurationS: 3, note: "grunt: low-mid" },
  "creature.stag_bell": { centroid: [150, 2500], maxDurationS: 4, note: "rut bellow: low-mid roar" },
  "creature.coyote_howl": { centroid: [300, 3500], maxDurationS: 4, note: "howl/bark: mid" },
  "creature.goat_bleat": { centroid: [300, 3500], maxDurationS: 3, note: "bleat: mid, nasal" },
  "creature.frog_croak": { centroid: [150, 3000], maxDurationS: 3, note: "croak: low-mid pulsed" },
  "creature.hen_cluck": { centroid: [500, 5000], maxDurationS: 3, note: "cluck: mid-high, short" },
  "creature.coney_squeak": { centroid: [1200, 9000], maxDurationS: 2, note: "squeak: high" },
  "creature.viper_hiss": { centroid: [2000, 12000], maxDurationS: 3, note: "hiss: broadband high" },
  "creature.chitin_click": { centroid: [1000, 10000], maxDurationS: 2, note: "click: short, bright" },
};
const CONTACT_PREFIXES = ["movement.footstep", "gather.mining_impact", "gather.wood_impact", "combat.melee_hit",
  "combat.player_hit", "combat.magic_hit", "production.smith", "production.craft", "ui.click"];

/**
 * `trimMs` is the variant's configured `startOffsetS`. Silence and onset flags are about what the
 * player hears, so they are measured after the trim: an untrimmed 139 ms of room tone is a defect,
 * the same 139 ms with `startOffsetS: 0.139` in front of it is the fix for that defect and must not
 * keep reporting itself. `asPlayedDbfs` carries the catalogue and variant gain for the same reason.
 */
function flagsFor(cue: string, definition: AudioCueDefinition, m: Metrics, trimMs: number, asPlayedDbfs: number): string[] {
  const flags: string[] = [];
  const isContact = CONTACT_PREFIXES.some((prefix) => cue.startsWith(prefix));
  const played = m.durationS / rateOf(definition);
  const leadMs = Math.max(0, m.leadingSilenceMs - trimMs);
  if (isContact && leadMs > 60) flags.push(`leading silence ${leadMs} ms on a contact cue after the trim`);
  if (!isContact && leadMs > 250) flags.push(`leading silence ${leadMs} ms after the trim`);
  if (m.trailingSilenceMs > 400) flags.push(`trailing silence ${m.trailingSilenceMs} ms`);
  if (m.clippedRuns > 0) flags.push(`${m.clippedRuns} clipped runs`);
  if (m.dcOffsetDbfs > -40) flags.push(`DC offset ${m.dcOffsetDbfs} dBFS`);
  if (m.peakDbfs > -0.3) flags.push(`peak ${m.peakDbfs} dBFS (hot)`);
  if (isContact && played > 2.5) flags.push(`${round1(played)} s as played is long for a contact cue`);
  const expectation = CREATURE_EXPECTATIONS[cue];
  if (expectation) {
    const centroid = m.centroidHz * rateOf(definition);
    if (centroid < expectation.centroid[0] || centroid > expectation.centroid[1]) {
      flags.push(`centroid ${Math.round(centroid)} Hz as played outside ${expectation.note} band ${expectation.centroid.join("-")} Hz`);
    }
    if (played > expectation.maxDurationS) flags.push(`${round1(played)} s idle vocal as played`);
  }
  // Judged as played, not as stored. The loudest ambience bed measures -39.9 LUFS at catalogue
  // gain, so a cue landing under about -46 dBFS is being played into its own room tone. A quiet
  // source that the catalogue boosts is fine; a loud source the catalogue buries is not.
  if (asPlayedDbfs < -46) flags.push(`plays at ${asPlayedDbfs} dBFS, under the ambience bed`);
  return flags;
}

const rows: VariantRow[] = [];
const fileCache = new Map<string, { probe: Probe; metrics: Metrics }>();
function analyse(url: string, isLoop = false, loopPoints?: { start?: number; end?: number }): { probe: Probe; metrics: Metrics } {
  const key = `${isLoop ? "loop" : "cue"}:${url}:${loopPoints?.start ?? ""}:${loopPoints?.end ?? ""}`;
  const cached = fileCache.get(key);
  if (cached) return cached;
  const file = urlToPath(url);
  if (!existsSync(file)) throw new Error(`Missing audio file ${file}`);
  const info = probe(file);
  const samples = decodeMono(file, info.sampleRate);
  const base = measure(samples, info.sampleRate, isLoop, loopPoints);
  const loud = base.durationS >= 0.4 ? ebur128(file) : { integrated: null, truePeak: null };
  const metrics: Metrics = { ...base, integratedLufs: loud.integrated, truePeakDbtp: loud.truePeak };
  const result = { probe: info, metrics };
  fileCache.set(key, result);
  return result;
}

const cues = COREALM_AUDIO_CATALOG.cues as Record<string, AudioCueDefinition>;
for (const [cue, definition] of Object.entries(cues)) {
  for (const variant of definition.variants) {
    const url = typeof variant === "string" ? variant : variant.url;
    const variantGain = typeof variant === "string" ? 1 : variant.gain ?? 1;
    const trimMs = Math.round((typeof variant === "string" ? 0 : variant.startOffsetS ?? 0) * 1000);
    const { probe: info, metrics } = analyse(url);
    const cueGain = definition.gain ?? 1;
    rows.push({
      cue, url, file: path.relative(publicRoot, urlToPath(url)).replace(/\\/g, "/"), probe: info, metrics,
      cueGain, variantGain, trimMs, rate: rateOf(definition),
      asPlayedDbfs: round1(metrics.activeRmsDbfs + db(cueGain * variantGain)),
      flags: [...flagsFor(cue, definition, metrics, trimMs, round1(metrics.activeRmsDbfs + db(cueGain * variantGain))),
        ...(metrics.peakDbfs + db(cueGain * variantGain) > -1 ? [`as-played peak ${round1(metrics.peakDbfs + db(cueGain * variantGain))} dBFS before the bus (clips when stacked)`] : []),
        ...(CONTACT_PREFIXES.some((prefix) => cue.startsWith(prefix)) && metrics.onsetMs - trimMs > 30
          ? [`onset ${round1(metrics.onsetMs - trimMs)} ms late for a contact cue after the trim`] : [])],
    });
  }
}
// Cue-level spread flags.
const byCue = new Map<string, VariantRow[]>();
for (const row of rows) byCue.set(row.cue, [...(byCue.get(row.cue) ?? []), row]);
for (const [, group] of byCue) {
  if (group.length < 2) continue;
  const levels = group.map((row) => row.asPlayedDbfs);
  const spread = round1(Math.max(...levels) - Math.min(...levels));
  if (spread > 6) for (const row of group) row.flags.push(`variant spread ${spread} dB as played`);
  const durations = group.map((row) => row.metrics.durationS);
  if (Math.max(...durations) / Math.max(0.05, Math.min(...durations)) > 4) for (const row of group) row.flags.push("variant durations differ more than 4x");
}

interface LoopRow { name: string; url: string; bus: string; gain: number; loopStart?: number; loopEnd?: number; probe: Probe; metrics: Metrics; asPlayedLufs: number | null; flags: string[] }
const loopRows: LoopRow[] = [];
for (const [name, definition] of Object.entries(COREALM_AUDIO_CATALOG.loops)) {
  const { probe: info, metrics } = analyse(definition.url, true, { start: definition.loopStart, end: definition.loopEnd });
  const flags: string[] = [];
  if (metrics.clippedRuns > 0) flags.push(`${metrics.clippedRuns} clipped runs`);
  if (metrics.dcOffsetDbfs > -40) flags.push(`DC offset ${metrics.dcOffsetDbfs} dBFS`);
  if ((metrics.seamJumpDbfs ?? 0) > 6) flags.push(`loop seam level jump ${metrics.seamJumpDbfs} dB`);
  if ((metrics.seamSampleStepDbfs ?? -120) > -40) flags.push(`loop seam sample step ${metrics.seamSampleStepDbfs} dBFS (click)`);
  // Edge silence outside `loopStart`/`loopEnd` is heard once on the way in and never repeats, so
  // it is only a defect while the loop still runs end to end.
  if (definition.loopStart === undefined && definition.loopEnd === undefined
    && (metrics.leadingSilenceMs > 200 || metrics.trailingSilenceMs > 200)) {
    flags.push(`loop has ${metrics.leadingSilenceMs}/${metrics.trailingSilenceMs} ms edge silence and no loop points`);
  }
  loopRows.push({ name, url: definition.url, bus: definition.bus, gain: definition.gain ?? 1,
    loopStart: definition.loopStart, loopEnd: definition.loopEnd, probe: info, metrics,
    asPlayedLufs: metrics.integratedLufs === null ? null : round1(metrics.integratedLufs + db(definition.gain ?? 1)), flags });
}

// Listening copies: raw identity (no gain, no rate) and as-played (catalogue rate and gain).
interface ListeningGroup { name: string; rows: VariantRow[] }
const groups: ListeningGroup[] = [
  { name: "creatures", rows: rows.filter((r) => r.cue.startsWith("creature.")) },
  { name: "footsteps", rows: rows.filter((r) => r.cue.startsWith("movement.")) },
  { name: "gathering", rows: rows.filter((r) => r.cue.startsWith("gather.")) },
  { name: "combat", rows: rows.filter((r) => r.cue.startsWith("combat.")) },
  { name: "interaction-ui-production", rows: rows.filter((r) => /^(interaction|ui|production)\./.test(r.cue)) },
];
const timestamps: Record<string, Array<{ cue: string; file: string; atS: number; durationS: number }>> = {};
const GAP_S = 0.6;
for (const group of groups) {
  for (const mode of ["raw", "as-played"] as const) {
    const inputs: string[] = []; const filters: string[] = []; const marks: Array<{ cue: string; file: string; atS: number; durationS: number }> = [];
    let cursor = 0.3;
    group.rows.forEach((row, index) => {
      inputs.push("-i", urlToPath(row.url));
      const sr = 48000;
      const rate = mode === "as-played" ? row.rate : 1;
      const gain = mode === "as-played" ? row.cueGain * row.variantGain : 1;
      const duration = row.metrics.durationS / rate;
      filters.push(`[${index}:a]aformat=sample_rates=${sr}:channel_layouts=stereo,asetrate=${sr * rate},aresample=${sr},volume=${gain.toFixed(4)},adelay=${Math.round(cursor * 1000)}|${Math.round(cursor * 1000)}[s${index}]`);
      marks.push({ cue: row.cue, file: row.file, atS: Math.round(cursor * 100) / 100, durationS: Math.round(duration * 100) / 100 });
      cursor += duration + GAP_S;
    });
    const mix = `${filters.join(";")};${group.rows.map((_, index) => `[s${index}]`).join("")}amix=inputs=${group.rows.length}:normalize=0:dropout_transition=0,apad=pad_dur=0.5[out]`;
    const target = path.join(out, `${group.name}-${mode}.mp3`);
    execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", mix, "-map", "[out]", "-c:a", "libmp3lame", "-q:a", "4", target]);
    timestamps[`${group.name}-${mode}`] = marks;
  }
}
// Loops: 8 s excerpt each including the seam (last 4 s then first 4 s) at catalogue gain.
{
  const inputs: string[] = []; const filters: string[] = []; const marks: Array<{ cue: string; file: string; atS: number; durationS: number }> = [];
  let cursor = 0.3;
  loopRows.forEach((row, index) => {
    inputs.push("-i", urlToPath(row.url));
    const d = row.metrics.durationS;
    const tailStart = Math.max(0, d - 4);
    filters.push(`[${index}:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit[a${index}][b${index}];[a${index}]atrim=start=${tailStart.toFixed(3)},asetpts=PTS-STARTPTS[t${index}];[b${index}]atrim=duration=4,asetpts=PTS-STARTPTS[h${index}];[t${index}][h${index}]concat=n=2:v=0:a=1,volume=${row.gain.toFixed(3)},adelay=${Math.round(cursor * 1000)}|${Math.round(cursor * 1000)}[s${index}]`);
    marks.push({ cue: row.name, file: path.relative(publicRoot, urlToPath(row.url)).replace(/\\/g, "/"), atS: Math.round(cursor * 100) / 100, durationS: 8 });
    cursor += 8 + GAP_S;
  });
  const mix = `${filters.join(";")};${loopRows.map((_, index) => `[s${index}]`).join("")}amix=inputs=${loopRows.length}:normalize=0:dropout_transition=0,apad=pad_dur=0.5[out]`;
  execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", mix, "-map", "[out]", "-c:a", "libmp3lame", "-q:a", "4", path.join(out, "loops-seams-as-played.mp3")]);
  timestamps["loops-seams-as-played"] = marks;
}

// Unpromoted candidates under runs/corealm-rebuild/audio-candidates, measured the same way.
interface CandidateRow { file: string; probe: Probe; metrics: Metrics }
const candidateRows: CandidateRow[] = [];
const candidateDir = path.resolve("runs/corealm-rebuild/audio-candidates");
if (existsSync(candidateDir)) {
  const { readdirSync } = await import("node:fs");
  for (const name of readdirSync(candidateDir).filter((entry) => entry.endsWith(".ogg")).sort()) {
    const file = path.join(candidateDir, name);
    const info = probe(file);
    const base = measure(decodeMono(file, info.sampleRate), info.sampleRate, false);
    const loud = base.durationS >= 0.4 ? ebur128(file) : { integrated: null, truePeak: null };
    candidateRows.push({ file: name, probe: info, metrics: { ...base, integratedLufs: loud.integrated, truePeakDbtp: loud.truePeak } });
  }
}

const fmt = (value: number | null): string => value === null ? "n/a" : String(value);
const lines: string[] = [];
lines.push("# Audio file review (objective measurements, not listening)", "", `Generated ${new Date().toISOString()} from the production catalogue. Listening copies and timestamps are in this directory.`, "");
lines.push("## Cue variants", "", "| Cue | File | SR/ch | Dur s | Peak dBFS | Active RMS dBFS | LUFS | Lead/Trail ms | Onset ms | Trim ms | Clip | DC dBFS | Centroid Hz | sub/low/mid/high/air % | Gain x rate | As played dBFS | Flags |", "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: | --- |");
for (const row of rows) {
  const m = row.metrics; const b = m.bands;
  lines.push(`| ${row.cue} | ${row.file} | ${row.probe.sampleRate}/${row.probe.channels} | ${m.durationS.toFixed(2)} | ${m.peakDbfs} | ${m.activeRmsDbfs} | ${fmt(m.integratedLufs)} | ${m.leadingSilenceMs}/${m.trailingSilenceMs} | ${m.onsetMs} | ${row.trimMs} | ${m.clippedRuns} | ${m.dcOffsetDbfs} | ${m.centroidHz} | ${b.sub}/${b.low}/${b.mid}/${b.high}/${b.air} | ${(row.cueGain * row.variantGain).toFixed(2)} x ${row.rate.toFixed(2)} | ${row.asPlayedDbfs} | ${row.flags.join("; ")} |`);
}
if (candidateRows.length) {
  lines.push("", "## Unpromoted candidates", "", "| File | SR/ch | Dur s | Peak dBFS | Active RMS dBFS | LUFS | Lead/Trail ms | Centroid Hz | sub/low/mid/high/air % |", "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const row of candidateRows) {
    const m = row.metrics; const b = m.bands;
    lines.push(`| ${row.file} | ${row.probe.sampleRate}/${row.probe.channels} | ${m.durationS.toFixed(2)} | ${m.peakDbfs} | ${m.activeRmsDbfs} | ${fmt(m.integratedLufs)} | ${m.leadingSilenceMs}/${m.trailingSilenceMs} | ${m.centroidHz} | ${b.sub}/${b.low}/${b.mid}/${b.high}/${b.air} |`);
  }
}
lines.push("", "## Loops", "", "| Loop | File | SR/ch | Dur s | Loop points s | Peak | LUFS | As played LUFS | Seam jump dB | Lead/Trail ms | Flags |", "| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |");
for (const row of loopRows) {
  const m = row.metrics;
  lines.push(`| ${row.name} | ${row.file ?? row.url} | ${row.probe.sampleRate}/${row.probe.channels} | ${m.durationS.toFixed(1)} | ${row.loopStart ?? 0}..${row.loopEnd ?? "end"} | ${m.peakDbfs} | ${fmt(m.integratedLufs)} | ${fmt(row.asPlayedLufs)} | ${fmt(m.seamJumpDbfs ?? null)} | ${m.leadingSilenceMs}/${m.trailingSilenceMs} | ${row.flags.join("; ")} |`);
}
lines.push("", "## Listening copies", "");
for (const [name, marks] of Object.entries(timestamps)) {
  lines.push(`### ${name}.mp3`, "", "| At | Cue | File | Length s |", "| ---: | --- | --- | ---: |");
  for (const mark of marks) {
    const mm = Math.floor(mark.atS / 60), ss = (mark.atS % 60).toFixed(1).padStart(4, "0");
    lines.push(`| ${mm}:${ss} | ${mark.cue} | ${mark.file} | ${mark.durationS} |`);
  }
  lines.push("");
}
await writeFile(path.join(out, "listening-sheet.md"), lines.join("\n"));
await writeFile(path.join(out, "file-review.json"), JSON.stringify({ generated: new Date().toISOString(), rows, loops: loopRows, candidates: candidateRows, timestamps }, null, 2));
console.log(JSON.stringify({ out, variants: rows.length, loops: loopRows.length, flagged: rows.filter((r) => r.flags.length).length }));
