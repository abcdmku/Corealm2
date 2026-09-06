import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { fingerprintNavmeshSources } from "../tools/build-navmesh.js";
import { NAVMESH_AUTHORING_INPUTS } from "../game/src/generated/navmeshFingerprint.js";
import { decodeNavigationArtifact } from "../game/src/systems/navigationArtifact.js";

it("ships a valid navigation bake for the current authored sources", async () => {
  const [sources, binary, text] = await Promise.all([
    fingerprintNavmeshSources(),
    readFile("game/public/generated/corealm-navmesh.bin"),
    readFile("game/public/generated/corealm-navmesh.json", "utf8"),
  ]);
  expect(sources, "Navigation sources changed. Run npm run navmesh:build before shipping.")
    .toEqual(NAVMESH_AUTHORING_INPUTS);
  const manifest = JSON.parse(text);
  expect(manifest.authoredInputs).toEqual(sources);
  const artifact = await decodeNavigationArtifact(binary);
  expect(artifact.metadata.fingerprint).toBe(manifest.fingerprint);
  expect(artifact.metadata.polyCount).toBeGreaterThan(0);
  expect(binary.byteLength).toBe(manifest.bytes);
});
