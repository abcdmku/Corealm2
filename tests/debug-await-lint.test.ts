import { expect, it } from "vitest";
import { lintFiles, lintText } from "../tools/debug-await-lint.js";

/**
 * `window.__gameDebug` methods that change the simulation or read the whole world are asynchronous,
 * because local play runs in a worker, and so are the lab surfaces' (`window.__featureLab` and the
 * rest of `game/src/featureLab/asyncMethods.ts`), because the labs do too. This holds every tool and
 * test to awaiting them, and proves the lint sees the shapes that matter.
 */
it("finds an un-awaited debug call, a polled one, and a dropped callDebug, and passes the awaited forms", () => {
  const messages = (code: string): string[] => lintText("tools/example.ts", code).map(violation => `${violation.line}: ${violation.message}`);
  expect(messages(`await page.evaluate(() => { const d = (window as any).__gameDebug; d.giveItem("x", 1); return d.getState(); });`)).toEqual([
    "1: __gameDebug.giveItem() is asynchronous and is not awaited"]);
  expect(messages(`await page.evaluate(() => JSON.parse(window.__gameDebug.getSaveBlob()));`)).toHaveLength(1);
  // A receiver that cannot be traced to the debug surface still counts inside a page callback.
  expect(messages(`const handle = await page.evaluateHandle(() => window.__gameDebug);
await page.evaluate((debug: Debug) => debug.getEntity("a").position, handle);`)).toEqual([
    "2: __gameDebug.getEntity() is asynchronous and is not awaited"]);
  expect(messages(`await page.evaluate(name => (window.__gameDebug as any)[name]("a").length, "getEntity");`)).toEqual(["1: a computed __gameDebug method is asynchronous and is not awaited"]);
  expect(messages(`await page.waitForFunction(async id => (await window.__gameDebug.getEntity(id))?.state === "dead", id);`)[0]).toMatch(/waitForFunction never awaits its predicate/);
  expect(messages(`driver.callDebug("teleport", [[0, 0, 0]]);\nawait driver.callDebug("getState");`)).toEqual([`1: callDebug("teleport") is a promise that nothing awaits`]);

  expect(messages(`await page.evaluate(async () => { const d = (window as any).__gameDebug; await d.giveItem("x", 1); return (await d.getEntity("a"))?.position; });`)).toEqual([]);
  expect(messages(`await page.evaluate(() => window.__gameDebug.getSaveBlob());`)).toEqual([]);
  expect(messages(`await page.evaluate(async () => { await window.__gameDebug.callTool("x", {}).catch(() => null); });`)).toEqual([]);
  expect(messages(`await waitForDebug(page, async id => (await window.__gameDebug.getEntity(id))?.state === "dead", id);`)).toEqual([]);
  expect(messages(`await page.evaluate(() => window.__gameDebug.getState().ready && window.__gameDebug.getPlayerPosition());`)).toEqual([]);
  expect(messages(`// debug-await-lint: ignore, fire and forget on purpose\nawait page.evaluate(() => { void (window as any).__gameDebug.teleport([0, 0, 0]); });`)).toEqual([]);
});

it("reads page scripts kept in strings", () => {
  const messages = (code: string): string[] => lintText("tools/example.ts", code).map(violation => `${violation.line}: ${violation.message}`);
  // What the script evaluates to is awaited by Playwright. Anything before that is not.
  expect(messages("await page.evaluate(\"window.__gameDebug.setPaused(true)\");")).toEqual([]);
  expect(messages("await page.evaluate(`(async () => { const d = window.__gameDebug; await d.teleport([0, 0, ${z}]); return d.getState(); })()`);")).toEqual([]);
  expect(messages("await page.evaluate(`(() => { const d = window.__gameDebug; d.teleport([0, 0, ${z}]); return d.getState(); })()`);")).toEqual([
    "1: __gameDebug.teleport() is asynchronous and is not awaited"]);
  expect(messages("await page.evaluate(`window.__gameDebug.listEntities().find(e => e.archetype === \"loot\")?.id`);")).toHaveLength(1);
  expect(messages("await page.waitForFunction(\"window.__gameDebug.getEntity('a')\");")[0]).toMatch(/waitForFunction never awaits/);
});

