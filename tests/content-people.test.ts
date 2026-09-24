import { describe, expect, it } from "vitest";
import npcData from "../game/content/data/npcs.json";
import shopData from "../game/content/data/shops.json";
import { FAIRY_NPC_CANDIDATES, fairyNpcCandidate, fairyNpcPresentation } from "../game/src/content/fairyNpcs.js";
import { NPCS, dialogueRootFor, npc, npcGivingQuest, npcName, npcsForRegion } from "../game/src/content/npcs.js";
import { SHOPS } from "../game/src/content/shops.js";
import { parseCollection, validateCollection } from "../game/src/content/schema/core.js";
import { fairyNpcSchema, npcRecordSchema, npcSchema, shopSchema } from "../game/src/content/schema/people.js";

describe("JSON people content", () => {
  it("loads catalogs without leaking tags and retains fairy row identity", () => {
    expect(SHOPS).toEqual(shopData);
    expect(NPCS.map((row) => row.id)).toEqual(npcData.map((row) => row.id));
    expect(FAIRY_NPC_CANDIDATES).toHaveLength(12);
    for (const candidate of FAIRY_NPC_CANDIDATES) {
      expect(npc(candidate.id)).toBe(candidate);
      expect(fairyNpcCandidate(candidate.id)).toBe(candidate);
    }
    expect(NPCS.every((row) => !("catalog" in row))).toBe(true);
  });

  it("keeps lookup results and fallbacks", () => {
    expect(npcName("npc_warden_ilse")).toBe("Warden Ilse");
    expect(npcGivingQuest("dorns_tally")?.id).toBe("npc_pitmaster_dorn");
    expect(dialogueRootFor("npc_fey_lantern_keeper")).toBe("fey_luma_root");
    expect(npcsForRegion("gloamgarden").map((row) => row.id)).toEqual(
      // The fairy candidates plus the Fairyland slayer master stationed at Lantern Rest.
      [...FAIRY_NPC_CANDIDATES.filter((row) => row.regionId === "gloamgarden").map((row) => row.id), "npc_slayer_aevra"],
    );
    expect(npc("missing")).toBeUndefined();
    expect(npcName("missing")).toBe("missing");
    expect(dialogueRootFor("missing")).toBeUndefined();
    expect(fairyNpcCandidate("missing")).toBeUndefined();
    expect(fairyNpcPresentation("npc_fey_opaline")).toEqual({ scale: 1.2, labelHeight: 1.4 });
    expect(fairyNpcPresentation("npc_warden")).toEqual({ scale: 1, labelHeight: 2.2 });
  });

  it("rejects malformed stock with the item path", () => {
    const bad = structuredClone(shopData);
    bad[0]!.stock[0]!.quantity = -1;
    expect(() => parseCollection(shopSchema, bad, { name: "shops" })).toThrow(/shops\[0:coldbrace_general\]\.stock\[0\]\.quantity/);
    bad[0]!.stock[0]!.quantity = 0.5;
    expect(() => parseCollection(shopSchema, bad, { name: "shops" })).toThrow(/expected integer/);
  });

  it("rejects duplicate identities, wrong catalogs and missing fairy model fields", () => {
    expect(validateCollection(npcRecordSchema, [npcData[0], npcData[0]], { name: "npcs" }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("duplicate id") })]));
    const first = { ...npcData[0] } as Record<string, unknown>;
    delete first.assetId;
    expect(() => parseCollection(npcRecordSchema, [first], { name: "npcs" })).toThrow(/assetId: missing required field/);
    expect(() => parseCollection(npcRecordSchema, [{ ...npcData[0], catalog: "faery" }], { name: "npcs" })).toThrow(/catalog/);
    expect(() => parseCollection(npcRecordSchema, [{ ...npcData[0], regionId: "unknown" }], { name: "npcs" })).toThrow(/regionId/);
    expect(() => parseCollection(npcRecordSchema, [{ ...npcData[0], bindHeightMetres: 0 }], { name: "npcs" })).toThrow(/bindHeightMetres/);
  });

  it("exposes identity and cross-link metadata for forms", () => {
    expect(npcSchema.fields.id.meta).toMatchObject({ identity: true, readOnly: true });
    expect(npcSchema.fields.regionId.meta.ref).toBe("region");
    expect(npcSchema.fields.dialogueRootId.meta.ref).toBe("dialogue");
    expect(npcSchema.fields.questIds.item.meta.ref).toBe("quest");
    expect(fairyNpcSchema.fields.assetId.meta.ref).toBe("asset");
    expect(shopSchema.fields.stock.item).toMatchObject({ fields: { itemId: { meta: { ref: "item" } } } });
  });
});
