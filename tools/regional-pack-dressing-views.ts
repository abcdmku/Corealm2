/** Root-scheduled visual captures. A screenshot is review material, never automatic art acceptance. */
import path from "node:path";
import type { Page } from "playwright";
import { createHash } from "node:crypto";
import { installAssetCandidates } from "./lib/assetCandidates.js";
import { RPG_BESTIARY_BY_ID } from "../game/src/content/rpgBestiary.js";
import { RPG_REGIONAL_PACK_PLAN } from "../game/src/content/rpgRegionalPacks.js";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue, repoRoot } from "./lib/paths.js";

const settings = {
  camp: "pack_fallowmarch_palewood_northwest_watch",
  burial: "pack_vellenwood_marchgate_south_rootshade",
  quarry: "pack_karrowmoor_highcairn_south_wall_mandibles",
  roost: "pack_karrowmoor_tideworn_east_watch",
  court: "pack_kilnhalt_ashback_northeast_range",
} as const;
const expectedSpecies = {
  camp: "goblin_archer", burial: "skeleton_soldier", quarry: "stone_golem",
  roost: "stone_golem", court: "skeleton_mage",
} as const;
const cases = Object.entries(settings).map(([setting, packId]) => {
  const speciesId = RPG_REGIONAL_PACK_PLAN.find(row => row.packId === packId)?.speciesId;
  const species = speciesId ? RPG_BESTIARY_BY_ID.get(speciesId) : undefined;
  if (!species || species.id !== expectedSpecies[setting as keyof typeof settings]
    || !["goblin", "skeleton", "golem"].includes(species.bodyFamily))
    throw new Error(`Dressing case ${setting} requires its retained resident; review revised assignment before launching`);
  return { setting, packId, speciesId, assetId: species.assetId, maximumSeconds: 60 };
});
const args = process.argv.slice(2);
const cataloguePath = path.join(repoRoot, "art/rebuild/candidates/finish-bestiary/retained-unhorned15/catalog.json");
const catalogueText = await readFile(cataloguePath, "utf8");
// The pin is the committed LF blob; an autocrlf checkout changes only line endings. GLB/texture
// bytes are hashed separately by the installer.
const catalogueSha256 = createHash("sha256").update(catalogueText.split("\r\n").join("\n")).digest("hex");
if (catalogueSha256 !== "3272d559169c9072ae3b8f3a592dcc3d92162fc9069b7b2926bc13a12bb5de63")
  throw new Error("Retained catalogue changed; root must review the new bytes before updating the visual fixture");
const staged = JSON.parse(catalogueText) as { assets: { id: string; file: string }[]; packs?: { id: string }[] };
const selectedAssets = staged.assets.filter(asset => cases.some(row => row.assetId === asset.id));
if (staged.assets.length !== 15 || cases.some(row => !selectedAssets.some(asset => asset.id === row.assetId)))
  throw new Error("Pinned dressing source must contain all five selected residents");
