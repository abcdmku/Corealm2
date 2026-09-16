import RequestsPage from "../../dev/RequestsPage.js";
import type { ViewProps } from "../types.js";
import { PAGE } from "../../ui/layout.js";

export default function RequestsView({ navigate }: ViewProps) { return <div className={PAGE}><RequestsPage navigate={navigate} /></div>; }
