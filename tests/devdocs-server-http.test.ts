import { mkdtemp, cp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { expect, it, vi } from "vitest";
import { devdocsPlugin } from "../devdocs/server/plugin.js";
import { repoRoot } from "../tools/lib/paths.js";

it("recovers content saves after a failed type check and mounts revision-checked metadata writes on real HTTP", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "corealm-devdocs-http-"));
  const contentRoot = path.join(temporary, "content");
  await cp(path.join(repoRoot, "game/content/data"), path.join(contentRoot, "data"), { recursive: true });
  const preload = path.join(temporary, 'fail-typecheck.cjs');
  await writeFile(preload, "if (process.argv[1]?.replaceAll('\\\\', '/').endsWith('/typescript/bin/tsc')) process.exit(7);\n");
  vi.stubEnv('NODE_OPTIONS', `${process.env.NODE_OPTIONS ?? ''} --require ${JSON.stringify(preload)}`);
  const server = await createServer({ configFile: false, root: temporary, plugins: [devdocsPlugin({ contentRoot })], server: { host: "127.0.0.1", port: 0 }, optimizeDeps: { noDiscovery: true } });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP server");
    const base = `http://127.0.0.1:${address.port}/__devdocs`;
    await vi.waitFor(async () => {
      const { build } = await (await fetch(`${base}/formulas`)).json();
      expect(build.state).toBe('invalid');
      expect(build.diagnostics[0].message).toContain('exit code 7');
    });
    vi.unstubAllEnvs();
    const items = await (await fetch(`${base}/collections/items`)).json();
    const sword = items.data.find((row: { id: string }) => row.id === 'worn_sword');
    const save = await fetch(`${base}/collections/items/worn_sword`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: items.revision, record: { ...sword, description: 'Saved after retrying project type checking.' } }),
    });
    const saved = await save.json();
    expect(save.status, JSON.stringify(saved)).toBe(200);
    const sources = JSON.parse(await readFile(path.join(contentRoot, 'data/items.json'), 'utf8'));
    expect(sources.find((row: { id: string }) => row.id === sword.id).description).toBe('Saved after retrying project type checking.');
    const catalog = JSON.parse(await readFile(path.join(contentRoot, 'compiled/catalog.json'), 'utf8'));
    expect(catalog.revision).toBe(saved.compiledRevision);
    expect(catalog.tables.items.find((row: { id: string }) => row.id === sword.id).description).toBe('Saved after retrying project type checking.');
    expect((await (await fetch(`${base}/formulas`)).json()).build.state).toBe('valid');
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
    vi.unstubAllEnvs();
    await server.close();
    if (path.dirname(temporary) !== path.resolve(tmpdir())) throw new Error("Unexpected temporary root");
    await rm(temporary, { recursive: true, force: true });
  }
});
