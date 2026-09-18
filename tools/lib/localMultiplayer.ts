import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer, preview, type Plugin } from "vite";
import { gameRoot, repoRoot } from "./paths.js";

type Mode = "dev" | "prod";
const CONFIG_PATH = "/__corealm_local_multiplayer.js";

export function localMultiplayerOptions(mode: Mode, args: readonly string[]) {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (["--lab", "--skip-build", "--help"].includes(flag)) { switches.add(flag); continue; }
    if (!["--web-port", "--world-port", "--data", "--capacity"].includes(flag)) throw new Error(`Unknown option: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    values.set(flag, value);
  }
  const number = (flag: string, fallback: number, min: number, max: number) => {
    const value = Number(values.get(flag) ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${flag} must be ${min} through ${max}`);
    return value;
  };
  if (mode === "dev" && switches.has("--skip-build")) throw new Error("--skip-build is only available in production mode");
  const webPort = number("--web-port", mode === "dev" ? 4173 : 4175, 0, 65535);
  const worldPort = number("--world-port", mode === "dev" ? 4180 : 4182, 0, 65535);
  if (webPort !== 0 && webPort === worldPort) throw new Error("Web and world ports must differ");
  const lab = switches.has("--lab");
  return { webPort, worldPort, lab, help: switches.has("--help"), skipBuild: switches.has("--skip-build"),
    capacity: number("--capacity", 200, 1, 200),
    data: resolve(repoRoot, values.get("--data") ?? `local-worlds/${mode}${lab ? "-lab" : ""}`),
    worldId: `local-${mode}${lab ? "-lab" : ""}` };
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolveExit => child.once("exit", () => resolveExit()));
  if (child.connected) child.send({ type: "shutdown" }, () => {});
  else child.kill();
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try { await exited; } finally { clearTimeout(timer); }
}

