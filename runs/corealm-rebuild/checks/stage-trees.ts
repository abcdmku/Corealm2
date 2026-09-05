import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const folder = path.join(root, "test-results/tree-refinement", process.argv.includes("--baseline") ? "baseline" : "candidate");
await mkdir(folder, { recursive: true });
let source = await readFile(path.join(root, "tools/build-corealm-nature.ts"), "utf8");
source = source.replace('from "./lib/paths.js"', `from ${JSON.stringify(pathToFileURL(path.join(root, "tools/lib/paths.ts")).href)}`)
  .replace('const outDir = path.join(gameRoot, "public/assets/models/corealm/nature");', `const outDir = ${JSON.stringify(folder)};`)
  .replace('const catalogueFile = path.join(repoRoot, "tools/data/corealm-nature.json");', `const catalogueFile = ${JSON.stringify(path.join(folder, "catalogue.json"))};`)
  .replace('({ oak, pine, deadwood, stump, fern, grass, shrub, flower })[spec.kind](plant);', `const treeTopology = ({ oak, pine, deadwood, stump, fern, grass, shrub, flower })[spec.kind](plant);
  const rawBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const skin of Object.values(plant.skins)) for (let i = 0; i < skin.positions.length; i++) {
    const a = i % 3; rawBounds.min[a] = Math.min(rawBounds.min[a], skin.positions[i]); rawBounds.max[a] = Math.max(rawBounds.max[a], skin.positions[i]);
  }`)
  .replace('sha256: createHash("sha256")', 'rawBounds, treeTopology, treeTopologySpace: "Authored wood axes before crown-envelope and production-envelope fits", sha256: createHash("sha256")')
  .replace('for (const spec of specs) {', 'for (const spec of specs.filter(spec => spec.kind === "oak" || spec.kind === "pine")) {');
const runner = path.join(folder, "build-stage.ts");
await writeFile(runner, source);
await import(pathToFileURL(runner).href);
