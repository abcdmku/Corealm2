import { expect, it, vi } from 'vitest';
import { EntityStore } from '../game/src/world/entities.js';
import { EntityActiveSet } from '../game/src/render/entityActiveSet.js';
import { SKILL_IDS, type SemanticEntity } from '../game/src/contracts.js';

const entity = (id: string, x: number, archetype: SemanticEntity['archetype'] = 'landmark'): SemanticEntity => ({
  id, name: id, archetype, tier: 1, regionId: 'fallowmarch', position: [x, 0, 0],
  state: 'alive', interactions: ['inspect'], view: { assetId: 'fixture' },
});
it('refreshes moving actors without scanning static world positions, and invalidates edits/removal/reset', () => {
  const store = new EntityStore({ skillLevels: () => Object.fromEntries(SKILL_IDS.map(id => [id, 1])) as Record<typeof SKILL_IDS[number], number> });
  const rock = entity('rock', 1), actor = entity('actor', 20, 'enemy');
  store.load([rock, actor]);
  const index = new EntityActiveSet({ cellSize: 4 }); index.setArea([0, 0, 0], 5);
  const initial = store.renderSnapshot(); index.replace(initial);
  const position = vi.spyOn(rock, 'position', 'get');
  store.setPosition('actor', [2, 0, 0]);
  expect(store.renderSnapshot()).toBe(initial);
  index.replace(store.renderSnapshot());
  expect(position).not.toHaveBeenCalled();
  expect(index.selected().map(row => row.id)).toEqual(['actor', 'rock']);
  position.mockRestore();
  store.setPosition('rock', [20, 0, 0]); index.replace(store.renderSnapshot());
  expect(index.selected().map(row => row.id)).toEqual(['actor']);
  store.remove('actor'); index.replace(store.renderSnapshot()); expect(index.selected()).toEqual([]);
  store.load([entity('new', 0)]); index.replace(store.renderSnapshot());
  expect(index.selected().map(row => row.id)).toEqual(['new']);
  store.load([]); index.replace(store.renderSnapshot()); expect(index.selected()).toEqual([]);
});

it('continues checking mutable unversioned snapshots and replacing same-id entities', () => {
  const index = new EntityActiveSet(), rock = entity('rock', 1), rows = [rock];
  index.setArea([0, 0, 0], 5); index.replace(rows);
  rock.position = [20, 0, 0]; index.replace(rows); expect(index.selected()).toEqual([]);
  rows[0] = entity('rock', 0); index.replace(rows); expect(index.selected()[0]).toBe(rows[0]);
});
