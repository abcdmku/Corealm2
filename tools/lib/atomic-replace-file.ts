import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";

type FileOps = Pick<typeof fs, "open" | "rename" | "unlink">;

/** The destination stays intact until a complete, flushed sibling replaces it. */
export async function atomicReplaceFile(destination: string, bytes: string | Uint8Array, io: FileOps = fs): Promise<void> {
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomUUID()}.tmp`);
  let created = false;
  try {
    const handle = await io.open(temporary, "wx");
    created = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Do not unlink the destination first: a failed Windows rename must leave it intact.
    await io.rename(temporary, destination);
    created = false;
  } catch (error) {
    if (created) {
      try { await io.unlink(temporary); }
      catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new AggregateError([error, cleanupError], `Atomic replacement failed; temporary file cleanup also failed: ${temporary}`);
        }
      }
    }
    throw error;
  }
}