// Only selected review bodies enter the browser staging map. The historical catalogue's
// rejected Fire model remains excluded even though its immutable source bytes are verified.
async function installDressingCandidates(page: Page): Promise<string[]> {
  const selectedPatterns = new Set(selectedAssets.map(asset => `**/assets/${asset.file}*`));
  const adapter = { route: async (pattern: string, handler: Parameters<Page["route"]>[1]) => {
    if (pattern.includes("manifest.json")) return;
    if (pattern.includes("/models/") && !selectedPatterns.has(pattern)) return;
    await page.route(pattern, handler);
  } };
  await installAssetCandidates(adapter as unknown as Page, cataloguePath);
  const manifest = JSON.parse(await readFile(path.join(repoRoot, "game/public/assets/manifest.json"), "utf8")) as {
    assets: { id: string }[]; packs: { id: string }[];
  };
  const selectedIds = new Set(selectedAssets.map(asset => asset.id));
  manifest.assets = [...manifest.assets.filter(asset => !selectedIds.has(asset.id)), ...selectedAssets];
  manifest.packs = [...new Map([...manifest.packs, ...(staged.packs ?? [])].map(pack => [pack.id, pack])).values()];
  await page.route("**/assets/manifest.json*", route => route.fulfill({ status: 200,
    contentType: "application/json", body: JSON.stringify(manifest) }));
  return [...selectedIds];
}
const url = argValue(args, "--url") ?? process.env["COREALM_URL"] ?? "http://127.0.0.1:4175";
if (args.includes("--check-only")) {
  // A route collector verifies the installer hashes every GLB/texture without creating a browser.
  const routes: string[] = [];
  const routeCollector = { route: async (pattern: string) => { routes.push(pattern); } };
  const stagedIds = await installDressingCandidates(routeCollector as unknown as Page);
  console.log(JSON.stringify({ status: "CPU readiness only; no browser launched", url, cataloguePath,
    catalogueSha256, stagedIds, verifiedRoutes: routes.length, cases }, null, 2));
  process.exit(0);
}
const setting = argValue(args, "--setting") ?? "camp";
if (!(setting in settings)) throw new Error("--setting must be camp, burial, quarry, roost or court");
const clearDeadline = installTestDeadline(`Encounter dressing ${setting}`, 60000);
const server = { url, close: async () => {} };
const driver = new GameDriver(server, { headless: !args.includes("--headed"), viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const output = path.join(repoRoot, "test-results", "regional-pack-dressing", setting);
await mkdir(output, { recursive: true });
try {
  await driver.launch();
  await installDressingCandidates(driver.page!);
  await driver.open(30000, `/index.html?mode=combat&rpg=1&pack=${settings[setting as keyof typeof settings]}`);
  const page = driver.page!;
  const overview = await page.evaluate((expectedAsset) => {
    const w = window as unknown as { __packLab: { ids: string[]; habitat: { centre: [number, number]; radius: number; dressing: unknown[] } };
      __gameDebug: { setPaused(value: boolean): void; groundHeight(x: number, z: number): number;
        inspectPose(pose: Record<string, unknown>): boolean; getEntity(id: string): unknown; getErrors(): unknown[] } };
    const habitat = w.__packLab.habitat;
    if (!habitat.dressing.length) throw new Error("Representative setting has no dressing");
    w.__gameDebug.setPaused(true);
    const [x, z] = habitat.centre;
    const y = w.__gameDebug.groundHeight(x, z);
    w.__gameDebug.inspectPose({ x, y, z, yaw: 0, pitch: 0.8, distance: Math.max(20, habitat.radius * 2.2), detached: true });
    const actors = w.__packLab.ids.map(id => w.__gameDebug.getEntity(id)) as { view?: { assetId?: string } }[];
    if (actors.length < 5 || actors.length > 10 || actors.some(actor => actor?.view?.assetId !== expectedAsset))
      throw new Error("Rendered pack does not match the retained resident assignment");
    const errors = w.__gameDebug.getErrors();
    if (errors.length) throw new Error(`Pack fixture reported ${errors.length} errors`);
    return { habitat, actors, errors };
  }, cases.find(row => row.setting === setting)!.assetId);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(output, "approach.png") });
  await page.evaluate(() => {
    const w = window as unknown as { __packLab: { habitat: { centre: [number, number] } };
      __gameDebug: { groundHeight(x: number, z: number): number; inspectPose(pose: Record<string, unknown>): boolean } };
    const [x, z] = w.__packLab.habitat.centre;
    w.__gameDebug.inspectPose({ x, y: w.__gameDebug.groundHeight(x, z), z, yaw: 0.6, pitch: 0.5, distance: 11, detached: true });
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(output, "setting-detail.png") });
  await writeFile(path.join(output, "review.json"), JSON.stringify({ setting, cataloguePath, catalogueSha256, url, ...overview,
    acceptance: "Pending root screenshot inspection. Simulation paused only for these visual captures." }, null, 2));
  console.log(JSON.stringify({ setting, output, status: "captured-for-review" }));
} finally {
  await driver.close(); await server.close(); clearDeadline();
}
