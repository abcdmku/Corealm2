/**
 * Captures the people, creatures, and places used by the generated game guides.
 *
 * One Chromium session boots the real Vite game, then every target goes through the same orbit
 * camera and region streaming used during play. The output is web-sized WebP rather than a folder
 * of manually chosen screenshots that drifts away from the content tables.
 */
import "./lib/repoContent.js";
import { createHash } from "node:crypto";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { ENEMY_BLOCKS } from "../game/src/content/enemies.js";
import { NPCS } from "../game/src/content/npcs.js";
import { QUESTS } from "../game/src/content/quests.js";
import { REGIONS } from "../game/src/content/regions.js";
import { GameDriver } from "./lib/driver.js";
import { repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";

interface RuntimeEntity {
  id: string;
  archetype: string;
  name: string;
  tier: number;
  regionId: string;
  meta?: { family?: string; groupId?: string };
}

interface CaptureRecord {
  id: string;
  kind: "npc" | "enemy" | "enemyGroup" | "entity" | "location";
  label: string;
  file: string;
  runtimeEntityId?: string;
  regionId?: string;
}

const outputRoot = path.resolve(repoRoot, "docs/game/assets/captures");
const allowedRoot = path.resolve(repoRoot, "docs/game/assets");
const only = (() => {
  const index = process.argv.indexOf("--only");
  return index >= 0 ? process.argv[index + 1] ?? "" : "";
})();
const skipExisting = process.argv.includes("--skip-existing");

function wanted(kind: CaptureRecord["kind"], id: string): boolean {
  if (only === "") return true;
  return only.split(",").some((selector) => selector === kind || selector === `${kind}:${id}`);
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function capturePath(kind: CaptureRecord["kind"], id: string): { absolute: string; relative: string } {
  const folder = {
    npc: "npcs",
    enemy: "enemies",
    enemyGroup: "enemy-groups",
    entity: "entities",
    location: "locations",
  }[kind];
  const name = `${safeSegment(id)}.webp`;
  return {
    absolute: path.join(outputRoot, folder, name),
    relative: `assets/captures/${folder}/${name}`,
  };
}

function assertSafeOutput(): void {
  const relative = path.relative(allowedRoot, outputRoot);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing capture output outside ${allowedRoot}: ${outputRoot}`);
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function captureFrame(driver: GameDriver, file: string): Promise<void> {
  // Read the WebGL drawing buffer in the same synchronous call that renders it. A browser-level
  // screenshot waits on Chromium's compositor while the game keeps submitting frames; this path
  // is exact and no later animation frame can clear the buffer first.
  const dataUrl = await driver.callDebug("captureDocumentationFrame") as string;
  const encoded = dataUrl.match(/^data:image\/png;base64,(.+)$/)?.[1];
  if (!encoded) throw new Error("The game did not return a PNG documentation frame.");
  const png = Buffer.from(encoded, "base64");
  await mkdir(path.dirname(file), { recursive: true });
  await sharp(png)
    .resize(960, 540, { fit: "cover", position: "centre" })
    .webp({ quality: 82, effort: 1 })
    .toFile(file);
}

async function main(): Promise<void> {
  assertSafeOutput();
  if (!skipExisting && only === "") await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  const server = await startGameServer();
  const driver = new GameDriver(server, { viewport: { width: 960, height: 540 } });
  const records: CaptureRecord[] = [];

  try {
    await driver.launch();
    await driver.open(120_000);
    if (!driver.page) throw new Error("The game page did not open.");
    await driver.page.addStyleTag({
      content: "#ui-root, #boot-screen { display: none !important; } html, body { background: #0e0c09 !important; }",
    });
    await driver.callDebug("setCaptureMode", [true]);

    const runtimeEntities = await driver.callDebug("listEntities") as RuntimeEntity[];
    const npcIds = new Set(NPCS.map((npc) => npc.id));
    const questEntityIds = new Set(QUESTS.flatMap((quest) => quest.stages.flatMap((stage) =>
      (stage.refs ?? [])
        .filter((ref) => ref.kind === "entity" && !npcIds.has(ref.id))
        .map((ref) => ref.id))));
    const missingQuestEntities = [...questEntityIds].filter((id) => !runtimeEntities.some((entity) => entity.id === id));
    if (missingQuestEntities.length > 0) {
      throw new Error(`Quest capture targets absent from the running game: ${missingQuestEntities.join(", ")}`);
    }

    for (const npc of NPCS) {
      if (!wanted("npc", npc.id)) continue;
      const runtime = runtimeEntities.find((entity) => entity.id === npc.id);
      if (!runtime) throw new Error(`NPC capture target ${npc.id} is absent from the running game.`);
      const target = capturePath("npc", npc.id);
      const record: CaptureRecord = {
        id: npc.id,
        kind: "npc",
        label: npc.name,
        file: target.relative,
        runtimeEntityId: runtime.id,
        regionId: npc.regionId,
      };
      if (skipExisting && await fileExists(target.absolute)) {
        records.push(record);
        continue;
      }
      console.log(`Capturing NPC: ${npc.name}`);
      const focused = await driver.callDebug("focusEntity", [runtime.id]);
      if (focused !== true) throw new Error(`Could not frame NPC ${npc.id}.`);
      await driver.wait(180);
      await captureFrame(driver, target.absolute);
      records.push(record);
    }

    for (const entityId of questEntityIds) {
      if (!wanted("entity", entityId)) continue;
      const runtime = runtimeEntities.find((entity) => entity.id === entityId);
      if (!runtime) throw new Error(`Quest capture target ${entityId} is absent from the running game.`);
      const target = capturePath("entity", entityId);
      const record: CaptureRecord = {
        id: entityId,
        kind: "entity",
        label: runtime.name,
        file: target.relative,
        runtimeEntityId: runtime.id,
        regionId: runtime.regionId,
      };
      if (skipExisting && await fileExists(target.absolute)) {
        records.push(record);
        continue;
      }
      console.log(`Capturing quest entity: ${runtime.name}`);
      const focused = await driver.callDebug("focusEntity", [runtime.id]);
      if (focused !== true) throw new Error(`Could not frame quest entity ${entityId}.`);
      await driver.wait(180);
      await captureFrame(driver, target.absolute);
      records.push(record);
    }

    for (const enemy of ENEMY_BLOCKS) {
      if (!wanted("enemy", enemy.id)) continue;
      const runtime = runtimeEntities.find((entity) =>
        (entity.archetype === "enemy" || entity.archetype === "boss")
        && entity.tier === enemy.tier
        && entity.meta?.family === enemy.family,
      );
      if (!runtime) throw new Error(`Enemy capture target ${enemy.family} tier ${enemy.tier} is absent.`);
      const target = capturePath("enemy", enemy.id);
      const record: CaptureRecord = {
        id: enemy.id,
        kind: "enemy",
        label: enemy.name,
        file: target.relative,
        runtimeEntityId: runtime.id,
        regionId: runtime.meta?.groupId,
      };
      if (skipExisting && await fileExists(target.absolute)) {
        records.push(record);
        continue;
      }
      console.log(`Capturing enemy: ${enemy.name}`);
      const focused = await driver.callDebug("focusEntity", [runtime.id]);
      if (focused !== true) throw new Error(`Could not frame enemy ${enemy.id}.`);
      await driver.wait(180);
      await captureFrame(driver, target.absolute);
      records.push(record);
    }

    const enemyGroups = REGIONS.flatMap((region) => [
      ...region.enemyGroups.map((group) => ({ group, regionId: region.id })),
      ...(region.dungeon?.enemyGroups ?? []).map((group) => ({
        group,
        regionId: region.dungeon!.id,
      })),
    ]);
    for (const { group, regionId } of enemyGroups) {
      if (!wanted("enemyGroup", group.id)) continue;
      const runtime = runtimeEntities.find((entity) =>
        (entity.archetype === "enemy" || entity.archetype === "boss")
        && entity.meta?.groupId === group.id,
      );
      if (!runtime) throw new Error(`Enemy group capture target ${group.id} is absent.`);
      const target = capturePath("enemyGroup", group.id);
      const record: CaptureRecord = {
        id: group.id,
        kind: "enemyGroup",
        label: group.name,
        file: target.relative,
        runtimeEntityId: runtime.id,
        regionId,
      };
      if (skipExisting && await fileExists(target.absolute)) {
        records.push(record);
        continue;
      }
      console.log(`Capturing enemy group: ${group.name} at ${group.id}`);
      const focused = await driver.callDebug("focusEntity", [runtime.id]);
      if (focused !== true) throw new Error(`Could not frame enemy group ${group.id}.`);
      await driver.wait(180);
      await captureFrame(driver, target.absolute);
      records.push(record);
    }

    const locations = new Map<string, { name: string; regionId: string }>();
    for (const region of REGIONS) {
      for (const location of region.locations) {
        locations.set(location.id, { name: location.name, regionId: region.id });
      }
      for (const location of region.dungeon?.locations ?? []) {
        locations.set(location.id, { name: location.name, regionId: region.dungeon!.id });
      }
    }

    for (const [id, location] of locations) {
      if (!wanted("location", id)) continue;
      const target = capturePath("location", id);
      const record: CaptureRecord = {
        id,
        kind: "location",
        label: location.name,
        file: target.relative,
        regionId: location.regionId,
      };
      if (skipExisting && await fileExists(target.absolute)) {
        records.push(record);
        continue;
      }
      console.log(`Capturing location: ${location.name}`);
      const focused = await driver.callDebug("focusLocation", [id]);
      if (focused !== true) throw new Error(`Could not frame location ${id}.`);
      await driver.wait(180);
      await captureFrame(driver, target.absolute);
      records.push(record);
    }

    const errors = await driver.callDebug("getErrors") as unknown[];
    if (errors.length > 0) throw new Error(`The game reported ${errors.length} error(s) during guide capture.`);
    if (driver.consoleErrors.length || driver.pageErrors.length || driver.requestErrors.length) {
      throw new Error([
        ...driver.consoleErrors,
        ...driver.pageErrors,
        ...driver.requestErrors,
      ].join("\n"));
    }
  } finally {
    await driver.callDebug("setCaptureMode", [false]).catch(() => undefined);
    await driver.close();
    await server.close();
  }

  const fingerprint = createHash("sha256")
    .update(JSON.stringify(records.map(({ id, kind, runtimeEntityId }) => ({ id, kind, runtimeEntityId }))))
    .digest("hex");
  if (only === "") {
    await writeFile(
      path.join(outputRoot, "manifest.json"),
      `${JSON.stringify({ version: 2, fingerprint, captures: records }, null, 2)}\n`,
      "utf8",
    );
  }
  console.log(`Captured ${records.length} guide images to ${path.relative(repoRoot, outputRoot)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
