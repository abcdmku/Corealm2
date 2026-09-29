/**
 * Renders a creature GLB's clips as a contact sheet: one row per clip, one column per phase, seen
 * from the side with the floor line drawn. Motion is judged by looking at it, not by key counts.
 *
 *   node tools/creature-motion/contact-sheet.mjs <glb> [<glb> ...] [--out dir] [--clips Idle,Walk]
 *        [--phases 8] [--view side|front|three-quarter] [--size 220]
 *
 * Several GLBs render as stacked blocks with the same framing, so a candidate can be compared
 * against the file it replaces. Paths may be anywhere on disk. Writes <out>/<name>.png
 * (default out: test-results/contact-sheets) and prints the clip list with durations.
 */
import http from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repo = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const files = args.filter((arg, index) => !arg.startsWith("--") && !(index > 0 && args[index - 1].startsWith("--")));
if (!files.length) {
  console.error("usage: contact-sheet.mjs <glb> [<glb> ...] [--out dir] [--clips A,B] [--phases 8] [--view side]");
  process.exit(2);
}
const out = path.resolve(option("out", path.join(repo, "test-results/contact-sheets")));
const phases = Number(option("phases", "8"));
const cell = Number(option("size", "220"));
const view = option("view", "side");
const clipFilter = option("clips", "");

const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm" };
const server = http.createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const page_html = /* html */`<!doctype html><html><body style="margin:0;background:#1d2127">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
document.body.appendChild(renderer.domElement);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
window.sheet = async (urls, opts) => {
  const loaded = [];
  for (const url of urls) loaded.push(await loader.loadAsync(url));
  // One framing for every block: the union of the rest bounds, so blocks compare at one scale.
  const rest = new THREE.Box3();
  for (const gltf of loaded) { gltf.scene.updateMatrixWorld(true); rest.union(new THREE.Box3().setFromObject(gltf.scene)); }
  const rows = [];
  for (let i = 0; i < loaded.length; i += 1) {
    const clips = loaded[i].animations.filter((clip) => !opts.clips.length || opts.clips.includes(clip.name));
    for (const clip of clips) rows.push({ block: i, clip });
  }
  const cols = opts.phases, size = opts.cell, label = 18;
  renderer.setSize(cols * size, rows.length * (size + label));
  renderer.setScissorTest(true);
  renderer.setClearColor(0x1d2127, 1);
  renderer.clear();
  const size3 = rest.getSize(new THREE.Vector3()), centre = rest.getCenter(new THREE.Vector3());
  const radius = Math.max(size3.x, size3.y, size3.z) * 0.62;
  const dir = opts.view === "front" ? new THREE.Vector3(0, 0.12, 1) : opts.view === "three-quarter" ? new THREE.Vector3(0.8, 0.35, 0.8) : new THREE.Vector3(1, 0.12, 0);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
  camera.position.copy(centre).addScaledVector(dir.normalize(), radius / Math.tan(THREE.MathUtils.degToRad(15)) * 1.05);
  camera.lookAt(centre);
  const info = [];
  const H = rows.length * (size + label);
  for (let r = 0; r < rows.length; r += 1) {
    const { block, clip } = rows[r];
    const gltf = loaded[block];
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 2.0));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 6, 4); scene.add(key);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(radius * 8, radius * 8), new THREE.MeshBasicMaterial({ color: 0x39414d }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.0005; scene.add(floor);
    const line = new THREE.GridHelper(radius * 8, 32, 0x7a8699, 0x4b5563); line.position.y = 0.0005; scene.add(line);
    scene.add(gltf.scene);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(clip); action.play();
    let minY = Infinity;
    for (let c = 0; c < cols; c += 1) {
      const t = clip.duration * (cols === 1 ? 0 : c / (cols - 1));
      mixer.setTime(t);
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene, true);
      minY = Math.min(minY, box.min.y);
      const x = c * size, y = H - (r + 1) * (size + label);
      renderer.setViewport(x, y, size, size); renderer.setScissor(x, y, size, size);
      renderer.render(scene, camera);
    }
    action.stop(); mixer.uncacheRoot(gltf.scene); scene.remove(gltf.scene);
    info.push({ block, clip: clip.name, duration: +clip.duration.toFixed(3), tracks: clip.tracks.length, minY: +minY.toFixed(4) });
  }
  return { info, width: cols * size, height: H, label };
};
window.ready = true;
</script></body></html>`;
server.on("request", async (req, res) => {
  if (req.url === "/sheet.html") { res.writeHead(200, { "content-type": "text/html" }).end(page_html); return; }
  try {
    const url = new URL(req.url ?? "/", "http://x");
    const file = url.pathname === "/file" ? path.resolve(url.searchParams.get("path") ?? "") : path.join(repo, decodeURIComponent(url.pathname));
    if (url.pathname !== "/file" && !file.startsWith(repo)) { res.writeHead(403).end(); return; }
    const info = await stat(file);
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "content-length": info.size });
    createReadStream(file).pipe(res);
  } catch { res.writeHead(404).end(); }
});

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (error) => console.error(error.message));
await page.goto(`${base}/sheet.html`);
await page.waitForFunction(() => window.ready === true);
const urls = files.map((file) => `${base}/file?path=${encodeURIComponent(path.resolve(file))}`);
const result = await page.evaluate(([u, o]) => window.sheet(u, o), [urls, { phases, cell, view, clips: clipFilter ? clipFilter.split(",") : [] }]);
await page.setViewportSize({ width: result.width, height: result.height });
const name = path.basename(files[0], ".glb") + (files.length > 1 ? `-vs${files.length - 1}` : "") + `-${view}.png`;
const canvas = page.locator("canvas");
await canvas.screenshot({ path: path.join(out, name) });
// Label each row after the fact: the WebGL canvas has no text, so write an overlay and reshoot.
await page.evaluate(({ info, label, cell }) => {
  const layer = document.createElement("div");
  layer.style.cssText = "position:absolute;left:0;top:0;font:12px monospace;color:#e5e7eb";
  info.forEach((row, index) => {
    const tag = document.createElement("div");
    tag.textContent = `[${row.block}] ${row.clip} ${row.duration}s  minY ${row.minY}`;
    tag.style.cssText = `position:absolute;left:4px;top:${index * (cell + label) + 1}px;white-space:nowrap`;
    layer.appendChild(tag);
  });
  document.body.style.position = "relative";
  document.body.appendChild(layer);
}, { info: result.info, label: result.label, cell });
await page.screenshot({ path: path.join(out, name), clip: { x: 0, y: 0, width: result.width, height: result.height } });
for (const row of result.info) console.log(`[${row.block}] ${row.clip.padEnd(18)} ${String(row.duration).padStart(7)}s ${String(row.tracks).padStart(4)} tracks  minY ${row.minY}`);
console.log(path.join(out, name));
await browser.close();
server.close();
