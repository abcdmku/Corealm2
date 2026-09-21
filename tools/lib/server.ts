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
      "No game is initialized. Follow AGENTS.md to create a brief, approve the PRD, and initialize game/index.html.",
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
      // `COREALM_TEST_PORT` pins the port for a machine where other sessions hold ranges of their own.
      port: options.port ?? (Number(process.env.COREALM_TEST_PORT) || 0),
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
