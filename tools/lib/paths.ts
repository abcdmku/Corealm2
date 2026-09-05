import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

export const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const gameRoot = path.join(repoRoot, "game");
export const runsRoot = path.join(repoRoot, "runs");

export function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function resolveInside(base: string, candidate: string): string {
  const resolved = path.resolve(repoRoot, candidate);
  const relative = path.relative(base, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path must stay inside ${base}: ${candidate}`);
  }
  return resolved;
}

export async function prepareRun(candidate: string): Promise<string> {
  const runDir = resolveInside(runsRoot, candidate);
  await mkdir(path.join(runDir, "screenshots"), { recursive: true });
  await mkdir(path.join(runDir, "test-results"), { recursive: true });
  return runDir;
}

export function safeName(value: string): string {
  const name = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!name || name === "." || name === "..") throw new Error(`Invalid name: ${value}`);
  return name;
}
