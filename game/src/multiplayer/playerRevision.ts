import { createHash } from "node:crypto";
import type { PlayerCharacter } from "../contracts.js";

const HASHED = ["inventory", "bank", "equipment", "currency", "skills"] as const;

/**
 * A short hash of what an editor shows and changes. Position is left out: a walking player moves ten
 * times a second, and an inventory edit must not lose a race with their feet. `GET` returns it,
 * `PATCH` takes it back as `expect.revision`, and a player who looted in between is a 409.
 */
export function playerRevision(character: PlayerCharacter): string {
  const hash = createHash("sha256");
  for (const key of HASHED) hash.update(JSON.stringify(key === "bank" ? character.bank.slots : key === "inventory" ? character.inventory.slots : character[key])).update("\n");
  return hash.digest("hex").slice(0, 16);
}
