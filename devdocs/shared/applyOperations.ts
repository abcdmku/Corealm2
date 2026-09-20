import { CONTENT_COLLECTIONS } from '../../game/src/content/compiler/collections.js';
import { renameReferences } from '../../game/src/content/compiler/references.js';
import type { ContentOperation } from './contracts.js';

/**
 * Turning the editor's put/delete/rename operations into whole collection values.
 *
 * Both writers need this and neither may drift from the other: the repo transaction writes the
 * result to `game/content/data/`, and server mode sends it to `POST /admin/content/publish`, which
 * takes whole collections. A rename is the reason this is not a one-liner — an id is referenced from
 * every other collection, so the new id has to be carried through all of them before either writer
 * sees the value. Pure, so it runs in Node and in the browser.
 */

/** Rename reference kinds by collection, for the shared `RefKind` union in the schemas. */
const REF_KINDS: Readonly<Record<string, string>> = {
  items: 'item', recipes: 'recipe', resources: 'resource', npcs: 'npc', shops: 'shop', quests: 'quest', dialogue: 'dialogue',
  spells: 'spell', spellRunes: 'rune', equipmentSets: 'set', lootTables: 'lootTable', creatureDefinitions: 'species',
  creatureProfiles: 'creatureProfile', encounters: 'encounter', materials: 'material', equipmentFamilies: 'equipmentFamily',
  recipeTemplates: 'recipeTemplate',
};
/** Domain references whose finite schemas name their own field rather than using `RefKind`. */
const REF_FIELDS: Readonly<Record<string, string>> = {
  equipmentFamilies: 'familyId', recipeTemplates: 'templateId', creatureProfiles: 'profileId', creatureDefinitions: 'baseId', encounters: 'encounterId',
};

export class OperationError extends Error {
  constructor(message: string) { super(message); this.name = 'OperationError'; }
}

/**
 * Applies `changes` to `values` in place and returns it. `values` maps collection name to the whole
 * authored value, and must already hold every collection, because a rename reads all of them.
 * Throws `OperationError` with the message the editor shows for an operation that cannot apply.
 */
export function applyOperations(values: Map<string, unknown>, changes: readonly ContentOperation[]): Map<string, unknown> {
  for (const change of changes) {
    const spec = CONTENT_COLLECTIONS.find(candidate => candidate.name === change.collection);
    if (!spec) throw new OperationError(`Unknown collection ${change.collection}`);
    if (!change.id || typeof change.id !== 'string') throw new OperationError('Record ID required');
    if (spec.shape === 'object') {
      if (change.kind !== 'put' || change.id !== '$collection') throw new OperationError('Object collections support replacement only');
      values.set(spec.name, change.record);
      continue;
    }
    const rows = values.get(spec.name) as Record<string, unknown>[], index = rows.findIndex(row => String(row[spec.idKey]) === change.id);
    if (change.kind === 'put') {
      if (!change.record || typeof change.record !== 'object' || String((change.record as Record<string, unknown>)[spec.idKey]) !== change.id)
        throw new OperationError('Record ID must match URL. Use Rename to change identity.');
      if (change.create && index >= 0) throw new OperationError(`Record ${change.id} already exists`);
      if (index < 0) rows.push(change.record as Record<string, unknown>); else rows[index] = change.record as Record<string, unknown>;
    } else if (change.kind === 'delete') {
      if (index < 0) throw new OperationError(`Unknown record ${change.id}`);
      rows.splice(index, 1);
    } else if (change.kind === 'rename') {
      if (index < 0 || !change.nextId || rows.some(row => String(row[spec.idKey]) === change.nextId)) throw new OperationError('Rename requires an existing record and unused new ID');
      rows[index]![spec.idKey] = change.nextId;
      const kind = REF_KINDS[spec.name];
      if (!kind) throw new OperationError('This collection has no rename reference contract');
      for (const target of CONTENT_COLLECTIONS) {
        // A caller that holds only some collections (a test fixture) gets the rename in the ones it has.
        if (!values.has(target.name)) continue;
        const raw = values.get(target.name);
        const rewrite = (row: unknown): unknown => {
          let result = renameReferences(target.schema, row, kind, change.id, change.nextId);
          if (spec.name === 'creatureDefinitions') result = renameReferences(target.schema, result, 'enemy', change.id, change.nextId);
          return result;
        };
        values.set(target.name, target.shape === 'array' ? (raw as unknown[]).map(rewrite) : rewrite(raw));
      }
      const field = REF_FIELDS[spec.name];
      if (field) {
        const rewrite = (raw: unknown): unknown => Array.isArray(raw) ? raw.map(rewrite)
          : raw && typeof raw === 'object' ? Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, key === field && value === change.id ? change.nextId : rewrite(value)]))
          : raw;
        for (const [name, raw] of values) values.set(name, rewrite(raw));
      }
      if (spec.name === 'materials') for (const tier of (values.get('progression') ?? []) as { materials: Record<string, string> }[])
        for (const key of Object.keys(tier.materials)) if (tier.materials[key] === change.id) tier.materials[key] = change.nextId;
    } else throw new OperationError('Unknown operation');
  }
  return values;
}
