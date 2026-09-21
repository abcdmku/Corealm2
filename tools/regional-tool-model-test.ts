/** Production acceptance for regional gathering tools and procedural fishing rods. */
import "./lib/repoContent.js";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { CAMERA, INTERACT_RANGE } from "../game/src/app/config.js";
import { gatheringToolAppearance } from "../game/src/render/equipmentVisuals.js";
import { FISHING_ROD_LOOKS, fishingRodAssetId, type FishingRodLook } from "../game/src/render/proceduralGear.js";
import type { GameEvent, SemanticEntity, Vec3 } from "../game/src/contracts.js";
import type { GameState } from "../game/src/state/store.js";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue, repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";

type Kind = "pickaxe" | "hatchet" | "rod";
type RequestedKind = Kind | "all";
type Point = { x: number; y: number; z: number };
type CameraState = Point & {
  target: Point;
  yaw: number;
  pitch: number;
  requestedDistance: number;
  freeMove: boolean;
};
type PlayerMotion = {
  pose: string;
  clip: string | null;
  drawnPosition: Vec3;
  drawnRotationY: number;
  attachments?: Record<string, string>;
  attachmentLoading?: Record<string, string>;
  attachmentErrors?: Record<string, string>;
  activityMainHandKey?: string | null;
  fishing?: {
    sample: { phase: string; ageMs: number; crank: number } | null;
    visible: boolean;
    tip: number[];
    float: number[];
    guideWorld: number[] | null;
    guideLocal: number[] | null;
    visibleTackle: number;
  };
};
type EnvironmentLabState = { entityIds: string[] };
type FishingLabState = { entityIds: string[] };
type EventBatch = { events: GameEvent[]; nextSeq: number; dropped?: boolean };
type Capture = {
  name: string;
  state: { motion: PlayerMotion; camera: CameraState; player: Point };
  file: string;
};
type ManifestAsset = { id: string; file?: string; sha256?: string; [key: string]: unknown };
type ProductionAssetRow = {
  itemId: string;
  kind: Kind;
  assetId: string;
  source: "gatheringToolAppearance" | "FISHING_ROD_LOOKS";
  sha256: string | null;
  manifest: ManifestAsset | null;
  look?: FishingRodLook;
};

const DEFINITIONS: Record<number, Record<Kind, string>> = {
  30: { pickaxe: "dewglass_pickaxe", hatchet: "dewglass_hatchet", rod: "willow_rod" },
  40: { pickaxe: "crownsilver_pickaxe", hatchet: "crownsilver_hatchet", rod: "maple_rod" },
  60: { pickaxe: "staramethyst_pickaxe", hatchet: "staramethyst_hatchet", rod: "yew_rod" },
};

const VERBS: Record<Kind, "mine" | "chop" | "fish"> = {
  pickaxe: "mine", hatchet: "chop", rod: "fish",
};
const SITES: Record<Exclude<Kind, "rod">, string> = {
  pickaxe: "bracken_workings", hatchet: "palewood_landing",
};

function parseKind(raw: string | undefined): RequestedKind {
  const value = raw ?? "all";
  assert(value === "all" || value === "pickaxe" || value === "hatchet" || value === "rod",
    `--kind must be all, pickaxe, hatchet, or rod; received ${value}`);
  return value;
}

function inventoryQuantity(state: GameState, itemId: string): number {
  return state.inventory.slots.reduce((total, slot) => total + (slot?.itemId === itemId ? slot.quantity : 0), 0);
}

function eventQuantity(events: readonly GameEvent[], entityId: string, itemId: string): number {
  return events
    .filter((event) => {
      const data = event.data as Record<string, unknown>;
      return event.type === "item.received" && event.entityId === entityId
        && data.source === "gather" && data.itemId === itemId;
    })
    .reduce((total, event) => total + Number((event.data as Record<string, unknown>).quantity ?? 0), 0);
}

function describeResult(result: unknown): string {
  return result && typeof result === "object" ? JSON.stringify(result) : String(result);
}

