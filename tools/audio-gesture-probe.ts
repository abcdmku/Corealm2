/**
 * Plays the game under a phone's autoplay policy and reports whether audio ever starts.
 *
 * Chrome on Android only lets an AudioContext leave `suspended` when `resume()` is called while the
 * document has user activation; a `resume()` made without it returns a promise that never settles.
 * Desktop Chrome does not enforce this (the Media Engagement Index gives localhost a free pass) and
 * headless Chromium ignores `--autoplay-policy` altogether, so the policy is simulated here in the
 * page instead of asked for on the command line. Everything below the shim is the real engine.
 *
 * Usage: npx tsx tools/audio-gesture-probe.ts [--url http://127.0.0.1:4179/index.html] [--permissive]
 */
import { chromium, type Page } from "playwright";

const args = process.argv.slice(2);
const urlArg = args.indexOf("--url");
const url = urlArg >= 0 ? args[urlArg + 1]! : "http://127.0.0.1:4179/index.html";
const permissive = args.includes("--permissive");

/**
 * Passed to `addInitScript` as source text on purpose: a function argument is compiled by tsx
 * first, and esbuild's `__name` helper does not exist in the page.
 */
const probeInit = (enforce: boolean): string => `
localStorage.setItem("corealm.settings.v1", JSON.stringify({
  touchControls: "on", renderScale: 0.6, shadowQuality: "off", drawDistance: "near"
}));
window.__audioLog = [];
window.__probeContexts = [];
var ENFORCE = ${enforce ? "true" : "false"};
var NativeAudioContext = window.AudioContext;
function log(line) { window.__audioLog.push(Math.round(performance.now()) + "ms " + line); }
function ProbedAudioContext(options) {
  var context = new NativeAudioContext(options);
  window.__probeContexts.push(context);
  var gateOpen = !ENFORCE;
  log("construct state=" + context.state + (ENFORCE ? " (policy: blocked until a gesture resumes it)" : ""));
  if (ENFORCE) {
    Object.defineProperty(context, "state", {
      configurable: true,
      get: function () { return gateOpen ? "running" : "suspended"; },
    });
  }
  var nativeResume = NativeAudioContext.prototype.resume.bind(context);
  context.resume = function () {
    var active = navigator.userActivation ? navigator.userActivation.isActive : true;
    log("resume() called, userActivation=" + active);
    if (!ENFORCE || active) {
      gateOpen = true;
      return nativeResume().then(function () { log("resume() resolved, context running"); });
    }
    // Chrome's actual behaviour for a gesture-less resume: no rejection, no resolution, ever.
    log("resume() ignored (no user activation) — promise left pending, as Chrome on Android does");
    return new Promise(function () {});
  };
  return context;
}
ProbedAudioContext.prototype = NativeAudioContext.prototype;
window.AudioContext = ProbedAudioContext;
window.webkitAudioContext = ProbedAudioContext;
`;

async function report(page: Page, label: string): Promise<void> {
  const snapshot = await page.evaluate(`(function () {
    var api = window.__gameDebug;
    return {
      audio: api && api.getAudioState ? api.getAudioState() : null,
      log: window.__audioLog || [],
      history: api && api.getAudioHistory ? api.getAudioHistory(6) : [],
    };
  })()`) as { audio: Record<string, unknown> | null; log: string[]; history: unknown[] };
  console.log(`\n=== ${label} ===`);
  const audio = snapshot.audio;
  if (audio) {
    console.log(`unlocked=${audio["unlocked"]} cachedBuffers=${audio["cachedBuffers"]}`);
    console.log(`activeLoops=${JSON.stringify(audio["activeLoops"])} desiredLoops=${JSON.stringify(audio["desiredLoops"])}`);
    console.log(`diagnostics=${JSON.stringify(audio["diagnostics"])}`);
    console.log(`played: ${JSON.stringify(snapshot.history)}`);
  } else {
    console.log("getAudioState() unavailable");
  }
  for (const line of snapshot.log) console.log(`  | ${line}`);
}

const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await context.addInitScript({ content: probeInit(!permissive) });

const page = await context.newPage();
page.on("pageerror", (error) => console.log(`[pageerror] ${String(error).slice(0, 300)}`));
console.log(`policy=${permissive ? "permissive (desktop-like)" : "user-gesture-required (phone-like)"}`);
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, undefined, { timeout: 180_000 });
await page.waitForTimeout(3000);
await report(page, "after boot, BEFORE any gesture");

await page.touchscreen.tap(206, 700);
await page.waitForTimeout(4000);
await report(page, "after the first tap");

await page.touchscreen.tap(206, 480);
await page.waitForTimeout(5000);
await report(page, "after a second tap");

await browser.close();
