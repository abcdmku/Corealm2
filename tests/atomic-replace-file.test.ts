import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { atomicReplaceFile } from "../tools/lib/atomic-replace-file.js";

const directories: string[] = [];
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "corealm-atomic-test-"));
  directories.push(directory);
  const destination = path.join(directory, "manifest.json");
  await fs.writeFile(destination, "original");
  return { directory, destination };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    // Delete only the exact OS-created test directory with the expected name.
    if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith("corealm-atomic-test-")) throw new Error("Unsafe test cleanup path");
    await fs.rm(directory, { recursive: true, force: true });
  }
});

describe("atomic file replacement", () => {
  it("replaces an existing file and can atomically restore its original bytes", async () => {
    const { directory, destination } = await fixture();
    await atomicReplaceFile(destination, "replacement");
    expect(await fs.readFile(destination, "utf8")).toBe("replacement");
    await atomicReplaceFile(destination, "original");
    expect(await fs.readFile(destination, "utf8")).toBe("original");
    expect(await fs.readdir(directory)).toEqual(["manifest.json"]);
  });
  it.each(["writeFile", "sync", "rename"] as const)("preserves destination and cleans up after %s failure", async (failureAt) => {
    const { directory, destination } = await fixture();
    const failure = Object.assign(new Error("simulated sharing failure"), { code: "UNKNOWN", errno: -4094 });
    const io = {
      open: async (...args: Parameters<typeof fs.open>) => {
        const handle = await fs.open(...args);
        if (failureAt !== "rename") vi.spyOn(handle, failureAt).mockRejectedValue(failure);
        return handle;
      },
      rename: failureAt === "rename" ? vi.fn<typeof fs.rename>().mockRejectedValue(failure) : fs.rename,
      unlink: fs.unlink,
    };
    await expect(atomicReplaceFile(destination, "replacement", io)).rejects.toBe(failure);
    expect(await fs.readFile(destination, "utf8")).toBe("original");
    expect(await fs.readdir(directory)).toEqual(["manifest.json"]);
  });
  it("reports both the operation failure and cleanup failure", async () => {
    const { destination } = await fixture();
    const operation = new Error("rename denied");
    const cleanup = new Error("cleanup denied");
    await expect(atomicReplaceFile(destination, "replacement", {
      open: fs.open,
      rename: vi.fn<typeof fs.rename>().mockRejectedValue(operation),
      unlink: vi.fn<typeof fs.unlink>().mockRejectedValue(cleanup),
    })).rejects.toMatchObject({ errors: [operation, cleanup] });
    expect(await fs.readFile(destination, "utf8")).toBe("original");
  });
});