/** The debug bridge unwraps successful calls to { started }, while failures carry { error }. */
function assertStarted(result: unknown, label: string): asserts result is { started: string } {
  if (!result || typeof result !== "object" || typeof (result as { started?: unknown }).started !== "string"
    || "error" in result) {
    throw new Error(`${label} did not start production interaction: ${describeResult(result)}`);
  }
  // Trees may need a short production path around their trunk before the gather starts.
  // The caller waits for the actual gather pose, tool attachment and receipt below.
}

function near(a: readonly number[], b: readonly number[], tolerance: number): boolean {
  return a.length === b.length && a.every((value, index) => Math.abs(value - (b[index] ?? 0)) <= tolerance);
}

function assertFollowCamera(state: { motion: PlayerMotion; camera: CameraState; player: Point }, label: string): void {
  assert.equal(state.camera.freeMove, false, `${label} camera detached from player`);
  assert(state.camera.requestedDistance >= CAMERA.minDistance && state.camera.requestedDistance <= CAMERA.maxDistance,
    `${label} camera left normal zoom bounds`);
  assert(state.camera.pitch >= CAMERA.minPitch && state.camera.pitch <= CAMERA.maxPitch,
    `${label} camera left normal pitch bounds`);
  assert(Math.hypot(state.camera.target.x - state.player.x, state.camera.target.z - state.player.z) < 0.6,
    `${label} camera target left the player`);
  assert(Math.abs(state.camera.target.y - state.player.y - 1.1) < 0.6,
    `${label} camera target is not the normal player follow target`);
  assert.deepEqual(state.motion.attachmentErrors ?? {}, {}, `${label} production attachment failed`);
  assert.deepEqual(state.motion.attachmentLoading ?? {}, {}, `${label} production attachment did not settle`);
}

/** Aim the ordinary follow camera with the same bounded right-drag a player can use. */
async function orientFollowCamera(page: Page): Promise<void> {
  await page.mouse.move(720,450);
  for(let i=0;i<25;i++)await page.mouse.wheel(0,-100);
  for (let attempt = 0; attempt < 3; attempt++) {
    const bearing = await page.evaluate(() => {
      const debug = (window as any).__gameDebug;
      return { motion: debug.getPlayerMotion() as PlayerMotion, camera: debug.getCamera() as CameraState };
    });
    const yawDelta = Math.atan2(
      Math.sin(bearing.motion.drawnRotationY + Math.PI / 2 - bearing.camera.yaw),
      Math.cos(bearing.motion.drawnRotationY + Math.PI / 2 - bearing.camera.yaw),
    );
    const dx = Math.max(-280, Math.min(280, -yawDelta / 0.006));
    const dy = Math.max(-150, Math.min(150, (0.2 - bearing.camera.pitch) / 0.004));
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break;
    await page.mouse.move(720, 450);
    await page.mouse.down({ button: "right" });
    try { await page.mouse.move(720 + dx, 450 + dy, { steps: 6 }); }
    finally { await page.mouse.up({ button: "right" }); }
  }
  await page.waitForTimeout(180);
}

/** Capture rear, side, and front views through ordinary follow-camera orbit input. */
async function captureFollowViews(driver: GameDriver, page: Page, output: string, itemId: string): Promise<Capture[]> {
  const views = ["back", "side", "front"] as const;
  const captures: Capture[] = [];
  for (let index = 0; index < views.length; index++) {
    const state = await page.evaluate(() => {
      const debug = (window as any).__gameDebug;
      return { motion: debug.getPlayerMotion(), camera: debug.getCamera(), player: debug.getPlayerPosition() };
    }) as { motion: PlayerMotion; camera: CameraState; player: Point };
    assertFollowCamera(state, `${itemId}-${views[index]}`);
    const file = await driver.screenshot(output, `${itemId}-${views[index]}`);
    captures.push({ name: `${itemId}-${views[index]}`, state, file });
    if (index < views.length - 1) {
      await page.mouse.move(720, 450);
      await page.mouse.down({ button: "right" });
      try { await page.mouse.move(1000, 450, { steps: 8 }); }
      finally { await page.mouse.up({ button: "right" }); }
      await page.waitForTimeout(150);
    }
  }
  return captures;
}

