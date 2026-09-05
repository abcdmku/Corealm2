import { startGameServer } from "./lib/server.js";

/**
 * 4173 by default, overridable with PORT.
 *
 * `strictPort` is deliberate — a dev server that silently wanders to another port breaks every
 * bookmark and every "open localhost:4173" instruction. But this repo is worked in through git
 * WORKTREES, and two worktrees each running `npm run dev` is an ordinary situation rather than a
 * mistake: the second one used to die with a bare "Port 4173 is already in use" and no way forward
 * short of killing a server that belongs to somebody else's checkout.
 */
const port = Number.parseInt(process.env["PORT"] ?? "", 10) || 4173;
const server = await startGameServer({ port, strictPort: true, logLevel: "info", hmr: true });
console.log(`Game available at ${server.url}`);

const stop = async (): Promise<void> => {
  await server.close();
  process.exit(0);
};

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
await new Promise<void>(() => undefined);
