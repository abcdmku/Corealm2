import { useQuery } from '@tanstack/react-query';
import { collectionQuery } from '../api/client.js';
import type { ContentRow, EntityDetailProps } from '../model/contracts.js';
import { ValueView } from './EntityDetail.js';

const combatFields = ['family', 'tier', 'maxHealth', 'attackLevel', 'defenceLevel', 'accuracy', 'armour', 'magicArmour', 'maxHit', 'attackSpeedMs', 'attackStyle', 'attackRangeM', 'aggroRadius', 'behaviour', 'moveSpeedMps', 'walkSpeedMps', 'respawnSeconds', 'marks'];

/** Join authored combat and loot records without copying them into species JSON. */
export function CreatureDetails({ collection, record, navigate }: EntityDetailProps) {
  const enemies = useQuery({ ...collectionQuery('enemies'), enabled: collection !== 'enemies' });
  const loot = useQuery(collectionQuery('lootTables'));
  const blockId = collection === 'enemies' ? String(record.id) : String(record.blockId);
  const base = collection === 'enemies' ? record : (enemies.data?.data as ContentRow[] | undefined)?.find(row => row.id === blockId);
  const block = base && collection === 'enemyAliases' ? { ...base, ...(record.overrides as ContentRow) } : base;
  const lootId = record.lootTableId ?? block?.lootTableId;
  const table = (loot.data?.data as ContentRow[] | undefined)?.find(row => row.id === lootId);
  const errors = [enemies, loot].filter(query => query.isError);
  return <section className="detail-section">
    <div className="section-heading"><h2>Combat and drops</h2>{collection !== 'enemies' && <button className="reference-link" onClick={() => navigate('enemies', blockId)}>Open combat record</button>}</div>
    {errors.length > 0 && <p role="alert">Combat or loot data could not be loaded. <button onClick={() => errors.forEach(query => void query.refetch())}>Retry</button></p>}
    {!block && enemies.isPending ? <p role="status">Loading combat data…</p> : block ? <ValueView value={Object.fromEntries(combatFields.filter(key => block[key] !== undefined).map(key => [key, block[key]]))} navigate={navigate}/> : <p role="alert">The combat record is missing.</p>}
    <div className="section-heading"><h3>Drops</h3>{typeof lootId === 'string' && <button className="reference-link" onClick={() => navigate('lootTables', lootId)}>Open loot table</button>}</div>
    {loot.isPending ? <p role="status">Loading drops…</p> : table ? <ValueView value={table.drops} navigate={navigate}/> : !loot.isError && <p role="alert">The loot table is missing.</p>}
  </section>;
}
