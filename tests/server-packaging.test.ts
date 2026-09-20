import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createAdminUi } from "../game/src/multiplayer/adminUi.js";
import {
  ASSET_MANIFEST_ASSET, BUILD_INFO_ASSET, DEVELOPMENT_BUILD, SERVER_WORLD_PACK_FILE,
  archiveAdminUi, buildInfo, createEmbedded, packAdminUiArchive, readAdminUiArchive, repoPathOf, serverBaseDir,
} from "../game/src/multiplayer/embedded.js";
import { SERVER_WORLD_PACK_REPO_PATH } from "../game/src/multiplayer/worldPack.js";
import { createServerLogger, fileWriter, logLine, logLevelOf } from "../game/src/multiplayer/serverLog.js";
import { formatBytes, formatUptime, renderConsole, startServerConsole, stripAnsi } from "../game/src/multiplayer/serverConsole.js";
import { moduleOwner } from "../tools/server-exe/bundle.js";
import { shasumFor } from "../tools/server-exe/nodeBinary.js";
import { seaConfig, SEA_FUSE } from "../tools/server-exe/sea.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The single executable's own parts: where it looks for its files, how it reads the ones inside it,
 * what its log lines say, and what its console draws. Everything here runs without a build.
 */

describe("where a server looks for its files", () => {
  it("resolves configuration beside the executable when packaged and in the working directory otherwise", () => {
    expect(serverBaseDir({ sea: true, execPath: "/opt/corealm/corealm-server", cwd: "/home/ops" })).toBe("/opt/corealm");
    expect(serverBaseDir({ sea: false, execPath: "/usr/bin/node", cwd: "/home/ops/Corealm2" })).toBe("/home/ops/Corealm2");
  });
});

