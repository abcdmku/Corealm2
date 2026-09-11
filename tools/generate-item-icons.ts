import path from "node:path";
import { pathToFileURL } from "node:url";
import { access, mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import sharp from "sharp";
import { ALL_ITEMS } from "../game/src/content/items.js";
import type { ItemDef, ItemId } from "../game/src/contracts.js";
import { itemIconAppearance } from "../game/src/render/itemIconAppearances.js";
import { repoRoot } from "./lib/paths.js";
import { startGameServer, type RunningGameServer } from "./lib/server.js";
import { ITEM_ICON_ART_DIR, generatedItemIconMaster, readItemIconArtRegistry } from "./lib/item-icon-art.js";

export const ITEM_ICON_MASTER_SIZE = 256;
export const ITEM_ICON_GAME_SIZE = 48;
const ITEM_ICON_CONTENT_SIZE = 44;
const ITEM_ICON_OUTLINE_RADIUS = 1;
export const ITEM_ICON_MASTER_DIR = path.join(repoRoot, "art", "item-icons", "256");
export const ITEM_ICON_GAME_DIR = path.join(repoRoot, "game", "public", "assets", "icons", "items", "48");
export const ITEM_ICON_CONTACT_SHEET = path.join(repoRoot, "art", "item-icons", "contact-sheet-48.png");

export interface GenerateItemIconOptions {
  /** Force fresh masters and derivatives for the selected items. */
  readonly all?: boolean;
  /** Reuse an existing Vite server. The generator does not start or close that server. */
  readonly url?: string;
  /** Exact item IDs. Output order follows the catalog, independent of argument order. */
  readonly only?: readonly ItemId[];
  /** Stage every output beneath this directory instead of the published icon locations. */
  readonly out?: string;
}

export interface ItemIconOutputPaths {
  readonly masterDir: string;
  readonly gameDir: string;
  readonly contactSheet: string;
  readonly diagnosticsDir: string;
}

export interface GenerateItemIconResult {
  readonly rendered: number;
  readonly derived: number;
  readonly itemIds: readonly ItemId[];
  readonly paths: ItemIconOutputPaths;
}

interface ImageCheck {
  ok: boolean;
  reason?: string;
}

function within(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

/** Resolve all destinations once so staged masters, derivatives and diagnostics stay together. */
export function itemIconOutputPaths(out?: string): ItemIconOutputPaths {
  if (out === undefined) {
    return {
      masterDir: ITEM_ICON_MASTER_DIR,
      gameDir: ITEM_ICON_GAME_DIR,
      contactSheet: ITEM_ICON_CONTACT_SHEET,
      diagnosticsDir: path.join(repoRoot, "runs", "corealm", "icon-diagnostics"),
    };
  }
  if (!out.trim()) throw new Error("Item icon --out requires a nonempty staging directory");
  const root = path.resolve(repoRoot, out);
  const publicRoot = path.join(repoRoot, "game", "public");
  const publishedArt = path.dirname(ITEM_ICON_MASTER_DIR);
  if (within(publicRoot, root) || within(publishedArt, root)) {
    throw new Error("Item icon --out must stay outside game/public and art/item-icons; omit --out to publish");
  }
  return {
    masterDir: path.join(root, String(ITEM_ICON_MASTER_SIZE)),
    gameDir: path.join(root, String(ITEM_ICON_GAME_SIZE)),
    contactSheet: path.join(root, "contact-sheet-48.png"),
    diagnosticsDir: path.join(root, "diagnostics"),
  };
}

export function itemIconFiles(
  itemId: ItemId,
  paths: ItemIconOutputPaths = itemIconOutputPaths(),
): { readonly master: string; readonly game: string } {
  return {
    master: path.join(paths.masterDir, `${itemId}.png`),
    game: path.join(paths.gameDir, `${itemId}.png`),
  };
}

function selectedItems(only?: readonly ItemId[]): readonly ItemDef[] {
  if (only === undefined) return ALL_ITEMS;
  if (only.length === 0 || new Set(only).size !== only.length) {
    throw new Error("Item icon --only requires nonempty, distinct exact item IDs");
  }
  const knownIds = new Set(ALL_ITEMS.map(item => item.id));
  const unknown = only.filter(id => !knownIds.has(id));
  if (unknown.length > 0) throw new Error(`Unknown item icon ID(s): ${unknown.join(", ")}`);
  const selected = new Set(only);
  return ALL_ITEMS.filter(item => selected.has(item.id));
}

/** Accept a server base URL or one of its HTML pages, including a Vite base prefix. */
export function itemIconRendererUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Item icon --url must use http or https");
  }
  const base = url.pathname.endsWith(".html")
    ? url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1)
    : `${url.pathname.replace(/\/$/, "")}/`;
  url.pathname = `${base}item-icon-renderer.html`;
  url.search = "";
  url.hash = "";
  return url.href;
}

