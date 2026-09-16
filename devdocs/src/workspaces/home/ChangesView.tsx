import ReviewPage from "../../dev/ReviewPage.js";
import type { ViewProps } from "../types.js";
import { PAGE } from "../../ui/layout.js";

export default function ChangesView({ navigate }: ViewProps) { return <div className={PAGE}><ReviewPage navigate={navigate} /></div>; }