describe("embedded assets", () => {
  const blob = { "server-world.pack": Buffer.from("packed"), "build-info.json": Buffer.from('{"version":"v1.2.3"}') };
  const sea = {
    isSea: () => true,
    getRawAsset(key: string) {
      const bytes = blob[key as keyof typeof blob];
      if (!bytes) throw new Error(`No asset named ${key}`);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
  };

  it("reads assets out of the blob when this process is a single executable", () => {
    const embedded = createEmbedded({ sea });
    expect(embedded.sea).toBe(true);
    expect(embedded.text(SERVER_WORLD_PACK_FILE)).toBe("packed");
    expect(embedded.json(BUILD_INFO_ASSET)).toEqual({ version: "v1.2.3" });
    expect(embedded.asset("admin-ui.archive")).toBeNull();
  });

  it("reads the same names out of the checkout when it is not", () => {
    const read = new Map<string, Uint8Array>([["game/public/assets/manifest.json", Buffer.from('{"asset":{}}')]]);
    const embedded = createEmbedded({ sea: null, root: "/repo", readFile: path => {
      const key = [...read.keys()].find(name => path.split("\\").join("/").endsWith(`/repo/${name}`));
      if (key === undefined) throw new Error(`ENOENT ${path}`);
      return read.get(key)!;
    } });
    expect(embedded.sea).toBe(false);
    expect(embedded.text(ASSET_MANIFEST_ASSET)).toBe('{"asset":{}}');
    // Nothing in a checkout is the admin UI archive or the seed catalog: those exist only in a build.
    expect(embedded.asset("admin-ui.archive")).toBeNull();
    expect(embedded.asset("seed-catalog.json")).toBeNull();
    expect(embedded.asset(SERVER_WORLD_PACK_FILE)).toBeNull();
  });

  it("looks for the world pack where the bake writes it", () => {
    // `embedded.ts` writes the path out instead of importing it, because it loads before the catalog
    // is installed and `worldPack.ts` reads content tables. These two must not drift apart.
    expect(repoPathOf(SERVER_WORLD_PACK_FILE)).toBe(SERVER_WORLD_PACK_REPO_PATH);
    expect(SERVER_WORLD_PACK_REPO_PATH).toBe("game/public/generated/server-world.pack");
    expect(repoPathOf("admin-ui.archive")).toBeNull();
  });

  it("reports a development build when nothing stamped one", () => {
    expect(buildInfo(createEmbedded({ sea: null, root: "/repo", readFile: () => { throw new Error("ENOENT"); } }))).toEqual({
      name: "corealm-server", version: "dev", builtAt: "unknown", node: "dev", commit: null,
      catalogRevision: null, formulaRevision: null, worldPack: false,
    });
    expect(DEVELOPMENT_BUILD.version).toBe("dev");
  });

  it("keeps every field a build stamped", () => {
    const stamped = { name: "corealm-server", version: "v0.4.0", builtAt: "2026-09-20T22:58:21.445Z", node: "24.14.0",
      commit: "54f88cd", catalogRevision: "b18876ed", formulaRevision: "4ac48aaf", worldPack: true };
    const embedded = createEmbedded({ sea: { isSea: () => true, getRawAsset: () => new TextEncoder().encode(JSON.stringify(stamped)).buffer as ArrayBuffer } });
    expect(buildInfo(embedded)).toEqual(stamped);
  });
});

describe("the admin UI archive", () => {
  const files = new Map<string, Uint8Array>([
    ["index.html", Buffer.from("<!doctype html><title>Corealm</title>")],
    ["assets/app-A1b2C3d4.js", Buffer.from("export const app = 1;")],
    ["assets/app-A1b2C3d4.css", Buffer.from(":root{--x:1}")],
    ["logo.svg", Buffer.from("<svg/>")],
  ]);
  const archive = packAdminUiArchive(files);

  it("round-trips every file", () => {
    const read = readAdminUiArchive(archive);
    expect(read.names()).toEqual(["assets/app-A1b2C3d4.css", "assets/app-A1b2C3d4.js", "index.html", "logo.svg"]);
    expect(read.file("index.html")!.toString("utf8")).toBe("<!doctype html><title>Corealm</title>");
    expect(read.file("assets/app-A1b2C3d4.js")!.toString("utf8")).toBe("export const app = 1;");
  });

  it("is a lookup, so no path can leave it", async () => {
    const source = archiveAdminUi(archive);
    expect(await source.read("../../etc/passwd")).toBeNull();
    expect(await source.read("assets")).toBeNull();
    expect(await source.read("nothing.js")).toBeNull();
    expect((await source.read("logo.svg"))!.type).toBe("image/svg+xml");
    expect((await source.read("assets/app-A1b2C3d4.css"))!.type).toBe("text/css; charset=utf-8");
  });

  it("refuses bytes that are not an archive", () => {
    expect(() => readAdminUiArchive(Buffer.from("not an archive at all"))).toThrow("That is not a Corealm admin UI archive");
  });

  it("serves the embedded build with the caching rules a directory gets", async () => {
    const ui = createAdminUi({ source: archiveAdminUi(archive) });
    expect((await get(ui, "/admin/")).headers["Cache-Control"]).toBe("no-cache");
    const hashed = await get(ui, "/admin/assets/app-A1b2C3d4.js");
    expect([hashed.status, hashed.headers["Content-Type"], hashed.headers["Cache-Control"]])
      .toEqual([200, "text/javascript; charset=utf-8", "public, max-age=31536000, immutable"]);
    expect((await get(ui, "/admin/logo.svg")).headers["Cache-Control"]).toBe("public, max-age=300");
    expect((await get(ui, "/admin/missing.js")).status).toBe(404);
    // A path the app never asks for is a stale link, and one directly under /admin/ still gets the page.
    expect((await get(ui, "/admin/players.js")).status).toBe(404);
    expect((await get(ui, "/admin/%2e%2e/secret")).status).toBe(400);
  });
});

type Answer = { status: number; headers: Record<string, string>; body: string };
async function get(ui: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>, url: string): Promise<Answer> {
  const answer: Answer = { status: 0, headers: {}, body: "" };
  const response = {
    writeHead(status: number, headers: Record<string, string | number> = {}) {
      answer.status = status;
      for (const [key, value] of Object.entries(headers)) answer.headers[key] = String(value);
      return response;
    },
    end(body?: Buffer | string) { answer.body = body === undefined ? "" : String(body); },
  };
  await ui({ url, method: "GET", headers: {} } as IncomingMessage, response as unknown as ServerResponse);
  return answer;
}

describe("log lines", () => {
  const at = 1_758_326_400_000;
  const lines: string[] = [];
  const logger = createServerLogger({ writer: { write: line => lines.push(line) }, now: () => at });

  it("writes one JSON object per event, with t, level and event first", () => {
    lines.length = 0;
    logger.info("ready", { ready: true, port: 4180 });
    expect(lines).toEqual(['{"t":"2025-09-20T00:00:00.000Z","level":"info","event":"ready","ready":true,"port":4180}']);
  });

  it("never writes a credential, and writes the setup code exactly once because that is what it is for", () => {
    lines.length = 0;
    logger.emit({ event: "owner-setup-code", code: "K7M3Q-2WXPR-9TVBH-4CJ8N", message: "Sign in to devdocs" });
    logger.emit({ event: "admin.session", accountId: "acc_9Qr7v2KpLd3XmB1sYwTgHa", token: "cas_abcdefghijkl", role: "owner" });
    logger.emit({ event: "admin.error", path: "/admin/players", message: "token cat_9876543210ab was rejected" });
    logger.emit({ event: "join", player: { name: "Ada", session: "cas_zzzzzzzzzzzz" } });
    expect(lines).toEqual([
      '{"t":"2025-09-20T00:00:00.000Z","level":"info","event":"owner-setup-code","code":"K7M3Q-2WXPR-9TVBH-4CJ8N","message":"Sign in to devdocs"}',
      '{"t":"2025-09-20T00:00:00.000Z","level":"info","event":"admin.session","accountId":"acc_9Qr7v2KpLd3XmB1sYwTgHa","token":"[redacted]","role":"owner"}',
      '{"t":"2025-09-20T00:00:00.000Z","level":"error","event":"admin.error","path":"/admin/players","message":"token [redacted] was rejected"}',
      '{"t":"2025-09-20T00:00:00.000Z","level":"info","event":"join","player":{"name":"Ada","session":"[redacted]"}}',
    ]);
  });

  it("levels the events an operator has to act on", () => {
    expect([logLevelOf("ready"), logLevelOf("catalog-base-ignored"), logLevelOf("directory.unreachable"), logLevelOf("admin.error")])
      .toEqual(["info", "warn", "warn", "error"]);
    expect(logLine("warn", "directory.refused", { status: 422, level: "info", t: "ignored" }, at))
      .toBe('{"t":"2025-09-20T00:00:00.000Z","level":"warn","event":"directory.refused","status":422}');
  });

  it("rotates the file it writes while the console owns stdout", async () => {
    const directory = await mkdtemp(join(tmpdir(), "corealm-log-"));
    try {
      const path = join(directory, "server.log");
      // Each line is 27 bytes, so the fifth rotates the file and the last four are what is left.
      const writer = fileWriter(path, { maxBytes: 120 });
      for (let index = 0; index < 8; index++) writer.write(JSON.stringify({ event: "tick", index }));
      writer.close?.();
      expect(await readFile(path, "utf8"))
        .toBe('{"event":"tick","index":4}\n{"event":"tick","index":5}\n{"event":"tick","index":6}\n{"event":"tick","index":7}\n');
      expect(await readFile(`${path}.1`, "utf8"))
        .toBe('{"event":"tick","index":0}\n{"event":"tick","index":1}\n{"event":"tick","index":2}\n{"event":"tick","index":3}\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("the live console", () => {
  const at = 1_758_326_400_000;
  const stats = {
    name: "Raid Night", host: "0.0.0.0", port: 4180, authentication: "account",
    catalogRevision: "9f2c1d4e7a0b3358ce11", uptimeSeconds: 11_530,
    worlds: [
      { worldId: "corealm", name: "Corealm", playersOnline: 12, capacity: 200, tick: 9031 },
      { worldId: "second-corealm", name: "Corealm II", playersOnline: 0, capacity: 50, tick: 9031 },
    ],
    tick: { lastMs: 21.4, meanMs: 23.9, p95Ms: 29.5 },
    memory: { rssBytes: 1_231_847_424, heapUsedBytes: 412_398_080 },
    bytesOut: 91_263_344, bytesOutPerSecond: 101_021.2,
    commands: 4821, rejected: 3, errors: 0,
    events: [
      { at: at + 1_000, kind: "join" as const, accountId: "acc_9Qr7v2KpLd3XmB1sYwTgHa", detail: "corealm" },
      { at: at + 2_000, kind: "rejected" as const, accountId: "acc_5Lm2p8QrTv1XwYzAbCdEf", detail: "DUPLICATE_LOGIN" },
      { at: at + 3_000, kind: "leave" as const, accountId: "acc_5Lm2p8QrTv1XwYzAbCdEf", detail: "corealm" },
    ],
    logPath: "/var/lib/corealm-server/server.log",
  };

  it("draws the frame an operator reads", () => {
    expect(stripAnsi(renderConsole(stats, { columns: 80, rows: 24 }))).toBe([
      "  COREALM  Raid Night                                 up 3h 12m   0.0.0.0:4180  ",
      "                                                                                ",
      "  WORLDS                                                                        ",
      "    Corealm          12 / 200   players    tick 9031                            ",
      "    Corealm II        0 / 50    players    tick 9031                            ",
      "                                                                                ",
      "  tick     last 21.4 ms  mean 23.9 ms  p95 29.5 ms                              ",
      "  memory   rss 1.1 GiB   heap 393.3 MiB                                         ",
      "  traffic  out 87.0 MiB  98.7 KiB/s                                             ",
      "  commands 4821          rejected 3    errors 0                                 ",
      "  catalog  9f2c1d4e7a0b3358   auth account                                      ",
      "                                                                                ",
      "  EVENTS                                                                        ",
      "    00:00:01  join          acc_9Qr7v2KpLd3XmB1sYwTgHa  corealm                 ",
      "    00:00:02  rejected      acc_5Lm2p8QrTv1XwYzAbCdEf   DUPLICATE_LOGIN         ",
      "    00:00:03  leave         acc_5Lm2p8QrTv1XwYzAbCdEf   corealm                 ",
      "                                                                                ",
      "                                                                                ",
      "                                                                                ",
      "                                                                                ",
      "                                                                                ",
      "                                                                                ",
      "                                                                                ",
      "  log lines to /var/lib/corealm-server/server.log      Ctrl+C stops the server  ",
    ].join("\n"));
  });

  it("paints the header, the labels and a missed tick target, and nothing else", () => {
    const frame = renderConsole(stats, { columns: 80, rows: 24 }).split("\n");
    expect(frame[0]).toBe("\u001b[7m  COREALM  Raid Night                                 up 3h 12m   0.0.0.0:4180  \u001b[0m");
    expect(frame[6]).toBe("\u001b[2m  tick     \u001b[0mlast 21.4 ms  mean 23.9 ms  p95 29.5 ms                              ");
    const slow = renderConsole({ ...stats, tick: { lastMs: 180, meanMs: 120, p95Ms: 205 } }, { columns: 80, rows: 24 }).split("\n");
    expect(slow[6]).toBe("\u001b[2m  tick     \u001b[0mlast 180.0 ms mean 120.0 ms \u001b[31mp95 205.0 ms\u001b[0m                             ");
  });

  it("fits a narrow terminal without wrapping and keeps the newest events", () => {
    const frame = renderConsole(stats, { columns: 44, rows: 16 }).split("\n");
    expect(frame).toHaveLength(16);
    expect(new Set(frame.map(line => stripAnsi(line).length))).toEqual(new Set([44]));
    expect(stripAnsi(frame.at(-2)!).trim()).toBe("00:00:03  leave         acc_5Lm2p8QrTv1X");
  });

  it("takes the alternate screen, draws a whole frame in one write, and puts the terminal back", () => {
    const writes: string[] = [];
    const stdout = { columns: 80, rows: 24, write: (text: string) => { writes.push(text); return true; },
      on: () => stdout, removeListener: () => stdout } as unknown as NodeJS.WriteStream;
    const handle = startServerConsole({ stats: () => stats, stdout, intervalMs: 3_600_000 });
    expect(writes[0]).toBe("[?1049h[?25l");
    expect(writes).toHaveLength(2);
    // Home, then clear-to-end-of-line per row, then clear below: no full clear, so nothing flickers.
    const frame = writes[1]!;
    expect([frame.startsWith("[H[2K"), frame.endsWith("[J"), frame.split("\r\n").length]).toEqual([true, true, 24]);
    handle.stop();
    handle.stop();
    expect(writes).toHaveLength(3);
    expect(writes[2]).toBe("[?25h[?1049l");
  });

  it("writes times and sizes the way an operator reads them", () => {
    expect([formatUptime(0), formatUptime(903), formatUptime(11_530), formatUptime(180_000)]).toEqual(["0m 00s", "15m 03s", "3h 12m", "2d 02h"]);
    expect([formatBytes(0), formatBytes(999), formatBytes(1024), formatBytes(91_263_344)]).toEqual(["0 B", "999 B", "1.0 KiB", "87.0 MiB"]);
  });
});

describe("the build pipeline", () => {
  it("names the owner of a bundled module", () => {
    expect(moduleOwner("node_modules/three/build/three.core.js")).toBe("three");
    expect(moduleOwner("node_modules/@gltf-transform/core/dist/core.js")).toBe("@gltf-transform/core");
    expect(moduleOwner("game/src/multiplayer/referenceServer.ts")).toBe("game/src");
    expect(moduleOwner("node_modules/ws/lib/websocket.js")).toBe("ws");
  });

  it("takes one file's hash out of a release SHASUMS256.txt", () => {
    const text = "aaaa000000000000000000000000000000000000000000000000000000000001  node-v24.14.0-linux-x64.tar.gz\n"
      + "bbbb000000000000000000000000000000000000000000000000000000000002  win-x64/node.exe\n";
    expect(shasumFor(text, "win-x64/node.exe")).toBe("bbbb000000000000000000000000000000000000000000000000000000000002");
    expect(() => shasumFor(text, "win-arm64/node.exe")).toThrow("SHASUMS256.txt has no entry for win-arm64/node.exe");
  });

  it("keeps the blob platform independent, which is what lets one machine build both executables", () => {
    expect(seaConfig("/b/server.cjs", "/b/server.blob", { "build-info.json": "/b/assets/build-info.json" })).toEqual({
      main: "/b/server.cjs", output: "/b/server.blob", disableExperimentalSEAWarning: true,
      useSnapshot: false, useCodeCache: false, assets: { "build-info.json": "/b/assets/build-info.json" },
    });
    expect(SEA_FUSE).toBe("NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2");
  });
});
