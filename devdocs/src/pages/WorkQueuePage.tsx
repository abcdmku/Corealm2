import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ClipboardList, FileDiff, RefreshCw } from "lucide-react";
import { apiGet } from "../api/client.js";
import type { AppProps } from "../model/contracts.js";
import RequestsPage from "../dev/RequestsPage.js";
import ReviewPage from "../dev/ReviewPage.js";

interface RequestsResponse { requests?: unknown[] }
interface GitStatusResponse { changes?: unknown[] }
type QueueView = "requests" | "review";

/** A single entry point for authored requests and local change review. */
export default function WorkQueuePage({ navigate }: AppProps) {
  const [view, setView] = useState<QueueView>("requests");
  const requests = useQuery<RequestsResponse, Error>({
    queryKey: ["requests"],
    queryFn: () => apiGet<RequestsResponse>("requests"),
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });
  const changes = useQuery<GitStatusResponse, Error>({
    queryKey: ["git-status"],
    queryFn: () => apiGet<GitStatusResponse>("git/status"),
    staleTime: 2_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const requestCount = Array.isArray(requests.data?.requests) ? requests.data.requests.length : "—";
  const changeCount = Array.isArray(changes.data?.changes) ? changes.data.changes.length : "—";

  return <section className="review-page" aria-labelledby="work-queue-title">
    <header className="review-header">
      <div className="review-header-copy">
        <span className="review-eyebrow"><ClipboardList size={14} /> Authoring queue</span>
        <h1 id="work-queue-title">Work queue</h1>
        <p>Keep incoming record work and local content changes in one place. Open a request to work on a record, or review the files waiting in this checkout.</p>
      </div>
      <dl className="review-summary" aria-label="Work queue summary">
        <div><dt>Requests</dt><dd>{requestCount}</dd></div>
        <div><dt>Changed files</dt><dd>{changeCount}</dd></div>
      </dl>
    </header>
    <nav aria-label="Work queue views" style={{ display: "flex", gap: 8, marginTop: 22, borderBottom: "1px solid var(--border)" }}>
      <button type="button" role="tab" aria-selected={view === "requests"} className={view === "requests" ? "review-requests-link" : "review-action"} onClick={() => setView("requests")}><ClipboardList size={14} />Requests</button>
      <button type="button" role="tab" aria-selected={view === "review"} className={view === "review" ? "review-requests-link" : "review-action"} onClick={() => setView("review")}><FileDiff size={14} />Changes and validation</button>
      {(requests.isFetching || changes.isFetching) && <span role="status" aria-label="Refreshing work queue" style={{ display: "inline-flex", alignItems: "center", marginLeft: "auto", color: "var(--muted)" }}><RefreshCw size={14} className="review-spin" /></span>}
    </nav>
    <div role="tabpanel" aria-label={view === "requests" ? "Requests" : "Changes and validation"} style={{ marginTop: 18, marginLeft: -36, marginRight: -36 }}>
      {view === "requests" ? <RequestsPage navigate={navigate} /> : <ReviewPage navigate={navigate} />}
    </div>
  </section>;
}
