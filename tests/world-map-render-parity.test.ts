import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import "../tools/lib/repoContent.js";
import { gameRoot } from "../tools/lib/paths.js";
import { buildWorldTerrainSpec } from "../game/src/app/worldSpec.js";
import { DEFAULT_WORLD_SEED } from "../game/src/app/worldSurface.js";
import { mapLayoutFor, mapLayoutOf, type MapMetadata } from "../game/src/world/worldMapRender.js";
import { writeWorldMapArtifacts } from "../tools/generate-world-map.js";

/*
  The world map pipeline moved into `game/src/world/worldMapRender.ts` so devdocs can render a
  server's map with the same code. The repository tool runs it with the Sharp codec, and from the
  committed capture it must write the committed files byte for byte: the renditions, their tiles,
  `world-map.json` and the fingerprint module.
*/

const generated = path.join(gameRoot, "public", "generated");
/** The checkout may carry text files with CRLF line endings. */
const lf = (bytes: Buffer): string => bytes.toString("utf8").split("\r\n").join("\n");
let scratch = "";
afterAll(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }); });

describe("world map render parity", () => {
  it("rebuilds the committed renditions from the committed capture byte for byte", async () => {
    scratch = await mkdtemp(path.join(tmpdir(), "world-map-parity-"));
    const out = path.join(scratch, "generated"), src = path.join(scratch, "src");
    const committed = JSON.parse(await readFile(path.join(generated, "world-map.json"), "utf8")) as MapMetadata;
    const layout = mapLayoutFor(buildWorldTerrainSpec(), DEFAULT_WORLD_SEED);
    expect(layout).toEqual(mapLayoutOf(committed));

    await writeWorldMapArtifacts(layout, await readFile(path.join(generated, "world-map.png")), out, src);

    const written = (await readdir(out)).filter(name => name !== "world-map.png").sort();
    const expected = (await readdir(generated)).filter(name => /^world-map.*\.(webp|json)$/.test(name)).sort();
    expect(written).toEqual(expected);
    const differing: string[] = [];
    for (const name of written) {
      const [mine, theirs] = await Promise.all([readFile(path.join(out, name)), readFile(path.join(generated, name))]);
      const same = name.endsWith(".json") ? lf(mine) === lf(theirs) : mine.equals(theirs);
      if (!same) differing.push(name);
    }
    expect(differing).toEqual([]);
    const [fingerprint, committedFingerprint] = await Promise.all([
      readFile(path.join(src, "worldMapFingerprint.ts")), readFile(path.join(gameRoot, "src", "generated", "worldMapFingerprint.ts")),
    ]);
    expect(lf(fingerprint)).toBe(lf(committedFingerprint));
  }, 600_000);
});
