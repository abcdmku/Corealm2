import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WORLD_MAP_DETAIL_RENDITIONS,
  WORLD_MAP_IMAGE_BOUNDS,
  WORLD_MAP_MINIMAP_RENDITION,
  WORLD_MAP_PLAYABLE_BOUNDS,
  WORLD_MAP_RENDER_FINGERPRINT,
  WORLD_MAP_RENDITION_SET_FINGERPRINT,
  WORLD_MAP_SOURCE_SHA256,
} from "../game/src/generated/worldMapFingerprint.js";
import { MAP_HOME_ZOOM, WorldMapCanvas } from "../game/src/ui/worldMapCanvas.js";

const MINIMAP_BOOT_BUDGET_BYTES = 150_000;
// Raised from 750 KB with the Kilnhalt expansion, mirroring the reviewed tripwire in
// tools/generate-world-map.ts: the canonical image grew 33% in pixels and the northern band's
// dry-brush ground compresses ~15% worse per pixel at the unchanged encode quality. The farming
// removal capture was visually reviewed before adding a narrow 25 KB margin. Detail levels stay
// lazy-loaded zoom assets; the boot-path checks below are what protect startup transfer.
const DETAIL_RENDITION_BUDGET_BYTES = 1_275_000;

interface MapRendition {
  id: string;
  role: "minimap" | "detail";
  path: string;
  format: "webp";
  width: number;
  height: number;
  metresPerPixel: number;
  bytes: number;
  sha256: string;
  quality: number;
}

interface MapMetadata {
  version: number;
  width: number;
  height: number;
  playableBounds: typeof WORLD_MAP_PLAYABLE_BOUNDS;
  imageBounds: typeof WORLD_MAP_IMAGE_BOUNDS;
  sha256: string;
  renderFingerprint: string;
  sourceImage: {
    path: string;
    format: "png";
    width: number;
    height: number;
    bytes: number;
    sha256: string;
  };
  renditions: {
    minimap: MapRendition;
    detail: MapRendition[];
  };
}

function publicFile(runtimePath: string): string {
  return path.join("game", "public", ...runtimePath.split("/"));
}

async function mapMetadata(): Promise<MapMetadata> {
  return JSON.parse(
    await readFile("game/public/generated/world-map.json", "utf8"),
  ) as MapMetadata;
}

