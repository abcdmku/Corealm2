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
      args: this.options.browserArgs ?? ["--enable-unsafe-swiftshader", "--mute-audio"],
    });
    this.context = await this.browser.newContext({
      viewport: this.options.viewport ?? { width: 1280, height: 720 },
      deviceScaleFactor: 1,
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

  async open(timeoutMs = 20_000, route = "/"): Promise<void> {
    const page = this.requirePage();
    const url = new URL(route, this.server.url);
    if (url.origin !== new URL(this.server.url).origin) throw new Error("Game route must use the server origin");
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
   * The result is awaited before serialising. Several debug helpers are genuinely async — most
   * importantly `callTool`, which drives the agent surface — and `JSON.stringify` of a pending
   * Promise is `{}`. Without the await every async call silently returned an empty object, which
   * looks like a passing step because the side effect still happened.
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
    return this.requirePage().evaluate((includeEntities) => {
      const api = window.__gameDebug;
      if (!api) throw new Error("window.__gameDebug is missing");
      return JSON.parse(JSON.stringify({
        state: api.getState(),
        player: api.getPlayer(),
        playerPosition: api.getPlayerPosition(),
        camera: api.getCamera(),
        entities: includeEntities ? api.getEntities() : null,
        currentActivity: api.getCurrentActivity(),
        objectives: api.getObjectives(),
        navigation: api.getNavigationState(),
      })) as RuntimeSnapshot;
    }, profile === "full");
  }

  /** A stalled capture must fail within the lab feedback budget. */
  async screenshot(directory: string, name: string): Promise<string> {
    const file = path.join(directory, `${safeName(name)}.png`);
    await this.requirePage().screenshot({
      path: file, type: "png", timeout: 5_000, animations: "disabled",
    });
    return file;
  }

  async reset(): Promise<void> {
    await this.callDebug("reset");
    await this.wait(150);
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