const USAGE = "Usage: npm run icons [-- --all] [--url http://127.0.0.1:4174] [--only item_id,other_id] [--out test-results/icon-review]";

export function parseGenerateItemIconOptions(args: readonly string[]): GenerateItemIconOptions {
  const values = new Map<string, string>();
  let all = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    const equals = argument.indexOf("=");
    const flag = equals < 0 ? argument : argument.slice(0, equals);
    if (flag === "--all" && equals < 0) {
      if (all) throw new Error("Duplicate item icon option: --all");
      all = true;
      continue;
    }
    if (flag !== "--url" && flag !== "--only" && flag !== "--out") {
      throw new Error(`${USAGE}\nUnknown item icon option: ${argument}`);
    }
    if (values.has(flag)) throw new Error(`Duplicate item icon option: ${flag}`);
    const value = equals < 0 ? args[++index] : argument.slice(equals + 1);
    if (!value?.trim() || value.startsWith("--")) throw new Error(`${flag} requires a value\n${USAGE}`);
    values.set(flag, value);
  }
  const onlyValue = values.get("--only");
  const options: GenerateItemIconOptions = {
    ...(all ? { all: true } : {}),
    ...(values.has("--url") ? { url: values.get("--url")! } : {}),
    ...(onlyValue === undefined ? {} : { only: onlyValue.split(",").map(id => id.trim()) }),
    ...(values.has("--out") ? { out: values.get("--out")! } : {}),
  };
  selectedItems(options.only);
  itemIconOutputPaths(options.out);
  if (options.url !== undefined) itemIconRendererUrl(options.url);
  return options;
}

