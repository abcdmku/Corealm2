import type { Frame, Page } from "playwright";

/**
 * `page.waitForFunction` for a predicate that awaits.
 *
 * Playwright polls a `waitForFunction` predicate and tests what it returns without awaiting it, so
 * an `async` predicate, or one that returns `__gameDebug.getEntity(...)`, is a promise, which is
 * truthy, and the wait ends on its first poll having checked nothing. The asynchronous debug methods
 * (`game/src/debug/asyncMethods.ts`) make that an easy mistake, and `tools/debug-await-lint.ts` sends
 * every such predicate here.
 *
 * This evaluates the predicate in the page, awaits it there, and polls until it is truthy. It
 * resolves with the value, which must be JSON-serialisable, as `page.evaluate` requires.
 */
export async function waitForDebug<Arg, Result>(page: Page | Frame, predicate: (arg: Arg) => Result | Promise<Result>, arg?: Arg,
  options: { timeout?: number; polling?: number | "raf" } = {}): Promise<NonNullable<Awaited<Result>>> {
  const timeout = options.timeout ?? 30_000, every = typeof options.polling === "number" ? options.polling : 50;
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await page.evaluate(predicate as never, arg as never) as Awaited<Result>;
    if (value) return value as NonNullable<Awaited<Result>>;
    if (timeout > 0 && Date.now() >= deadline) throw new Error(`waitForDebug: the predicate was not truthy within ${timeout} ms`);
    await new Promise(resolve => setTimeout(resolve, every));
  }
}
