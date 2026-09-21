/**
 * Every test runs on the catalog compiled into the repo.
 *
 * `content/resolvedCatalog.ts` no longer imports the compiled JSON itself, so a process that reads
 * content declares where the content came from. For the suite that is always the build, and it has
 * to be installed before the first content module evaluates — which, for a test file, is before its
 * own imports run. Vitest evaluates `setupFiles` first, so this one line is the whole answer, and
 * `tests/content-install-order.test.ts` checks what happens to a process that skips it.
 */
import "./game/src/content/bundledCatalog.js";
