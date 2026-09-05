import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { ALL_ITEMS } from "../game/src/content/items.js";
import type { ItemId } from "../game/src/contracts.js";
import { repoRoot } from "../tools/lib/paths.js";
import {
  ITEM_ICON_CONTACT_SHEET,
  ITEM_ICON_GAME_DIR,
  ITEM_ICON_MASTER_DIR,
  generateItemIcons,
  itemIconFiles,
  itemIconOutputPaths,
  itemIconRendererUrl,
  parseGenerateItemIconOptions,
} from "../tools/generate-item-icons.js";

const io = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  access: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  launch: vi.fn(),
  newPage: vi.fn(),
  browserClose: vi.fn(),
  goto: vi.fn(),
  waitForFunction: vi.fn(),
  evaluate: vi.fn(),
  on: vi.fn(),
  startGameServer: vi.fn(),
  serverClose: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  access: io.access,
  mkdir: io.mkdir,
  readFile: io.readFile,
  writeFile: io.writeFile,
}));
vi.mock("playwright", () => ({ chromium: { launch: io.launch } }));
vi.mock("../tools/lib/server.js", () => ({ startGameServer: io.startGameServer }));

const firstItem = ALL_ITEMS[0]!;
const secondItem = ALL_ITEMS[1]!;
const stagedRoot = path.join(repoRoot, "runs", "icon-generator-test");

