/** Extract authored FBX tracks without loading the game or modifying production assets. */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

export interface SourceClipRequest {
  id: string;
  file: string;
  name: string;
  take?: string;
  /** Inclusive source frame indices; omit when the file contains one complete motion. */
  frames?: [number, number];
  fps?: number;
  /** Sample the source at this frame and emit a held two-key pose. */
  heldFrame?: number;
  heldSeconds?: number;
}

export interface SourceTrack {
  name: string;
  sourceNodeId: number | null;
  type: string;
  interpolation: number;
  times: number[];
  values: number[];
}

export interface ExtractedSourceClip {
  id: string;
  name: string;
  duration: number;
  tracks: SourceTrack[];
  targets: {
    name: string;
    type: string;
    fbxId: number | null;
    parentChain: string[];
    translation: number[];
    rotation: number[];
    scale: number[];
  }[];
  source: {
    file: string;
    sha256: string;
    take: string;
    duration: number;
    availableTakes: string[];
    frames?: [number, number];
    fps: number;
    heldFrame?: number;
    heldSeconds?: number;
    keyedFrameRange?: [number, number];
  };
}

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const threeRoot = path.join(repoRoot, "node_modules", "three");
const converterPage = `<!doctype html><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js"}}</script>
<script type="module">
import { FBXLoader } from '/three/examples/jsm/loaders/FBXLoader.js';
window.extract = async (request) => {
  const bytes = await (await fetch('/source/' + request.index)).arrayBuffer();
  const root = new FBXLoader().parse(bytes, '/ignored-textures/');
  let clip = request.take ? root.animations.find(clip => clip.name === request.take) : root.animations[0];
  if (!clip) throw new Error('Missing source take: ' + (request.take ?? '(first)'));
  const sourceTake = clip.name;
  const sourceDuration = clip.duration;
  const fps = request.fps ?? 30;
  const keyedFrameRange = [Infinity, -Infinity];
  for (const track of clip.tracks) for (const time of track.times) {
    keyedFrameRange[0] = Math.min(keyedFrameRange[0], time * fps);
    keyedFrameRange[1] = Math.max(keyedFrameRange[1], time * fps);
  }
  const sourceIdentities = new Map();
  for (const track of clip.tracks) {
    const identities = sourceIdentities.get(track.name) ?? [];
    identities.push(track.sourceNodeId ?? null);
    sourceIdentities.set(track.name, identities);
  }
  if (request.frames) {
    const [first, last] = request.frames;
    if (!(last > first)) throw new Error('Invalid source frame range');
    const wholeTake = first <= 1 && last >= Math.round(sourceDuration * fps);
    if (!wholeTake) {
      clip = clip.clone();
      const start = first / fps;
      const end = last / fps;
      const epsilon = 1e-4 / fps;
      for (const track of clip.tracks) {
        // Unity's lastFrame is inclusive. Exact boundary samples also prevent float32
        // source timestamps from dropping frame400 because399.99999 compares below400.
        const sampleTimes = [start, ...Array.from(track.times).filter(time =>
          time > start + epsilon && time < end - epsilon), end];
        const interpolant = track.createInterpolant();
        const values = sampleTimes.flatMap(time => Array.from(interpolant.evaluate(time)));
        track.times = new Float32Array(sampleTimes.map(time => time - start));
        track.values = new Float32Array(values);
      }
      clip.duration = end - start;
    }
  }
  if (request.heldFrame !== undefined) {
    if (request.frames) throw new Error('Held poses and frame cuts cannot be combined');
    const seconds = request.heldSeconds ?? 1 / fps;
    if (!Number.isFinite(request.heldFrame) || !(seconds > 0)) throw new Error('Invalid held pose');
    clip = clip.clone();
    for (const track of clip.tracks) {
      // Interpolants clamp before the first key, matching a held pre-roll pose.
      const pose = Array.from(track.createInterpolant().evaluate(request.heldFrame / fps));
      track.times = new Float32Array([0, seconds]);
      track.values = new Float32Array([...pose, ...pose]);
    }
    clip.duration = seconds;
  }
  const targetNames = new Set(clip.tracks.map(track => track.name.split('.')[0]));
  const targets = [];
  root.traverse(node => {
    if (!targetNames.has(node.name)) return;
    const parentChain = [];
    for (let parent = node.parent; parent; parent = parent.parent) parentChain.unshift(parent.name);
    targets.push({ name: node.name, type: node.type, fbxId: node.ID ?? null, parentChain,
      translation: node.position.toArray(), rotation: node.quaternion.toArray(), scale: node.scale.toArray() });
  });
  return {
    id: request.id, name: request.name, duration: clip.duration,
    targets,
    tracks: clip.tracks.map(track => ({
      name: track.name, sourceNodeId: sourceIdentities.get(track.name)?.shift() ?? null,
      type: track.ValueTypeName, interpolation: track.getInterpolation(),
      times: Array.from(track.times), values: Array.from(track.values)
    })),
    source: { take: sourceTake, duration: sourceDuration,
      availableTakes: root.animations.map(clip => clip.name), frames: request.frames, fps,
      heldFrame: request.heldFrame, heldSeconds: request.heldSeconds, keyedFrameRange }
  };
};
</script>`;

