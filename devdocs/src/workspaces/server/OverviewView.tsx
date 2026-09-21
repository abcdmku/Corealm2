import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { statsQuery, type ServerStats } from "../../api/adminData.js";
import { useAccountNames } from "../../model/adminNames.js";
import { Badge, Button } from "../../components/ui/index.js";
import { bytes, count, moment, ms, percent, shortRevision, since } from "../../model/format.js";
import { EmptyNote, ErrorState, LoadingRows } from "../../ui/States.js";
import { PAGE_WIDE, PAGE_HEADING, PANEL, PANEL_BODY, PANEL_HEADER } from "../../ui/layout.js";
import { cn } from "../../lib/utils.js";

/**
 * What the server is doing right now.
 *
 * `GET /admin/stats` is polled about once a second while this view is on screen and not at all
 * while the tab is hidden, because a console nobody is looking at should cost a host nothing. The
 * numbers the endpoint gives are the process's own: tick times from its ring of the last hour,
 * stage times as a per-tick average over the life of the process, and a bounded ring of events. The
 * sparklines are kept here, in the page, for as long as it stays open; nothing is stored.
 */

/** About a minute of history at one sample a second. */
const HISTORY = 60;

export default function OverviewView() {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  const query = useQuery(statsQuery(visible));
  const stats = query.data;
  const history = useHistory(stats);
  const nameOf = useAccountNames();

  if (query.isPending) return <div className={PAGE_WIDE}><LoadingRows /></div>;
  if (query.isError) return <div className={PAGE_WIDE}><ErrorState message={query.error.message} retry={() => void query.refetch()} /></div>;
  if (!stats) return null;

  const online = stats.worlds.reduce((sum, world) => sum + world.playersOnline, 0);
  const capacity = stats.worlds.reduce((sum, world) => sum + world.capacity, 0);

  return <div className={PAGE_WIDE}>
    <div className={PAGE_HEADING}>
      <h1>{stats.server.name}</h1>
      <Badge variant={visible ? "ok" : "default"} title={visible ? "Reading the server once a second" : "Paused while this tab is hidden"}>
        <Activity />{visible ? "Live" : "Paused"}
      </Badge>
      <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        <span title={`Started ${moment(stats.startedAt)}`}>Up {since(stats.startedAt).replace(" ago", "")}</span>
        <code className="font-mono text-[11px] text-faint" title={`Active catalog revision ${stats.catalogRevision}`}>{shortRevision(stats.catalogRevision)}</code>
      </span>
    </div>

    <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-3">
      <Panel title="Players" aside={`${online} of ${capacity}`}>
        {!stats.worlds.length && <EmptyNote>This server hosts no worlds.</EmptyNote>}
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {stats.worlds.map(world => <li key={`${world.providerId}/${world.worldId}`} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate" title={`${world.providerId}/${world.worldId}`}>{world.name}</span>
            <span className="font-mono tabular-nums text-muted-foreground">{world.playersOnline}/{world.capacity}</span>
            <Meter value={world.capacity ? world.playersOnline / world.capacity : 0} label={`${world.playersOnline} of ${world.capacity} players in ${world.name}`} />
          </li>)}
        </ul>
      </Panel>

      <Panel title="Tick" aside={<Spark points={history.tick} label="Tick time over the last minute" />}>
        <Stats rows={[
          { label: "Last", value: ms(stats.tick.lastMs) },
          { label: "Mean", value: ms(stats.tick.meanMs) },
          { label: "p95", value: ms(stats.tick.p95Ms), tone: stats.tick.p95Ms > 100 ? "warn" : undefined },
          { label: "Max", value: ms(stats.tick.maxMs) },
          { label: "Samples", value: count(stats.tick.samples) },
        ]} />
      </Panel>

      <Panel title="Stages" aside="per tick, mean">
        <Stats rows={[
          { label: "Simulation", value: ms(stats.stages.simulationMs) },
          { label: "Snapshot", value: ms(stats.stages.snapshotMs) },
          { label: "Commit", value: ms(stats.stages.commitMs) },
          { label: "Replication", value: ms(stats.stages.replicationMs) },
        ]} />
      </Panel>

      <Panel title="Traffic" aside={<Spark points={history.bandwidth} label="Outbound bytes per second over the last minute" />}>
        <Stats rows={[
          { label: "Out now", value: `${bytes(stats.bytesOutPerSecond)}/s` },
          { label: "Out total", value: bytes(stats.bytesOut) },
          { label: "Commands", value: count(stats.commands) },
          { label: "Rejected", value: count(stats.rejected), tone: stats.rejected > 0 ? "warn" : undefined },
        ]} />
      </Panel>

      <Panel title="Memory" aside={<Spark points={history.memory} label="Resident memory over the last minute" />}>
        <Stats rows={[
          { label: "Resident", value: bytes(stats.memory.rssBytes) },
          { label: "Heap used", value: bytes(stats.memory.heapUsedBytes) },
        ]} />
      </Panel>

      <Threads stats={stats} />

      <Panel title="Trouble" aside={stats.errors + stats.backlogDisconnects === 0 ? "none" : undefined}>
        <Stats rows={[
          { label: "Errors", value: count(stats.errors), tone: stats.errors > 0 ? "danger" : undefined },
          { label: "Backlog drops", value: count(stats.backlogDisconnects), tone: stats.backlogDisconnects > 0 ? "warn" : undefined },
        ]} />
      </Panel>
    </div>

    <div className={cn(PANEL, "mt-3")}>
      <div className={PANEL_HEADER}><h2>Recent events</h2><span className="ml-auto text-[11px] text-faint">newest first</span></div>
      <div className={cn(PANEL_BODY, "max-h-80 overflow-y-auto")}>
        {!stats.events.length && <EmptyNote>Nothing has happened since this server started.</EmptyNote>}
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {[...stats.events].reverse().map((event, index) => <li key={`${event.at}:${index}`} className="flex items-baseline gap-2 text-xs">
            <span className="w-16 shrink-0 text-faint tabular-nums" title={moment(event.at)}>{since(event.at)}</span>
            <Badge variant={event.kind === "rejected" || event.kind === "ban" ? "warn" : event.kind === "join" ? "ok" : "default"}>{event.kind}</Badge>
            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={`${event.accountId ?? ""} ${event.detail ?? ""}`.trim()}>
              {[event.accountId ? nameOf(event.accountId) ?? event.accountId : null, event.detail].filter(Boolean).join(" · ") || "—"}
            </span>
          </li>)}
        </ul>
      </div>
    </div>

    {query.isError === false && !visible && <p className="mt-2 text-[11px] text-faint">
      Polling is paused because this tab is in the background. <Button variant="link" size="xs" onClick={() => void query.refetch()}>Read once now</Button>
    </p>}
  </div>;
}

