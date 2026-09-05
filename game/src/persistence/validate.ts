/** Checks the repaired save before any runtime owner receives it. Content ids may be legacy ids. */
import { EQUIP_SLOTS, SKILL_IDS, type RegionId } from "../contracts.js";
import { INVENTORY_SLOTS } from "../state/store.js";

const REGIONS: Readonly<Record<RegionId, true>> = {
  fallowmarch: true, vellenwood: true, karrowmoor: true, kilnhalt: true, gravelmaw: true,
};

type RecordValue = Record<string, unknown>;
type Check = (value: unknown) => boolean;

const record = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const count = (value: unknown): value is number => nonnegative(value) && Number.isSafeInteger(value);
const text = (value: unknown): value is string => typeof value === "string";
const id = (value: unknown): value is string => text(value) && value.length > 0;
const bool = (value: unknown): value is boolean => typeof value === "boolean";
const region = (value: unknown): boolean => text(value) && Object.hasOwn(REGIONS, value);
const vector = (value: unknown): boolean => Array.isArray(value) && value.length === 3 && value.every(finite);
const nullable = (check: Check): Check => (value) => value === null || check(value);
const values = (value: unknown, check: Check): boolean => record(value) && Object.values(value).every(check);
const list = (value: unknown, check: Check): boolean => Array.isArray(value) && value.every(check);
const stack = (value: unknown): boolean => record(value) && id(value.itemId)
  && count(value.quantity) && value.quantity > 0;

/** A reason is returned rather than throwing so rejected imports leave the running store alone. */
export function validateSaveState(value: unknown): string | null {
  const invalid = (slice: string): string => `Save has invalid ${slice}`;
  if (!record(value)) return invalid("state");

  const meta = value.meta;
  if (!record(meta) || !count(meta.saveVersion) || meta.saveVersion < 1
    || !nonnegative(meta.createdAtMs) || !nonnegative(meta.lastSavedAtMs)
    || !nonnegative(meta.playSeconds) || !finite(meta.seed) || !Number.isSafeInteger(meta.seed)) {
    return invalid("metadata");
  }

  const player = value.player;
  if (!record(player) || !id(player.id) || !text(player.name) || !vector(player.position)
    || !finite(player.facingRad) || !region(player.regionId) || !finite(player.health)
    || !finite(player.maxHealth) || player.maxHealth <= 0 || !id(player.respawnPointId)) {
    return invalid("player");
  }
  const movement = player.movement;
  if (!record(movement) || !["idle", "path", "direct"].includes(String(movement.mode))
    || !nullable((path) => list(path, vector))(movement.path) || !count(movement.pathIndex)
    || !nullable(vector)(movement.destination) || !nullable(id)(movement.destinationEntityId)) {
    return invalid("player movement");
  }

  const skills = value.skills;
  if (!record(skills) || !SKILL_IDS.every((skill) => {
    const entry = skills[skill];
    return record(entry) && nonnegative(entry.xp) && count(entry.level) && entry.level >= 1 && entry.level <= 99;
  })) return invalid("skills");

  const inventory = value.inventory;
  if (!record(inventory) || !Array.isArray(inventory.slots) || inventory.slots.length !== INVENTORY_SLOTS
    || !inventory.slots.every((entry, index) => entry === null
      || (stack(entry) && record(entry) && entry.slotIndex === index))) return invalid("inventory");
  const equipment = value.equipment;
  if (!record(equipment) || !EQUIP_SLOTS.every((slot) => nullable(stack)(equipment[slot]))) {
    return invalid("equipment");
  }
  const bank = value.bank;
  if (!record(bank) || !list(bank.slots, stack) || !text(bank.filter)) return invalid("bank");
  if (!nonnegative(value.currency)) return invalid("currency");

  if (!values(value.quests, (quest) => record(quest)
    && ["unstarted", "active", "complete"].includes(String(quest.status)) && count(quest.stage)
    && values(quest.counters, finite) && values(quest.flags, bool))) return invalid("quests");
  const discovery = value.discovery;
  if (!record(discovery) || !values(discovery.entities, nonnegative)
    || !values(discovery.locations, nonnegative) || !list(discovery.regions, region)) {
    return invalid("discovery");
  }
  const magic = value.magic;
  if (!record(magic) || !values(magic.weaponCharges, count)
    || !values(magic.consumedOrbs, bool) || !values(magic.awakenedAltars, bool)) return invalid("magic");
  const combat = value.combat;
  if (!record(combat) || !nullable(id)(combat.preferredSpellId)) return invalid("combat");

  const world = value.world;
  if (!record(world) || !values(world.obstaclesUsed, count)) return invalid("world");
  if (!values(world.enemies, (enemy) => record(enemy) && finite(enemy.health) && vector(enemy.spawnPos)
    && ["idle", "aggro", "dead", "returning"].includes(String(enemy.state))
    && nullable(nonnegative)(enemy.respawnAtMs)
    && (enemy.bossPhase === undefined || count(enemy.bossPhase))
    && (enemy.diedAtMs === undefined || nonnegative(enemy.diedAtMs)))) return invalid("enemies");
  if (!values(world.lootPiles, (pile) => record(pile) && vector(pile.position) && list(pile.items, stack)
    && nonnegative(pile.expiresAtMs) && bool(pile.ownerOnly))) return invalid("loot piles");
  const cache = world.recoveryCache;
  if (cache !== null && (!record(cache) || !id(cache.id) || !vector(cache.position)
    || !region(cache.regionId) || !list(cache.items, stack) || !nonnegative(cache.expiresAtMs)
    || (cache.expiresAtWallMs !== undefined && !nonnegative(cache.expiresAtWallMs)))) {
    return invalid("recovery cache");
  }

  const settings = value.settings;
  if (!record(settings) || !finite(settings.cameraDistance) || settings.cameraDistance <= 0
    || !finite(settings.cameraPitchRad) || !bool(settings.overlaysVisible)
    || !finite(settings.uiScale) || settings.uiScale <= 0) return invalid("settings");
  return null;
}
