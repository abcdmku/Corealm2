import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Undo2 } from "lucide-react";
import { auditQuery, failureMessage, revisionQuery, rollbackTo, type RevisionMove, type RollbackResult } from "../../api/adminData.js";
import { useAccountNames } from "../../model/adminNames.js";
import { Badge, Button, Table, TableBody, TableCell, TableFrame, TableHead, TableHeader, TableRow } from "../../components/ui/index.js";
import { ActionError, ConfirmAction } from "../../ui/Confirm.js";
import { EmptyNote, ErrorState, LoadingRows } from "../../ui/States.js";
import { moment, shortRevision, since } from "../../model/format.js";
import { PAGE, PAGE_HEADING, PANEL, PANEL_BODY, PANEL_HEADER } from "../../ui/layout.js";
import { cn } from "../../lib/utils.js";

/**
 * Every time this server's catalog pointer moved, and the way back.
 *
 * A rollback is a publish of an earlier revision's source collections, so it runs every check a
 * publish runs: a definition something still holds refuses it, and a spawn that cannot be placed
 * refuses it. The result says the same thing the save confirmation says — which tables the running
 * game reads now and which wait for a restart.
 */

export default function HistoryView() {
  const query = useQuery(revisionQuery());
  // The note an author wrote with a publish lives on its audit row, not on the pointer move, so the
  // two are joined here by revision. Without it this table can only say "published".
  const notes = useQuery(auditQuery({ action: "content.", limit: 200 }));
  const nameOf = useAccountNames();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<RollbackResult>();
  const [error, setError] = useState("");

  async function rollback(revision: string): Promise<void> {
    setError(""); setResult(undefined);
    try {
      setResult(await rollbackTo(revision));
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      void queryClient.invalidateQueries({ queryKey: ["collection"] });
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
    } catch (failure) { setError(failureMessage(failure)); }
  }

  if (query.isPending) return <div className={PAGE}><LoadingRows /></div>;
  if (query.isError) return <div className={PAGE}><ErrorState message={query.error.message} retry={() => void query.refetch()} /></div>;
  const { revision: active, history } = query.data;
  const noteOf = new Map((notes.data?.entries ?? []).flatMap(entry => {
    const after = entry.after as { note?: unknown } | null;
    return entry.target && after && typeof after.note === "string" && after.note ? [[entry.target, after.note] as const] : [];
  }));

  return <div className={PAGE}>
    <div className={PAGE_HEADING}>
      <h1>Publish history</h1>
      <Badge variant="ok" title={`Active catalog revision ${active}`}>Active {shortRevision(active)}</Badge>
      <span className="ml-auto text-xs text-muted-foreground">{history.length} {history.length === 1 ? "move" : "moves"}</span>
    </div>

    {result && <RollbackResultPanel result={result} onDismiss={() => setResult(undefined)} />}
    <ActionError message={error} className="mb-2" />

    {!history.length && <EmptyNote>This server has published nothing since its catalog was seeded.</EmptyNote>}
    {Boolean(history.length) && <TableFrame className="w-full">
      <Table>
        <TableHeader><TableRow>
          <TableHead>When</TableHead>
          <TableHead>Revision</TableHead>
          <TableHead>Replaced</TableHead>
          <TableHead>By</TableHead>
          <TableHead className="w-full">Note</TableHead>
          <TableHead aria-label="Actions" />
        </TableRow></TableHeader>
        <TableBody>
          {history.map(move => <Move key={move.id} move={move} active={active} note={noteOf.get(move.revision)} nameOf={nameOf} onRollback={rollback} />)}
        </TableBody>
      </Table>
    </TableFrame>}
  </div>;
}

function Move({ move, active, note, nameOf, onRollback }: {
  move: RevisionMove; active: string; note: string | undefined; nameOf: (accountId: string) => string | undefined; onRollback: (revision: string) => Promise<void>;
}) {
  const isActive = move.revision === active;
  return <TableRow>
    <TableCell title={moment(move.at)}>{since(move.at)}</TableCell>
    <TableCell><code className="font-mono text-[11px]" title={move.revision}>{shortRevision(move.revision)}</code>{isActive && <Badge variant="ok" className="ml-1.5">active</Badge>}</TableCell>
    <TableCell><code className="font-mono text-[11px] text-faint" title={move.previous ?? undefined}>{shortRevision(move.previous)}</code></TableCell>
    <TableCell className="max-w-40 truncate" title={move.by ?? undefined}>{move.by ? nameOf(move.by) ?? move.by : <span className="text-faint">—</span>}</TableCell>
    <TableCell className="max-w-[24rem] truncate text-muted-foreground" title={note}>
      {note ?? <span className="text-faint">{move.previous === null ? "Seeded from the catalog this server ships with" : "No note"}</span>}
    </TableCell>
    <TableCell className="text-right">
      <ConfirmAction label="Roll back" icon={<Undo2 />} variant="secondary" size="xs"
        disabled={isActive} disabledReason="This revision is already active."
        consequence={<>Every world on this server moves onto {shortRevision(move.revision)} now, and every connected player is told their content changed. Nothing is deleted: this is a publish of that revision's sources.</>}
        confirmLabel="Roll back to it" onConfirm={() => onRollback(move.revision)} />
    </TableCell>
  </TableRow>;
}

function RollbackResultPanel({ result, onDismiss }: { result: RollbackResult; onDismiss: () => void }) {
  return <section className={cn(PANEL, "mb-3 border-ok/50")} aria-label="Rollback result">
    <div className={PANEL_HEADER}>
      <h2><History className="mr-1 inline size-3.5" aria-hidden />{result.unchanged ? "Already on that catalog" : `Now on ${shortRevision(result.revision)}`}</h2>
      <Badge variant="ok" className="ml-auto">{result.notified} {result.notified === 1 ? "player" : "players"} told</Badge>
      <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
    </div>
    <div className={cn(PANEL_BODY, "flex flex-col gap-1 text-xs text-muted-foreground")}>
      <p>Replaced {shortRevision(result.previous)}. {result.changedCollections.length ? `Collections: ${result.changedCollections.join(", ")}.` : "No source collection differed."}</p>
      {Boolean(result.live.length) && <p><span className="text-ok">Live now:</span> {result.live.join(", ")}.</p>}
      {Boolean(result.onRestart.length) && <p><span className="text-warn">At the next restart:</span> {result.onRestart.join(", ")}.</p>}
      {result.spawns.map(world => <p key={world.world}>{world.world}: {world.added} spawned now, {world.pending} waiting for a respawn, {world.retiring} finishing their lives, {world.removed} removed.</p>)}
    </div>
  </section>;
}
