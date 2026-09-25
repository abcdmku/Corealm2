import { spawn, type ChildProcess } from "node:child_process";
import { repoRoot } from "../../tools/lib/paths.js";

/**
 * `tools/multiplayer-server.ts` in a process of its own. The content modules read their tables as
 * they load, so only a fresh process proves which catalog a server starts on, or that it refused one.
 * `stop` is idempotent; push it to the test's cleanups.
 */
export function startServerProcess(args: readonly string[]) {
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "tools/multiplayer-server.ts", ...args],
    { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  const lines: Record<string, unknown>[] = []; let pending = "", stderr = "";
  const take = (text: string) => { for (const part of text.split("\n")) try { lines.push(JSON.parse(part)); } catch { /* not a log line */ } };
  child.stderr!.on("data", chunk => { stderr += String(chunk); });
  child.stdout!.on("data", chunk => { pending += String(chunk); const parts = pending.split("\n"); pending = parts.pop()!; take(parts.join("\n")); });
  const exited = new Promise<number | null>(done => child.once("exit", code => { take(stderr); done(code); }));
  const ready = new Promise<Record<string, unknown>>((done, fail) => {
    const poll = setInterval(() => { const line = lines.find(entry => entry.ready === true); if (line) { clearInterval(poll); done(line); } }, 20);
    void exited.then(code => { clearInterval(poll); fail(new Error(`The server exited with code ${code} before it was ready\n${stderr}`)); });
  });
  ready.catch(() => {});
  const stop = async () => { if (child.exitCode === null) { if (child.connected) child.send({ type: "shutdown" }); else child.kill(); await exited; } };
  return { lines, ready, exited, stop, stderr: () => stderr };
}