function toolProductionAsset(kind: Kind, itemId: string): {
  assetId: string;
  look?: FishingRodLook;
} {
  if (kind === "rod") {
    const look = FISHING_ROD_LOOKS[itemId];
    assert(look, `${itemId} is missing from the production FISHING_ROD_LOOKS map`);
    return { assetId: fishingRodAssetId(itemId), look };
  }
  const appearance = gatheringToolAppearance(itemId);
  assert(appearance, `${itemId} is missing from production gatheringToolAppearance`);
  assert.equal(appearance.slot, "mainHand", `${itemId} is not a main-hand gathering tool`);
  assert.equal(appearance.attach, "bone", `${itemId} does not use the production held-tool path`);
  return { assetId: appearance.assetId };
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const stopDeadline = installTestDeadline("Regional production tool acceptance", 59_000);
  const args = process.argv.slice(2);
  const rawTier = argValue(args, "--tier") ?? "30";
  const tier = Number(rawTier);
  assert(Number.isInteger(tier) && DEFINITIONS[tier], `--tier must be 30, 40, or 60; received ${rawTier}`);
  const requestedKind = parseKind(argValue(args, "--kind"));
  const kinds: Kind[] = requestedKind === "all" ? ["pickaxe", "hatchet", "rod"] : [requestedKind];
  const externalUrl = argValue(args, "--url");
  const server = externalUrl ? { url: externalUrl, close: async () => {} } : await startGameServer({ hmr: false });
  const driver = new GameDriver(server, {
    headless: !args.includes("--headed"),
    viewport: { width: 1440, height: 900 },
    browserArgs: ["--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio",
      ...(process.platform === "win32" ? ["--use-angle=d3d11"] : [])],
  });
  const output = path.join(repoRoot, "test-results", "regional-tier-content", `regional-tools-tier${tier}-${requestedKind}`);
  await mkdir(output, { recursive: true });
  const route = requestedKind === "rod"
    ? "/index.html?mode=combat&fishing=crownward&startup-cache=0"
    : requestedKind === "pickaxe" || requestedKind === "hatchet"
      ? "/index.html?mode=combat&environment=1&startup-cache=0"
      : "/index.html?mode=combat&environment=1&fishing=crownward&startup-cache=0";

  const report: Record<string, unknown> = {
    status: "failed", passed: false, tier, kind: requestedKind, url: server.url, route,
    setup: "The production feature lab only seeds skill levels and one carried regional tool. Resource actions use corealm_interact at the live fixture position.",
    cameraRule: "Screenshots use the normal player-follow camera and bounded mouse orbit. No detached inspection camera is used.",
    assets: [] as ProductionAssetRow[],
    tools: [] as Record<string, unknown>[],
    screenshots: [] as string[],
    captures: [] as Capture[],
  };
  const screenshots = report.screenshots as string[];
  const productionAssets = report.assets as ProductionAssetRow[];
  let stage = "boot";
  let currentEntityId: string | null = null;
  let eventCursor = 0;
  const remaining = (limit: number): number => {
    const budget = 57_000 - (Date.now() - startedAt);
    assert(budget > 0, "Regional production tool acceptance exceeded its 57-second operation budget");
    return Math.max(1, Math.min(limit, budget));
  };

  try {
    const manifest = JSON.parse(await readFile(path.join(repoRoot, "game", "public", "assets", "manifest.json"), "utf8")) as {
      assets?: ManifestAsset[];
    };
    const manifestById = new Map((manifest.assets ?? []).map((entry) => [entry.id, entry]));
    for (const kind of kinds) {
      const itemId = DEFINITIONS[tier]![kind];
      const production = toolProductionAsset(kind, itemId);
      const manifestEntry = manifestById.get(production.assetId) ?? null;
      productionAssets.push({
        itemId, kind, assetId: production.assetId,
        source: kind === "rod" ? "FISHING_ROD_LOOKS" : "gatheringToolAppearance",
        sha256: manifestEntry?.sha256 ?? null,
        manifest: manifestEntry,
        ...(production.look ? { look: production.look } : {}),
      });
    }

    await driver.launch();
    const page = driver.page!;
    page.setDefaultTimeout(5_000);
    await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true });");
    await driver.open(remaining(24_000), route);
    await page.waitForFunction(({ needsEnvironment, needsFishing }) => {
      const global = window as any;
      return Boolean(global.__featureLab)
        && (!needsEnvironment || Boolean(global.__environmentLab))
        && (!needsFishing || Boolean(global.__fishingLab));
    }, { needsEnvironment: kinds.some((kind) => kind !== "rod"), needsFishing: kinds.includes("rod") }, { timeout: remaining(5_000) });
    await page.evaluate(() => {
      const lab = (window as any).__featureLab;
      lab.setFreeCameraEnabled(false);
      lab.setWalkingEnabled(true);
      for (const skill of ["mining", "woodcutting", "fishing"]) lab.setLevel(skill, 99);
    });
    await page.evaluate(async (itemIds: string[]) => {
      const textures = await import("/src/render/regionalEquipmentTextures.ts" as string);
      await textures.preloadRegionalEquipmentTextures(itemIds);
    }, kinds.map((kind) => DEFINITIONS[tier]![kind]));

    const giveTool = async (itemId: string): Promise<void> => {
      await driver.callDebug("callTool", ["corealm_stop", {}]);
      await driver.callDebug("clearInventory");
      const grant = await driver.callDebug("giveItem", [itemId, 1, "inventory"]) as { ok?: boolean; value?: unknown };
      assert(grant.ok === true && grant.value === 1, `Production inventory refused ${itemId}: ${describeResult(grant)}`);
    };

    const readLive = async (): Promise<{ motion: PlayerMotion; camera: CameraState; player: Point; activity: unknown }> => page.evaluate(() => {
      const debug = (window as any).__gameDebug;
      return { motion: debug.getPlayerMotion(), camera: debug.getCamera(), player: debug.getPlayerPosition(), activity: debug.getCurrentActivity() };
    });

    const runGather = async (kind: Exclude<Kind, "rod">): Promise<void> => {
      const itemId = DEFINITIONS[tier]![kind];
      const verb = VERBS[kind];
      const production = toolProductionAsset(kind, itemId);
      stage = `${kind} fixture setup`;
      await page.evaluate(async (site) => { await (window as any).__environmentLab.showSite(site); }, SITES[kind]);
      const panel = page.locator("#panel-feature-lab");
      if (await panel.isVisible()) {
        await panel.locator(".panel__close").click();
        await panel.waitFor({ state: "hidden", timeout: remaining(2_000) });
      }
      const fixture = await page.evaluate(() => (window as any).__environmentLab.getState() as EnvironmentLabState);
      assert(fixture.entityIds.length > 0, `${kind} environment fixture did not expose entities`);
      const node = await page.evaluate(({ ids, operation, range }) => {
        const debug = (window as any).__gameDebug;
        for(const entity of ids.map((id: string) => debug.getEntity(id))) {
          if(!entity?.interactions?.includes(operation)||entity.resource?.remaining<=0)continue;
          const anchor=entity.interactionPosition??entity.position;
          const stance=entity.interactionPosition??[anchor[0]+1,anchor[1],anchor[2]+1];
          debug.teleport(stance);const player=debug.getPlayerPosition();
          if(Math.hypot(player.x-anchor[0],player.z-anchor[2])<range-.1)return entity;
        }
        return undefined;
      }, { ids: fixture.entityIds, operation: verb, range: INTERACT_RANGE }) as SemanticEntity | undefined;
      assert(node, `No live ${verb} resource in the production environment fixture`);
      assert(node.resource, `${node.id} has no production resource state`);
      currentEntityId = node.id;
      const target = node.interactionPosition ?? node.position;
      await giveTool(itemId);
      const stance = node.interactionPosition ?? [target[0] + 1, target[1], target[2] + 1];
      assert.equal(await driver.callDebug("teleport", [stance]), true, `${kind} setup teleport was not accepted`);
      await page.waitForTimeout(160);
      const before = JSON.parse(await driver.callDebug("getSaveBlob") as string) as GameState;
      const beforeNode = await driver.callDebug("getEntity", [node.id]) as SemanticEntity;
      assert(beforeNode.resource, `${node.id} lost its resource during setup`);
      eventCursor = (await driver.callDebug("getEvents", [0]) as { nextSeq: number }).nextSeq;
      stage = `${kind} production interaction`;
      const result = await driver.callDebug("callTool", ["corealm_interact", { entityId: node.id, interaction: verb }]);
      assertStarted(result, verb);
      await page.waitForFunction(({ item, operation, asset }) => {
        const motion = (window as any).__gameDebug.getPlayerMotion() as PlayerMotion;
        return motion.pose === operation && motion.attachments?.mainHand === `equip-mainHand-${asset}`
          && motion.activityMainHandKey === `${item}:${asset}`;
      }, { item: itemId, operation: verb === "mine" ? "mine" : "chop", asset: production.assetId },
      { timeout: remaining(5_000), polling: 40 });
      await orientFollowCamera(page);
      const live = await readLive();
      assertFollowCamera(live, kind);
      const captures = await captureFollowViews(driver, page, output, itemId);
      screenshots.push(...captures.map((capture) => capture.file));
      (report.captures as Capture[]).push(...captures);
      await page.waitForFunction(({ id, since, outputItem }) => {
        const events = (window as any).__gameDebug.getEvents(since);
        return events.events.some((event: GameEvent) => event.type === "item.received" && event.entityId === id
          && (event.data as any).source === "gather" && (event.data as any).itemId === outputItem);
      }, { id: node.id, since: eventCursor, outputItem: node.resource.itemId }, { timeout: remaining(9_000), polling: 50 });
      const evidence = await page.evaluate(({ id, since }) => {
        const debug = (window as any).__gameDebug;
        return { entity: debug.getEntity(id), events: debug.getEvents(since), motion: debug.getPlayerMotion(),
          camera: debug.getCamera(), player: debug.getPlayerPosition(), errors: debug.getErrors() };
      }, { id: node.id, since: eventCursor }) as { entity: SemanticEntity; events: EventBatch; motion: PlayerMotion; camera: CameraState; player: Point; errors: unknown[] };
      await driver.callDebug("callTool", ["corealm_stop", {}]);
      const after = JSON.parse(await driver.callDebug("getSaveBlob") as string) as GameState;
      assert(evidence.entity.resource, `${kind} evidence lost the resource state`);
      const received = eventQuantity(evidence.events.events, node.id, node.resource.itemId);
      assert(received > 0, `${kind} produced no gathered quantity`);
      assert.equal(inventoryQuantity(after, node.resource.itemId) - inventoryQuantity(before, node.resource.itemId), received,
        `${kind} inventory delta disagrees with item.received`);
      assert.equal(beforeNode.resource.remaining - evidence.entity.resource.remaining, received,
        `${kind} resource remaining delta disagrees with item.received`);
      assert(!evidence.events.dropped, `${kind} event buffer dropped production evidence`);
      assert(evidence.events.events.some((event) => event.type === "activity.started"), `${kind} has no activity.started event`);
      assert(Math.hypot(evidence.player.x - target[0], evidence.player.z - target[2]) <= INTERACT_RANGE,
        `${kind} receipt occurred outside the normal gather range`);
      const asset = productionAssets.find((entry) => entry.itemId === itemId)!;
      (report.tools as Record<string, unknown>[]).push({
        kind, itemId, assetId: production.assetId, sha256: asset.sha256, source: asset.source,
        entityId: node.id, nodeTier: node.tier, verb, target,
        beforeRemaining: beforeNode.resource.remaining, afterRemaining: evidence.entity.resource.remaining,
        received, outputItemId: node.resource.itemId,
        beforeInventory: inventoryQuantity(before, node.resource.itemId), afterInventory: inventoryQuantity(after, node.resource.itemId),
        motion: live.motion, camera: live.camera, player: live.player, captures, events: evidence.events.events,
      });
    };

    const runRod = async (): Promise<void> => {
      const itemId = DEFINITIONS[tier]!.rod;
      const production = toolProductionAsset("rod", itemId);
      assert(production.look, `${itemId} has no production rod look`);
      stage = "rod fixture setup";
      const fixture = await page.evaluate(() => (window as any).__fishingLab.getState() as FishingLabState);
      assert(fixture.entityIds.length > 0, "Fishing fixture did not expose entity ids");
      const node = await page.evaluate(({ ids, wantedTier }) => {
        const debug = (window as any).__gameDebug;
        return ids.map((id: string) => debug.getEntity(id)).find((entity: any) => entity?.tier === wantedTier
          && entity.interactions?.includes("fish") && entity.resource?.remaining > 0);
      }, { ids: fixture.entityIds, wantedTier: tier }) as SemanticEntity | undefined;
      assert(node, `No tier-${tier} fish resource in the crownward production fixture`);
      assert(node.resource, `${node.id} has no production fish state`);
      currentEntityId = node.id;
      const target = node.interactionPosition ?? node.position;
      await giveTool(itemId);
      assert.equal(await driver.callDebug("teleport", [target]), true, "Rod setup teleport was not accepted");
      await page.waitForTimeout(160);
      const before = JSON.parse(await driver.callDebug("getSaveBlob") as string) as GameState;
      const beforeNode = await driver.callDebug("getEntity", [node.id]) as SemanticEntity;
      assert(beforeNode.resource, `${node.id} lost its fish resource during setup`);
      eventCursor = (await driver.callDebug("getEvents", [0]) as { nextSeq: number }).nextSeq;
      await page.evaluate(() => {
        const global = window as any;
        global.__regionalRodFrames = [];
        global.__regionalRodTimer = setInterval(() => {
          const motion = global.__gameDebug.getPlayerMotion() as PlayerMotion;
          if (motion.fishing?.visible) global.__regionalRodFrames.push(JSON.parse(JSON.stringify(motion)));
        }, 35);
      });
      stage = "rod production interaction";
      const result = await driver.callDebug("callTool", ["corealm_interact", { entityId: node.id, interaction: "fish" }]);
      assertStarted(result, "fish");
      await page.waitForFunction(({ item, asset }) => {
        const motion = (window as any).__gameDebug.getPlayerMotion() as PlayerMotion;
        return motion.pose === "fish" && motion.attachments?.mainHand === `equip-mainHand-${asset}`
          && motion.activityMainHandKey === `${item}:${asset}` && motion.fishing?.visible === true
          && motion.fishing.visibleTackle === 0 && motion.fishing.guideLocal?.every((part) => Number.isFinite(part));
      }, { item: itemId, asset: production.assetId }, { timeout: remaining(5_000), polling: 40 });
      await orientFollowCamera(page);
      const live = await readLive();
      assertFollowCamera(live, "rod");
      assert(live.motion.fishing?.visible, "Production rod did not expose a live fishing line");
      assert.equal(live.motion.fishing.visibleTackle, 0, "Production rod left decorative tackle beside the live line");
      const captures = await captureFollowViews(driver, page, output, itemId);
      screenshots.push(...captures.map((capture) => capture.file));
      (report.captures as Capture[]).push(...captures);
      await page.waitForFunction(({ id, since, outputItem }) => {
        const events = (window as any).__gameDebug.getEvents(since);
        return events.events.some((event: GameEvent) => event.type === "item.received" && event.entityId === id
          && (event.data as any).source === "gather" && (event.data as any).itemId === outputItem);
      }, { id: node.id, since: eventCursor, outputItem: node.resource.itemId }, { timeout: remaining(9_000), polling: 50 });
      const evidence = await page.evaluate(({ id, since }) => {
        const global = window as any;
        clearInterval(global.__regionalRodTimer);
        const debug = global.__gameDebug;
        return { entity: debug.getEntity(id), events: debug.getEvents(since), frames: global.__regionalRodFrames ?? [],
          motion: debug.getPlayerMotion(), camera: debug.getCamera(), player: debug.getPlayerPosition(), errors: debug.getErrors() };
      }, { id: node.id, since: eventCursor }) as { entity: SemanticEntity; events: EventBatch; frames: PlayerMotion[]; motion: PlayerMotion; camera: CameraState; player: Point; errors: unknown[] };
      await driver.callDebug("callTool", ["corealm_stop", {}]);
      const after = JSON.parse(await driver.callDebug("getSaveBlob") as string) as GameState;
      assert(evidence.entity.resource, "Rod evidence lost the fish resource state");
      assert(evidence.frames.length > 5, "Production rod did not render enough active fishing frames");
      const guideErrors = evidence.frames.map((frame) => {
        const fishing = frame.fishing;
        assert(fishing?.visible, "A recorded rod frame lost the live fishing line");
        assert.equal(frame.attachments?.mainHand, `equip-mainHand-${production.assetId}`);
        assert.equal(fishing.visibleTackle, 0, "Production rod frame exposed decorative tackle");
        assert(fishing.guideWorld && near(fishing.tip, fishing.guideWorld, 0.002), "Fishing line detached from the procedural rod tip");
        assert(fishing.guideLocal && fishing.guideLocal.every((part) => Number.isFinite(part)), "Procedural rod guide was not finite");
        return Math.max(...fishing.tip.map((value, index) => Math.abs(value - (fishing.guideWorld?.[index] ?? value))));
      });
      const crankSamples = evidence.frames.map((frame) => frame.fishing?.sample?.crank ?? 0);
      const crankRange = Math.max(...crankSamples) - Math.min(...crankSamples);
      assert(crankRange > 0.05, "Production fishing reel motion did not advance");
      const received = eventQuantity(evidence.events.events, node.id, node.resource.itemId);
      assert(received > 0, "Rod produced no gathered fish");
      assert.equal(inventoryQuantity(after, node.resource.itemId) - inventoryQuantity(before, node.resource.itemId), received,
        "Rod inventory delta disagrees with item.received");
      assert.equal(beforeNode.resource.remaining - evidence.entity.resource.remaining, received,
        "Rod resource remaining delta disagrees with item.received");
      assert(!evidence.events.dropped, "Rod event buffer dropped production evidence");
      assert(evidence.events.events.some((event) => event.type === "activity.started"), "Rod has no activity.started event");
      const asset = productionAssets.find((entry) => entry.itemId === itemId)!;
      (report.tools as Record<string, unknown>[]).push({
        kind: "rod", itemId, assetId: production.assetId, sha256: asset.sha256, source: asset.source,
        look: production.look, entityId: node.id, nodeTier: node.tier, target,
        beforeRemaining: beforeNode.resource.remaining, afterRemaining: evidence.entity.resource.remaining,
        received, outputItemId: node.resource.itemId,
        beforeInventory: inventoryQuantity(before, node.resource.itemId), afterInventory: inventoryQuantity(after, node.resource.itemId),
        frames: evidence.frames.length, maxGuideTipError: Math.max(...guideErrors), crankRange,
        motion: live.motion, camera: live.camera, player: live.player, captures, events: evidence.events.events,
      });
    };

    for (const kind of kinds) if (kind === "rod") await runRod(); else await runGather(kind);
    assert.equal(driver.pageErrors.length, 0, `Runtime page errors: ${driver.pageErrors.join(" | ")}`);
    assert.equal(driver.consoleErrors.length, 0, `Runtime console errors: ${driver.consoleErrors.join(" | ")}`);
    assert.equal(driver.requestErrors.length, 0, `Runtime request errors: ${driver.requestErrors.join(" | ")}`);
    report.status = "passed";
    report.passed = true;
  } catch (error) {
    report.failedStage = stage;
    report.entityId = currentEntityId;
    report.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
    if (driver.page) {
      try {
        report.failureObservation = await driver.page.evaluate(({ id, since }) => {
          const debug = (window as any).__gameDebug;
          return debug ? { entity: id ? debug.getEntity(id) : null, motion: debug.getPlayerMotion(), camera: debug.getCamera(),
            player: debug.getPlayerPosition(), activity: debug.getCurrentActivity(), events: debug.getEvents(since), errors: debug.getErrors() } : { debugMissing: true };
        }, { id: currentEntityId, since: eventCursor });
      } catch (observationError) {
        report.failureObservationError = observationError instanceof Error ? observationError.message : String(observationError);
      }
      if (Date.now() - startedAt < 51_000) {
        try { screenshots.push(await driver.screenshot(output, "failure")); } catch { /* Keep the primary assertion. */ }
      }
    }
  } finally {
    report.elapsedMs = Date.now() - startedAt;
    report.errors = { console: driver.consoleErrors, page: driver.pageErrors, request: driver.requestErrors };
    await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ status: report.status, passed: report.passed, elapsedMs: report.elapsedMs,
      report: path.join(output, "report.json"), error: report.error }));
    await driver.close();
    await server.close();
    stopDeadline();
  }
}

await main();
