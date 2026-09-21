/**
 * This process reads the repo's content. Import it for the side effect, first, before anything else:
 *
 *     import "./lib/repoContent.js";
 *
 * `game/src/content/resolvedCatalog.ts` holds no catalog of its own any more, because the client and
 * the local-play worker must be able to run on a catalog they fetched. So every process says where
 * its content comes from: a server installs its database's catalog, and everything that works
 * against the repo — tools, harnesses, devdocs, the test suite — installs the compiled one by
 * reaching this module before the first content import.
 *
 * It has to be the FIRST import in the entry file. ES modules evaluate depth first in source order,
 * so an import below a content import runs too late, and `resolvedCatalog.ts` throws instead of
 * quietly running on the wrong catalog. Installing twice is fine: the second one is a no-op.
 */
import "../../game/src/content/bundledCatalog.js";