async function inspectImage(input: Buffer, expectedSize: number): Promise<ImageCheck> {
  try {
    const source = sharp(input, { failOn: "error" });
    const metadata = await source.metadata();
    if (metadata.width !== expectedSize || metadata.height !== expectedSize) {
      return { ok: false, reason: `${metadata.width ?? "?"}x${metadata.height ?? "?"}, expected ${expectedSize}x${expectedSize}` };
    }
    if (!metadata.hasAlpha) return { ok: false, reason: "no alpha channel" };

    const { data, info } = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let visible = 0;
    let transparent = 0;
    let minX = info.width;
    let minY = info.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const alpha = data[(y * info.width + x) * info.channels + 3] ?? 0;
        if (alpha < 250) transparent += 1;
        if (alpha <= 8) continue;
        visible += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (visible < expectedSize * expectedSize * 0.01) return { ok: false, reason: `only ${visible} visible pixels` };
    if (transparent < expectedSize * expectedSize * 0.01) return { ok: false, reason: "background is opaque" };
    const safeMargin = expectedSize >= 128 ? 4 : 1;
    if (minX < safeMargin || minY < safeMargin || maxX >= expectedSize - safeMargin || maxY >= expectedSize - safeMargin) {
      return { ok: false, reason: `visible bounds ${minX},${minY}-${maxX},${maxY} touch the safe margin` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function validFile(file: string, size: number): Promise<boolean> {
  try {
    return (await inspectImage(await readFile(file), size)).ok;
  } catch {
    return false;
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

async function deriveGameIcon(master: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(master)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .resize(ITEM_ICON_CONTENT_SIZE, ITEM_ICON_CONTENT_SIZE, {
      fit: "inside",
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const silhouette = Buffer.alloc(data.length);
  for (let offset = 0; offset < data.length; offset += info.channels) {
    silhouette[offset] = 0;
    silhouette[offset + 1] = 0;
    silhouette[offset + 2] = 0;
    silhouette[offset + 3] = data[offset + 3] ?? 0;
  }
  const raw = { width: info.width, height: info.height, channels: info.channels } as const;
  const [foregroundPng, silhouettePng] = await Promise.all([
    sharp(data, { raw }).png().toBuffer(),
    sharp(silhouette, { raw }).png().toBuffer(),
  ]);
  const left = Math.floor((ITEM_ICON_GAME_SIZE - info.width) / 2);
  const top = Math.floor((ITEM_ICON_GAME_SIZE - info.height) / 2);
  const layers: Array<{ input: Buffer; left: number; top: number }> = [];
  for (let y = -ITEM_ICON_OUTLINE_RADIUS; y <= ITEM_ICON_OUTLINE_RADIUS; y += 1) {
    for (let x = -ITEM_ICON_OUTLINE_RADIUS; x <= ITEM_ICON_OUTLINE_RADIUS; x += 1) {
      if (x === 0 && y === 0) continue;
      layers.push({ input: silhouettePng, left: left + x, top: top + y });
    }
  }
  layers.push({ input: foregroundPng, left, top });

  return sharp({
    create: {
      width: ITEM_ICON_GAME_SIZE,
      height: ITEM_ICON_GAME_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers)
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, colours: 256 })
    .toBuffer();
}

function decodePngDataUrl(value: string): Buffer {
  const match = /^data:image\/png;base64,(.+)$/.exec(value);
  if (!match?.[1]) throw new Error("Item icon renderer returned a non-PNG data URL");
  return Buffer.from(match[1], "base64");
}

async function openRenderer(rendererUrl?: string): Promise<{
  server: RunningGameServer | undefined;
  browser: Browser;
  page: Page;
  errors: string[];
}> {
  const server = rendererUrl === undefined ? await startGameServer({ logLevel: "error" }) : undefined;
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader", "--mute-audio"] });
    const page = await browser.newPage({ viewport: { width: ITEM_ICON_MASTER_SIZE, height: ITEM_ICON_MASTER_SIZE } });
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 1000));
    });
    page.on("pageerror", (error) => errors.push(String(error).slice(0, 1000)));
    await page.goto(rendererUrl ?? itemIconRendererUrl(server!.url), { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction(() => window.__itemIconRenderer?.ready === true, undefined, { timeout: 30_000 });
    return { server, browser, page, errors };
  } catch (error) {
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
    throw error;
  }
}

async function renderMaster(page: Page, itemId: ItemId): Promise<Buffer> {
  const dataUrl = await page.evaluate(async (id) => {
    const api = window.__itemIconRenderer;
    if (!api?.ready) throw new Error("window.__itemIconRenderer is not ready");
    return api.render(id);
  }, itemId);
  return decodePngDataUrl(dataUrl);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function writeContactSheet(items: readonly ItemDef[], paths: ItemIconOutputPaths): Promise<void> {
  const columns = Math.min(6, items.length);
  const cellWidth = 200;
  const cellHeight = 72;
  const rows = Math.ceil(items.length / columns);
  const width = columns * cellWidth;
  const height = rows * cellHeight;
  const cells: string[] = [];
  for (const [index, item] of items.entries()) {
    const x = (index % columns) * cellWidth;
    const y = Math.floor(index / columns) * cellHeight;
    const image = (await readFile(itemIconFiles(item.id, paths).game)).toString("base64");
    cells.push(
      `<g transform="translate(${x} ${y})">`,
      `<rect width="${cellWidth}" height="${cellHeight}" fill="${index % 2 === 0 ? "#1d1916" : "#241f1a"}" stroke="#3d352d"/>`,
      `<image x="8" y="12" width="48" height="48" href="data:image/png;base64,${image}"/>`,
      `<text x="64" y="30" fill="#eee7da" font-family="Segoe UI, sans-serif" font-size="12">${escapeXml(item.name)}</text>`,
      `<text x="64" y="47" fill="#9d9284" font-family="Consolas, monospace" font-size="9">${escapeXml(item.id)}</text>`,
      "</g>",
    );
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#171411"/>${cells.join("")}</svg>`;
  await mkdir(path.dirname(paths.contactSheet), { recursive: true });
  await writeFile(paths.contactSheet, await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer());
}

export async function generateItemIcons(options: GenerateItemIconOptions = {}): Promise<GenerateItemIconResult> {
  // Validate selection and destinations before touching the filesystem or opening a browser.
  const items = selectedItems(options.only);
  const paths = itemIconOutputPaths(options.out);
  const rendererUrl = options.url === undefined ? undefined : itemIconRendererUrl(options.url);
  const artRegistry = await readItemIconArtRegistry();
  if (options.only === undefined && options.out === undefined) {
    const registeredSources = new Set(Object.values(artRegistry).map(entry => path.resolve(ITEM_ICON_ART_DIR, entry.source)));
    for (const entry of await readdir(ITEM_ICON_ART_DIR, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".png") && !registeredSources.has(path.join(ITEM_ICON_ART_DIR, entry.name))) {
        throw new Error(`Unregistered generated item icon source: ${entry.name}; restore its registry entry before publishing`);
      }
    }
  }
  const knownIds = new Set(ALL_ITEMS.map(item => item.id));
  for (const id of Object.keys(artRegistry)) if (!knownIds.has(id)) throw new Error(`Unknown generated item icon ID: ${id}`);
  const artMasters = new Map<ItemId, Buffer>();
  for (const item of items) {
    const entry = artRegistry[item.id];
    if (entry?.status === "pending" && options.out === undefined) throw new Error(`Generated item icon awaits visual acceptance: ${item.id}; stage with --out before publishing`);
    if (entry) artMasters.set(item.id, await generatedItemIconMaster(entry, ITEM_ICON_MASTER_SIZE));
  }
  for (const item of items) itemIconAppearance(item.id);

  await mkdir(paths.masterDir, { recursive: true });
  await mkdir(paths.gameDir, { recursive: true });

  const masterNeeded = new Set<ItemId>();
  const gameNeeded = new Set<ItemId>();
  for (const item of items) {
    const files = itemIconFiles(item.id, paths);
    const artMaster = artMasters.get(item.id);
    const artChanged = artMaster !== undefined && !(await readFile(files.master).then(existing => existing.equals(artMaster)).catch(() => false));
    if (options.all || artChanged || !(await validFile(files.master, ITEM_ICON_MASTER_SIZE))) masterNeeded.add(item.id);
    if (options.all || masterNeeded.has(item.id) || !(await validFile(files.game, ITEM_ICON_GAME_SIZE))) gameNeeded.add(item.id);
  }

  let rendered = 0;
  let derived = 0;
  let rendererSession: Awaited<ReturnType<typeof openRenderer>> | undefined;
  try {
    if (masterNeeded.size > 0) {
      if ([...masterNeeded].some(id => !artMasters.has(id))) rendererSession = await openRenderer(rendererUrl);
      for (const item of items) {
        if (!masterNeeded.has(item.id)) continue;
        const master = artMasters.get(item.id) ?? await renderMaster(rendererSession!.page, item.id);
        const check = await inspectImage(master, ITEM_ICON_MASTER_SIZE);
        if (!check.ok) {
          const diagnostic = path.join(paths.diagnosticsDir, `${item.id}.png`);
          await mkdir(path.dirname(diagnostic), { recursive: true });
          await writeFile(diagnostic, master);
          throw new Error(`${item.id} master failed validation: ${check.reason}; wrote ${diagnostic}`);
        }
        await writeFile(itemIconFiles(item.id, paths).master, master);
        rendered += 1;
        process.stdout.write(`rendered ${item.id}\n`);
      }
      if (rendererSession && rendererSession.errors.length > 0) {
        throw new Error(`Item icon renderer reported browser errors:\n${rendererSession.errors.join("\n")}`);
      }
    }

    for (const item of items) {
      if (!gameNeeded.has(item.id)) continue;
      const master = await readFile(itemIconFiles(item.id, paths).master);
      const game = await deriveGameIcon(master);
      const check = await inspectImage(game, ITEM_ICON_GAME_SIZE);
      if (!check.ok) throw new Error(`${item.id} ${ITEM_ICON_GAME_SIZE}px icon failed validation: ${check.reason}`);
      await writeFile(itemIconFiles(item.id, paths).game, game);
      derived += 1;
    }
    // Review directories may be reused for a different selection with already-valid images.
    if (options.out !== undefined || options.only !== undefined || rendered > 0 || derived > 0 || !(await fileExists(paths.contactSheet))) {
      await writeContactSheet(items, paths);
    }
  } finally {
    await rendererSession?.browser.close().catch(() => undefined);
    await rendererSession?.server?.close().catch(() => undefined);
  }

  // Only a successful complete publication owns the full catalog. Selections and staging never prune.
  if (options.only === undefined && options.out === undefined) {
    const filenames = new Set(items.map(item => `${item.id}.png`));
    for (const directory of [paths.masterDir, paths.gameDir]) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".png") && !filenames.has(entry.name)) {
          await unlink(path.join(directory, entry.name));
        }
      }
    }
  }

  process.stdout.write(`item icons: ${rendered} master render(s), ${derived} gameplay derivative(s)\n`);
  return { rendered, derived, itemIds: items.map(item => item.id), paths };
}

async function main(): Promise<void> {
  await generateItemIcons(parseGenerateItemIconOptions(process.argv.slice(2)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
