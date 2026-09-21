/**
 * The lab surfaces on `window` whose methods return a Promise, and which methods those are.
 *
 * A lab world runs in the lab worker, so anything that changes the simulation is a round trip on the
 * worker's debug channel (`worker/labProtocol.ts`). Each of these resolves after this page's own
 * replicated state shows the effect, which makes `await lab.setLevel(...)` followed by
 * `lab.getState()` race free. Everything not listed reads page state (the replicated store and
 * entity set, the camera, the renderer) or changes only the page (walking, visibility, the free
 * camera) and stays synchronous.
 *
 * `"*"` means every method: the surface is a remote one, hosted whole by the worker, and even its
 * `getState` is a round trip.
 *
 * Like `debug/asyncMethods.ts`, this list is a contract between three things: the surfaces return
 * promises from exactly these, `tools/codemods/await-debug-mutators.ts` awaits exactly these, and
 * `tools/debug-await-lint.ts` fails on a call to one of them that is not awaited, or that sits in a
 * `page.waitForFunction` predicate. It imports nothing, so a tool can load it.
 */
export const ASYNC_LAB_METHODS = {
  __featureLab: ["setStructure", "fitStructure", "spawnTarget", "setLevel", "equipPlayer", "setSpell", "perform"],
  __environmentLab: ["showGallery", "showFoliage", "showSite", "showCutFace", "showPortal", "dispose"],
  __creatureGallery: ["show", "place", "dispose"],
  __agilityLab: ["prepare", "setLevel", "getState", "setLandingAvailable"],
  __dungeonDoorLab: ["setState"],
  __huntLab: ["refreshOffers", "accept", "claim", "abandon", "attack"],
  __regionalTierFixture: "*",
  __creatureLootFixture: "*",
  __questRecoveryLab: "*",
  __gameplayAcceptance: "*",
} as const satisfies Record<string, readonly string[] | "*">;

export type AsyncLabSurface = keyof typeof ASYNC_LAB_METHODS;
