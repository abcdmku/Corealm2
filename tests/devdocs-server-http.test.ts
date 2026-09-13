import { mkdtemp, cp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { expect, it } from "vitest";
import { devdocsPlugin } from "../devdocs/server/plugin.js";
import { repoRoot } from "../tools/lib/paths.js";

it("mounts revision-checked metadata writes on real local HTTP using an isolated content root", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "corealm-devdocs-http-"));
  const contentRoot = path.join(temporary, "content");
  await cp(path.join(repoRoot, "game/content/data"), path.join(contentRoot, "data"), { recursive: true });
  const server = await createServer({ configFile: false, root: temporary, plugins: [devdocsPlugin({ contentRoot })], server: { host: "127.0.0.1", port: 0 }, optimizeDeps: { noDiscovery: true } });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP server");
    const url = `http://127.0.0.1:${address.port}/__devdocs/meta/items/grithe_sword`;
    const read = await fetch(url);
    expect(read.status).toBe(200);
    const initial = await read.json() as { revision: string };
    const mutation = { revision: initial.revision, operation: { kind: "note", text: "Check sword grip in the next art pass." } };
    const write = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutation) });
    expect(write.status).toBe(200);
    const updated = await write.json() as { revision: string };
    expect(updated.revision).not.toBe(initial.revision);
    const records = JSON.parse(await readFile(path.join(contentRoot, "meta/items.meta.json"), "utf8"));
    expect(records.grithe_sword.notes[0].text).toBe(mutation.operation.text);
    const stale = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutation) });
    expect(stale.status).toBe(409);
    const malformed = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{" });
    expect(malformed.status).toBe(400);
    const hostile = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json", Origin: "https://untrusted.example" }, body: "{" });
    expect(hostile.status).toBe(403);
    expect((await fetch(url, { method: "PATCH", body: "bad" })).status).toBe(415);
  } finally {
    await server.close();
    if (path.dirname(temporary) !== path.resolve(tmpdir())) throw new Error("Unexpected temporary root");
    await rm(temporary, { recursive: true, force: true });
  }
});
