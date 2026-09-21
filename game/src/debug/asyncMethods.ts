/**
 * The `window.__gameDebug` methods that return a Promise.
 *
 * Local play runs in a worker, so anything that changes the simulation, or reads the world beyond
 * what is replicated to the page, is a round trip. Each of these resolves after the page's own store
 * shows the effect, which makes `await debug.giveItem(...)` followed by a read race free. Everything
 * not listed reads main-thread state (camera, renderer, UI, the replicated player) and stays
 * synchronous.
 *
 * This list is the contract between three things: the debug surface wraps exactly these,
 * `tools/codemods/await-debug-mutators.ts` awaits exactly these, and `tools/debug-await-lint.ts`
 * fails on a call to one of them that is not awaited. It imports nothing, so a tool can load it.
 */
export const ASYNC_DEBUG_METHODS = [
  // The session
  "reset", "saveNow", "getSaveBlob", "loadSaveBlob",
  // Time
  "setPaused", "setTimeScale", "advanceGameTime", "advanceTicks", "setCaptureMode",
  // The player
  "teleport", "giveItem", "removeItem", "clearInventory", "setEquipment", "setHealth", "setSkillLevel", "grantXp", "setCurrency", "setSeed",
  "setQuestStage", "setQuestState", "seedMagic",
  // The world
  "depleteNode", "forceRespawn", "killEntity", "spawnEntity", "despawnEntity",
  "getEntity", "getEntities", "listEntities", "findEntities", "getWorldState",
  // Poses that move the player
  "focusCamera", "focusPlayer", "focusEntity", "focusLocation", "setCameraPreset", "inspectPose",
  // Already asynchronous before the worker
  "callTool", "waitForView",
] as const;

export type AsyncDebugMethod = (typeof ASYNC_DEBUG_METHODS)[number];