async function verifyRendition(rendition: MapRendition): Promise<void> {
  expect(rendition.path).toMatch(/^generated\/world-map-(?:minimap|detail-[0-9]+)\.webp$/);
  expect(rendition.path).not.toContain("..");
  expect(rendition.format).toBe("webp");
  expect(rendition.quality).toBeGreaterThan(0);
  expect(rendition.quality).toBeLessThanOrEqual(100);

  const file = publicFile(rendition.path);
  const bytes = await readFile(file);
  const fileStat = await stat(file);
  const image = await sharp(bytes).metadata();
  expect(fileStat.size, rendition.path).toBe(rendition.bytes);
  expect(createHash("sha256").update(bytes).digest("hex"), rendition.path).toBe(rendition.sha256);
  expect(image.format, rendition.path).toBe(rendition.format);
  expect(image.width, rendition.path).toBe(rendition.width);
  expect(image.height, rendition.path).toBe(rendition.height);

  const metresWide = WORLD_MAP_IMAGE_BOUNDS.maxX - WORLD_MAP_IMAGE_BOUNDS.minX;
  const metresHigh = WORLD_MAP_IMAGE_BOUNDS.maxZ - WORLD_MAP_IMAGE_BOUNDS.minZ;
  expect(metresWide / rendition.width, rendition.path).toBeCloseTo(rendition.metresPerPixel, 8);
  expect(metresHigh / rendition.height, rendition.path).toBeCloseTo(rendition.metresPerPixel, 8);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("generated world-map payloads", () => {
  it("keeps the boot minimap and every detail level inside their transfer budgets", async () => {
    expect(WORLD_MAP_MINIMAP_RENDITION.bytes).toBeLessThanOrEqual(MINIMAP_BOOT_BUDGET_BYTES);
    for (const rendition of WORLD_MAP_DETAIL_RENDITIONS) {
      expect(rendition.bytes, rendition.path).toBeLessThanOrEqual(DETAIL_RENDITION_BUDGET_BYTES);
    }

    await verifyRendition(WORLD_MAP_MINIMAP_RENDITION);
    for (const rendition of WORLD_MAP_DETAIL_RENDITIONS) await verifyRendition(rendition);
  });

  it("keeps JSON metadata, generated exports, files, and the set fingerprint in sync", async () => {
    const metadata = await mapMetadata();
    expect(metadata.version).toBe(4);
    expect(metadata.playableBounds).toEqual(WORLD_MAP_PLAYABLE_BOUNDS);
    expect(metadata.imageBounds).toEqual(WORLD_MAP_IMAGE_BOUNDS);
    expect(metadata.sha256).toBe(WORLD_MAP_SOURCE_SHA256);
    expect(metadata.sourceImage.sha256).toBe(WORLD_MAP_SOURCE_SHA256);
    expect(metadata.sourceImage.width).toBe(metadata.width);
    expect(metadata.sourceImage.height).toBe(metadata.height);
    expect(metadata.renditions.minimap).toEqual(WORLD_MAP_MINIMAP_RENDITION);
    expect(metadata.renditions.detail).toEqual(WORLD_MAP_DETAIL_RENDITIONS);
    expect(metadata.renderFingerprint).toBe(WORLD_MAP_RENDITION_SET_FINGERPRINT);
    expect(WORLD_MAP_RENDER_FINGERPRINT).toBe(WORLD_MAP_RENDITION_SET_FINGERPRINT);

    const expectedFingerprint = createHash("sha256")
      .update(JSON.stringify({
        schemaVersion: metadata.version,
        sourceSha256: metadata.sha256,
        playableBounds: metadata.playableBounds,
        imageBounds: metadata.imageBounds,
        renditions: metadata.renditions,
      }))
      .digest("hex");
    expect(WORLD_MAP_RENDITION_SET_FINGERPRINT).toBe(expectedFingerprint);

    const sourceBytes = await readFile(publicFile(metadata.sourceImage.path));
    expect(sourceBytes.byteLength).toBe(metadata.sourceImage.bytes);
    expect(createHash("sha256").update(sourceBytes).digest("hex")).toBe(WORLD_MAP_SOURCE_SHA256);
  });

  it("orders pregenerated zoom levels largest-first without duplicate IDs or paths", () => {
    expect(WORLD_MAP_DETAIL_RENDITIONS.length).toBeGreaterThan(1);
    const ids = new Set<string>();
    const paths = new Set<string>();
    for (const [index, rendition] of WORLD_MAP_DETAIL_RENDITIONS.entries()) {
      expect(ids.has(rendition.id), rendition.id).toBe(false);
      expect(paths.has(rendition.path), rendition.path).toBe(false);
      ids.add(rendition.id);
      paths.add(rendition.path);
      const previous = WORLD_MAP_DETAIL_RENDITIONS[index - 1];
      if (!previous) continue;
      expect(previous.width).toBeGreaterThan(rendition.width);
      expect(previous.height).toBeGreaterThan(rendition.height);
      expect(previous.metresPerPixel).toBeLessThan(rendition.metresPerPixel);
    }
  });

  it("does not request detail imagery until the full-map canvas renders", () => {
    const requested: string[] = [];
    class FakeImage {
      decoding = "";
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(value: string) {
        requested.push(value);
      }
    }
    const context = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillStyle: "",
    };
    const canvas = {
      width: 1,
      height: 1,
      style: { width: "", height: "" },
      getContext: vi.fn(() => context),
    } as unknown as HTMLCanvasElement;
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    vi.stubGlobal("document", { baseURI: "https://example.test/Corealm/" });
    vi.stubGlobal("Image", FakeImage);

    const map = new WorldMapCanvas(canvas, {
      bounds: WORLD_MAP_PLAYABLE_BOUNDS,
      sample: () => ({ height: 0, normal: [0, 1, 0], regionId: "fallowmarch" }),
      roadPolylines: () => [],
    });
    map.resize(1_000, 600);
    map.centreOn([0, 0, 0], MAP_HOME_ZOOM);
    expect(requested).toEqual([]);

    map.render();
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain("/Corealm/generated/world-map-detail-4800.webp");
    expect(requested[0]).toContain(`v=${WORLD_MAP_DETAIL_RENDITIONS[0].sha256}`);
    expect(context.fillText).toHaveBeenCalledWith("Loading detailed map…", 500, 300);

    map.resetView();
    map.render();
    expect(requested).toHaveLength(2);
    expect(requested[1]).toContain("/Corealm/generated/world-map-detail-1200.webp");
  });

  it("retries a failed preferred level and shows a pregenerated fallback meanwhile", async () => {
    vi.useFakeTimers();
    const requested: string[] = [];
    const images: FakeImage[] = [];
    class FakeImage {
      decoding = "";
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor() {
        images.push(this);
      }

      set src(value: string) {
        requested.push(value);
      }
    }
    const context = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillStyle: "",
    };
    const canvas = {
      width: 1,
      height: 1,
      style: { width: "", height: "" },
      getContext: vi.fn(() => context),
    } as unknown as HTMLCanvasElement;
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    vi.stubGlobal("document", { baseURI: "https://example.test/Corealm/" });
    vi.stubGlobal("Image", FakeImage);

    const map = new WorldMapCanvas(canvas, {
      bounds: WORLD_MAP_PLAYABLE_BOUNDS,
      sample: () => ({ height: 0, normal: [0, 1, 0], regionId: "fallowmarch" }),
      roadPolylines: () => [],
    });
    map.resize(1_000, 600);
    map.centreOn([0, 0, 0], MAP_HOME_ZOOM);
    map.render();

    images[0]?.onerror?.();
    expect(requested).toHaveLength(2);
    expect(requested[1]).toContain("/Corealm/generated/world-map-detail-2400.webp");

    await vi.advanceTimersByTimeAsync(250);
    expect(requested).toHaveLength(3);
    expect(requested[2]).toContain("/Corealm/generated/world-map-detail-4800.webp");
  });
});
