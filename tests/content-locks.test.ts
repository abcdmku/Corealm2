import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { atomicReplaceFile } from "../tools/lib/atomic-replace-file.js";
import { withFileLock } from "../tools/content/locks.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    if (path.resolve(path.dirname(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("corealm-content-lock-")) {
      throw new Error(`Unsafe test cleanup path: ${directory}`);
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "corealm-content-lock-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

describe("content file locks", () => {
  it("serializes atomic temp-file updates and removes the lock directory", async () => {
    const directory = await temporaryDirectory();
    const file = path.join(directory, "nested", "content.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "0", "utf8");

    const events: string[] = [];
    const update = async (name: string, holdMs: number): Promise<number> => withFileLock(file, async () => {
      const before = Number(await fs.readFile(file, "utf8"));
      events.push(`${name}:start:${before}`);
      await delay(holdMs);
      const after = before + 1;
      await atomicReplaceFile(file, String(after));
      events.push(`${name}:end:${after}`);
      return after;
    });

    const results = await Promise.all([update("first", 80), update("second", 10)]);

    expect(results.sort((left, right) => left - right)).toEqual([1, 2]);
    expect(events).toHaveLength(4);
    expect(events[0]).toMatch(/:start:0$/);
    expect(events[1]).toMatch(/:end:1$/);
    expect(events[2]).toMatch(/:start:1$/);
    expect(events[3]).toMatch(/:end:2$/);
    expect(await fs.readFile(file, "utf8")).toBe("2");
    expect(await exists(`${file}.lock`)).toBe(false);
  });
});
