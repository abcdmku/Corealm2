import type { ContentRow } from './contracts.js';

const record = (value: unknown): ContentRow => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ContentRow : {};
const list = (value: unknown): ContentRow[] => Array.isArray(value) ? value.map(record) : [];
export interface LootRollPreview { id: string; name: string; count: number; drops: ContentRow[] }

/** Read partially loaded authoring data without hiding direct items when a linked pool is missing. */
export function lootRollPreview(value: unknown, lookup: (id: string) => ContentRow | undefined): LootRollPreview[] {
  function drops(roll: ContentRow, active = new Set<string>()): ContentRow[] {
    return [...list(roll.drops), ...list(roll.tables).flatMap(link => {
      const key = `${link.tableId}:${link.rollId}`;
      if (active.has(key) || typeof link.tableId !== 'string') return [];
      const source = list(lookup(link.tableId)?.rolls).find(row => row.id === link.rollId);
      return source ? drops(source, new Set([...active, key])) : [];
    })];
  }
  return list(record(value).rolls).map(roll => ({
    id: String(roll.id ?? ''), name: String(roll.name ?? roll.id ?? 'Items'),
    count: typeof roll.count === 'number' ? roll.count : 0, drops: drops(roll),
  }));
}

export interface RollOdds {
  /** Chance one roll of the pool selects an item. */
  perRoll: number;
  /** Chance at least one of the roll's repeats selects an item. */
  any: number;
  /** Item stacks the roll yields per kill, on average. */
  stacks: number;
}
export interface LootOdds { any: number; stacks: number; items: number; rolls: number }

const clamp = (value: number): number => Math.min(1, Math.max(0, value));
type OddsRoll = { count: number; drops: readonly { itemId?: unknown; chance: number }[] };

/** What one roll group is worth: a roll picks at most one item, and repeats are independent. */
export function rollOdds(roll: OddsRoll): RollOdds {
  const perRoll = clamp(roll.drops.reduce((sum, drop) => sum + drop.chance, 0));
  return { perRoll, any: 1 - (1 - perRoll) ** roll.count, stacks: perRoll * roll.count };
}

/** A kill's odds across every roll group. Gold is left to the caller: it is not a chance. */
export function lootOdds(rolls: readonly OddsRoll[]): LootOdds {
  const odds = rolls.map(rollOdds);
  return {
    any: 1 - odds.reduce((none, roll) => none * (1 - roll.any), 1),
    stacks: odds.reduce((sum, roll) => sum + roll.stacks, 0),
    items: new Set(rolls.flatMap(roll => roll.drops.map(drop => drop.itemId))).size,
    rolls: rolls.reduce((sum, roll) => sum + roll.count, 0),
  };
}

/** Chance an item with `chance` per roll turns up at least once in `count` rolls. */
export const dropPerKill = (chance: number, count: number): number => 1 - (1 - clamp(chance)) ** count;

/** 12%, 0.5%, 0.04%: enough digits to tell rare drops apart, no more. */
export function formatChance(value: number): string {
  const percent = value * 100;
  if (percent >= 10) return `${Number(percent.toFixed(1))}%`;
  return `${Number(percent.toPrecision(2))}%`;
}
