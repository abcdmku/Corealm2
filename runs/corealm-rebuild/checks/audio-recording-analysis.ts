import { execFileSync, spawnSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import type { AudioSourceStart } from "./audio-capture-support.js";

/**
 * Turns a captured production mix into a small MP3 listening copy and measures it.
 *
 * The webm is deleted once the MP3 exists (disk is shared and tight). Onsets are detected on the
 * decoded mono mix: a 5 ms frame whose RMS is at least 10 dB above the trailing 150 ms average and
 * above -48 dBFS, with a 60 ms refractory window. They are matched to scheduled one-shot starts so
 * a report can show whether sound really appeared where the graph scheduled it.
 */
export interface RecordingAnalysis {
  mp3: string;
  durationS: number;
  meanDbfs: number;
  peakDbfs: number;
  /** EBU R128 programme loudness of the recorded production mix, and its loudest 3 s window. */
  integratedLufs: number | null;
  shortTermMaxLufs: number | null;
  loudnessRangeLu: number | null;
  truePeakDbtp: number | null;
  onsetsS: number[];
  /** Per scheduled non-loop start: expected recording time, nearest onset, delta (ms). */
  starts: Array<{ atMs: number; expectedS: number; onsetS: number | null; deltaMs: number | null }>;
  /** Median of the deltas: the recorder's fixed pipeline latency. Individual deltas are read against it. */
  medianBiasMs: number | null;
}

const db = (value: number): number => 20 * Math.log10(Math.max(Math.abs(value), 1e-12));

/**
 * EBU R128 on the finished recording.
 *
 * Peak dBFS says whether a mix clipped; it says nothing about whether the mix is loud enough to
 * hear or so loud it fatigues. Programme loudness is the measure the balance target is written in,
 * and `ebur128` also reports the loudest three-second window, which is where a stacked kill or a
 * boss slam would show up.
 */
function programmeLoudness(file: string): Pick<RecordingAnalysis, "integratedLufs" | "shortTermMaxLufs" | "loudnessRangeLu" | "truePeakDbtp"> {
  // `info` on purpose: the per-frame `S:` lines are what the short-term maximum is read from, and
  // ffmpeg logs them at that level. `-nostats` only suppresses the progress line.
  const raw = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-loglevel", "info", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" }).stderr ?? "";
  // The summary block is multi-line; flattening it keeps the patterns single-line and readable.
  const text = raw.replace(/\s+/g, " ");
  const num = (value: string | undefined): number | null => value === undefined || value === "-inf" ? null : Number(value);
  const shortTerm = [...raw.matchAll(/ S: *(-?[\d.]+|-inf) LUFS/g)].map((match) => num(match[1]))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return {
    integratedLufs: num(/Integrated loudness: I: (-?[\d.]+|-inf) LUFS/.exec(text)?.[1]),
    shortTermMaxLufs: shortTerm.length ? Math.round(Math.max(...shortTerm) * 10) / 10 : null,
    loudnessRangeLu: num(/Loudness range: LRA: (-?[\d.]+) LU/.exec(text)?.[1]),
    truePeakDbtp: num(/True peak: Peak: (-?[\d.]+|-inf) dBFS/.exec(text)?.[1]),
  };
}

export async function analyseRecording(webmPath: string, bytes: number[], starts: AudioSourceStart[],
  recordStart: { atMs: number; contextTime: number }): Promise<RecordingAnalysis> {
  await writeFile(webmPath, Buffer.from(bytes));
  const mp3 = webmPath.replace(/\.webm$/, ".mp3");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", webmPath, "-c:a", "libmp3lame", "-q:a", "4", mp3]);
  const sampleRate = 48000;
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", webmPath, "-ac", "1", "-ar", String(sampleRate), "-f", "f32le", "pipe:1"], { maxBuffer: 256 * 1024 * 1024 });
  const loudness = programmeLoudness(webmPath);
  await rm(webmPath, { force: true });
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  let peak = 0, power = 0;
  for (const x of samples) { const a = Math.abs(x); if (a > peak) peak = a; power += x * x; }
  const frame = Math.round(sampleRate * 0.005);
  const frameCount = Math.floor(samples.length / frame);
  const rms = new Float64Array(frameCount);
  for (let f = 0; f < frameCount; f += 1) {
    let s = 0; for (let i = f * frame; i < (f + 1) * frame; i += 1) s += samples[i]! * samples[i]!;
    rms[f] = Math.sqrt(s / frame);
  }
  const onsetsS: number[] = [];
  const history = 30; // 150 ms
  let lastOnset = -Infinity;
  for (let f = history; f < frameCount; f += 1) {
    let trailing = 0; for (let k = f - history; k < f; k += 1) trailing += rms[k]! ** 2;
    const trailingDb = db(Math.sqrt(trailing / history));
    const nowDb = db(rms[f]!);
    if (nowDb > -48 && nowDb - trailingDb >= 10 && f * 0.005 - lastOnset > 0.06) {
      lastOnset = f * 0.005; onsetsS.push(Math.round(lastOnset * 1000) / 1000);
    }
  }
  const matched = starts.filter((start) => !start.loop).map((start) => {
    const expectedS = start.contextTime - recordStart.contextTime;
    let best: number | null = null;
    for (const onset of onsetsS) {
      if (Math.abs(onset - expectedS) <= 0.12 && (best === null || Math.abs(onset - expectedS) < Math.abs(best - expectedS))) best = onset;
    }
    return { atMs: Math.round(start.atMs * 10) / 10, expectedS: Math.round(expectedS * 1000) / 1000, onsetS: best,
      deltaMs: best === null ? null : Math.round((best - expectedS) * 1000) };
  });
  const deltas = matched.map((m) => m.deltaMs).filter((d): d is number => d !== null).sort((a, b) => a - b);
  return {
    mp3, ...loudness, durationS: Math.round(samples.length / sampleRate * 100) / 100,
    meanDbfs: Math.round(db(Math.sqrt(power / Math.max(1, samples.length))) * 10) / 10, peakDbfs: Math.round(db(peak) * 10) / 10,
    onsetsS, starts: matched, medianBiasMs: deltas.length ? deltas[Math.floor(deltas.length / 2)]! : null,
  };
}

/** Nearest one-shot start at or after a wall-clock marker, within a window. */
export function startAfter(starts: AudioSourceStart[], atMs: number, windowMs = 400): AudioSourceStart | null {
  let best: AudioSourceStart | null = null;
  for (const start of starts) {
    if (start.loop || start.atMs < atMs - 2 || start.atMs > atMs + windowMs) continue;
    if (!best || start.atMs < best.atMs) best = start;
  }
  return best;
}

/**
 * Programme loudness of one window of a finished recording.
 *
 * The balance question is not "how loud is the session" but "does gameplay read over its own
 * ambience bed". Measuring the idle seconds and the busy seconds of the SAME recording answers
 * that from the production mix, with no per-family re-recording and no listening.
 */
export function segmentLoudness(file: string, startS: number, durationS: number): {
  integratedLufs: number | null; truePeakDbtp: number | null;
} {
  const raw = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-ss", String(startS), "-t", String(durationS),
    "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" }).stderr ?? "";
  const text = raw.replace(/\s+/g, " ");
  const num = (value: string | undefined): number | null => value === undefined || value === "-inf" ? null : Number(value);
  return {
    integratedLufs: num(/Integrated loudness: I: (-?[\d.]+|-inf) LUFS/.exec(text)?.[1]),
    truePeakDbtp: num(/True peak: Peak: (-?[\d.]+|-inf) dBFS/.exec(text)?.[1]),
  };
}