/**
 * A thread per world, and the thread that owns the database.
 *
 * `threads` is missing from the reading when the server runs every world in one loop, which is what
 * a one-world server does, so the panel says that rather than drawing an empty list. Where there
 * are threads, what an admin needs is which world is down and whether the database is the queue
 * everything waits in: `commitWait` is how long a world's commit sat before the database thread
 * reached it, and it is the number that grows first when one file cannot keep up with the worlds.
 */
function Threads({ stats }: { stats: ServerStats }) {
  const threads = stats.threads;
  const nameOf = (worldId: string): string => stats.worlds.find(world => world.worldId === worldId)?.name ?? worldId;
  const mean = (samples: readonly number[]): number => samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0;
  if (!threads) return <Panel title="Threads" aside="off">
    <EmptyNote>Every world ticks in this server&rsquo;s main thread.</EmptyNote>
  </Panel>;
  const down = threads.worlds.filter(world => !world.available).length;
  return <Panel title="Threads" aside={threads.mode === "on" ? "on" : "auto"}>
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {threads.worlds.map(world => <li key={world.worldId} className="flex items-center gap-2 text-xs">
        <span className="min-w-0 flex-1 truncate" title={world.worldId}>{nameOf(world.worldId)}</span>
        {world.restarts > 0 && <span className="shrink-0 text-muted-foreground" title={`${world.failures} failures inside the restart window`}>
          {count(world.restarts)} {world.restarts === 1 ? "restart" : "restarts"}
        </span>}
        <Badge variant={world.abandoned ? "danger" : world.available ? "ok" : "warn"}
          title={world.abandoned ? "Failed too often to be started again. It stays down until this server restarts."
            : world.available ? `Booted in ${ms(world.bootMs)}, ${bytes(world.heapUsedBytes)} heap` : "The thread is gone. It is being started again."}>
          {world.abandoned ? "Given up" : world.available ? "Running" : "Down"}
        </Badge>
      </li>)}
    </ul>
    <div className="mt-2 border-t border-border-subtle pt-2">
      <Stats rows={[
        { label: "Commit", value: ms(mean(threads.database.commitMs)) },
        { label: "Commit wait", value: ms(mean(threads.database.commitWaitMs)), tone: mean(threads.database.commitWaitMs) > 20 ? "warn" : undefined },
        { label: "Database busy", value: percent(threads.database.utilization), tone: threads.database.utilization > 0.8 ? "warn" : undefined },
        ...(down ? [{ label: "Worlds down", value: count(down), tone: "danger" as const }] : []),
      ]} />
    </div>
  </Panel>;
}

