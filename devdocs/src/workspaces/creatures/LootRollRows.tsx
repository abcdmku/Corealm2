import { useState, type ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';
import type { LootRoll } from '../../../../game/src/contracts.js';
import { createLootCompiler } from '../../../../game/src/content/lootCompiler.js';
import type { LootTableRecord } from '../../../../game/src/content/schema/loot.js';
import { useRecordDraft } from '../../model/draft.js';
import { formatChance, lootOdds, rollOdds } from '../../model/loot.js';
import { draftKey, useDraftState } from '../../model/store.js';
import { Badge, Button } from '../../components/ui/index.js';
import { ChoiceField, Facts, NumberField, RefAddButton, RefField, TextField } from '../../ui/field/index.js';
import { Thumb } from '../../ui/Thumb.js';
import { cn } from '../../lib/utils.js';
import { AddDrop, LootCardGrid, StaticLootCards } from './LootCards.js';

const HOW = 'Each roll picks at most one item. Chances are per roll and whatever is left over drops nothing. A pool rolled more than once can pick the same item again. An attached table joins the pool it is attached to; attaching one on its own rolls starts from the table\'s counts.';

function nextId(rolls: LootRoll[], prefix = 'roll'): string {
  let index = 1;
  while (rolls.some(roll => roll.id === `${prefix}_${index}`)) index++;
  return `${prefix}_${index}`;
}

/**
 * Shared editor for creature loot and reusable tables: the kill's odds, then one block of loot
 * cards per roll group. `lead` sits between the two (a creature's gold); `leadFacts` open the odds line.
 */
export function LootRollRows({ rolls, tables, onChange, readOnly = false, tableId, lead, leadFacts = [], tableUsers }: {
  rolls: LootRoll[]; tables: readonly LootTableRecord[]; onChange: (rolls: LootRoll[]) => void; readOnly?: boolean; tableId?: string;
  lead?: ReactNode; leadFacts?: readonly ReactNode[];
  /** How many creatures roll on a table, so editing one in place says who else it changes. */
  tableUsers?: (tableId: string) => number;
}) {
  // Shared tables are edited in place, so odds and cards read their unsaved drafts, not the file.
  const drafts = useDraftState().entries;
  const currentTables = tables.map(table => table.id === tableId ? { ...table, rolls } : (drafts.get(draftKey('lootTables', table.id))?.draft as LootTableRecord | undefined) ?? table);
  const update = (index: number, roll: LootRoll) => onChange(rolls.map((old, at) => at === index ? roll : old));
  let compiled: ReturnType<ReturnType<typeof createLootCompiler>> = [];
  let error: string | undefined;
  try { compiled = createLootCompiler(currentTables)({ rolls }, 'preview'); }
  catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  const odds = lootOdds(compiled);
  return <div data-slot="loot" className="flex w-full flex-col gap-2.5">
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs" title={HOW}>
      <Facts className="text-foreground" items={[
        ...leadFacts,
        !error && rolls.length > 0 && <><strong className="font-mono font-semibold">{formatChance(odds.any)}</strong> of kills drop an item</>,
        !error && rolls.length > 0 && <><strong className="font-mono font-semibold">{Number(odds.stacks.toFixed(2))}</strong> items per kill</>,
        !error && rolls.length > 0 && `${odds.items} possible over ${odds.rolls} ${odds.rolls === 1 ? 'roll' : 'rolls'}`,
        !rolls.length && 'No item rolls',
      ]} />
      <span className="ml-auto text-[11px] text-faint">Each roll picks at most one item</span>
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {lead}
    {rolls.map((roll, index) => {
      const pool = compiled[index];
      const own = pool ? rollOdds(pool) : undefined;
      return <section key={roll.id} data-slot="loot-roll" aria-label={`Roll ${index + 1}`} className="rounded-md border border-border">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-subtle px-2 py-1.5 text-xs">
          <span className="font-mono text-[11px] font-semibold tracking-[.04em] text-faint uppercase">Roll {index + 1}</span>
          <TextField value={roll.name} readOnly={readOnly} width="short" className="w-auto! max-w-72 min-w-48 flex-[0_1_14rem]" ariaLabel={`Roll ${index + 1} name`} onChange={name => update(index, { ...roll, name })} />
          <NumberField value={roll.count} min={0} max={100} integer unit={roll.count === 1 ? 'roll' : 'rolls'} readOnly={readOnly} ariaLabel={`Roll ${index + 1} count`}
            onChange={count => update(index, { ...roll, count: count ?? 0 })} />
          {own && <Facts items={[
            <><strong className="font-mono font-semibold text-foreground">{formatChance(own.perRoll)}</strong> drops an item</>,
            roll.count > 1 && `${formatChance(own.any)} per kill`,
          ]} />}
          {!readOnly && <span className="ml-auto flex items-center gap-0.5">
            <Button variant="ghost" size="sm" className="text-muted-foreground" title="Copy this roll with its loot and tables, to change from there" onClick={() => {
              const copy = { ...structuredClone(roll), id: nextId(rolls), name: `${roll.name} copy` };
              onChange([...rolls.slice(0, index + 1), copy, ...rolls.slice(index + 1)]);
            }}>Duplicate</Button>
            <Button variant="ghost" size="icon-xs" className="text-faint" aria-label={`Remove roll ${roll.name}`} title="Remove roll" onClick={() => onChange(rolls.filter((_, at) => at !== index))}><X /></Button>
          </span>}
        </header>
        <div className="flex flex-col gap-2 p-2">
          {!roll.drops.length && !roll.tables.length && <p className="text-xs text-faint">This roll drops nothing yet. Add its own loot, attach a table, or both.</p>}
          {roll.drops.length > 0 && <LootCardGrid drops={roll.drops} count={roll.count} readOnly={readOnly} onChange={drops => update(index, { ...roll, drops })} />}
          {roll.tables.map((link, linkIndex) => <SharedTablePool key={`${linkIndex}:${link.tableId}`} link={link} tables={currentTables} count={roll.count} readOnly={readOnly}
            name={`Roll ${index + 1} table ${linkIndex + 1}`} tableUsers={tableUsers} hostTableId={tableId}
            onLink={next => update(index, { ...roll, tables: roll.tables.map((old, at) => at === linkIndex ? next : old) })}
            onDetach={() => update(index, { ...roll, tables: roll.tables.filter((_, at) => at !== linkIndex) })} />)}
          {!readOnly && <div className="flex flex-wrap items-center gap-x-3 pl-1.5">
            <AddDrop drops={roll.drops} used={own?.perRoll} onChange={drops => update(index, { ...roll, drops })} />
            <RefAddButton kind="lootTable" label="Attach table" onPick={id => {
              const source = tables.find(table => table.id === id)?.rolls[0];
              update(index, { ...roll, tables: [...roll.tables, { tableId: id, rollId: source?.id ?? '' }] });
            }} />
          </div>}
        </div>
      </section>;
    })}
    {!readOnly && <div className="flex flex-wrap gap-3">
      <Button variant="outline" size="sm" onClick={() => onChange([...rolls, { id: nextId(rolls), name: `Roll ${rolls.length + 1}`, count: 1, drops: [], tables: [] }])}>Add roll</Button>
      <RefAddButton kind="lootTable" label="Add a table's rolls" onPick={id => {
        const next = [...rolls];
        for (const source of tables.find(table => table.id === id)?.rolls ?? []) next.push({
          id: nextId(next), name: source.name, count: source.count, drops: [], tables: [{ tableId: id, rollId: source.id }],
        });
        onChange(next);
      }} />
    </div>}
  </div>;
}

type TableLink = LootRoll['tables'][number];

/**
 * A shared table's roll, attached to a roll here and edited in place. It is tinted and badged so it
 * never reads as the creature's own loot: every edit lands on the table record, for everyone who rolls on it.
 */
function SharedTablePool({ link, tables, count, readOnly, name, tableUsers, hostTableId, onLink, onDetach, depth = 0 }: {
  link: TableLink; tables: readonly LootTableRecord[]; count: number; readOnly: boolean; name: string; tableUsers?: (tableId: string) => number; hostTableId?: string;
  /** Absent for a table reached through another table: the link belongs to that table, not to this record. */
  onLink?: (link: TableLink) => void; onDetach?: () => void; depth?: number;
}) {
  const draft = useRecordDraft<LootTableRecord>('lootTables', link.tableId);
  const table = tables.find(candidate => candidate.id === link.tableId);
  const at = table?.rolls.findIndex(candidate => candidate.id === link.rollId) ?? -1;
  const source = at >= 0 ? table!.rolls[at] : undefined;
  const editable = !readOnly && draft.editable && draft.draft !== undefined && link.tableId !== hostTableId;
  // What the table's roll takes from other tables in turn: each is its own shared table, edited in place below.
  let nested: LootRoll['drops'] = [];
  try { if (table && source?.tables.length) nested = createLootCompiler(tables)({ rolls: [{ ...source, drops: [] }] }, `lootTables.${table.id}`)[0]?.drops ?? []; } catch { /* the pool's own error is already shown */ }
  const deeper = depth < 3 ? source?.tables ?? [] : [];
  const [open, setOpen] = useState(true);
  const all = [...(source?.drops ?? []), ...nested];
  const users = tableUsers?.(link.tableId);
  const others = users === undefined ? undefined : Math.max(0, users - (hostTableId ? 0 : 1));
  return <div data-slot="loot-shared-table" className="flex flex-col gap-1 rounded-md border border-info/40 bg-info-soft p-1.5">
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${table?.name ?? link.tableId}`} title={open ? 'Collapse table' : 'Expand table'} onClick={() => setOpen(!open)}>
        <ChevronDown className={cn('transition-transform', !open && '-rotate-90')} />
      </Button>
      <Badge variant="info" title={editable ? 'A shared loot table, not loot owned by this record. Edits here change the table for everything that rolls on it.' : 'A shared loot table'}>
        Shared table{others ? ` · ${others} other ${others === 1 ? 'creature' : 'creatures'}` : ''}</Badge>
      <RefField bare kind="lootTable" label={name} value={link.tableId} readOnly={readOnly || !onLink}
        onChange={id => { if (id) onLink?.({ tableId: id, rollId: tables.find(candidate => candidate.id === id)?.rolls[0]?.id ?? '' }); }} />
      {(table?.rolls.length ?? 0) > 1 && <ChoiceField value={link.rollId} readOnly={readOnly || !onLink} display="select" width="short" className="w-32!" ariaLabel={`${name} pool`} options={(table?.rolls ?? []).map(entry => ({ value: entry.id, label: entry.name }))}
        onChange={rollId => { if (rollId) onLink?.({ ...link, rollId }); }} />}
      {draft.dirty && <Badge variant="accent">Unsaved</Badge>}
      {!open && <button type="button" className="flex min-w-0 cursor-pointer items-center gap-1.5" title="Expand table" onClick={() => setOpen(true)}>
        <span className="flex items-center gap-0.5">{all.slice(0, 8).map((drop, index) => <Thumb key={`${drop.itemId}:${index}`} spec={{ kind: 'item', id: drop.itemId }} size="s" alt="" />)}</span>
        <span className="whitespace-nowrap">{all.length} {all.length === 1 ? 'drop' : 'drops'} · <strong className="font-mono font-semibold text-foreground">{formatChance(all.reduce((sum, drop) => sum + drop.chance, 0))}</strong> per roll</span>
      </button>}
      {!readOnly && onDetach && <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" aria-label={`Detach ${link.tableId}`} onClick={onDetach}>Detach</Button>}
    </div>
    {!source && <p className="text-xs text-destructive">This table has no roll "{link.rollId}".</p>}
    {open && source && (editable
      ? <>
        <LootCardGrid drops={source.drops} count={count} label={`${name} drop`} onChange={drops => draft.setPath(['rolls', at, 'drops'], drops)} />
        {deeper.map((inner, innerIndex) => <SharedTablePool key={`${innerIndex}:${inner.tableId}`} link={inner} tables={tables} count={count} readOnly={readOnly} name={`${name} table ${innerIndex + 1}`} tableUsers={tableUsers} hostTableId={hostTableId} depth={depth + 1} />)}
        <div className="pl-1.5"><AddDrop drops={source.drops} used={source.drops.reduce((sum, drop) => sum + drop.chance, 0) + nested.reduce((sum, drop) => sum + drop.chance, 0)} label={`Add drop to ${table?.name ?? 'table'}`} onChange={drops => draft.setPath(['rolls', at, 'drops'], drops)} /></div>
      </>
      : <StaticLootCards drops={[...source.drops, ...nested]} count={count} emptyText="This table roll has no drops." />)}
  </div>;
}
