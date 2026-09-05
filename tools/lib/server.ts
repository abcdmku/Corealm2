import path from "node:path";
import { access } from "node:fs/promises";
import { createServer, type LogLevel, type ViteDevServer } from "vite";
import { gameRoot } from "./paths.js";

export interface RunningGameServer {
  url: string;
  close(): Promise<void>;
}

export interface GameServerOptions {
  port?: number;
  strictPort?: boolean;
  logLevel?: LogLevel;
  /** Acceptance runs keep one document stable while other workers edit. */
  hmr?: boolean;
}

export async function assertGameInitialized(): Promise<void> {
  try {
    await access(path.join(gameRoot, "index.html"));
  } catch {
    throw new Error(
      "No game is initialized. Create a brief, run `npm run game-agent -- build <brief> --id <run-id>`, then follow AGENTS.md to produce the PRD and game foundation.",
    );
  }
}

export async function startGameServer(options: GameServerOptions = {}): Promise<RunningGameServer> {
  await assertGameInitialized();
  const vite: ViteDevServer = await createServer({
    root: gameRoot,
    logLevel: options.logLevel ?? "error",
    server: {
      host: "127.0.0.1",
      port: options.port ?? 0,
      strictPort: options.strictPort ?? false,
      hmr: options.hmr ?? false,
    },
  });
  await vite.listen();

  const address = vite.httpServer?.address();
  if (!address || typeof address === "string") {
    await vite.close();
    throw new Error("Vite did not expose a local TCP port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => vite.close(),
  };
}
