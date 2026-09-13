import { describe, expect, it } from "vitest";
import rawParameters from "../game/content/data/balance/gear.json";
import { gear } from "../game/src/content/balance/gear.js";
import { ITEM_RECORDS } from "../game/src/content/itemData.js";
import { gearBalanceSchema } from "../game/src/content/schema/balance.js";
import { GearDerivationSchema } from "../game/src/content/schema/gearDerivation.js";
import { parseValue } from "../game/src/content/schema/core.js";
import { attachGearDerivations } from "../tools/content/gear-derivations.js";

const params = parseValue(gearBalanceSchema, rawParameters, "balance/gear");

describe("authored base and rare gear derivations", () => {
  it("recomputes all 63 base items and eight rare weapons from independent parameters", () => {
    const tagged = ITEM_RECORDS.filter((row) => row.derivation?.kind === "gear").map(row => ({ ...row, derivation: parseValue(GearDerivationSchema, row.derivation, row.id) }));
    expect(tagged).toHaveLength(71);
    expect(tagged.filter((row) => row.derivation!.variant === "base")).toHaveLength(63);
    expect(tagged.filter((row) => row.derivation!.variant === "rare")).toHaveLength(8);
    for (const row of tagged) {
      expect(gear(params, row.derivation!), row.id).toEqual({ tier: row.tier, value: row.value, equip: row.equip });
    }
    expect(attachGearDerivations(ITEM_RECORDS, params)).toEqual(ITEM_RECORDS);
  });

  it("uses changed baseline stats and cadence without mutating parameters or tags", () => {
    const changed = structuredClone(params);
    const baseline = changed.baselines.find((row) => row.id === "grithe_sword")!;
    baseline.bonuses.meleePower = 17;
    changed.attackSpeedMs.melee = 2700;
    const tag = { kind: "gear", variant: "base", baselineId: "grithe_sword", attackKind: "melee" } as const;
    const before = JSON.stringify(changed);
    const output = gear(changed, tag);
    expect(output.equip.bonuses.meleePower).toBe(17);
    expect(output.equip.attackSpeedMs).toBe(2700);
    output.equip.bonuses.meleePower = 99;
    expect(JSON.stringify(changed)).toBe(before);
    expect(tag).toEqual({ kind: "gear", variant: "base", baselineId: "grithe_sword", attackKind: "melee" });
  });

  it("preserves ceil on each rare offensive stat and round on value", () => {
    const changed = structuredClone(params);
    changed.rare.bonusMultiplier = 1.13;
    changed.rare.valueMultiplier = 1.333;
    const base = changed.baselines.find((row) => row.id === "grithe_sword")!;
    const result = gear(changed, { kind: "gear", variant: "rare", baselineId: base.id, attackKind: "melee" });
    expect(result.equip.bonuses.meleeAccuracy).toBe(Math.ceil(base.bonuses.meleeAccuracy * 1.13));
    expect(result.equip.bonuses.meleePower).toBe(Math.ceil(base.bonuses.meleePower * 1.13));
    expect(result.value).toBe(Math.round(base.value * 1.333));
    expect(result.equip.bonuses.defence).toBe(base.bonuses.defence);
    const staff = changed.baselines.find((row) => row.id === "palewood_staff")!;
    const rareStaff = gear(changed, { kind: "gear", variant: "rare", baselineId: staff.id, attackKind: "staff" });
    expect(rareStaff.equip.bonuses.magicPower).toBe(Math.ceil(staff.bonuses.magicPower * 1.13));
    expect(rareStaff.equip.bonuses.magicAccuracy).toBe(Math.ceil(staff.bonuses.magicAccuracy * 1.13));
    expect(rareStaff.equip.bonuses.meleePower).toBe(staff.bonuses.meleePower);
    expect(rareStaff.equip.bonuses.defence).toBe(staff.bonuses.defence);
  });

  it("omits attack cadence for armor and leaves unparameterized variants untagged", () => {
    expect(gear(params, { kind: "gear", variant: "base", baselineId: "grithe_helm" }).equip)
      .not.toHaveProperty("attackSpeedMs");
    for (const row of ITEM_RECORDS.filter((row) => row.catalog !== "EQUIPMENT" && row.catalog !== "RARE_MINIBOSS_WEAPONS")) {
      expect(row.derivation?.kind, row.id).not.toBe("gear");
    }
  });

  it("refuses unknown baselines, drifted numeric records, and invalid tag fields", () => {
    expect(() => gear(params, { kind: "gear", variant: "base", baselineId: "missing" })).toThrow("Unknown gear baseline");
    const original = ITEM_RECORDS.find((row) => row.id === "grithe_sword")!;
    expect(() => attachGearDerivations([{ ...original, value: original.value + 1 }], params)).toThrow("drifted gear");
    expect(() => parseValue(GearDerivationSchema, { kind: "gear", variant: "rare", baselineId: "palewood_wand", attackKind: "wand" }, "derivation"))
      .toThrow("attackKind");
    expect(() => parseValue(GearDerivationSchema, { kind: "gear", variant: "base", baselineId: "grithe_sword", bonuses: {} }, "derivation"))
      .toThrow("bonuses");
  });
});
