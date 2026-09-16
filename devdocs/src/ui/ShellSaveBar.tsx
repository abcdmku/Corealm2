import { useState } from "react";
import { Redo2, Undo2 } from "lucide-react";
import type { AppProps } from "../model/contracts.js";
import { canonical, draftStore, lineDiff, useDraftState, type RecordEntry } from "../model/store.js";
import { viewForCollection } from "./workspaces.js";
import { Button, Kbd } from "../components/ui/index.js";
import { cn } from "../lib/utils.js";

/*
  The one save bar. It sits at the bottom of the workspace column, hidden until something is dirty,
  and saves every dirty record and contributor as a single transaction. Conflicts turn it to the
  danger tone and add a Compare / Overwrite / Reload row per record.
*/

export function ShellSaveBar({ navigate }: { navigate: AppProps["navigate"] }) {
  const state = useDraftState();
  const entries = [...state.entries.values()].filter(entry => entry.dirty || entry.conflict);
  const contributors = [...state.contributors.values()].filter(contributor => contributor.isDirty());
  const conflicts = entries.filter(entry => entry.conflict);
  const count = entries.length + contributors.reduce((sum, contributor) => sum + (contributor.count?.() ?? 1), 0);
  const error = state.error || entries.find(entry => !entry.conflict && entry.saveError)?.saveError || "";
  const diagnostics = entries.flatMap(entry => entry.diagnostics.filter(diagnostic => diagnostic.severity === "error").map(diagnostic => `${entry.name}: ${diagnostic.path} ${diagnostic.message}`));
  if (!entries.length && !contributors.length) return null;
  const undoLabel = draftStore.undoLabel(), redoLabel = draftStore.redoLabel();
  const tone = conflicts.length ? "danger" : error || diagnostics.length ? "warn" : undefined;
  const open = (entry: RecordEntry) => navigate(entry.collection, entry.objectShaped ? undefined : entry.id);

  return <div className={cn(
    "flex min-w-0 shrink-0 flex-col gap-1 border-t px-3 py-1.5 text-xs",
    tone === "danger" ? "border-destructive bg-destructive-soft" : tone === "warn" ? "border-warn bg-warn-soft" : "border-primary bg-brass-soft",
  )} data-tone={tone} role={tone ? "alert" : "status"} aria-label="Unsaved changes">
    <div className={ROW}>
      <span className={cn("shell-savebar-count shrink-0 font-medium whitespace-nowrap", tone === "danger" ? "text-destructive" : "text-primary")}>{count} {count === 1 ? "record" : "records"} changed{conflicts.length ? ` · ${conflicts.length} in conflict` : ""}</span>
      <span className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
        {entries.filter(entry => !entry.conflict).map(entry => <button key={entry.key} type="button" className={CHIP} title={`${entry.collection}/${entry.id}`} onClick={() => open(entry)}>{entry.name}</button>)}
        {contributors.map(contributor => <button key={contributor.key} type="button" className={CHIP} onClick={() => contributor.route && navigate(...contributor.route)}>{contributor.label}</button>)}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon-sm" aria-label="Undo" title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : "Nothing to undo"} disabled={!undoLabel} onClick={() => draftStore.undo()}><Undo2 /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Redo" title={redoLabel ? `Redo ${redoLabel} (Ctrl+Shift+Z)` : "Nothing to redo"} disabled={!redoLabel} onClick={() => draftStore.redo()}><Redo2 /></Button>
        <Button variant="secondary" size="sm" aria-label="Reset draft" disabled={state.saving} onClick={() => draftStore.resetAll()}>Discard all</Button>
        {!conflicts.length && <Button variant="default" size="sm" aria-label="Save changes" disabled={state.saving} onClick={() => void draftStore.saveAll()}>{state.saving ? "Saving…" : "Save all"} <Kbd className="border-transparent bg-black/15 text-current">Ctrl S</Kbd></Button>}
      </span>
    </div>
    {(error || diagnostics.length > 0) && <div className="flex flex-col gap-0.5 text-destructive [overflow-wrap:anywhere]">{error}{diagnostics.map(line => <span key={line}>{line}</span>)}</div>}
    {conflicts.map(entry => <Conflict key={entry.key} entry={entry} onOpen={() => open(entry)} />)}
  </div>;
}

const ROW = "flex min-h-[26px] min-w-0 items-center gap-2";
const CHIP = "inline-flex h-5 max-w-56 shrink-0 cursor-pointer items-center truncate rounded-full border border-border bg-card px-2 text-[11px] whitespace-nowrap text-foreground hover:border-link hover:text-link";

function Conflict({ entry, onOpen }: { entry: RecordEntry; onOpen: () => void }) {
  const [compare, setCompare] = useState(false);
  const disk = entry.server?.record;
  const diff = compare ? lineDiff(canonical(disk), canonical(entry.draft)) : [];
  return <div className="flex flex-col gap-1 border-t border-border-subtle pt-1">
    <div className={ROW}>
      <button type="button" className={CHIP} onClick={onOpen}>{entry.name}</button>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.saveError}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <Button variant="secondary" size="sm" aria-pressed={compare} onClick={() => setCompare(!compare)} disabled={!entry.server}>{compare ? "Hide" : "Compare"}</Button>
        <Button variant="destructive" size="sm" onClick={() => void draftStore.resolveConflict(entry.key, "overwrite")} disabled={!entry.server}>Overwrite</Button>
        <Button variant="secondary" size="sm" onClick={() => void draftStore.resolveConflict(entry.key, "reload")}>Reload</Button>
      </span>
    </div>
    {compare && <pre className="shell-savebar-diff m-0 mb-1 flex max-h-60 flex-col overflow-auto rounded-md border border-border bg-card px-2 py-1.5 font-mono text-[11px] leading-normal" aria-label={`${entry.name}: disk versus draft`}>
      <span className="mb-1 flex gap-4 text-muted-foreground"><span>− on disk</span><span>+ your draft</span></span>
      {diff.map((line, index) => <span key={index} data-kind={line.kind} className={cn("whitespace-pre", line.kind === "add" ? "bg-ok-soft text-ok" : line.kind === "del" ? "bg-destructive-soft text-destructive" : "text-faint")}>{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "} {line.text}</span>)}
    </pre>}
  </div>;
}

/** Dirty record counts per workspace, for the sidebar badges. */
export function useDirtyByWorkspace(): Map<string, number> {
  const state = useDraftState();
  const counts = new Map<string, number>();
  for (const entry of state.entries.values()) {
    if (!entry.dirty && !entry.conflict) continue;
    const workspace = viewForCollection(entry.collection)?.workspace.key ?? "home";
    counts.set(workspace, (counts.get(workspace) ?? 0) + 1);
  }
  for (const contributor of state.contributors.values()) {
    if (!contributor.isDirty()) continue;
    const workspace = contributor.workspace ?? "home";
    counts.set(workspace, (counts.get(workspace) ?? 0) + (contributor.count?.() ?? 1));
  }
  return counts;
}
