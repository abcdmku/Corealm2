import type { ItemDef } from "../../game/src/contracts.js";
import { jewelry } from "../../game/src/content/balance/jewelry.js";
import type { JewelryBalance } from "../../game/src/content/schema/balance.js";
import type { JewelryDerivation } from "../../game/src/content/schema/jewelryDerivation.js";
import { collectDifferences, type ParityDifference } from "./parity.js";

/** Structural input avoids a cycle with the item schema that will include jewelry tags. */
export interface JewelryDerivableRecord {
  id: string;
  catalog: string;
  tier: number;
  value: number;
  equip?: ItemDef["equip"];
  derivation?: unknown;
}

export type WithJewelryDerivation<T extends JewelryDerivableRecord> =
  Omit<T, "derivation"> & { derivation?: T["derivation"] | JewelryDerivation };

/**
 * Attach only original crafted/guardian identities that exactly match the parameter projection.
 * Other catalogs and their existing gear tags pass through untouched. The caller owns item
 * schema validation and canonical writing; this helper never changes item values or writes files.
 */
export function attachJewelryDerivations<T extends JewelryDerivableRecord>(
  records: readonly T[], params: JewelryBalance,
): WithJewelryDerivation<T>[] {
  return records.map(record => {
    const variant = record.catalog === "CRAFTED_JEWELRY" ? "crafted"
      : record.catalog === "MINIBOSS_JEWELLERY" ? "miniboss" : undefined;
    if (!variant) return record;
    const identity = /^(crafted|guardian)_(ring|earring)_t([1-9]\d*)$/.exec(record.id);
    if (!identity || identity[1] !== (variant === "crafted" ? "crafted" : "guardian")
      || Number(identity[3]) !== record.tier) {
      throw new Error(`Jewelry ${record.id} does not match its original catalog/tier identity`);
    }
    const derivation: JewelryDerivation = {
      kind: "jewelry", variant, tier: record.tier, shape: identity[2] as JewelryDerivation["shape"],
    };
    const differences: ParityDifference[] = [];
    if (record.derivation !== undefined) {
      collectDifferences(derivation, record.derivation, `${record.id}.derivation`, differences);
      if (differences.length) throw new Error(`Conflicting jewelry derivation ${record.id}: ${JSON.stringify(differences)}`);
    }
    collectDifferences({ tier: record.tier, value: record.value, equip: record.equip },
      jewelry(params, derivation), record.id, differences);
    if (differences.length) throw new Error(`Cannot tag drifted jewelry ${record.id}: ${JSON.stringify(differences)}`);
    return { ...record, derivation };
  });
}
