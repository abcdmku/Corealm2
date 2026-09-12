import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import { decodeNavigationArtifact, type NavigationAuthoredInputs } from "../game/src/systems/navigationArtifact.js";
import type {} from "./lib/debug-api.js";
import { gameRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";

const repoRoot = path.resolve(gameRoot, "..");
const generatedSourceFile = path.join(gameRoot, "src", "generated", "navmeshFingerprint.ts");
const generatedAssetDir = path.join(gameRoot, "public", "generated");
const binaryFile = path.join(generatedAssetDir, "corealm-navmesh.bin");
const manifestFile = path.join(generatedAssetDir, "corealm-navmesh.json");

const SOURCE_GROUPS = {
  terrainGeometry: [
    "game/src/app/worldSpec.ts",
    "game/src/app/realmTerrain.ts",
    "game/src/content/crownward.ts",
    "game/src/content/fairyRegions.ts",
    "game/src/render/scene.ts",
    "game/src/world/organicFields.ts",
    "game/src/world/siteTerrain.ts",
    "game/src/content/worldSites.ts",
    "game/src/content/wildernessLava.ts",
    "game/src/content/wildernessLavaLandforms.ts",
    "game/src/world/lavaLandforms.ts",
    "game/src/content/wildernessLandmarks.ts",
    "game/src/content/wildernessDepth.ts",
    "game/src/content/wildernessResources.ts",
    "game/src/render/compositions/deepWildernessStructures.ts",
  ],
  roads: [
    "game/src/content/crownwardFishing.ts",
    "game/src/app/worldSurface.ts",
    "game/src/app/fishingAccess.ts",
    "game/src/content/regions.ts",
    "game/src/content/wilderness.ts",
    "game/src/content/wildernessLandmarks.ts",
    "game/src/content/wildernessExpansion.ts",
    "game/src/content/crownward.ts",
    "game/src/content/fairyRegions.ts",
  ],
  water: [
    "game/src/world/riverChannels.ts",
    "game/src/content/crownwardRiver.ts",
    "game/src/world/waterNavigation.ts",
    "game/src/app/worldSurface.ts",
    "game/src/world/waterBodies.ts",
    "game/src/world/organicFields.ts",
  ],
  solidCarves: [
    "tools/medieval-bridge/catalog.json",
    "game/src/content/wildernessEastRelief.ts",
    "game/src/content/crownwardDragons.ts",
    "game/src/render/compositions/crownwardBridge.ts",
    "game/src/render/crownwardBridgeNavigation.ts",
    "game/src/render/structureNavigation.ts",
    "game/src/app/boot.ts",
    "game/src/content/worldSites.ts",
    "game/src/content/worldHabitats.ts",
    "game/src/content/biomePopulation.ts",
    "game/src/content/deepWildernessEncounters.ts",
    "game/src/content/encounterPlacement.ts",
    "game/src/content/encounterFootprints.ts",
    "game/src/content/legacyEncounterPlacements.ts",
    "game/src/content/fairyCrownCreatures.ts",
    "game/src/content/fairyFoliage.ts",
    "game/src/content/fairyOres.ts",
    "game/src/render/compositions/wildernessRuins.ts",
    "game/src/render/compositions/blackKnightCastle.ts",
    "game/src/render/compositions/whiteKnightCastle.ts",
    "game/src/render/compositions/deepWildernessStructures.ts",
    "game/src/world/lavaObstacles.ts",
    "game/src/render/worldSiteDressing.ts",
    "game/src/render/mineCutFace.ts",
    "game/src/world/regionBuilder.ts",
    "game/src/world/dungeonDoors.ts",
    "game/src/contracts.ts",
    "game/src/systems/navigation.ts",
  ],
  dungeonGeometry: [
    "game/src/render/dungeon.ts",
    "game/src/content/regions.ts",
  ],
  seedDependentInputs: [
    "game/src/app/worldSpec.ts",
    "game/src/world/organicFields.ts",
    "game/src/content/regions.ts",
    "game/src/content/crownward.ts",
    "game/src/content/fairyRegions.ts",
  ],
  navigationSettings: [
    "game/src/app/config.ts",
    "game/src/systems/navigation.ts",
    "game/src/systems/navigationArtifact.ts",
    "package-lock.json",
  ],
} as const satisfies Record<keyof NavigationAuthoredInputs, readonly string[]>;

const CHROMIUM_ARGS = [
  "--use-angle=d3d11",
  "--enable-gpu",
  "--ignore-gpu-blocklist",
  "--disable-frame-rate-limit",
  "--disable-gpu-vsync",
  "--mute-audio",
];

export async function fingerprintNavmeshSources(): Promise<NavigationAuthoredInputs> {
  const entries = await Promise.all(Object.entries(SOURCE_GROUPS).map(async ([name, files]) => {
    const hash = createHash("sha256");
    for (const file of files) {
      hash.update(file);
      hash.update("\0");
      // Git checkouts may use CRLF on Windows. Source meaning, not checkout line endings, owns the
      // artifact revision, so hash one canonical LF form on every platform.
      hash.update((await readFile(path.join(repoRoot, file), "utf8")).replace(/\r\n/g, "\n"));
      hash.update("\0");
    }
    return [name, hash.digest("hex")] as const;
  }));
  return Object.fromEntries(entries) as unknown as NavigationAuthoredInputs;
}

export async function writeNavmeshSourceFingerprint(authored: NavigationAuthoredInputs): Promise<void> {
  const source = [
    "import type { NavigationAuthoredInputs } from \"../systems/navigationArtifact.js\";",
    "",
    "/** Generated by tools/build-navmesh.ts. Do not edit. */",
    `export const NAVMESH_AUTHORING_INPUTS = ${JSON.stringify(authored, null, 2)} as const satisfies NavigationAuthoredInputs;`,
    "",
  ].join("\n");
  await mkdir(path.dirname(generatedSourceFile), { recursive: true });
  await writeFile(generatedSourceFile, source, "utf8");
}

export async function assertNavigationArtifact(): Promise<void> {
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const bytes = await readFile(binaryFile);
  const artifact = await decodeNavigationArtifact(bytes);
  if (JSON.stringify(manifest.authoredInputs) !== JSON.stringify(await fingerprintNavmeshSources())
    || manifest.worldSeed !== '1337' || bytes.length !== manifest.bytes
    || artifact.metadata.fingerprint !== manifest.fingerprint || artifact.metadata.polyCount <= 0) {
    throw new Error('Shipped navigation is stale or incomplete');
  }
}

export async function buildNavmeshArtifact(): Promise<{
  bytes: number;
  fingerprint: string;
  polyCount: number;
  tileCount: number;
}> {
  const authored = await fingerprintNavmeshSources();
  await writeNavmeshSourceFingerprint(authored);

  const server = await startGameServer({ logLevel: "error" });
  let browser: Browser | undefined;
  const browserErrors: string[] = [];
  try {
    browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    page.on("pageerror", (error) => browserErrors.push(String(error).slice(0, 1000)));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text().slice(0, 1000));
    });
    await page.routeWebSocket("**", () => undefined);
    await page.goto(`${server.url}?navmesh-bake=1`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction(
      () => window.__gameDebug?.getState().ready === true,
      undefined,
      { timeout: 120_000 },
    );

    const result = await page.evaluate(async () => {
      const debug = window.__gameDebug;
      if (!debug) throw new Error("window.__gameDebug is unavailable");
      const state = debug.getState() as { seed?: string | number };
      const navigation = debug.getNavigationState() as { status?: string };
      if (navigation.status !== "ready") throw new Error(`navigation is ${navigation.status ?? "unknown"}`);
      if (typeof window.__corealmNavigationArtifact !== "function") {
        throw new Error("window.__corealmNavigationArtifact is unavailable");
      }
      const getErrors = debug["getErrors"];
      const errors = typeof getErrors === "function" ? (getErrors() as unknown[]) : [];
      if (errors.length > 0) throw new Error(`game errors: ${JSON.stringify(errors).slice(0, 2000)}`);
      if (state.seed === undefined) throw new Error("game state has no world seed");
      return {
        base64: await window.__corealmNavigationArtifact(state.seed),
        seed: state.seed,
      };
    });
    if (browserErrors.length > 0) {
      throw new Error(`Navmesh browser bake failed:\n${browserErrors.join("\n")}`);
    }

    const bytes = Buffer.from(result.base64, "base64");
    const decoded = await decodeNavigationArtifact(bytes);
    const manifest = {
      ...decoded.metadata,
      path: "generated/corealm-navmesh.bin",
      bytes: bytes.byteLength,
      worldSeed: String(result.seed),
      authoredInputs: authored,
    };
    await mkdir(generatedAssetDir, { recursive: true });
    await Promise.all([
      writeFile(binaryFile, bytes),
      writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    ]);
    return {
      bytes: bytes.byteLength,
      fingerprint: decoded.metadata.fingerprint,
      polyCount: decoded.metadata.polyCount,
      tileCount: decoded.metadata.tileCount,
    };
  } finally {
    await browser?.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  void buildNavmeshArtifact()
    .then((result) => {
      console.log(
        `Built ${result.bytes} byte navmesh (${result.polyCount} polys, ${result.tileCount} tiles, `
          + `fingerprint ${result.fingerprint}).`,
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
