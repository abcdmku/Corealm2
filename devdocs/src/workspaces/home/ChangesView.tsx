import ReviewPage from "../../dev/ReviewPage.js";
import type { ViewProps } from "../types.js";
import "../../styles/review.css";

export default function ChangesView({ navigate }: ViewProps) { return <div className="ws-page"><ReviewPage navigate={navigate} /></div>; }
