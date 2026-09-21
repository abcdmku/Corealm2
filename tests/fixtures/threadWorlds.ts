import { existsSync } from "node:fs";
import type { WorldDescriptor } from "../../game/src/contracts.js";
import type { HeadlessWorldPorts } from "../../game/src/multiplayer/headlessWorld.js";
import { createMultiplayerLabWorld } from "../../game/src/multiplayer/labWorld.js";

/**
 * Lab worlds for a server that runs a thread per world, where a test cannot reach into a world. One
 * of them can be told, by a file appearing, to die the way a bug would (an uncaught error in its
 * thread) or to stop answering for a while (its thread blocked).
 */
export interface ThreadWorldOptions { worldId: string; crashFlag?: string; stallFlag?: string; stallMs?: number }

export default async function build(world: WorldDescriptor, options?: ThreadWorldOptions): Promise<HeadlessWorldPorts> {
  const ports = await createMultiplayerLabWorld(world.seed);
  if (options?.worldId !== world.worldId) return ports;
  let stalled = false;
  setInterval(() => {
    // A flag that is still there when the world is started again kills it again. The test takes it away first.
    if (options.crashFlag && existsSync(options.crashFlag)) throw new Error(`The ${world.worldId} world was told to crash`);
    if (options.stallFlag && !stalled && existsSync(options.stallFlag)) { stalled = true; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, options.stallMs ?? 1000); }
  }, 20).unref();
  return ports;
}
