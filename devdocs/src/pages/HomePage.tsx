import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ClipboardList, FileDiff, Layers, Map as MapIcon, SlidersHorizontal } from "lucide-react";
import type { AppProps } from "../model/contracts.js";
import type { CollectionSummary } from "../../shared/contracts.js";
import { apiGet } from "../api/client.js";
import { iconFor, labelFor, navigationGroups, taskDescription } from "../ui/library.js";

interface RequestEntry { collection: string; entityId: string; note: { text: string; at: string }; request: { kind: string; state: string } }
interface GitChange { path: string; status: string; tracked: boolean }

/** Home is a launcher: every collection one click away, plus the work that is waiting. */
export function HomePage({ collections, navigate }: { collections: CollectionSummary[]; navigate: AppProps["navigate"] }) {
  const groups = navigationGroups(collections);
  const requests = useQuery({ queryKey: ["requests"], queryFn: () => apiGet<{ requests: RequestEntry[] }>("requests"), enabled: !__DEVDOCS_PLAYER__, staleTime: 15_000, refetchOnWindowFocus: false, retry: false });
  const changes = useQuery({ queryKey: ["git-status"], queryFn: () => apiGet<{ changes: GitChange[] }>("git/status"), enabled: !__DEVDOCS_PLAYER__, staleTime: 5_000, refetchOnWindowFocus: false, retry: false });
  const openRequests = (requests.data?.requests ?? []).filter(entry => entry.request.state !== "closed");
  const changedCollections = [...new Set((changes.data?.changes ?? []).map(change => /^game\/content\/data\/(?:balance\/)?([A-Za-z]+)\.json$/.exec(change.path)?.[1]).filter((value): value is string => Boolean(value)))];

  return <div className="home-page">
    <div className="page-heading"><h1>{__DEVDOCS_PLAYER__ ? "Corealm guide" : "Corealm codex"}</h1><span className="count-badge">{collections.reduce((sum, collection) => sum + collection.count, 0).toLocaleString()} records</span>
      <div className="page-heading-actions">
        <button className="button" onClick={() => navigate("kits")}><Layers size={14} /> Kit ladder</button>
        <button className="button" onClick={() => navigate("world")}><MapIcon size={14} /> World map</button>
        {!__DEVDOCS_PLAYER__ && <button className="button" onClick={() => navigate("formulas")}><SlidersHorizontal size={14} /> Formulas</button>}
      </div>
    </div>
    <div className={__DEVDOCS_PLAYER__ ? undefined : "home-grid"}>
      <div className="home-areas">
        {groups.map(group => {
          const Icon = iconFor(group.entries[0]?.name ?? "");
          return <section className="area-card" key={group.label}>
            <div className="area-card-head"><Icon size={15} />{group.label}<small>{group.entries.reduce((sum, entry) => sum + entry.count, 0).toLocaleString()}</small></div>
            <div className="area-card-links">{group.entries.map(entry => <button key={entry.name} onClick={() => navigate(entry.name)} title={taskDescription(entry.name)}>{entry.label}{entry.count > 0 && <small>{entry.count}</small>}</button>)}</div>
          </section>;
        })}
      </div>
      {!__DEVDOCS_PLAYER__ && <aside className="home-side">
        <section className="panel">
          <header className="panel-header"><ClipboardList size={14} /><h2>Open requests</h2><span className="count-badge">{openRequests.length}</span><div className="panel-header-actions"><button className="text-button" onClick={() => navigate("work-queue")}>Work queue <ArrowRight size={13} /></button></div></header>
          <div className="home-list">
            {requests.isPending && <p className="empty-inline" style={{ padding: "8px 12px" }}>Loading…</p>}
            {requests.isError && <p className="empty-inline" style={{ padding: "8px 12px" }}>Requests unavailable.</p>}
            {requests.data && !openRequests.length && <p className="empty-inline" style={{ padding: "8px 12px" }}>Nothing waiting.</p>}
            {openRequests.slice(0, 8).map((entry, index) => <button key={`${entry.collection}:${entry.entityId}:${index}`} onClick={() => navigate(entry.collection, entry.entityId)}>
              <span className="badge" data-tone={entry.request.state === "open" ? "warn" : "info"}>{entry.request.kind}</span>
              <span title={entry.note.text}>{entry.note.text}</span>
              <small>{labelFor(entry.collection)}</small>
            </button>)}
          </div>
        </section>
        <section className="panel">
          <header className="panel-header"><FileDiff size={14} /><h2>Local changes</h2><span className="count-badge">{changes.data?.changes.length ?? "—"}</span><div className="panel-header-actions"><button className="text-button" onClick={() => navigate("review")}>Review <ArrowRight size={13} /></button></div></header>
          <div className="home-list">
            {changes.isError && <p className="empty-inline" style={{ padding: "8px 12px" }}>Git status unavailable.</p>}
            {changes.data && !changes.data.changes.length && <p className="empty-inline" style={{ padding: "8px 12px" }}>Working tree is clean.</p>}
            {changedCollections.slice(0, 8).map(name => {
              const target = collections.some(collection => collection.name === name) ? name : `balance/${name}`;
              const Icon = iconFor(target);
              return <button key={name} onClick={() => navigate(target)}><Icon size={14} /><span>{labelFor(target)}</span><small>modified</small></button>;
            })}
          </div>
        </section>
      </aside>}
    </div>
  </div>;
}
