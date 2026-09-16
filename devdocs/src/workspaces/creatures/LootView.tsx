import { useMemo, useState } from "react";
import { LootTableSchema } from "../../../../game/src/content/schema/loot.js";
import { useRecordDraft } from "../../model/draft.js";
import { rowName } from "../../model/rows.js";
import { Facts, Field, ReferencedBy, Section, Sheet, TextField, fieldFromSchema } from "../../ui/field/index.js";
import { EmptyState, LoadingRows } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import type { ViewProps } from "../types.js";
import { DropRows, dropList } from "./DropRows.js";
import { useCreatureData, type LootTable } from "./shared.js";
import { Button, SearchInput } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
import { COUNT, EMPTY, PAGE, RECORD_HEAD, RECORD_TITLE, TOOLBAR } from "../../ui/layout.js";
import { ListRow } from "../../ui/ListRow.js";

const NAME = fieldFromSchema(LootTableSchema, "name");
const DROPS = fieldFromSchema(LootTableSchema, "drops");

/** Shared loot tables: what drops, and which creatures roll on them. */
export default function LootView({ recordId, navigate }: ViewProps) {
  if (recordId) return <LootTablePage key={recordId} id={recordId} navigate={navigate} />;
  return <LootList navigate={navigate} />;
}

function LootList({ navigate }: { navigate: ViewProps["navigate"] }) {
  const data = useCreatureData();
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return data.lootTables
      .map(table => ({ table, drops: dropList(table.drops), users: data.usersOfTable(table.id) }))
      .filter(entry => !needle || `${entry.table.name} ${entry.table.id} ${entry.drops.map(drop => drop.itemId).join(" ")}`.toLowerCase().includes(needle))
      .sort((a, b) => b.users.length - a.users.length || a.table.name.localeCompare(b.table.name));
  }, [data, search]);
  return <div className={cn(PAGE, "max-w-[67.5rem]")}>
    <div className={TOOLBAR}>
      <SearchInput label="Search loot tables" shortcut onEnter={() => { if (rows[0]) navigate("lootTables", rows[0].table.id); }} placeholder="Search tables and items…" value={search} onChange={setSearch} />
      <span className={COUNT}>{data.loading ? "" : `${rows.length} of ${data.lootTables.length}`}</span>
    </div>
    {data.loading && !data.lootTables.length && <LoadingRows />}
    {!data.loading && !rows.length && <p className={EMPTY}>No tables match.</p>}
    <div className="flex flex-col gap-0.5">
      {rows.map(({ table, drops, users }) => <ListRow key={table.id} hint={table.id} onClick={() => navigate("lootTables", table.id)}
        art={<Thumb spec={{ kind: "items", ids: drops.map(drop => drop.itemId) }} size="l" alt="" />}
        title={table.name}
        subtitle={drops.map(drop => { const item = data.ctx.lookup("item", drop.itemId); return item ? rowName(item) : drop.itemId; }).join(", ") || "No drops"}
        meta={<Facts className="font-sans" items={[`${drops.length} ${drops.length === 1 ? "drop" : "drops"}`, `${users.length} ${users.length === 1 ? "creature" : "creatures"}`]} />} />)}
    </div>
  </div>;
}

function LootTablePage({ id, navigate }: { id: string; navigate: ViewProps["navigate"] }) {
  const data = useCreatureData();
  const draft = useRecordDraft<LootTable>("lootTables", id);
  const working = draft.draft ?? draft.record;
  const editable = draft.editable;
  const users = data.usersOfTable(id);
  const drops = dropList(working?.drops);

  if (draft.loading) return <div className={PAGE}><LoadingRows /></div>;
  if (!working) return <div className={PAGE}><EmptyState title="Loot table not found">"{id}" is not a loot table. <Button variant="link" size="inline" onClick={() => navigate("lootTables")}>Back to loot tables</Button></EmptyState></div>;

  return <div className={cn(PAGE, "max-w-[67.5rem]")}>
    <header className={RECORD_HEAD}>
      <Thumb spec={{ kind: "items", ids: drops.map(drop => drop.itemId) }} size="xl" alt="" />
      <div className={RECORD_TITLE}>
        <h1>{working.name}</h1>
        <Facts items={[`${drops.length} ${drops.length === 1 ? "drop" : "drops"}`, `used by ${users.length} ${users.length === 1 ? "creature" : "creatures"}`]} />
        <code>{id}</code>
      </div>
    </header>
    <Sheet>
      <Section title="Table">
        <Field label={NAME.label} hint={NAME.hint} dirty={draft.dirty && working.name !== draft.record?.name} disabled={!editable}>
          <TextField value={working.name ?? ""} readOnly={!editable} onChange={value => draft.setPath(["name"], value)} />
        </Field>
      </Section>
      {/* The section heading is the field's label; a second "Drops" beside the list would say it twice. */}
      <Section title={DROPS.label} aside={<span>each drop rolls on its own</span>}>
        <DropRows drops={drops} readOnly={!editable} onChange={next => draft.setPath(["drops"], next)} />
        {DROPS.hint && <p className="mt-1 text-[11px] text-faint">{DROPS.hint}</p>}
      </Section>
      <ReferencedBy collection="lootTables" id={id} navigate={navigate} />
    </Sheet>
  </div>;
}
