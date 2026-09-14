import RequestsPage from "../../dev/RequestsPage.js";
import type { ViewProps } from "../types.js";
import "../../styles/review.css";

export default function RequestsView({ navigate }: ViewProps) { return <div className="ws-page"><RequestsPage navigate={navigate} /></div>; }
