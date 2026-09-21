import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { applyBase, baseConflictKey, baseErrorLines, baseFailure, baseStatusQuery, completeBaseBodies, previewBase, type BaseApplyResult, type BaseDecision, type BaseError, type BaseMarker, type BasePreview } from "../../api/baseGame.js";
import { Badge, Button, Checkbox, Input, Table, TableBody, TableCell, TableFrame, TableHead, TableHeader, TableRow } from "../../components/ui/index.js";
import { ConfirmAction } from "../../ui/Confirm.js";
import { ErrorState, LoadingRows } from "../../ui/States.js";
import { PublishResult } from "../../ui/ShellSaveBar.js";
import { shortRevision } from "../../model/format.js";
import { useDraftState } from "../../model/store.js";
import { PAGE, PAGE_HEADING, PANEL, PANEL_BODY, PANEL_HEADER } from "../../ui/layout.js";
import { cn } from "../../lib/utils.js";

export default function BaseGameView() {
  const status = useQuery(baseStatusQuery());
  const client = useQueryClient();
  const drafts = useDraftState();
  const dirty = drafts.saving || [...drafts.entries.values()].some(row => row.dirty || row.conflict) || [...drafts.contributors.values()].some(row => row.isDirty());
  const [preview, setPreview] = useState<BasePreview>();
  const [decisions, setDecisions] = useState<BaseDecision[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [allowDowngrade, setAllowDowngrade] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<BaseError>();
  const [result, setResult] = useState<BaseApplyResult>();

  async function inspect(reset = false) {
    setBusy(true); setError(undefined); setReviewed(false);
    if (reset) { setDecisions([]); setPreview(undefined); }
    try {
      const next = await completeBaseBodies(await previewBase(reset ? [] : decisions, allowDowngrade));
      setPreview(next); setReviewed(true);
      setDecisions(next.conflicts.flatMap(row => row.decision ? [{ collection: row.collection, id: row.id, take: row.decision }] : []));
      void status.refetch();
    } catch (failure) { setError(baseFailure(failure)); }
    finally { setBusy(false); }
  }
  function choose(rows: BasePreview["conflicts"], take: BaseDecision["take"]) {
    const keys = new Set(rows.map(baseConflictKey));
    setDecisions(current => [...current.filter(row => !keys.has(baseConflictKey(row))), ...rows.map(row => ({ collection: row.collection, id: row.id, take }))]);
    setReviewed(false); setError(undefined);
  }
  async function apply() {
    if (!preview || !reviewed || dirty || busy || !preview.validation?.ok) return;
    setBusy(true); setError(undefined);
    try {
      setResult(await applyBase(preview.expect, decisions, allowDowngrade, note));
      setPreview(undefined); setDecisions([]); setReviewed(false); setNote("");
      void client.invalidateQueries({ queryKey: ["admin"] });
      void client.invalidateQueries({ queryKey: ["collection"] });
      void client.invalidateQueries({ queryKey: ["collections"] });
    } catch (failure) {
      setError(baseFailure(failure)); setReviewed(false);
      if (baseFailure(failure).code === "stale_base") { setPreview(undefined); setDecisions([]); }
    } finally { setBusy(false); }
  }

  if (status.isPending) return <div className={PAGE}><LoadingRows /></div>;
  if (status.isError) return <div className={PAGE}><ErrorState message={status.error.message} retry={() => void status.refetch()} /></div>;
  const current = status.data;
  const choices = new Map(decisions.map(row => [baseConflictKey(row), row.take]));
  const remaining = preview?.conflicts.filter(row => !choices.has(baseConflictKey(row))).length ?? 0;
  const canPreview = Boolean(current.current && current.bundled && current.direction !== "same" && (current.direction !== "older" || allowDowngrade));
  const canApply = reviewed && preview?.validation?.ok === true && remaining === 0 && !dirty && !busy;
  const markerOnly = preview?.changedCollections.length === 0;
  const validationError = reviewed && preview?.validation?.ok === false ? preview.validation.error : undefined;

  return <div className={cn(PAGE, "flex min-w-0 flex-col gap-3")}>
    <div className={cn(PAGE_HEADING, "mb-0")}><h1>Base game</h1>
      <Badge variant={current.updateAvailable ? "warn" : "default"}>{current.updateAvailable ? "Update available" : current.direction === "older" ? "Older base bundled" : current.direction === "same" ? "Up to date" : "Base unavailable"}</Badge>
    </div>
    <p className="text-xs text-muted-foreground">Compare the base bundled with this executable against this server's content. Your choices apply to every world on this server.</p>
    <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"><Marker title="Current base" marker={current.current} /><Marker title="Bundled base" marker={current.bundled} /></div>
    <p className="text-xs text-muted-foreground">{current.serverModified === true ? "This server has its own content changes." : current.serverModified === false ? "This server's content matches its current base." : "The server's base sources are unavailable."}
      {current.direction === "different-content-same-version" && " The versions match, but the base content differs."}</p>
    {current.direction === "older" && <label className="flex items-center gap-2 text-xs"><Checkbox checked={allowDowngrade} disabled={busy} onCheckedChange={value => { setAllowDowngrade(value === true); setReviewed(false); setPreview(undefined); setDecisions([]); }} />Allow downgrade to the older bundled base</label>}
    {dirty && <p role="status" className="text-xs text-warn">Save or discard the editor's unsaved changes before applying a base update.</p>}
    {result && <section className={PANEL} aria-label="Base update result"><div className={PANEL_BODY}><h2 className="text-xs font-semibold">Base updated to v{result.baseUpdate.to.version}</h2>
      {result.unchanged && <p className="mt-1 text-xs text-muted-foreground">Only base tracking changed. Content rollback cannot undo this update.</p>}</div><PublishResult summary={result} onDismiss={() => setResult(undefined)} /></section>}
    {error && <Failure error={error} />}
    <div className="flex flex-wrap items-center gap-2"><Button size="sm" disabled={!canPreview || busy} onClick={() => void inspect(true)}>{busy ? "Working..." : preview ? "Start new preview" : "Preview update"}</Button>
      {preview && <Button size="sm" variant="secondary" disabled={busy || remaining > 0} onClick={() => void inspect()}>Validate choices</Button>}
      {preview && <span className="text-xs text-muted-foreground" role="status">{remaining ? `${remaining} conflicts need a choice` : !reviewed ? "Choices changed. Validate before applying." : preview.validation?.ok ? "Ready to apply" : "Validation needs attention"}</span>}
    </div>
    {preview && <>
      <TableFrame className="w-full" aria-label="Collection summary"><Table><TableHeader><TableRow><TableHead>Collection</TableHead>{["From base", "Kept server", "Added", "Deleted", "Unchanged", "Unresolved"].map(label => <TableHead numeric key={label}>{label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{Object.entries(preview.summary).map(([name, counts]) => <TableRow key={name}><TableCell>{name}</TableCell>{[counts.takenFromBase, counts.keptMine, counts.added, counts.deleted, counts.unchanged, counts.conflicts].map((count, at) => <TableCell numeric key={at}>{count}</TableCell>)}</TableRow>)}</TableBody></Table></TableFrame>
      {!reviewed && <p className="text-xs text-muted-foreground">The summary reflects the last preview. Validate choices to refresh it.</p>}
      {Array.from(new Set(preview.conflicts.map(row => row.collection))).map(collection => {
        const rows = preview.conflicts.filter(row => row.collection === collection);
        return <section key={collection} className="flex min-w-0 flex-col gap-2" aria-label={`${collection} conflicts`}>
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-xs font-semibold">{collection}</h2><Badge>{rows.length} conflicts</Badge><Button size="xs" variant="secondary" disabled={busy} onClick={() => choose(rows, "mine")}>Keep all server records</Button><Button size="xs" variant="secondary" disabled={busy} onClick={() => choose(rows, "theirs")}>Take all base records</Button></div>
          {rows.map(row => <Conflict key={baseConflictKey(row)} row={row} choice={choices.get(baseConflictKey(row))} disabled={busy} choose={take => choose([row], take)} />)}
        </section>;
      })}
      {validationError && <Failure error={validationError} />}
      {reviewed && preview.validation?.ok && <section className={PANEL} aria-label="Validated update"><div className={cn(PANEL_BODY, "flex flex-col gap-2 text-xs")}>
        <p>{markerOnly ? "Only base tracking will change. Content rollback cannot undo this update." : `${preview.changedCollections.length} collections will change.`}</p>
        <p>Live now: {preview.live?.join(", ") || "none"}. At next restart: {preview.onRestart?.join(", ") || "none"}.</p>
        <label className="flex flex-col gap-1">Publish note<Input value={note} maxLength={512} disabled={busy} placeholder="Optional note for the audit log" onChange={event => setNote(event.target.value)} /></label>
        <div><ConfirmAction label="Apply base update" variant="default" disabled={!canApply} disabledReason={dirty ? "Save or discard your drafts first." : "Validate all choices first."} busy={busy} confirmDisabled={!canApply}
          consequence={markerOnly ? `Move this server's base tracking to v${preview.base.to.version}. Content stays the same. Content rollback cannot undo this update.` : `Publish the reviewed base update to every world on this server. Live tables change now; the listed restart tables change on the next restart.`}
          confirmLabel="Publish base update" onConfirm={apply} /></div>
      </div></section>}
    </>}
  </div>;
}

function Marker({ title, marker }: { title: string; marker: BaseMarker | null }) {
  return <section className={PANEL}><div className={PANEL_HEADER}><h2>{title}</h2></div><div className={cn(PANEL_BODY, "flex flex-wrap items-center gap-2 text-xs")}><strong>{marker ? `v${marker.version}` : "Unavailable"}</strong>{marker && <code title={marker.revision} className="font-mono text-faint">{shortRevision(marker.revision)}</code>}</div></section>;
}
function Failure({ error }: { error: BaseError }) {
  return <div role="alert" className="flex flex-col gap-1 text-xs text-destructive [overflow-wrap:anywhere]">{baseErrorLines(error).map((line, index) => <p key={index}>{line}</p>)}</div>;
}

function Conflict({ row, choice, choose, disabled }: { row: BasePreview["conflicts"][number]; choice: BaseDecision["take"] | undefined; choose: (take: BaseDecision["take"]) => void; disabled: boolean }) {
  const sides = [{ label: "Ancestor", value: row.ancestor, fields: [...row.mineFields, ...row.theirsFields] }, { label: "This server", value: row.mine, fields: row.mineFields }, { label: "New base", value: row.theirs, fields: row.theirsFields }];
  const kind = { "both-changed": "Both changed", "both-added": "Both added", "deleted-in-base": "Deleted in base", "deleted-on-server": "Deleted on server" }[row.kind];
  return <article className={PANEL} aria-label={`${row.collection}/${row.id}`}><div className={cn(PANEL_HEADER, "flex-wrap")}><h3 className="min-w-0 break-all">{row.id}</h3><Badge>{kind}</Badge><span className="ml-auto text-[11px] text-muted-foreground">{choice === "mine" ? "Keeping server" : choice === "theirs" ? "Taking base" : "Choose a record"}</span></div>
    <div className={cn(PANEL_BODY, "flex flex-col gap-2")}><div className="overflow-auto"><div className="grid min-w-[42rem] grid-cols-3 gap-2" aria-label="Record comparison">
      {sides.map(side => <section key={side.label} className="min-w-0"><h4 className="mb-1 text-xs font-semibold">{side.label}</h4><RecordBody value={side.value} fields={side.fields} /></section>)}
    </div></div><p className="text-[11px] text-muted-foreground">Highlighted fields differ from the ancestor. Each choice takes the whole record.</p>
      <div className="flex flex-wrap gap-2"><Button variant={choice === "mine" ? "default" : "secondary"} size="sm" aria-pressed={choice === "mine"} disabled={disabled} onClick={() => choose("mine")}>Keep this server's{row.mine === null ? " deletion" : " record"}</Button><Button variant={choice === "theirs" ? "default" : "secondary"} size="sm" aria-pressed={choice === "theirs"} disabled={disabled} onClick={() => choose("theirs")}>Take the base{row.theirs === null ? " deletion" : " record"}</Button></div>
    </div></article>;
}
function RecordBody({ value, fields }: { value: unknown; fields: string[] }) {
  if (value === null) return <p className="text-xs text-muted-foreground">Record absent</p>;
  const object = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const entries = object ? [...new Set([...Object.keys(object), ...fields])].map(key => [key, object[key]] as const) : [["$value", value] as const];
  return <div data-slot="json" className="max-h-80 overflow-auto rounded-sm border border-border-subtle bg-background font-mono text-[11px] leading-relaxed">{entries.map(([key, field]) => <div key={key} data-changed={fields.includes(key) || !object || undefined} className={cn("px-1.5 py-0.5", (fields.includes(key) || !object) && "bg-warn-soft text-warn")}><pre className="whitespace-pre-wrap [overflow-wrap:anywhere]">{object ? `${key}: ` : ""}{field === undefined ? "[absent]" : JSON.stringify(field, null, 2)}</pre></div>)}</div>;
}
