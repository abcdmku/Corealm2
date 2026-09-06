import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { structureInputHash } from "../tools/lib/structureReviewInputs.js";

describe("structure review dependency selection", () => {
  it("ignores an unrelated catalogue promotion but invalidates a used asset entry", () => {
    const directory = mkdtempSync(path.join(tmpdir(),"structure-input-"));
    const file = path.join(directory,"manifest.json");
    try {
      const used = {id:"wall",file:"wall.glb",size:{x:2,y:3,z:.4}};
      const write = (assets: unknown[]) => writeFileSync(file,JSON.stringify({assets}));
      const input = {path:file,kind:"manifest-entry" as const,id:"wall"};
      write([used,{id:"creature",file:"old.glb"}]); const first = structureInputHash(input);
      write([{id:"creature",file:"new.glb"},used]); expect(structureInputHash(input)).toBe(first);
      write([{...used,size:{...used.size,y:4}}]); expect(structureInputHash(input)).not.toBe(first);
    } finally { unlinkSync(file); rmdirSync(directory); }
  });
  it("tracks only the surface profile actually selected by a model material", () => {
    const directory = mkdtempSync(path.join(tmpdir(),"structure-profile-"));
    const file = path.join(directory,"surfaces.json");
    try {
      const input = {path:file,kind:"surface-profile" as const,id:"stone"};
      const write = (stone: number,leaf: number) => writeFileSync(file,JSON.stringify({version:2,surfaces:{stone:{tileMetres:stone},leaf:{tileMetres:leaf}}}));
      write(2.4,.16); const first = structureInputHash(input);
      write(2.4,.2); expect(structureInputHash(input)).toBe(first);
      write(3,.2); expect(structureInputHash(input)).not.toBe(first);
    } finally { unlinkSync(file); rmdirSync(directory); }
  });
});
