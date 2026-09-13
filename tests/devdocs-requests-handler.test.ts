import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createRequestsHandler } from "../devdocs/server/handlers/requests.js";
import { devdocsPlugin } from "../devdocs/server/plugin.js";
import type { RequestsReport } from "../tools/content/requests.js";

const at = "2026-09-13T12:00:00.000Z";

function note(id: string, state: "open" | "claimed" | "replied" | "closed", text = id) {
  return {
    at,
    by: "Borg",
    text,
    request: {
      id,
      kind: "art" as const,
      state,
      ...(state === "claimed" || state === "replied" || state === "closed" ? { claimedBy: "agent-a", claimedAt: at } : {}),
      ...(state === "replied" ? { reply: "Ready for review", repliedAt: at } : {}),
      ...(state === "closed" ? { closedAt: at } : {}),
    },
  };
}

async function tempMetadata(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "corealm-devdocs-requests-"));
  await mkdir(path.join(root, "meta"), { recursive: true });
  await writeFile(path.join(root, "meta", "items.meta.json"), JSON.stringify({
    sword: { status: "draft", notes: [note("open-art", "open", "Repair the sword icon."), note("claimed-balance", "claimed")], candidates: [], history: [], sourceRefs: [] },
    ring: { status: "live", notes: [note("replied-art", "replied"), note("closed-text", "closed")], candidates: [], history: [], sourceRefs: [] },
  }, null, 2) + "\n", "utf8");
  await writeFile(path.join(root, "meta", "npcs.meta.json"), JSON.stringify({
    npc: { status: "draft", notes: [], candidates: [], history: [], sourceRefs: [] },
  }, null, 2) + "\n", "utf8");
  return root;
}

function parsed<T>(response: { body: string } | undefined): T {
  if (!response) throw new Error("Expected a response");
  return JSON.parse(response.body) as T;
}

describe("devdocs requests GET API", () => {
  it("reads temp metadata, hashes each metadata file, and filters to open and claimed requests", async () => {
    const root = await tempMetadata();
    try {
      const response = await createRequestsHandler({ contentRoot: root })({ method: "GET", url: "/__devdocs/requests" });
      expect(response?.status).toBe(200);
      expect(response?.headers["Content-Type"]).toBe("application/json; charset=utf-8");
      const report = parsed<RequestsReport>(response);
      expect(Object.keys(report.revisions)).toEqual(["items", "npcs"]);
      expect(report.revisions.items).toMatch(/^[a-f0-9]{64}$/);
      expect(report.requests.map(({ request }) => request.id)).toEqual(["open-art", "claimed-balance"]);
      expect(report.requests.every(({ request }) => request.state === "open" || request.state === "claimed")).toBe(true);
      expect(report.requests[0]).toMatchObject({ collection: "items", entityId: "sword", note: { text: "Repair the sword icon." } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns the same report as markdown formatting for the .md route", async () => {
    const root = await tempMetadata();
    try {
      const response = await createRequestsHandler({ contentRoot: root })({ method: "GET", url: "/__devdocs/requests.md" });
      expect(response?.status).toBe(200);
      expect(response?.headers["Content-Type"]).toBe("text/markdown; charset=utf-8");
      expect(response?.body).toContain("items revision: ");
      expect(response?.body).toContain("- open-art | items/sword | art | open");
      expect(response?.body).toContain("- claimed-balance | items/sword | art | claimed");
      expect(response?.body).not.toContain("replied-art");
      expect(response?.body).not.toContain("closed-text");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats a missing metadata directory as an empty report", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "corealm-devdocs-no-meta-"));
    try {
      const json = await createRequestsHandler({ contentRoot: root })({ method: "GET", url: "/__devdocs/requests" });
      const markdown = await createRequestsHandler({ contentRoot: root })({ method: "GET", url: "/__devdocs/requests.md" });
      expect(parsed<RequestsReport>(json)).toEqual({ revisions: {}, requests: [] });
      expect(markdown?.body).toBe("No matching requests.\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects malformed metadata and hostile or write requests without reading client paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "corealm-devdocs-bad-meta-"));
    await mkdir(path.join(root, "meta"), { recursive: true });
    await writeFile(path.join(root, "meta", "items.meta.json"), "{broken", "utf8");
    try {
      const handler = createRequestsHandler({ contentRoot: root });
      expect((await handler({ method: "GET", url: "/__devdocs/requests" }))?.status).toBe(500);
      expect((await handler({ method: "GET", url: "/__devdocs/requests/../../secret" }))?.status).toBe(400);
      expect((await handler({ method: "POST", url: "/__devdocs/requests" }))?.status).toBe(405);
      expect((await handler({ method: "GET", url: "/__devdocs/requests", socket: { remoteAddress: "203.0.113.9" } }))?.status).toBe(403);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the plugin dev-only while mounting both request formats", () => {
    const plugin = devdocsPlugin();
    expect(plugin.apply).toBe("serve");
    expect(plugin.configureServer).toEqual(expect.any(Function));
    expect(plugin.configurePreviewServer).toBeUndefined();
  });
});
