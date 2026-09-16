import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { useQueries } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, ChevronLeft, Search, SlidersHorizontal, X } from "lucide-react";
import type { CollectionResponse, CollectionSummary } from "../../shared/contracts.js";
import { CONTENT_COLLECTIONS } from "../../../tools/content/collections.js";
import type { AppProps } from "../model/contracts.js";
import { collectionQuery } from "../api/client.js";
import { getPath } from "../model/draft.js";
import { contentRows, displayRows, rowId, rowName } from "../model/rows.js";
import { optionsFor, refTargetCollection, summaryContext } from "../model/refs.js";
import { draftStore } from "../model/store.js";
import { summarize, titleCase, type RecordSummary, type ThumbSpec } from "../model/summaries.js";
import { applyEdit, hotkeyFor, hotkeysFor, settableFields, useSelection, type SettableField } from "./grid/index.js";
import { Thumb } from "./Thumb.js";
import { labelFor } from "./library.js";
import { WORKSPACES } from "./workspaces.js";
import { Button, Kbd, buttonVariants } from "../components/ui/index.js";

/** One row of the palette: thumbnail, label, a faint hint, and a trailing icon or hotkey. */
const ITEM = "flex h-8 cursor-pointer items-center gap-2 rounded-sm px-1.5 text-xs text-foreground data-[selected=true]:bg-selected [&>svg]:text-faint";
const ITEM_LABEL = "min-w-0 flex-1 truncate";
const ITEM_HINT = "max-w-[45%] shrink-0 truncate text-[11px] text-faint";
const NOTE = "px-3 py-[18px] text-center text-xs text-muted-foreground";

/*
  Search, and the one place a selection is acted on. With records selected on the page (see
  `ui/grid/selection.ts`) the palette also lists "Set <field>…" for every enum and reference field
  of that collection, and the single-letter keys in `ui/grid/hotkeys.ts` open it straight at one of
  them. Choosing a value writes every selected record through the draft store, one commit each, so
  the shell bar counts them and Ctrl+Z steps back through the set.
*/

/** Expanded catalogs share labels with their authored source; both groups read under the same name. */
function groupLabel(collection: string): string { return labelFor(collection).replace(/ (generated)$/i, ""); }

/** "Loot.Loot table" reads as "loot table" with "Loot" as the hint beside it. */
const leafLabel = (label: string): string => label.slice(label.lastIndexOf(".") + 1);
const parentLabel = (label: string): string => label.includes(".") ? label.slice(0, label.indexOf(".")) : "";

/** A letter is a hotkey unless it is being typed into something. A row checkbox is not typing. */
const isEditing = (target: EventTarget | null | undefined): boolean => target instanceof HTMLElement
  && (target.isContentEditable || target.tagName === "TEXTAREA" || target.tagName === "SELECT"
    || (target instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "range"].includes(target.type)));

interface Match { collection: string; id: string; name: string; summary: RecordSummary; haystack: string }
interface Choice { key: string; value: unknown; label: string; thumb?: ThumbSpec }

