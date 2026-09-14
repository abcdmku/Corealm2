import { CREATURE_CATALOG } from './creatureRuntime.js';

/** Importing the shared compiler validates sources, direct bases, profiles and combat outputs. */
export function assertCreatureCatalog(): void {
  if (!CREATURE_CATALOG.creatures.length) throw new Error('Creature catalog must not be empty');
}