function Panel({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return <section className={PANEL}>
    <div className={PANEL_HEADER}><h2>{title}</h2>{aside !== undefined && <span className="ml-auto flex items-center gap-1.5 text-[11px] text-faint">{aside}</span>}</div>
    <div className={PANEL_BODY}>{children}</div>
  </section>;
}

function Stats({ rows }: { rows: readonly { label: string; value: string; tone?: "warn" | "danger" }[] }) {
  return <dl className="m-0 grid grid-cols-[minmax(0,1fr)_max-content] items-baseline gap-x-3 gap-y-1 text-xs">
    {rows.map(row => <div key={row.label} className="col-span-2 grid grid-cols-subgrid items-baseline">
      <dt className="truncate text-muted-foreground">{row.label}</dt>
      <dd className={cn("m-0 font-mono tabular-nums", row.tone === "danger" ? "text-destructive" : row.tone === "warn" ? "text-warn" : "text-foreground")}>{row.value}</dd>
    </div>)}
  </dl>;
}

function Meter({ value, label }: { value: number; label: string }) {
  const filled = Math.max(0, Math.min(1, value));
  return <span role="img" aria-label={label} title={label} className="block h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-secondary">
    <span className={cn("block h-full rounded-full", filled > 0.9 ? "bg-warn" : "bg-primary")} style={{ width: `${filled * 100}%` }} />
  </span>;
}

/**
 * A minute of one number, drawn as a polyline. The kit has no chart component and this plan says to
 * add no chart library, so it is eleven lines of SVG rather than a dependency.
 */
function Spark({ points, label }: { points: readonly number[]; label: string }) {
  // Nothing at all until there are two samples: a placeholder word in a panel header reads as a
  // label for the numbers under it, which it is not.
  if (points.length < 2) return null;
  const top = Math.max(...points, 1), bottom = Math.min(...points, 0);
  const span = top - bottom || 1;
  const path = points.map((value, index) => `${(index / (points.length - 1)) * 60},${16 - ((value - bottom) / span) * 14}`).join(" ");
  return <svg role="img" aria-label={`${label}. Now ${Math.round(points.at(-1)!)}, highest ${Math.round(top)}.`} width={60} height={16} viewBox="0 0 60 16" className="overflow-visible text-primary">
    <polyline points={path} fill="none" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
  </svg>;
}

/** The series this page keeps for its sparklines, appended as each poll lands. */
function useHistory(stats: ServerStats | undefined): { tick: number[]; bandwidth: number[]; memory: number[] } {
  const series = useRef({ tick: [] as number[], bandwidth: [] as number[], memory: [] as number[] });
  const [, bump] = useState(0);
  // React Query's structural sharing hands back the same object when a poll changed nothing, so
  // object identity is exactly "a new reading arrived" and no sample is counted twice.
  useEffect(() => {
    if (!stats) return;
    const push = (list: number[], value: number) => { list.push(value); if (list.length > HISTORY) list.shift(); };
    push(series.current.tick, stats.tick.lastMs);
    push(series.current.bandwidth, stats.bytesOutPerSecond);
    push(series.current.memory, stats.memory.rssBytes);
    bump(value => value + 1);
  }, [stats]);
  return series.current;
}
