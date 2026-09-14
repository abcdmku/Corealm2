import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { useQueries } from "@tanstack/react-query";
import { ArrowUpRight, Search, X } from "lucide-react";
import type { CollectionSummary } from "../../shared/contracts.js";
import type { AppProps } from "../model/contracts.js";
import { collectionQuery } from "../api/client.js";
import { displayRows, rowId, rowName } from "../model/rows.js";
import { summaryContext } from "../model/refs.js";
import { summarize, type RecordSummary } from "../model/summaries.js";
import { Thumb } from "./Thumb.js";
import { iconFor, isGeneratedCollection, labelFor } from "./library.js";

/** Generated catalogs share labels with their authored source; mark them so the two groups read apart. */
function groupLabel(collection: string): string {
  const label = labelFor(collection);
  return isGeneratedCollection(collection) && !/generated/i.test(label) ? `${label} (generated)` : label;
}

interface Match { collection: string; id: string; name: string; summary: RecordSummary; haystack: string }

export function CommandPalette({ open, onOpenChange, collections, navigate }: { open: boolean; onOpenChange: (open: boolean) => void; collections: CollectionSummary[]; navigate: AppProps["navigate"] }) {
  const [search, setSearch] = useState("");
  const queries = useQueries({ queries: collections.map(c => ({ ...collectionQuery(c.name), enabled: open })) });
  const needle = search.toLowerCase().trim();
  // Every loaded record with its visual summary, so results carry the same thumbnail as the browser.
  const entries = useMemo(() => {
    const loaded = queries.flatMap(q => q.data ? [q.data] : []);
    const ctx = summaryContext({ collections: new Map(loaded.map(response => [response.collection.name, response])) });
    const enemies = loaded.find(response => response.collection.name === "enemies");
    return loaded.flatMap(response => displayRows(response, enemies).map((record): Match => {
      const id = rowId(record, response.collection.idKey);
      const name = rowName(record, response.collection.idKey);
      const summary = summarize(response.collection.name, record, ctx);
      return { collection: response.collection.name, id, name, summary, haystack: `${summary.title} ${name} ${id}`.toLowerCase() };
    }));
  }, [queries]);
  const groups = useMemo(() => {
    if (!needle) return [] as { collection: string; matches: Match[] }[];
    const matches = entries.filter(entry => entry.haystack.includes(needle)).slice(0, 40);
    const byCollection = new Map<string, Match[]>();
    for (const match of matches) {
      const list = byCollection.get(match.collection) ?? [];
      list.push(match);
      byCollection.set(match.collection, list);
    }
    return [...byCollection.entries()].map(([collection, list]) => ({ collection, matches: list }));
  }, [needle, entries]);
  function go(collection?: string, id?: string) { navigate(collection, id); onOpenChange(false); setSearch(""); }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="command-dialog" aria-describedby="command-help"><Dialog.Title className="sr-only">Search the codex</Dialog.Title><Command shouldFilter={false} label="Search the codex"><div className="command-input-wrap"><Search size={17} /><Command.Input value={search} onValueChange={setSearch} placeholder="Search collections, names or IDs…" autoFocus /><Dialog.Close className="icon-button" aria-label="Close search"><X size={16} /></Dialog.Close></div><Command.List><Command.Empty>No matches. Try another name or ID.</Command.Empty><Command.Group heading="Collections">{collections.filter(c => labelFor(c.name).toLowerCase().includes(needle) || c.name.includes(needle)).map(c => { const Icon = iconFor(c.name); return <Command.Item key={c.name} value={`collection:${c.name}`} onSelect={() => go(c.name)}><span className="thumb" data-size="s"><span className="thumb-glyph"><Icon /></span></span><span>{labelFor(c.name)}</span><small>{c.count}</small><ArrowUpRight size={14} /></Command.Item>; })}</Command.Group>{groups.map(group => <Command.Group key={group.collection} heading={groupLabel(group.collection)}>{group.matches.map(r => <Command.Item key={`${r.collection}:${r.id}`} value={`${r.collection}:${r.id}`} onSelect={() => go(r.collection, r.id)}><Thumb spec={r.summary.thumb} size="s" alt="" /><span>{r.summary.title}</span><small>{r.summary.subtitle ?? r.id}</small><ArrowUpRight size={14} /></Command.Item>)}</Command.Group>)}{open && queries.some(q => q.isLoading) && <Command.Loading>Loading records…</Command.Loading>}</Command.List></Command><p className="command-footer" id="command-help"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>↵</kbd> to open</span><span><kbd>esc</kbd> to close</span></p></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