it("holds the lab surfaces to their own lists, by receiver", () => {
  const messages = (code: string): string[] => lintText("tools/example.ts", code).map(violation => `${violation.line}: ${violation.message}`);
  expect(messages(`await page.evaluate(() => { window.__featureLab.setLevel("melee", 5); });`)).toEqual(["1: __featureLab.setLevel() is asynchronous and is not awaited"]);
  expect(messages(`await page.evaluate(async () => { await window.__featureLab.setLevel("melee", 5); });`)).toEqual([]);
  expect(messages(`await page.evaluate(() => window.__featureLab!.setLevel("melee", 5));`)).toEqual([]);
  // `getState` is synchronous on the feature lab, and so are the page-only switches.
  expect(messages(`await page.evaluate(() => { const lab = (window as any).__featureLab; lab.setWalkingEnabled(true); lab.setFreeCameraEnabled(false); lab.setPlayerVisible(true); return lab.getState(); });`)).toEqual([]);
  expect(messages(`await page.evaluate(() => { const lab = window.__featureLab!; lab.setSpell("stonebrand"); return lab.getState(); });`)).toEqual([
    "1: __featureLab.setSpell() is asynchronous and is not awaited"]);
  // A hosted fixture lives in the worker whole: even its `getState` is a round trip.
  expect(messages(`await page.evaluate(() => { const fixture = (window as any).__creatureLootFixture; const state = fixture.getState(); return state.ready; });`)).toEqual([
    "1: __creatureLootFixture.getState() is asynchronous and is not awaited"]);
  expect(messages(`await page.evaluate(async () => { const fixture = (window as any).__creatureLootFixture; return (await fixture.getState()).ready; });`)).toEqual([]);
  expect(messages(`await page.evaluate(() => { const w = window as any; w.__agilityLab.prepare(); return w.__agilityLab.getState().lanes; });`)).toEqual([
    "1: __agilityLab.prepare() is asynchronous and is not awaited", "1: __agilityLab.getState() is asynchronous and is not awaited"]);
  // The same name is a different surface in the next callback.
  expect(messages(`await page.evaluate(() => { const lab = window.__featureLab!; return lab.getState(); });
await page.evaluate(() => { const lab = (window as any).__agilityLab; return lab.getState().lanes; });`)).toEqual(["2: __agilityLab.getState() is asynchronous and is not awaited"]);
  // A debug method name on a lab local is the lab's, and the lab has no `teleport`.
  expect(messages(`await page.evaluate(() => { const lab = window.__featureLab!; lab.teleport([0, 0, 0]); });`)).toEqual([]);
  expect(messages(`await page.waitForFunction(() => (window as any).__agilityLab.getState().activity === null);`)).toEqual([
    "1: __agilityLab.getState() is asynchronous, and waitForFunction never awaits its predicate: use waitForDebug from tools/lib/wait-for-debug.ts"]);
  expect(messages(`await page.waitForFunction(() => window.__featureLab!.getState().ready);`)).toEqual([]);
  expect(messages(`await waitForDebug(page, async () => (await (window as any).__agilityLab.getState()).activity === null);`)).toEqual([]);
  expect(messages("await page.evaluate(`(() => { window.__environmentLab.showSite(\"${site}\"); return window.__environmentLab.getState(); })()`);")).toEqual([
    "1: __environmentLab.showSite() is asynchronous and is not awaited"]);
  expect(messages("await page.waitForFunction(\"window.__environmentLab?.getState().ready\");")).toEqual([]);
  expect(messages(`throw new Error("__regionalTierFixture.prepare() is not exposed by the lab boot");`)).toEqual([]);
});

it("finds nothing to report under tools/ and tests/",async () => {
  expect((await lintFiles()).map(violation => `${violation.file}:${violation.line} ${violation.message}`)).toEqual([]);
}, 120_000);