/** Values remain in the source rig's local coordinates; the consumer owns retargeting. */
export async function extractSourceClips(
  requests: SourceClipRequest[],
  outputDirectory: string,
): Promise<ExtractedSourceClip[]> {
  if (!requests.length) return [];
  const ids = new Set<string>();
  for (const request of requests) {
    if (!/^[a-zA-Z0-9_-]+$/.test(request.id) || ids.has(request.id)) {
      throw new Error(`Invalid or duplicate clip id: ${request.id}`);
    }
    ids.add(request.id);
  }
  const sources = await Promise.all(requests.map((request) => readFile(request.file)));
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html" }).end(converterPage);
        return;
      }
      const source = /^\/source\/(\d+)$/.exec(pathname);
      if (source) {
        const bytes = sources[Number(source[1])];
        if (!bytes) { response.writeHead(404).end(); return; }
        response.writeHead(200, { "content-type": "application/octet-stream" }).end(bytes);
        return;
      }
      if (pathname.startsWith("/three/")) {
        const file = path.resolve(threeRoot, decodeURIComponent(pathname.slice(7)));
        const relative = path.relative(threeRoot, file);
        if (relative.startsWith("..") || path.isAbsolute(relative) || !file.endsWith(".js")) {
          response.writeHead(403).end(); return;
        }
        let contents = await readFile(file, "utf8");
        if (pathname === "/three/examples/jsm/loaders/FBXLoader.js") {
          // Rhino has distinct spine joints with the same name. Keep FBX identity before
          // Three's public track format loses it; this modifies only the conversion response.
          const marker = "tracks = tracks.concat( scope.generateTracks( rawTracks ) );";
          if (!contents.includes(marker)) throw new Error("FBXLoader track extraction changed");
          contents = contents.replace(marker,
            "const generatedTracks = scope.generateTracks( rawTracks ); " +
            "for (const track of generatedTracks) track.sourceNodeId = rawTracks.ID ?? null; " +
            "tracks = tracks.concat( generatedTracks );");
        }
        response.writeHead(200, { "content-type": "text/javascript" }).end(contents);
        return;
      }
      response.writeHead(404).end();
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local converter port");
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.waitForFunction(() => typeof (window as unknown as { extract?: unknown }).extract === "function");
    await mkdir(outputDirectory, { recursive: true });
    const result: ExtractedSourceClip[] = [];
    for (const [index, request] of requests.entries()) {
      const clip = await page.evaluate(async (payload) => {
        const convert = (window as unknown as {
          extract: (request: SourceClipRequest & { index: number }) => Promise<ExtractedSourceClip>;
        }).extract;
        return convert(payload);
      }, { ...request, index });
      clip.source.file = path.resolve(request.file);
      clip.source.sha256 = createHash("sha256").update(sources[index]!).digest("hex");
      if (!Number.isFinite(clip.duration) || clip.duration <= 0 || !clip.tracks.length) {
        throw new Error(`Empty source motion: ${request.id}`);
      }
      for (const track of clip.tracks) {
        if (!track.times.length || track.values.length % track.times.length !== 0 ||
          track.times.some((time, i) => !Number.isFinite(time) || (i > 0 && time < track.times[i - 1]!)) ||
          track.values.some((value) => !Number.isFinite(value))) {
          throw new Error(`Invalid source track: ${request.id}/${track.name}`);
        }
      }
      await writeFile(path.join(outputDirectory, `${request.id}.json`), JSON.stringify(clip));
      result.push(clip);
    }
    return result;
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

// npx tsx tools/creature-motion/source-clips.ts requests.json output-directory
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [requestFile, outputDirectory] = process.argv.slice(2);
  if (!requestFile || !outputDirectory) throw new Error("Usage: source-clips.ts requests.json output-directory");
  const requests = JSON.parse((await readFile(requestFile, "utf8")).replace(/^\uFEFF/, "")) as SourceClipRequest[];
  const clips = await extractSourceClips(requests, outputDirectory);
  console.log(JSON.stringify(clips.map((clip) => ({
    id: clip.id, duration: clip.duration, tracks: clip.tracks.length,
    targets: new Set(clip.tracks.map((track) => track.name.split(".")[0])).size,
    source: clip.source.file,
  })), null, 2));
}
