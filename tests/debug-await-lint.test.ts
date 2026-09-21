import { expect, it } from "vitest";
import { lintFiles, lintText } from "../tools/debug-await-lint.js";

/**
 * `window.__gameDebug` methods that change the simulation or read the whole world are asynchronous,
 * because local play runs in a worker. This holds every tool and test to awaiting them, and proves
 * the lint sees the shapes that matter.
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

it("finds nothing to report under tools/ and tests/", async () => {
  expect((await lintFiles()).map(violation => `${violation.file}:${violation.line} ${violation.message}`)).toEqual([]);
}, 120_000);