/** Each mode owns its web listener, one independent simulation process and one save directory. */
export async function startLocalMultiplayer(mode: Mode, args: readonly string[] = []) {
  const options = localMultiplayerOptions(mode, args);
  let child: ChildProcess | undefined;
  let web: { close(): Promise<void> } | undefined;
  let closing: Promise<void> | undefined;
  let resolveClosed!: () => void;
  const closed = new Promise<void>(resolveDone => { resolveClosed = resolveDone; });
  const onParentExit = () => { child?.kill(); };
  const close = () => closing ??= (async () => {
    try { if (child) await stopChild(child); }
    finally {
      try { await web?.close(); }
      finally { process.removeListener("exit", onParentExit); resolveClosed(); }
    }
  })();
  process.once("exit", onParentExit);
  const onSignal = () => { void close().catch(error => { console.error(error); process.exitCode = 1; }); };
  const onMessage = (message: unknown) => { if (message && typeof message === "object" && "type" in message && message.type === "shutdown") onSignal(); };
  process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal); process.on("message", onMessage);
  void closed.then(() => {
    process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal); process.removeListener("message", onMessage);
    if (process.connected) process.disconnect();
  });
  try {
    if (mode === "prod" && !options.skipBuild) {
      console.log("Building the production game...");
      child = spawn(process.execPath, ["--import", "tsx", "tools/build-game.ts"],
        { cwd: repoRoot, stdio: "inherit", windowsHide: true, env: { ...process.env, GAME_BASE: "/" } });
      await new Promise<void>((done, reject) => {
        child!.once("error", reject);
        child!.once("exit", code => code === 0 ? done() : reject(new Error(`Game build exited with code ${code}`)));
      });
      child = undefined;
    }
    if (closing) throw new Error("Startup cancelled");
    const releaseHtml = mode === "prod" ? await readFile(resolve(gameRoot, "dist/index.html"), "utf8") : "";
    let worldPort: number | undefined;
    const configTag = `<script src="${CONFIG_PATH}"></script>`;
    const plugin: Plugin = {
      name: "corealm-local-multiplayer",
      transformIndexHtml: () => [{ tag: "script", attrs: { src: CONFIG_PATH }, injectTo: "head-prepend" }],
      configureServer(server) { install(server.middlewares, false); },
      configurePreviewServer(server) { install(server.middlewares, true); },
    };
    const install = (middlewares: import("vite").Connect.Server, production: boolean) => {
      middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?")[0];
        if (pathname === CONFIG_PATH) {
          response.setHeader("Content-Type", "application/javascript");
          response.setHeader("Cache-Control", "no-store");
          if (worldPort === undefined) { response.writeHead(503).end("throw new Error('Local world is still starting');"); return; }
          response.end(`window.__COREALM_DEVELOPMENT_GUESTS__=true;window.__COREALM_MULTIPLAYER__=${JSON.stringify({ directoryUrl: `http://127.0.0.1:${worldPort}/worlds` })};`);
          return;
        }
        if (production && (pathname === "/" || pathname === "/index.html")) {
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(releaseHtml.replace("<head>", `<head>${configTag}`)); return;
        }
        next();
      });
    };
    const listener = { host: "127.0.0.1", port: options.webPort, strictPort: true };
    const app = mode === "dev"
      ? await createServer({ root: gameRoot, base: "/", plugins: [plugin], server: listener })
      : await preview({ root: gameRoot, base: "/", plugins: [plugin], preview: listener });
    web = app;
    if (closing) { await web.close(); throw new Error("Startup cancelled"); }
    if ("listen" in app) await app.listen();
    if (closing) { await web.close(); throw new Error("Startup cancelled"); }
    const address = app.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Game web server did not open a port");
    const origin = `http://127.0.0.1:${address.port}`;
    console.log(`Starting ${options.lab ? "lab" : "authored"} world. Saved characters: ${options.data}`);
    const env = { ...process.env }; delete env.COREALM_AUTH_MODULE;
    child = spawn(process.execPath, ["--import", "tsx", "tools/multiplayer-server.ts",
      ...(options.lab ? [] : ["--authored"]), "--development-guests", "--host", "127.0.0.1",
      "--port", String(options.worldPort), "--public-endpoint", `ws://127.0.0.1:${options.worldPort}/`,
      "--worlds", options.worldId, "--capacity", String(options.capacity), "--data", options.data, "--origins", origin],
    { cwd: repoRoot, stdio: ["ignore", "pipe", "inherit", "ipc"], windowsHide: true, env });
    const worldChild = child;
    worldPort = await new Promise<number>((ready, reject) => {
      const timer = setTimeout(() => reject(new Error("Local world startup timed out")), 180_000);
      const fail = (error: Error) => { clearTimeout(timer); reject(error); };
      worldChild.once("error", fail);
      worldChild.once("exit", code => {
        fail(new Error(`World server exited with code ${code}`));
        if (!closing) { process.exitCode = 1; void close(); }
      });
      let pending = "";
      worldChild.stdout!.on("data", chunk => {
        pending += String(chunk);
        const lines = pending.split("\n"); pending = lines.pop()!;
        for (const line of lines) {
          let message: { ready?: boolean; port?: number };
          try { message = JSON.parse(line); } catch { console.log(line); continue; }
          if (message.ready && Number.isInteger(message.port)) { clearTimeout(timer); ready(message.port!); }
        }
      });
    });
    if (closing) throw new Error("Startup cancelled");
    const url = `${origin}/${options.lab ? "index.html?mode=combat&multiplayer=1" : ""}`;
    return { url, worldPort, options, close, closed };
  } catch (error) { await close(); throw error; }
}

export async function runLocalMultiplayer(mode: Mode) {
  const args = process.argv.slice(2);
  if (localMultiplayerOptions(mode, args).help) {
    console.log(`npm run multiplayer:${mode} -- [--web-port PORT] [--world-port PORT] [--data DIRECTORY] [--capacity 1..200] [--lab]${mode === "prod" ? " [--skip-build]" : ""}`);
    return;
  }
  const server = await startLocalMultiplayer(mode, args);
  console.log(`\nOpen ${server.url}\n${server.options.lab ? "Enter" : "Worlds opens when loading finishes. Enter"} a guest character name, select the world and Join world.\nUse the same name to resume progress. Ctrl+C stops both servers.\n`);
  console.log(JSON.stringify({ ready: true, mode, url: server.url, worldPort: server.worldPort, capacity: server.options.capacity, data: server.options.data }));
  await server.closed;
}
