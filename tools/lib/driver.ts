import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { RunningGameServer } from "./server.js";
import { safeName } from "./paths.js";
import type {} from "./debug-api.js";

export interface RuntimeSnapshot {
  state: unknown;
  player: unknown;
  playerPosition: unknown;
  camera: unknown;
  entities: unknown;
  currentActivity: unknown;
  objectives: unknown;
  navigation: unknown;
}

export type SnapshotProfile = "lean" | "full";

/** Shared low-cost renderer preferences for semantic browser checks. */
export const FAST_TEST_SETTINGS = {
  renderScale: 0.7,
  shadowQuality: "off",
  drawDistance: "near",
  damageNumbers: true,
  invertCameraY: false,
  uiScale: "normal",
  music: 0,
  ambient: 0,
  sfx: 0,
} as const;

export interface DriverOptions {
  mobile?: boolean;
  headless?: boolean;
  viewport?: { width: number; height: number };
  /** Optional browser launch flags. Deterministic gameplay checks keep the SwiftShader default. */
  browserArgs?: string[];
  /**
   * Client preferences seeded into `localStorage` before the page loads.
   *
   * `ui/settings.ts` reads its store during construction, so a tool that wants the renderer to come
   * up at a lower setting has to write the blob BEFORE navigation — setting it afterwards means a
   * reload, and a reload costs another full boot (16.7 s measured here). Semantic smoke/play and
   * effect verification all use this hook; visual capture deliberately retains production quality.
   */
  settings?: Record<string, unknown>;
}

export class GameDriver {
  readonly consoleErrors: string[] = [];
  readonly pageErrors: string[] = [];
  readonly requestErrors: string[] = [];

  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  page: Page | undefined;

  constructor(
    private readonly server: RunningGameServer,
    private readonly options: DriverOptions = {},
  ) {}

