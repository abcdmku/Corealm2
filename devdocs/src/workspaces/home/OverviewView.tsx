import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { apiGet } from "../../api/client.js";
import { WORKSPACES, viewForCollection, workspaceLabel } from "../../ui/workspaces.js";
import type { ViewProps } from "../types.js";
import { Button, Badge } from "../../components/ui/index.js";
import { toneVariant } from "../../components/ui/badge.js";

interface RequestEntry { collection: string; entityId: string; note: { text: string; at: string }; request: { kind: string; state: string } }
interface GitChange { path: string; status: string; tracked: boolean }

/** Home: where to go, and what is waiting. */
export default function OverviewView({ navigate }: ViewProps) {
  const requests = useQuery({ queryKey: ["requests"], queryFn: () => apiGet<{ requests: RequestEntry[] }>("requests"), enabled: !__DEVDOCS_PLAYER__, staleTime: 15_000, refetchOnWindowFocus: false, retry: false });
  const changes = useQuery({ queryKey: ["git-status"], queryFn: () => apiGet<{ changes: GitChange[] }>("git/status"), enabled: !__DEVDOCS_PLAYER__, staleTime: 5_000, refetchOnWindowFocus: false, retry: false });
  const openRequests = (requests.data?.requests ?? []).filter(entry => entry.request.state !== "closed");
  const changedFiles = changes.data?.changes ?? [];
  const workspaces = WORKSPACES.filter(workspace => workspace.key !== "home" && (!workspace.devOnly || !__DEVDOCS_PLAYER__));

  return <div className="ws-page ws-page-narrow home-overview">
    <div className="home-workspaces">
      {workspaces.map(workspace => {
        const Icon = workspace.icon;
        return <button key={workspace.key} className="home-workspace" onClick={() => navigate(workspace.key)}>
          <Icon size={18} />
          <strong>{workspace.label}</strong>
          <span>{workspace.views.filter(view => !view.hidden).map(view => view.label).join(" · ")}</span>
        </button>;
      })}
    </div>
    {!__DEVDOCS_PLAYER__ && <div className="home-columns">
      <section className="home-block">
        <header><h2>Open requests</h2><Button variant="link" size="inline" onClick={() => navigate("home/requests")}>All requests <ArrowRight size={12} /></Button></header>
        {requests.isPending && <p className="empty-inline">Loading…</p>}
        {requests.isError && <p className="empty-inline">Requests unavailable.</p>}
        {requests.data && !openRequests.length && <p className="empty-inline">Nothing waiting.</p>}
        <div className="home-list">
          {openRequests.slice(0, 8).map((entry, index) => <button key={`${entry.collection}:${entry.entityId}:${index}`} onClick={() => navigate(entry.collection, entry.entityId)}>
            <Badge variant={toneVariant(entry.request.state === "open" ? "warn" : "info")}>{entry.request.kind}</Badge>
            <span title={entry.note.text}>{entry.note.text}</span>
            <small>{workspaceLabel(viewForCollection(entry.collection)?.workspace.key ?? entry.collection)}</small>
          </button>)}
        </div>
      </section>
      <section className="home-block">
        <header><h2>Local changes</h2><Button variant="link" size="inline" onClick={() => navigate("home/changes")}>Review <ArrowRight size={12} /></Button></header>
        {changes.isError && <p className="empty-inline">Git status unavailable.</p>}
        {changes.data && !changedFiles.length && <p className="empty-inline">Working tree is clean.</p>}
        <div className="home-list">
          {changedFiles.slice(0, 10).map(change => <button key={change.path} onClick={() => navigate("home/changes")}><span className="mono">{change.path.replace(/^game\/content\//, "")}</span><small>{change.status}</small></button>)}
        </div>
      </section>
    </div>}
  </div>;
}
