import type { ItemDef } from "../../game/src/contracts.js";
import { gear } from "../../game/src/content/balance/gear.js";
import type { GearBalance } from "../../game/src/content/schema/balance.js";
import type { GearDerivation } from "../../game/src/content/schema/gearDerivation.js";
import { ItemRecordSchema, type ItemRecord } from "../../game/src/content/schema/itemRecords.js";
import { canonicalRecords } from "./format.js";
import { collectDifferences, type ParityDifference } from "./parity.js";

/** Original rare() base arguments; values and bonuses always come from independent parameters. */
const rareBases: Readonly<Record<string, string>> = {
  galeskin_sword: "grithe_sword", galeskin_staff: "palewood_staff",
  mossbound_sword: "corven_sword", mossbound_staff: "duskoak_staff",
  tideworn_sword: "kaldite_sword", tideworn_staff: "cairnpine_staff",
  cinderwake_sword: "emberite_sword", cinderwake_staff: "cinderpine_staff",
};

/** Attach only the approved base/rare locks, and refuse to write any tag that already drifts. */
export function attachGearDerivations(records: readonly ItemRecord[], params: GearBalance): ItemRecord[] {
  const baselineIds = new Set(params.baselines.map((row) => row.id));
  return canonicalRecords(ItemRecordSchema, records.map((record): ItemRecord => {
    let derivation: GearDerivation | undefined;
    if (record.catalog === "EQUIPMENT") {
      if (!baselineIds.has(record.id)) throw new Error(`Base equipment ${record.id} has no authored balance baseline`);
      const attackKind = record.equip?.attackSpeedMs === undefined ? undefined : record.magicWeapon?.kind ?? "melee";
      derivation = { kind: "gear", variant: "base", baselineId: record.id, ...(attackKind ? { attackKind } : {}) };
    } else if (record.catalog === "RARE_MINIBOSS_WEAPONS") {
      const baselineId = rareBases[record.id];
      if (!baselineId) throw new Error(`Rare weapon ${record.id} has no original base mapping`);
      if (record.magicWeapon?.kind === "wand") throw new Error(`Original rare weapon ${record.id} cannot be a wand`);
      derivation = { kind: "gear", variant: "rare", baselineId, attackKind: record.magicWeapon ? "staff" : "melee" };
    }
    if (!derivation) return record;
    const expected: Pick<ItemDef, "tier" | "value" | "equip"> = { tier: record.tier, value: record.value, equip: record.equip };
    const differences: ParityDifference[] = [];
    collectDifferences(expected, gear(params, derivation), record.id, differences);
    if (differences.length) throw new Error(`Cannot tag drifted gear ${record.id}: ${JSON.stringify(differences)}`);
    return { ...record, derivation };
  }), "items");
}