  async launch(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.options.headless ?? true,
      // `COREALM_HARDWARE=1` runs any driver tool on the GPU, for a machine where software rendering cannot finish the authored world's first frame.
      args: this.options.browserArgs ?? (process.env.COREALM_HARDWARE === "1"
        ? ["--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio", ...(process.platform === "win32" ? ["--use-angle=d3d11"] : [])]
        : ["--enable-unsafe-swiftshader", "--mute-audio"]),
    });
    this.context = await this.browser.newContext({
      viewport: this.options.viewport ?? { width: 1280, height: 720 },
      deviceScaleFactor: this.options.mobile ? 2 : 1,
      isMobile: this.options.mobile ?? false,
      hasTouch: this.options.mobile ?? false,
    });
    const settings = this.options.settings;
    if (settings) {
      await this.context.addInitScript((blob: string) => {
        globalThis.localStorage?.setItem("corealm.settings.v1", blob);
      }, JSON.stringify(settings));
    }
    this.page = await this.context.newPage();
    this.page.on("console", (message) => {
      if (message.type() === "error") this.consoleErrors.push(message.text().slice(0, 1000));
    });
    this.page.on("pageerror", (error) => this.pageErrors.push(String(error).slice(0, 1000)));
    this.page.on("requestfailed", (request) => {
      this.requestErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`);
    });
  }

  /**
   * Opens a game route and waits for the debug surface to report ready.
   *
   * Every route gets `play=local` unless it already names a target. The loading screen always shows
   * the world picker now, and a run that never answers it finishes boot with the worlds menu open
   * over the game — so a harness that means "the single-player game, as it has always been" has to
   * say so. This is the one place the 70-odd `open()` callers say it.
   */
  async open(timeoutMs = 20_000, route = "/"): Promise<void> {
    const page = this.requirePage();
    const url = new URL(route, this.server.url);
    if (url.origin !== new URL(this.server.url).origin) throw new Error("Game route must use the server origin");
    if (!url.searchParams.has("play")) url.searchParams.set("play", "local");
    await page.goto(url.href, { waitUntil: "load", timeout: timeoutMs });
    await page.waitForFunction(
      () => window.__gameDebug?.getState().ready === true,
      undefined,
      { timeout: timeoutMs },
    );
    await this.wait(150);
  }

  async wait(ms: number): Promise<void> {
    await this.requirePage().waitForTimeout(ms);
  }

  async press(key: string, holdMs = 0): Promise<void> {
    const keyboard = this.requirePage().keyboard;
    if (holdMs > 0) {
      await keyboard.down(key);
      try { await this.wait(holdMs); }
      finally { await keyboard.up(key); }
      return;
    }
    await keyboard.press(key);
  }

  async click(x: number, y: number, button: "left" | "right" | "middle" = "left"): Promise<void> {
    await this.requirePage().mouse.click(x, y, { button });
  }

  async drag(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    button: "left" | "right" | "middle" = "left",
  ): Promise<void> {
    const mouse = this.requirePage().mouse;
    await mouse.move(x1, y1);
    await mouse.down({ button });
    try { await mouse.move(x2, y2, { steps: 12 }); }
    finally { await mouse.up({ button }); }
  }

  async moveMouse(x: number, y: number): Promise<void> {
    await this.requirePage().mouse.move(x, y, { steps: 8 });
  }

  /**
   * Calls a `window.__gameDebug` method and returns its JSON-safe result.
   *
   * The result is awaited before serialising. Every method that changes the simulation or reads the
   * whole world is async (`game/src/debug/asyncMethods.ts`), because local play runs in a worker, and
   * each resolves only after this page's state shows the effect. So a `callDebug` write followed by a
   * `callDebug` read needs no wait between them. `JSON.stringify` of a pending Promise is `{}`, which
   * is why an inline `page.evaluate` must await these too; `tools/debug-await-lint.ts` checks that.
   */
  async callDebug(method: string, args: unknown[] = []): Promise<unknown> {
    return this.requirePage().evaluate(
      async ({ methodName, methodArgs }) => {
        const api = window.__gameDebug as unknown as Record<string, unknown> | undefined;
        const fn = api?.[methodName];
        if (!api || !Object.hasOwn(api, methodName) || typeof fn !== "function") throw new Error(`window.__gameDebug.${methodName} is not a function`);
        const value = await (fn as (...values: unknown[]) => unknown).apply(api, methodArgs);
        return JSON.parse(JSON.stringify(value ?? null));
      },
      { methodName: method, methodArgs: args },
    );
  }

  /**
   * Capture semantic state. Entity detail is opt-in because a full world contains thousands of
   * rows and used to make every scripted action transfer and persist several megabytes twice.
   */
  async snapshot(profile: SnapshotProfile = "lean"): Promise<RuntimeSnapshot> {
    return this.requirePage().evaluate(async (includeEntities) => {
      const api = window.__gameDebug;
      if (!api) throw new Error("window.__gameDebug is missing");
      return JSON.parse(JSON.stringify({
        state: api.getState(),
        player: api.getPlayer(),
        playerPosition: api.getPlayerPosition(),
        camera: api.getCamera(),
        // The whole world, which only the host holds: local play runs in a worker and replicates what is near the player.
        entities: includeEntities ? await api.getEntities() : null,
        currentActivity: api.getCurrentActivity(),
        objectives: api.getObjectives(),
        navigation: api.getNavigationState(),
      })) as RuntimeSnapshot;
    }, profile === "full");
  }

  /**
   * A stalled capture must fail within the lab feedback budget.
   *
   * The budget stays 5 s. `COREALM_SCREENSHOT_TIMEOUT_MS` raises it for a run that shares the
   * machine with other browser sessions: measured on this box with 35 Chromium processes and 73%
   * CPU, one full-game capture took 26.6 s and still produced a correct image, so the 5 s ceiling
   * was reporting contention rather than a stall. Nothing sets this by default.
   */
  async screenshot(directory: string, name: string): Promise<string> {
    const file = path.join(directory, `${safeName(name)}.png`);
    const budget = Number(process.env.COREALM_SCREENSHOT_TIMEOUT_MS ?? 5_000);
    await this.requirePage().screenshot({
      path: file, type: "png", timeout: Number.isFinite(budget) && budget > 0 ? budget : 5_000,
      animations: "disabled",
    });
    return file;
  }

  async reset(): Promise<void> {
    await this.callDebug("reset");
  }

  async reload(): Promise<void> {
    await this.requirePage().reload({ waitUntil: "load" });
    await this.requirePage().waitForFunction(() => window.__gameDebug?.getState().ready === true);
    await this.wait(150);
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
  }

  private requirePage(): Page {
    if (!this.page) throw new Error("GameDriver.launch() must run first");
    return this.page;
  }
}
