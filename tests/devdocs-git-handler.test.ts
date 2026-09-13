import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createGitHandler, type GitHandler, type GitStatusResponse } from "../devdocs/server/handlers/git.js";
import type { DevdocsJsonResponse } from "../devdocs/server/handlers/collections.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function body<T>(response: DevdocsJsonResponse | undefined): T {
  if (!response) throw new Error("Expected response");
  return JSON.parse(response.body) as T;
}

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

async function fixture(): Promise<{ root: string; handler: GitHandler }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "corealm-devdocs-git-"));
  roots.push(root);
  await mkdir(path.join(root, "game", "content", "data"), { recursive: true });
  await mkdir(path.join(root, "game", "content", "meta"), { recursive: true });
  await mkdir(path.join(root, "devdocs", "src"), { recursive: true });
  await writeFile(path.join(root, "game", "content", "data", "items.json"), "{\"one\":1}\n");
  await writeFile(path.join(root, "game", "content", "data", "rename-me.json"), "before\n");
  await writeFile(path.join(root, "devdocs", "src", "App.tsx"), "export const app = 1;\n");
  await writeFile(path.join(root, "README.md"), "private review surface\n");
  await writeFile(path.join(root, ".env"), "SHOULD_NOT_BE_RETURNED=one\n");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "initial"]);
  return { root, handler: createGitHandler({ repoRoot: root }) };
}

describe("devdocs Git handler", () => {
  it("lists tracked, untracked, and rename destination paths from porcelain status", async () => {
    const { root, handler } = await fixture();
    await writeFile(path.join(root, "game", "content", "data", "items.json"), "{\"one\":2}\n");
    await writeFile(path.join(root, "game", "content", "data", "new.json"), "new\n");
    git(root, ["mv", "game/content/data/rename-me.json", "game/content/data/renamed.json"]);

    const result = await handler({ method: "GET", url: "/__devdocs/git/status" });
    expect(result?.status).toBe(200);
    const status = body<GitStatusResponse>(result);
    expect(status.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "game/content/data/items.json", status: " M", tracked: true }),
      expect.objectContaining({ path: "game/content/data/new.json", status: "??", tracked: false }),
      expect.objectContaining({ path: "game/content/data/renamed.json", status: "R ", tracked: true, originalPath: "game/content/data/rename-me.json" }),
    ]));
    expect(status.changes.some(change => change.path === "game/content/data/rename-me.json")).toBe(false);
  });

  it("returns a diff only for a listed tracked authored path and never private content", async () => {
    const { root, handler } = await fixture();
    await writeFile(path.join(root, "game", "content", "data", "items.json"), "{\"one\":2}\n");
    await writeFile(path.join(root, ".env"), "SHOULD_NOT_BE_RETURNED=two\n");
    const allowed = await handler({ method: "GET", url: "/__devdocs/git/diff?path=game%2Fcontent%2Fdata%2Fitems.json" });
    expect(allowed?.status).toBe(200);
    expect(allowed?.body).toContain("+{\"one\":2}");
    const privateResult = await handler({ method: "GET", url: "/__devdocs/git/diff?path=.env" });
    expect(privateResult?.status).toBe(400);
    expect(privateResult?.body).not.toContain("SHOULD_NOT_BE_RETURNED");
    const untracked = await handler({ method: "GET", url: "/__devdocs/git/diff?path=game%2Fcontent%2Fdata%2Fmissing.json" });
    expect(untracked?.status).toBe(404);
    const disallowed = await handler({ method: "GET", url: "/__devdocs/git/diff?path=README.md" });
    expect(disallowed?.status).toBe(400);
  });

  it("rejects absolute, traversal, NUL, remote, and non-GET requests", async () => {
    const { handler } = await fixture();
    for (const value of [
      "/__devdocs/git/diff?path=%2Fetc%2Fpasswd",
      "/__devdocs/git/diff?path=game%2Fcontent%2Fdata%2F..%2Fmeta%2Fx.json",
      "/__devdocs/git/diff?path=game%2Fcontent%2Fdata%2Fsecret%00.json",
    ]) expect((await handler({ method: "GET", url: value }))?.status).toBe(400);
    expect((await handler({ method: "GET", url: "/__devdocs/git/status", headers: { origin: "https://evil.example" } }))?.status).toBe(403);
    const method = await handler({ method: "POST", url: "/__devdocs/git/status" });
    expect(method?.status).toBe(405);
    expect(method?.headers.Allow).toBe("GET");
    expect((await handler({ method: "GET", url: "/__devdocs/git/other" }))?.status).toBe(400);
  });

  it("does not expose filesystem or command details when the repository is unavailable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "corealm-devdocs-git-empty-"));
    roots.push(root);
    const result = await createGitHandler({ repoRoot: root })({ method: "GET", url: "/__devdocs/git/status" });
    expect(result?.status).toBe(500);
    expect(result?.body).not.toContain(root);
    await expect(readFile(path.join(root, ".env"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
