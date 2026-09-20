import { useMemo, useState } from "react";
import { LootTableSchema } from "../../../../game/src/content/schema/loot.js";
import { useRecordDraft } from "../../model/draft.js";
import { rowName } from "../../model/rows.js";
import { Facts, Field, ReferencedBy, Section, Sheet, TextField, fieldFromSchema } from "../../ui/field/index.js";
import { EmptyState, LoadingRows } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import type { ViewProps } from "../types.js";
import { LootRollRows } from "./LootRollRows.js";
import { lootRollPreview } from "../../model/loot.js";
import { useQueryClient } from "@tanstack/react-query";
import { collectionQuery } from "../../api/client.js";
import { runTransaction } from "../../model/draft.js";
import { toast } from "sonner";
import { useCreatureData, type LootTable } from "./shared.js";
import { Button, SearchInput } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
import { COUNT, EMPTY, PAGE, RECORD_HEAD, RECORD_TITLE, TOOLBAR } from "../../ui/layout.js";
import { ListRow } from "../../ui/ListRow.js";

const NAME = fieldFromSchema(LootTableSchema, "name");


/** Shared loot tables: what drops, and which creatures roll on them. */
export default function LootView({ recordId, navigate }: ViewProps) {
  if (recordId) return <LootTablePage key={recordId} id={recordId} navigate={navigate} />;
  return <LootList navigate={navigate} />;
}

function LootList({ navigate }: { navigate: ViewProps["navigate"] }) {
  const data = useCreatureData();
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  async function createTable() {
    const revision = data.revisionOf("lootTables");
    if (!revision || creating) return;
    let index = 1;
    while (data.lootById.has(`loot_table_${index}`)) index++;
    const id = `loot_table_${index}`;
    setCreating(true);
    try {
      const record = { id, name: "New loot table", rolls: [{ id: "items", name: "Items", count: 1, drops: [], tables: [] }] };
      const saving = runTransaction("save", { lootTables: revision }, [{ kind: "put", collection: "lootTables", id, create: true, record }]);
      // Publishing content can reload Vite before its response arrives. Keep the new route through that reload.
      queryClient.setQueryData(collectionQuery("lootTables").queryKey, previous => previous
        ? { ...previous, data: [...(previous.data as LootTable[]), record] } : previous);
      navigate("lootTables", id);
      await saving;
      await queryClient.invalidateQueries({ queryKey: collectionQuery("lootTables").queryKey });
    } catch (error) { await queryClient.invalidateQueries({ queryKey: collectionQuery("lootTables").queryKey }); navigate("lootTables"); toast.error(error instanceof Error ? error.message : "Could not create loot table"); }
    finally { setCreating(false); }
  }
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return data.lootTables
      .map(table => ({ table, drops: lootRollPreview(table, id => data.lootById.get(id)).flatMap(roll => roll.drops).filter((drop): drop is typeof drop & { itemId: string } => typeof drop.itemId === "string"), users: data.usersOfTable(table.id) }))
      .filter(entry => !needle || `${entry.table.name} ${entry.table.id} ${entry.drops.map(drop => drop.itemId).join(" ")}`.toLowerCase().includes(needle))
      .sort((a, b) => b.users.length - a.users.length || a.table.name.localeCompare(b.table.name));
  }, [data, search]);
  return <div className={cn(PAGE, "max-w-[67.5rem]")}>
    <div className={TOOLBAR}>
      <SearchInput label="Search loot tables" shortcut onEnter={() => { if (rows[0]) navigate("lootTables", rows[0].table.id); }} placeholder="Search tables and items…" value={search} onChange={setSearch} />
      {data.index.collections.get("lootTables")?.collection.editable && <Button variant="outline" size="sm" disabled={creating || !data.revisionOf("lootTables")} onClick={() => void createTable()}>New loot table</Button>}
      <span className={COUNT}>{data.loading ? "" : `${rows.length} of ${data.lootTables.length}`}</span>
    </div>
    {data.loading && !data.lootTables.length && <LoadingRows />}
    {!data.loading && !rows.length && <p className={EMPTY}>No tables match.</p>}
    <div className="flex flex-col gap-0.5">
      {rows.map(({ table, drops, users }) => <ListRow key={table.id} hint={table.id} onClick={() => navigate("lootTables", table.id)}
        art={<Thumb spec={{ kind: "items", ids: drops.map(drop => drop.itemId) }} size="l" alt="" />}
        title={table.name}
        subtitle={drops.map(drop => { const item = data.ctx.lookup("item", drop.itemId); return item ? rowName(item) : drop.itemId; }).join(", ") || "No drops"}
        meta={<Facts className="font-sans" items={[`${drops.length} items`, `${table.rolls.reduce((sum, roll) => sum + roll.count, 0)} rolls`, `${users.length} ${users.length === 1 ? "creature" : "creatures"}`]} />} />)}
    </div>
  </div>;
}

function LootTablePage({ id, navigate }: { id: string; navigate: ViewProps["navigate"] }) {
  const data = useCreatureData();
  const draft = useRecordDraft<LootTable>("lootTables", id);
  const working = draft.draft ?? draft.record;
  const editable = draft.editable;
  const users = data.usersOfTable(id);
  const drops = lootRollPreview(working, id => data.lootById.get(id)).flatMap(roll => roll.drops).filter((drop): drop is typeof drop & { itemId: string } => typeof drop.itemId === "string");

  if (draft.loading) return <div className={PAGE}><LoadingRows /></div>;
  if (!working) return <div className={PAGE}><EmptyState title="Loot table not found">"{id}" is not a loot table. <Button variant="link" size="inline" onClick={() => navigate("lootTables")}>Back to loot tables</Button></EmptyState></div>;

  return <div className={cn(PAGE, "max-w-[67.5rem]")}>
    <header className={RECORD_HEAD}>
      <Thumb spec={{ kind: "items", ids: drops.map(drop => drop.itemId) }} size="xl" alt="" />
      <div className={RECORD_TITLE}>
        <h1>{working.name}</h1>
        <Facts items={[`${drops.length} items`, `${working.rolls.reduce((sum, roll) => sum + roll.count, 0)} rolls`, `used by ${users.length} ${users.length === 1 ? "creature" : "creatures"}`]} />
        <code>{id}</code>
      </div>
    </header>
    <Sheet>
      <Section title="Table">
        <Field label={NAME.label} hint={NAME.hint} dirty={draft.dirty && working.name !== draft.record?.name} disabled={!editable}>
          <TextField value={working.name ?? ""} readOnly={!editable} onChange={value => draft.setPath(["name"], value)} />
        </Field>
      </Section>
      <Section title="Rolls">
        <LootRollRows rolls={working.rolls} tables={data.lootTables} tableId={id} tableUsers={tableId => data.usersOfTable(tableId).length} readOnly={!editable} onChange={rolls => draft.setPath(["rolls"], rolls)} />
      </Section>
      <ReferencedBy collection="lootTables" id={id} navigate={navigate} />
    </Sheet>
  </div>;
}
