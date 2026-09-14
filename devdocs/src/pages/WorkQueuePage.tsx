import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ClipboardList, FileDiff, RefreshCw } from "lucide-react";
import { apiGet } from "../api/client.js";
import type { AppProps } from "../model/contracts.js";
import RequestsPage from "../dev/RequestsPage.js";
import ReviewPage from "../dev/ReviewPage.js";
import "../styles/review.css";

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
  const refreshing = requests.isFetching || changes.isFetching;

  return <section className="page work-queue" aria-labelledby="work-queue-title">
    <div className="page-heading">
      <h1 id="work-queue-title">Work queue</h1>
      <span className="badge" data-tone={typeof requestCount === "number" && requestCount > 0 ? "warn" : undefined}>{requestCount} {requestCount === 1 ? "request" : "requests"}</span>
      <span className="badge" data-tone={typeof changeCount === "number" && changeCount > 0 ? "info" : undefined}>{changeCount} changed {changeCount === 1 ? "file" : "files"}</span>
      {refreshing && <span role="status" aria-label="Refreshing work queue" className="muted" style={{ display: "inline-flex" }}><RefreshCw size={13} className="review-spin" /></span>}
      <div className="page-heading-actions">
        <div className="segmented" role="tablist" aria-label="Work queue views">
          <button type="button" role="tab" aria-selected={view === "requests"} className={view === "requests" ? "is-active" : ""} onClick={() => setView("requests")}><ClipboardList size={13} />Requests</button>
          <button type="button" role="tab" aria-selected={view === "review"} className={view === "review" ? "is-active" : ""} onClick={() => setView("review")}><FileDiff size={13} />Changes</button>
        </div>
      </div>
    </div>
    <div role="tabpanel" aria-label={view === "requests" ? "Requests" : "Changes and validation"}>
      {view === "requests" ? <RequestsPage navigate={navigate} /> : <ReviewPage navigate={navigate} />}
    </div>
  </section>;
}
