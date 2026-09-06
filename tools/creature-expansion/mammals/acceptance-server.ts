import { startGameServer } from "../../lib/server.js";

/**
 * Slice 05 acceptance server: the production Vite game with HMR disabled, so a concurrent worker's
 * or Codex's file write cannot reload the document in the middle of a hardware lifecycle proof.
 * PORT defaults to 4181 (this worktree's assigned port).
 */
const port = Number.parseInt(process.env["PORT"] ?? "", 10) || 4181;
const server = await startGameServer({ port, strictPort: true, logLevel: "info", hmr: false });
console.log(`Acceptance server (no HMR) at ${server.url}`);
const stop = async (): Promise<void> => { await server.close(); process.exit(0); };
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
await new Promise<void>(() => undefined);