export function CommandPalette({ open, onOpenChange, collections, navigate }: { open: boolean; onOpenChange: (open: boolean) => void; collections: CollectionSummary[]; navigate: AppProps["navigate"] }) {
  const [search, setSearch] = useState("");
  /** The field being set on the selection, by its dotted path; undefined is the search step. */
  const [step, setStep] = useState<string | undefined>(undefined);
  const selection = useSelection();
  const queries = useQueries({ queries: collections.map(c => ({ ...collectionQuery(c.name), enabled: open })) });
  const needle = search.toLowerCase().trim();
  const loaded = useMemo(() => queries.flatMap(q => q.data ? [q.data] : []), [queries]);
  const index = useMemo(() => ({ collections: new Map(loaded.map(response => [response.collection.name, response])) }), [loaded]);
  // Every loaded record with its visual summary, so results carry the same thumbnail as the browser.
  const entries = useMemo(() => {
    const ctx = summaryContext(index);
    const enemies = index.collections.get("enemies");
    const authored = new Set(index.collections.keys());
    const skip = (name: string) => name === "compiled-enemies" || name === "compiled-species" || (name === "compiled-items" && authored.has("items")) || (name === "compiled-resources");
    return loaded.filter(response => !skip(response.collection.name)).flatMap(response => displayRows(response, enemies).map((record): Match => {
      const id = rowId(record, response.collection.idKey);
      const name = rowName(record, response.collection.idKey);
      const summary = summarize(response.collection.name, record, ctx);
      return { collection: response.collection.name, id, name, summary, haystack: `${summary.title} ${name} ${id}`.toLowerCase() };
    }));
  }, [loaded, index]);
  const groups = useMemo(() => {
    if (!needle || step) return [] as { collection: string; matches: Match[] }[];
    const matches = entries.filter(entry => entry.haystack.includes(needle)).slice(0, 40);
    const byCollection = new Map<string, Match[]>();
    for (const match of matches) {
      const list = byCollection.get(match.collection) ?? [];
      list.push(match);
      byCollection.set(match.collection, list);
    }
    return [...byCollection.entries()].map(([collection, list]) => ({ collection, matches: list }));
  }, [needle, entries, step]);

  // ---------------------------------------------------------------- the selection
  const bulk = useMemo(() => {
    if (__DEVDOCS_PLAYER__ || !selection.ids.length) return undefined;
    const schema = CONTENT_COLLECTIONS.find(candidate => candidate.name === selection.collection)?.schema;
    if (!schema) return undefined;
    const fields = settableFields(schema, hotkeysFor(selection.collection).map(hotkey => hotkey.path));
    return { collection: selection.collection, schema, fields, count: selection.ids.length, noun: labelFor(selection.collection).toLowerCase() };
  }, [selection]);
  const field = useMemo(() => step ? bulk?.fields.find(candidate => candidate.key === step) : undefined, [step, bulk]);

  const choices = useMemo<Choice[]>(() => {
    if (!field) return [];
    const out: Choice[] = [];
    if (field.spec.ref) {
      const fixed = optionsFor(field.spec.ref, index);
      if (fixed?.length) out.push(...fixed.map(option => ({ key: option.value, value: option.value, label: option.label, thumb: option.thumb })));
      else {
        const target = refTargetCollection(field.spec.ref, [...index.collections.keys()]);
        const response = target ? index.collections.get(target) : undefined;
        if (response) {
          const ctx = summaryContext(index);
          out.push(...contentRows(response).map(row => {
            const id = rowId(row, response.collection.idKey);
            const summary = summarize(response.collection.name, row, ctx);
            return { key: id, value: id, label: summary.title || rowName(row, response.collection.idKey), thumb: summary.thumb };
          }));
        }
      }
    }
    if (!out.length) out.push(...(field.spec.choices ?? []).map(choice => ({ key: String(choice), value: choice, label: titleCase(String(choice)) })));
    // A field with no list of its own (a hotkeyed number such as an item's tier) offers the values
    // the collection already uses; anything else is typed into the search box.
    if (!out.length && bulk) {
      const response = index.collections.get(bulk.collection);
      const used = new Set<string>();
      for (const row of response ? contentRows(response) : []) { const value = getPath(row, field.path); if (value !== undefined && value !== null && typeof value !== "object") used.add(String(value)); }
      out.push(...[...used].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(0, 40).map(text => ({ key: text, value: field.spec.kind === "number" ? Number(text) : text, label: text })));
    }
    if (field.spec.optional) out.push({ key: "$clear", value: undefined, label: "Clear the field" });
    return out;
  }, [field, index, bulk]);
  const shownChoices = useMemo(() => {
    if (!field) return [];
    const matched = (needle ? choices.filter(choice => `${choice.label} ${choice.key}`.toLowerCase().includes(needle)) : choices).slice(0, 80);
    if (field.kind !== "value" || !needle) return matched;
    const typed = field.spec.kind === "number" ? Number(needle) : search.trim();
    if (typeof typed === "number" && !Number.isFinite(typed)) return matched;
    return [{ key: `$typed:${String(typed)}`, value: typed, label: `Set to ${String(typed)}` }, ...matched.filter(choice => choice.key !== String(typed))];
  }, [choices, needle, search, field]);

  function close(): void { onOpenChange(false); setSearch(""); setStep(undefined); }
  function go(collection?: string, id?: string): void { navigate(collection, id); close(); }
  function toStep(next: SettableField): void { setStep(next.key); setSearch(""); }
  function back(): void { setStep(undefined); setSearch(""); }

  /** Write the value into every selected record: one commit each, all labelled with the field path. */
  function apply(target: SettableField, value: unknown): void {
    const response: CollectionResponse | undefined = bulk ? index.collections.get(bulk.collection) : undefined;
    if (!bulk || !response) return;
    const idKey = response.collection.idKey;
    const wanted = new Set(selection.ids);
    const rows = contentRows(response).flatMap(row => { const id = rowId(row, idKey); return wanted.has(id) ? [{ id, row }] : []; });
    const changed = applyEdit({ store: draftStore, collection: bulk.collection, idKey, revision: response.revision, schema: bulk.schema }, rows, target.path, { kind: "set", value });
    if (changed) toast.success(`Set ${leafLabel(target.label).toLowerCase()} for ${changed} ${bulk.noun}`);
    else toast.message(`Every selected record already has that ${leafLabel(target.label).toLowerCase()}`);
    close();
  }

  useEffect(() => { if (!open) { setStep(undefined); setSearch(""); } }, [open]);
  // A single letter with records selected, outside any control, opens the palette at that field.
  useEffect(() => {
    function keys(event: KeyboardEvent): void {
      if (open || !selection.ids.length || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
      const target = event.target instanceof HTMLElement ? event.target : undefined;
      if (isEditing(target) || target?.closest("[role=dialog]")) return;
      const hotkey = hotkeysFor(selection.collection).find(candidate => candidate.key === event.key.toLowerCase());
      if (!hotkey) return;
      // Capture, so the letter never also reaches the grid cell underneath and starts editing it.
      event.preventDefault();
      event.stopPropagation();
      setSearch("");
      setStep(hotkey.path.join("."));
      onOpenChange(true);
    }
    document.addEventListener("keydown", keys, true);
    return () => document.removeEventListener("keydown", keys, true);
  }, [open, selection, onOpenChange]);

  const views = WORKSPACES.filter(workspace => !workspace.devOnly || !__DEVDOCS_PLAYER__).flatMap(workspace => workspace.views.filter(view => !view.hidden).map(view => ({ workspace, view })));
  const title = field ? `Set ${leafLabel(field.label).toLowerCase()}` : "Search the codex";

  return <Dialog.Root open={open} onOpenChange={next => { if (next) onOpenChange(true); else close(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-[#06080cb3] backdrop-blur-[2px] [@media(prefers-reduced-transparency:reduce)]:bg-[#0a0d12e6] [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none" />
      <Dialog.Content className="fixed top-[min(12dvh,100px)] left-1/2 z-[51] w-[min(620px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl shadow-shadow outline-none" aria-describedby="command-help" onEscapeKeyDown={event => { if (field) { event.preventDefault(); back(); } }}>
        <Dialog.Title className="sr-only">{title}</Dialog.Title>
        <Command shouldFilter={false} label={title} className="[&_[cmdk-group-heading]]:px-1.5 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:pb-0.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-faint" onKeyDown={event => { if (field && event.key === "Backspace" && !search) { event.preventDefault(); back(); } }}>
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-muted-foreground">
            {field
              ? <Button variant="ghost" size="icon-sm" aria-label="Back to search" onClick={back}><ChevronLeft size={17} /></Button>
              : <Search size={17} />}
            <Command.Input value={search} onValueChange={setSearch} placeholder={field ? `Search ${leafLabel(field.label).toLowerCase()} values…` : "Search collections, names or IDs…"} autoFocus className="h-7 w-full min-w-0 flex-1 border-0 bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint" />
            <Dialog.Close className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label="Close search"><X size={16} /></Dialog.Close>
          </div>
          <Command.List className="max-h-[min(440px,60dvh)] overflow-auto p-1 [scrollbar-width:thin]">
            <Command.Empty className={NOTE}>{field ? "No matching value." : "No matches. Try another name or ID."}</Command.Empty>
            {field && bulk
              ? <Command.Group heading={`Set ${leafLabel(field.label).toLowerCase()} for ${bulk.count} ${bulk.noun}`}>
                {shownChoices.map(choice => <Command.Item key={choice.key} value={`choice:${choice.key}`} onSelect={() => apply(field, choice.value)} className={ITEM}>
                  <Thumb spec={choice.thumb ?? { kind: "glyph", icon: SlidersHorizontal }} size="s" alt="" />
                  <span className={ITEM_LABEL}>{choice.label}</span>
                  {choice.key !== choice.label && choice.key !== "$clear" && <small className={ITEM_HINT}>{choice.key}</small>}
                </Command.Item>)}
              </Command.Group>
              : <>
                {bulk && bulk.fields.length > 0 && <Command.Group heading={`${bulk.count} ${bulk.noun} selected`}>
                  {bulk.fields.filter(candidate => !needle || candidate.label.toLowerCase().includes(needle)).map(candidate => {
                    const hotkey = hotkeyFor(bulk.collection, candidate.path);
                    return <Command.Item key={candidate.key} value={`set:${candidate.key}`} onSelect={() => toStep(candidate)} className={ITEM}>
                      <Thumb spec={{ kind: "glyph", icon: SlidersHorizontal }} size="s" alt="" />
                      <span className={ITEM_LABEL}>Set {leafLabel(candidate.label).toLowerCase()}…</span>
                      <small className={ITEM_HINT}>{parentLabel(candidate.label) && `${parentLabel(candidate.label)} · `}{bulk.count} {bulk.noun}</small>
                      {hotkey && <Kbd className="h-[18px] min-w-[18px] text-[11px] uppercase">{hotkey.key}</Kbd>}
                    </Command.Item>;
                  })}
                </Command.Group>}
                <Command.Group heading="Go to">
                  {views.filter(({ workspace, view }) => !needle || `${workspace.label} ${view.label}`.toLowerCase().includes(needle)).map(({ workspace, view }) => {
                    const Icon = workspace.icon;
                    return <Command.Item key={`${workspace.key}/${view.key}`} value={`view:${workspace.key}/${view.key}`} onSelect={() => go(`${workspace.key}/${view.key}`)} className={ITEM}>
                      <Thumb spec={{ kind: "glyph", icon: Icon }} size="s" alt="" />
                      <span className={ITEM_LABEL}>{workspace.label} · {view.label}</span>
                      <ArrowUpRight size={14} />
                    </Command.Item>;
                  })}
                </Command.Group>
                {groups.map(group => <Command.Group key={group.collection} heading={groupLabel(group.collection)}>
                  {group.matches.map(r => <Command.Item key={`${r.collection}:${r.id}`} value={`${r.collection}:${r.id}`} onSelect={() => go(r.collection, r.id)} className={ITEM}>
                    <Thumb spec={r.summary.thumb} size="s" alt="" /><span className={ITEM_LABEL}>{r.summary.title}</span><small className={ITEM_HINT}>{r.summary.subtitle ?? r.id}</small><ArrowUpRight size={14} />
                  </Command.Item>)}
                </Command.Group>)}
              </>}
            {open && queries.some(q => q.isLoading) && <Command.Loading className={NOTE}>Loading records…</Command.Loading>}
          </Command.List>
        </Command>
        <p className="flex items-center gap-3 border-t border-border px-3 py-[5px] text-[11px] text-faint [&>span]:inline-flex [&>span]:items-center [&>span]:gap-0.5" id="command-help">
          <span><Kbd>↑</Kbd><Kbd>↓</Kbd>&nbsp;to move</span>
          <span><Kbd>↵</Kbd>&nbsp;to {field ? "apply" : "open"}</span>
          <span><Kbd>esc</Kbd>&nbsp;to {field ? "go back" : "close"}</span>
        </p>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
