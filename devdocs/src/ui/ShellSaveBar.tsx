import { useState } from "react";
import { Redo2, Undo2 } from "lucide-react";
import type { AppProps } from "../model/contracts.js";
import { canonical, draftStore, lineDiff, useDraftState, type RecordEntry } from "../model/store.js";
import { viewForCollection } from "./workspaces.js";

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

  return <div className="shell-savebar" data-tone={tone} role={tone ? "alert" : "status"} aria-label="Unsaved changes">
    <div className="shell-savebar-row">
      <span className="shell-savebar-count">{count} {count === 1 ? "record" : "records"} changed{conflicts.length ? ` · ${conflicts.length} in conflict` : ""}</span>
      <span className="shell-savebar-chips">
        {entries.filter(entry => !entry.conflict).map(entry => <button key={entry.key} type="button" className="shell-savebar-chip" title={`${entry.collection}/${entry.id}`} onClick={() => open(entry)}>{entry.name}</button>)}
        {contributors.map(contributor => <button key={contributor.key} type="button" className="shell-savebar-chip" onClick={() => contributor.route && navigate(...contributor.route)}>{contributor.label}</button>)}
      </span>
      <span className="shell-savebar-actions">
        <button type="button" className="icon-button" aria-label="Undo" title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : "Nothing to undo"} disabled={!undoLabel} onClick={() => draftStore.undo()}><Undo2 size={14} /></button>
        <button type="button" className="icon-button" aria-label="Redo" title={redoLabel ? `Redo ${redoLabel} (Ctrl+Shift+Z)` : "Nothing to redo"} disabled={!redoLabel} onClick={() => draftStore.redo()}><Redo2 size={14} /></button>
        <button type="button" className="button button-small" aria-label="Reset draft" disabled={state.saving} onClick={() => draftStore.resetAll()}>Discard all</button>
        {!conflicts.length && <button type="button" className="button button-small button-primary" aria-label="Save changes" disabled={state.saving} onClick={() => void draftStore.saveAll()}>{state.saving ? "Saving…" : "Save all"} <kbd>Ctrl S</kbd></button>}
      </span>
    </div>
    {(error || diagnostics.length > 0) && <div className="shell-savebar-error">{error}{diagnostics.map(line => <span key={line}>{line}</span>)}</div>}
    {conflicts.map(entry => <Conflict key={entry.key} entry={entry} onOpen={() => open(entry)} />)}
  </div>;
}

function Conflict({ entry, onOpen }: { entry: RecordEntry; onOpen: () => void }) {
  const [compare, setCompare] = useState(false);
  const disk = entry.server?.record;
  const diff = compare ? lineDiff(canonical(disk), canonical(entry.draft)) : [];
  return <div className="shell-savebar-conflict">
    <div className="shell-savebar-row">
      <button type="button" className="shell-savebar-chip" onClick={onOpen}>{entry.name}</button>
      <span className="shell-savebar-conflict-text">{entry.saveError}</span>
      <span className="shell-savebar-actions">
        <button type="button" className="button button-small" aria-pressed={compare} onClick={() => setCompare(!compare)} disabled={!entry.server}>{compare ? "Hide" : "Compare"}</button>
        <button type="button" className="button button-small button-danger" onClick={() => void draftStore.resolveConflict(entry.key, "overwrite")} disabled={!entry.server}>Overwrite</button>
        <button type="button" className="button button-small" onClick={() => void draftStore.resolveConflict(entry.key, "reload")}>Reload</button>
      </span>
    </div>
    {compare && <pre className="shell-savebar-diff" aria-label={`${entry.name}: disk versus draft`}>
      <span className="shell-savebar-diff-head"><span>− on disk</span><span>+ your draft</span></span>
      {diff.map((line, index) => <span key={index} data-kind={line.kind}>{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "} {line.text}</span>)}
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
