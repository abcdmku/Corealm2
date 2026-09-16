import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { LootTableSchema } from "../../../../game/src/content/schema/loot.js";
import { useRecordDraft } from "../../model/draft.js";
import { rowName } from "../../model/rows.js";
import { Facts, Field, ReferencedBy, Section, Sheet, TextField, fieldFromSchema } from "../../ui/field/index.js";
import { EmptyState, LoadingRows } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import type { ViewProps } from "../types.js";
import { DropRows, dropList } from "./DropRows.js";
import { useCreatureData, type LootTable } from "./shared.js";
import "./creatures.css";

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
  return <div className="ws-page ws-page-narrow loot-view">
    <div className="bestiary-toolbar">
      <label className="search-field"><Search size={14} /><input aria-label="Search loot tables" placeholder="Search tables and items…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button type="button" aria-label="Clear search" className="icon-button" onClick={() => setSearch("")}><X size={13} /></button>}</label>
      <span className="bestiary-count mono">{data.loading ? "" : `${rows.length} of ${data.lootTables.length}`}</span>
    </div>
    {data.loading && !data.lootTables.length && <LoadingRows />}
    {!data.loading && !rows.length && <p className="empty-inline">No tables match.</p>}
    <div className="loot-list">
      {rows.map(({ table, drops, users }) => <button type="button" key={table.id} className="ref-row loot-row" onClick={() => navigate("lootTables", table.id)} title={table.id}>
        <Thumb spec={{ kind: "items", ids: drops.map(drop => drop.itemId) }} size="l" alt="" />
        <span className="ref-row-body">
          <span className="ref-row-title">{table.name}</span>
          <span className="ref-row-sub">{drops.map(drop => { const item = data.ctx.lookup("item", drop.itemId); return item ? rowName(item) : drop.itemId; }).join(", ") || "No drops"}</span>
        </span>
        <span className="ref-row-meta"><Facts items={[`${drops.length} ${drops.length === 1 ? "drop" : "drops"}`, `${users.length} ${users.length === 1 ? "creature" : "creatures"}`]} /></span>
      </button>)}
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

  if (draft.loading) return <div className="ws-page"><LoadingRows /></div>;
  if (!working) return <div className="ws-page"><EmptyState title="Loot table not found">"{id}" is not a loot table. <button type="button" className="text-button" onClick={() => navigate("lootTables")}>Back to loot tables</button></EmptyState></div>;

  return <div className="ws-page ws-page-narrow loot-page">
    <header className="record-head">
      <Thumb spec={{ kind: "items", ids: drops.map(drop => drop.itemId) }} size="xl" alt="" />
      <div className="record-title">
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
      <Section title={DROPS.label} aside={<span>each drop rolls on its own</span>} className="loot-drops">
        <DropRows drops={drops} readOnly={!editable} onChange={next => draft.setPath(["drops"], next)} />
        {DROPS.hint && <p className="field-hint">{DROPS.hint}</p>}
      </Section>
      <ReferencedBy collection="lootTables" id={id} navigate={navigate} />
    </Sheet>
  </div>;
}