beforeEach(() => {
  vi.clearAllMocks();
  io.files.clear();
  io.access.mockImplementation(async (file: string) => {
    if (!io.files.has(String(file))) throw new Error(`ENOENT: ${file}`);
  });
  io.mkdir.mockResolvedValue(undefined);
  io.readFile.mockImplementation(async (file: string) => {
    const contents = io.files.get(String(file));
    if (!contents) throw new Error(`ENOENT: ${file}`);
    return contents;
  });
  io.writeFile.mockImplementation(async (file: string, contents: Buffer) => {
    io.files.set(String(file), Buffer.from(contents));
  });
  io.launch.mockResolvedValue({ newPage: io.newPage, close: io.browserClose });
  io.newPage.mockResolvedValue({
    goto: io.goto,
    waitForFunction: io.waitForFunction,
    evaluate: io.evaluate,
    on: io.on,
  });
  io.browserClose.mockResolvedValue(undefined);
  io.goto.mockResolvedValue(undefined);
  io.waitForFunction.mockResolvedValue(undefined);
  io.startGameServer.mockResolvedValue({ url: "http://127.0.0.1:4174", close: io.serverClose });
  io.serverClose.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("item icon generator arguments", () => {
  it("keeps the default invocation and accepts a selected staging run", () => {
    expect(parseGenerateItemIconOptions([])).toEqual({});
    expect(parseGenerateItemIconOptions([
      "--all", "--url", "http://127.0.0.1:4174/index.html?mode=equipment",
      "--only", `${firstItem.id},${secondItem.id}`, "--out", "runs/icon-review",
    ])).toEqual({
      all: true,
      url: "http://127.0.0.1:4174/index.html?mode=equipment",
      only: [firstItem.id, secondItem.id],
      out: "runs/icon-review",
    });
  });

  it("trims CLI list separators while keeping exact catalog IDs", () => {
    expect(parseGenerateItemIconOptions(["--only", ` ${firstItem.id}, ${secondItem.id} `]).only)
      .toEqual([firstItem.id, secondItem.id]);
  });

  it.each([
    ["--unknown"],
    ["--all", "--all"],
    ["--url", "http://localhost:4174", "--url", "http://localhost:4175"],
    ["--only", firstItem.id, "--only", secondItem.id],
    ["--out", "runs/first", "--out", "runs/second"],
    ["--url"],
    ["--only"],
    ["--out"],
    ["--only", "--all"],
    ["--only", ""],
    ["--only", "not_a_real_item"],
    ["--only", `${firstItem.id},${firstItem.id}`],
    ["--only", `${firstItem.id},`],
    ["--only", `,${firstItem.id}`],
  ])("rejects invalid or ambiguous arguments %j", (...args) => {
    expect(() => parseGenerateItemIconOptions(args)).toThrow();
  });
});

describe("item icon output paths", () => {
  it("preserves canonical defaults", () => {
    expect(itemIconOutputPaths()).toEqual({
      masterDir: ITEM_ICON_MASTER_DIR,
      gameDir: ITEM_ICON_GAME_DIR,
      contactSheet: ITEM_ICON_CONTACT_SHEET,
      diagnosticsDir: path.join(repoRoot, "runs", "corealm", "icon-diagnostics"),
    });
    expect(itemIconFiles(firstItem.id)).toEqual({
      master: path.join(ITEM_ICON_MASTER_DIR, `${firstItem.id}.png`),
      game: path.join(ITEM_ICON_GAME_DIR, `${firstItem.id}.png`),
    });
  });

  it("routes masters, derivatives, contact sheet and diagnostics into a staging root", () => {
    const expected = {
      masterDir: path.join(stagedRoot, "256"),
      gameDir: path.join(stagedRoot, "48"),
      contactSheet: path.join(stagedRoot, "contact-sheet-48.png"),
      diagnosticsDir: path.join(stagedRoot, "diagnostics"),
    };
    expect(itemIconOutputPaths("runs/icon-generator-test")).toEqual(expected);
    expect(itemIconOutputPaths(stagedRoot)).toEqual(expected);
    expect(itemIconFiles(firstItem.id, expected)).toEqual({
      master: path.join(expected.masterDir, `${firstItem.id}.png`),
      game: path.join(expected.gameDir, `${firstItem.id}.png`),
    });
  });

  it.each([
    "game/public",
    "game/public/assets/icons/items/48",
    "game/public/../public/icon-review",
    "art/item-icons",
    "art/item-icons/256/review",
    path.join(repoRoot, "game", "public", "icon-review"),
  ])("rejects staging inside canonical publication paths: %s", (out) => {
    expect(() => itemIconOutputPaths(out)).toThrow();
  });

  it("allows adjacent directories whose names share a protected prefix", () => {
    expect(itemIconOutputPaths("art/item-icons-review").masterDir)
      .toBe(path.join(repoRoot, "art", "item-icons-review", "256"));
    expect(itemIconOutputPaths("game/public-review").gameDir)
      .toBe(path.join(repoRoot, "game", "public-review", "48"));
  });
});

describe("existing renderer server URLs", () => {
  it.each([
    ["http://localhost:4174", "http://localhost:4174/item-icon-renderer.html"],
    ["http://localhost:4174/", "http://localhost:4174/item-icon-renderer.html"],
    ["http://localhost:4174/index.html?mode=equipment#preview", "http://localhost:4174/item-icon-renderer.html"],
    ["http://localhost:4174/item-icon-renderer.html?old=1#preview", "http://localhost:4174/item-icon-renderer.html"],
    ["https://example.test/corealm/", "https://example.test/corealm/item-icon-renderer.html"],
    ["https://example.test/corealm/index.html?mode=equipment", "https://example.test/corealm/item-icon-renderer.html"],
    ["https://example.test/corealm/item-icon-renderer.html", "https://example.test/corealm/item-icon-renderer.html"],
  ])("normalizes %s without losing its base prefix", (url, expected) => {
    expect(itemIconRendererUrl(url)).toBe(expected);
  });

  it.each(["", "localhost:4174", "/index.html", "file:///tmp/index.html", "ftp://example.test/"])(
    "rejects a non-HTTP(S) server URL: %s", (url) => {
      expect(() => itemIconRendererUrl(url)).toThrow();
    },
  );
});

describe("selected staged generation", () => {
  async function mockMaster(): Promise<void> {
    const master = await sharp({
      create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite([{
      input: await sharp({
        create: { width: 100, height: 160, channels: 4, background: { r: 160, g: 90, b: 40, alpha: 1 } },
      }).png().toBuffer(),
      left: 78,
      top: 48,
    }]).png().toBuffer();
    io.evaluate.mockResolvedValue(`data:image/png;base64,${master.toString("base64")}`);
  }

  it("renders only selected items using the supplied server and keeps every file in staging", async () => {
    await mockMaster();
    const selected = [firstItem.id, secondItem.id] as const;
    const paths = itemIconOutputPaths(stagedRoot);
    const result = await generateItemIcons({
      all: true,
      url: "http://127.0.0.1:4174/index.html?mode=equipment",
      only: [...selected].reverse(),
      out: stagedRoot,
    });

    expect(result.rendered).toBe(2);
    expect(result.derived).toBe(2);
    expect(result.itemIds).toEqual(selected);
    expect(result.paths).toEqual(paths);
    expect(io.evaluate.mock.calls.map((call) => call[1])).toEqual(selected);
    expect(io.goto).toHaveBeenCalledWith("http://127.0.0.1:4174/item-icon-renderer.html", expect.any(Object));
    expect(io.startGameServer).not.toHaveBeenCalled();
    expect(io.serverClose).not.toHaveBeenCalled();
    expect(io.browserClose).toHaveBeenCalledOnce();

    expect([...io.files.keys()].sort()).toEqual([
      ...selected.flatMap((id) => Object.values(itemIconFiles(id, paths))),
      paths.contactSheet,
    ].sort());
    for (const operation of [io.access, io.mkdir, io.readFile, io.writeFile]) {
      for (const [file] of operation.mock.calls) {
        const relative = path.relative(stagedRoot, String(file));
        expect(relative.startsWith(".."), String(file)).toBe(false);
        expect(path.isAbsolute(relative), String(file)).toBe(false);
      }
    }
    const sheet = await sharp(io.files.get(paths.contactSheet)!).metadata();
    expect([sheet.width, sheet.height]).toEqual([selected.length * 200, 72]);
  });

  it("starts and closes its own server when no existing URL is supplied", async () => {
    await mockMaster();
    await generateItemIcons({ all: true, only: [firstItem.id], out: stagedRoot });
    expect(io.startGameServer).toHaveBeenCalledOnce();
    expect(io.serverClose).toHaveBeenCalledOnce();
    expect(io.browserClose).toHaveBeenCalledOnce();
  });

  it("keeps invalid-master diagnostics inside staging without publishing the failed image", async () => {
    const invalidMaster = await sharp({
      create: { width: 256, height: 256, channels: 4, background: { r: 160, g: 90, b: 40, alpha: 1 } },
    }).png().toBuffer();
    io.evaluate.mockResolvedValue(`data:image/png;base64,${invalidMaster.toString("base64")}`);
    await expect(generateItemIcons({
      all: true, url: "http://127.0.0.1:4174", only: [firstItem.id], out: stagedRoot,
    })).rejects.toThrow("master failed validation");
    const diagnostic = path.join(itemIconOutputPaths(stagedRoot).diagnosticsDir, `${firstItem.id}.png`);
    expect([...io.files.keys()]).toEqual([diagnostic]);
    expect(io.files.get(diagnostic)).toEqual(invalidMaster);
    expect(io.browserClose).toHaveBeenCalledOnce();
    expect(io.startGameServer).not.toHaveBeenCalled();
    expect(io.serverClose).not.toHaveBeenCalled();
  });

  it("closes only its browser when an external renderer fails", async () => {
    io.evaluate.mockRejectedValue(new Error("renderer failed"));
    await expect(generateItemIcons({
      all: true, url: "http://127.0.0.1:4174", only: [firstItem.id], out: stagedRoot,
    })).rejects.toThrow("renderer failed");
    expect(io.startGameServer).not.toHaveBeenCalled();
    expect(io.serverClose).not.toHaveBeenCalled();
    expect(io.browserClose).toHaveBeenCalledOnce();
    expect(io.writeFile).not.toHaveBeenCalled();
  });

  it.each([
    { only: [] },
    { only: [firstItem.id, firstItem.id] },
    { only: ["not_a_real_item" as ItemId] },
    { only: [` ${firstItem.id}` as ItemId] },
  ])("validates direct API selections before creating files or opening a browser: $only", async ({ only }) => {
    await expect(generateItemIcons({
      only, out: stagedRoot,
    })).rejects.toThrow();
    expect(io.mkdir).not.toHaveBeenCalled();
    expect(io.writeFile).not.toHaveBeenCalled();
    expect(io.launch).not.toHaveBeenCalled();
    expect(io.startGameServer).not.toHaveBeenCalled();
  });
});
