import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { useQueries } from "@tanstack/react-query";
import { ArrowUpRight, Search, X } from "lucide-react";
import type { CollectionSummary } from "../../shared/contracts.js";
import type { AppProps } from "../model/contracts.js";
import { collectionQuery } from "../api/client.js";
import { contentRows, rowId, rowName } from "../model/rows.js";
import { iconFor, labelFor } from "./library.js";

export function CommandPalette({ open, onOpenChange, collections, navigate }: { open: boolean; onOpenChange: (open: boolean) => void; collections: CollectionSummary[]; navigate: AppProps["navigate"] }) {
  const [search, setSearch] = useState("");
  const queries = useQueries({ queries: collections.map(c => ({ ...collectionQuery(c.name), enabled: open })) });
  const needle = search.toLowerCase().trim();
  const matches = useMemo(() => needle ? queries.flatMap(q => q.data ? contentRows(q.data).map(record => ({ collection: q.data!.collection.name, id: rowId(record, q.data!.collection.idKey), name: rowName(record, q.data!.collection.idKey) })) : []).filter(r => `${r.name} ${r.id}`.toLowerCase().includes(needle)).slice(0, 40) : [], [needle, queries]);
  function go(collection?: string, id?: string) { navigate(collection, id); onOpenChange(false); setSearch(""); }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="command-dialog" aria-describedby="command-help"><Dialog.Title className="sr-only">Search the codex</Dialog.Title><Command shouldFilter={false} label="Search the codex"><div className="command-input-wrap"><Search size={19}/><Command.Input value={search} onValueChange={setSearch} placeholder="Search collections, names or IDs…" autoFocus/><Dialog.Close className="icon-button" aria-label="Close search"><X size={18}/></Dialog.Close></div><Command.List><Command.Empty>No matches. Try another name or ID.</Command.Empty><Command.Group heading="Collections">{collections.filter(c => labelFor(c.name).toLowerCase().includes(needle) || c.name.includes(needle)).map(c => { const Icon = iconFor(c.name); return <Command.Item key={c.name} value={`collection:${c.name}`} onSelect={() => go(c.name)}><Icon size={17}/><span>{labelFor(c.name)}</span><small>{c.count}</small><ArrowUpRight size={15}/></Command.Item>; })}</Command.Group>{matches.length > 0 && <Command.Group heading="Records">{matches.map(r => <Command.Item key={`${r.collection}:${r.id}`} value={`${r.collection}:${r.id}`} onSelect={() => go(r.collection, r.id)}><span>{r.name}</span><small>{labelFor(r.collection)}</small><ArrowUpRight size={15}/></Command.Item>)}</Command.Group>}{open && queries.some(q => q.isLoading) && <Command.Loading>Loading records…</Command.Loading>}</Command.List></Command><p className="command-footer" id="command-help"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>↵</kbd> to open</span><span><kbd>esc</kbd> to close</span></p></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
