import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";

/** Production host in its own process, so Vite/browser tooling cannot share its simulation thread. */
export async function startAuthoredTestHost(startupTimeoutMs = 45_000) {
  const directory = await mkdtemp(join(tmpdir(), "corealm-authored-"));
  const child = spawn(process.execPath, ["--import", "tsx", "tools/multiplayer-server.ts", "--authored",
    "--development-guests", "--port", "0", "--worlds", "authored", "--data", directory],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const stopOnExit = () => { if (child.exitCode === null) child.kill(); };
  process.once("exit", stopOnExit);
  let stderr = ""; child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-4000); });
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    process.removeListener("exit", stopOnExit);
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("corealm-authored-"))
      throw new Error("Refusing cleanup outside the authored test directory");
    await rm(directory, { recursive: true, force: true });
  };
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Authored host startup timed out: ${stderr}`)), startupTimeoutMs);
      let stdout = "";
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`Authored host exited ${code}: ${stderr}`)); });
      child.stdout.on("data", chunk => {
        stdout += String(chunk);
        const lines = stdout.split("\n"); stdout = lines.pop()!;
        for (const line of lines) {
          try { const value = JSON.parse(line); if (value.ready && Number.isInteger(value.port)) { clearTimeout(timer); resolve(value.port); } } catch {}
        }
      });
    });
    return { port, close };
  } catch (error) { await close(); throw error; }
}
