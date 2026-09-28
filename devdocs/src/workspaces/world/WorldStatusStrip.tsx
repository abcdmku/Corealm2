import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { can } from "../../api/backend.js";
import { bakeWorld, worldStatusQuery } from "../../api/worldBake.js";
import { Badge, Button, type BadgeTone } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
import { duration, stripView, type StepState, type StripTone, type StripView } from "./bakeStrip.js";

/*
  One line above the map: which world the server runs, the bake that is moving it, and what a
  geometry edit takes to ship. In repo mode it says `npm run world:build`, since a checkout has no
  server bake. The strip also answers whether the map image is stale, which the map shows as a note.
*/

const TONE: Record<StripTone, BadgeTone> = { ok: "ok", info: "info", warn: "warn", danger: "danger" };
const STEP_TONE: Record<StepState, BadgeTone> = { done: "ok", running: "info", failed: "danger", waiting: "outline" };

/** The world status on a server, undefined in repo mode or while it loads. */
export function useWorldStatusView(): { view: StripView; loaded: boolean; error?: string } {
  const server = can("publish");
  const query = useQuery({ ...worldStatusQuery(), enabled: server });
  const [now, setNow] = useState(() => Date.now());
  const view = stripView(server ? query.data ?? undefined : undefined, now);
  // The elapsed time moves while a bake runs even when a poll brings nothing new.
  useEffect(() => {
    if (!view.poll) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [view.poll]);
  if (!server) return { view, loaded: true };
  if (query.isError) return { view, loaded: false, error: query.error instanceof Error ? query.error.message : String(query.error) };
  return { view, loaded: Boolean(query.data) };
}

/** `npm run world:build` in a sentence, as code. */
function Note({ text }: { text: string }) {
  return <span className="min-w-0 flex-1 truncate text-muted-foreground" title={text.replaceAll("`", "")}>
    {text.split("`").map((part, index) => index % 2 ? <code key={index} className="font-mono text-[11px] text-foreground">{part}</code> : part)}
  </span>;
}

export function WorldStatusStrip({ status }: { status: ReturnType<typeof useWorldStatusView> }) {
  const client = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const { view, loaded, error } = status;
  async function retry() {
    setRetrying(true); setRetryError("");
    try { await bakeWorld(); await client.invalidateQueries({ queryKey: worldStatusQuery().queryKey }); }
    catch (reason) { setRetryError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setRetrying(false); }
  }
  if (error) return <div className={STRIP} role="status" aria-label="World status"><Badge variant="warn">World status unavailable</Badge><span className="min-w-0 truncate text-muted-foreground" title={error}>This server does not report its world bake yet.</span></div>;
  if (!loaded) return <div className={STRIP} role="status" aria-label="World status"><span className="text-faint">Reading the world status…</span></div>;
  const bake = view.bake;
  // A failed bake's error is the one thing an author came to read, so it gets its own line, whole.
  const problem = bake?.error || retryError;
  return <div className="flex shrink-0 flex-col border-b border-border-subtle" role="status" aria-label="World status"><div className={cn(STRIP, "border-b-0")}>
    <Badge variant={TONE[view.world.tone]}>{view.world.label}</Badge>
    {view.world.revision && <code className="shrink-0 font-mono text-[11px] text-faint" title="World geometry revision">{view.world.revision}</code>}
    {bake && <span className="flex shrink-0 items-center gap-1" aria-label="World bake">
      <Badge variant={TONE[bake.tone]}>{bake.label}</Badge>
      {bake.steps.map(step => <Badge key={step.name} variant={STEP_TONE[step.state]} title={`${step.name}: ${step.state}`}>{step.name}{step.ms !== undefined ? ` ${duration(step.ms)}` : ""}</Badge>)}
      {bake.elapsed && <span className="font-mono text-[11px] text-muted-foreground" title="Elapsed">{bake.elapsed}</span>}
    </span>}
    {bake?.retry && <Button variant="secondary" size="xs" className="shrink-0" disabled={retrying} onClick={() => void retry()}>{retrying ? "Starting…" : "Retry bake"}</Button>}
    {!problem && <Note text={view.note} />}
    {view.history.length > 0 && <details className="relative ml-auto shrink-0">
      <summary className="cursor-pointer text-muted-foreground">Last bakes ({view.history.length})</summary>
      <ul className="absolute right-0 top-full z-20 mt-1 flex w-72 flex-col gap-1 rounded-md border border-border bg-background p-2 shadow-lg">
        {view.history.map(entry => <li key={`${entry.revision}:${entry.when}`} className="flex items-center gap-2">
          <Badge variant={TONE[entry.tone]}>{entry.label}</Badge>
          <code className="font-mono text-[11px] text-faint">{entry.revision}</code>
          <span className="ml-auto text-[11px] text-muted-foreground">{when(entry.when)}</span>
        </li>)}
      </ul>
    </details>}
  </div>
  {problem && <p className="px-2.5 pb-1.5 text-xs [overflow-wrap:anywhere]"><span className="text-destructive">{problem}</span> <span className="text-muted-foreground">{view.note}</span></p>}
  </div>;
}

function when(at: string): string {
  const time = Date.parse(at);
  return Number.isFinite(time) ? new Date(time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : at;
}

/** Over the map, when the server runs a world the shipped map image does not show. */
export function MapStaleNote() {
  return <p className="pointer-events-none absolute bottom-2 left-2 z-10 max-w-[calc(100%-1rem)] truncate rounded-sm border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground" role="note">
    The map image shows the base world; terrain edits appear in game.
  </p>;
}

const STRIP = "relative flex h-8 min-w-0 shrink-0 items-center gap-2 border-b border-border-subtle bg-background px-2.5 text-xs whitespace-nowrap";
