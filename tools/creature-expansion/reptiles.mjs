import { buildTortoise } from './reptiles/tortoise.mjs';

export const SPECIES = ['slateback_tortoise', 'ashscale_monitor'];

export async function buildSpecies(id) {
  if (id === 'slateback_tortoise') return buildTortoise();
  if (id === 'ashscale_monitor') return (await import('./reptiles/monitor.mjs')).buildMonitor();
  throw new Error(`Unknown reptile species: ${id}`);
}
