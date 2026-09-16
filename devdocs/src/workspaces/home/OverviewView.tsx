import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { apiGet } from "../../api/client.js";
import { WORKSPACES, viewForCollection, workspaceLabel } from "../../ui/workspaces.js";
import type { ViewProps } from "../types.js";
import { Button, Badge } from "../../components/ui/index.js";
import { toneVariant } from "../../components/ui/badge.js";
import { cn } from "../../lib/utils.js";
import { BLOCK_TITLE, EMPTY, PAGE } from "../../ui/layout.js";
import { ListRow } from "../../ui/ListRow.js";

interface RequestEntry { collection: string; entityId: string; note: { text: string; at: string }; request: { kind: string; state: string } }
interface GitChange { path: string; status: string; tracked: boolean }

/** Home: where to go, and what is waiting. */
export default function OverviewView({ navigate }: ViewProps) {
  const requests = useQuery({ queryKey: ["requests"], queryFn: () => apiGet<{ requests: RequestEntry[] }>("requests"), enabled: !__DEVDOCS_PLAYER__, staleTime: 15_000, refetchOnWindowFocus: false, retry: false });
  const changes = useQuery({ queryKey: ["git-status"], queryFn: () => apiGet<{ changes: GitChange[] }>("git/status"), enabled: !__DEVDOCS_PLAYER__, staleTime: 5_000, refetchOnWindowFocus: false, retry: false });
  const openRequests = (requests.data?.requests ?? []).filter(entry => entry.request.state !== "closed");
  const changedFiles = changes.data?.changes ?? [];
  const workspaces = WORKSPACES.filter(workspace => workspace.key !== "home" && (!workspace.devOnly || !__DEVDOCS_PLAYER__));

  return <div className={cn(PAGE, "max-w-[67.5rem]")}>
    <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-2">
      {workspaces.map(workspace => {
        const Icon = workspace.icon;
        return <button key={workspace.key} type="button" onClick={() => navigate(workspace.key)}
          className="flex min-h-21 cursor-pointer flex-col items-start gap-1 rounded-md border border-border-subtle bg-card p-3 text-left outline-none hover:border-faint hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/40">
          <Icon size={18} className="mb-0.5 text-primary" />
          <strong className="text-[13px] font-semibold">{workspace.label}</strong>
          <span className="text-[11px] leading-snug text-faint">{workspace.views.filter(view => !view.hidden).map(view => view.label).join(" · ")}</span>
        </button>;
      })}
    </div>
    {!__DEVDOCS_PLAYER__ && <div className="grid grid-cols-2 items-start gap-6 max-[56rem]:grid-cols-1">
      <Block title="Open requests" action={<Button variant="link" size="inline" onClick={() => navigate("home/requests")}>All requests <ArrowRight size={12} /></Button>}>
        {requests.isPending && <p className={EMPTY}>Loading…</p>}
        {requests.isError && <p className={EMPTY}>Requests unavailable.</p>}
        {requests.data && !openRequests.length && <p className={EMPTY}>Nothing waiting.</p>}
        {openRequests.slice(0, 8).map((entry, index) => <ListRow key={`${entry.collection}:${entry.entityId}:${index}`} onClick={() => navigate(entry.collection, entry.entityId)} hint={entry.note.text}
          art={<Badge variant={toneVariant(entry.request.state === "open" ? "warn" : "info")} className="shrink-0">{entry.request.kind}</Badge>}
          title={<span className="font-normal">{entry.note.text}</span>}
          meta={workspaceLabel(viewForCollection(entry.collection)?.workspace.key ?? entry.collection)} />)}
      </Block>
      <Block title="Local changes" action={<Button variant="link" size="inline" onClick={() => navigate("home/changes")}>Review <ArrowRight size={12} /></Button>}>
        {changes.isPending && <p className={EMPTY}>Loading…</p>}
        {changes.isError && <p className={EMPTY}>Git status unavailable.</p>}
        {changes.data && !changedFiles.length && <p className={EMPTY}>Working tree is clean.</p>}
        {changedFiles.slice(0, 10).map(change => <ListRow key={change.path} onClick={() => navigate("home/changes")} hint={change.path}
          title={<span className="font-mono font-normal">{change.path.replace(/^game\/content\//, "")}</span>}
          meta={change.status} />)}
        {changedFiles.length > 10 && <p className={cn(EMPTY, "px-1.5")}>{changedFiles.length - 10} more</p>}
      </Block>
    </div>}
  </div>;
}

function Block({ title, action, children }: { title: string; action: ReactNode; children: ReactNode }) {
  return <section className="flex min-w-0 flex-col gap-0.5">
    <header className="mb-1 flex min-h-6 items-center justify-between gap-2 border-b border-border-subtle pb-1"><h2 className={BLOCK_TITLE}>{title}</h2>{action}</header>
    {children}
  </section>;
}
