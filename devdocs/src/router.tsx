import { createHashHistory, createRootRoute, createRoute, createRouter, useLocation, useNavigate } from "@tanstack/react-router";
import App from "./App.js";
function RoutedApp() {
  const pathname = useLocation({ select: location => location.pathname });
  const navigate = useNavigate();
  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const collection = segments[0] === "balance" && segments[1] ? `balance/${segments[1]}` : segments[0];
  const recordId = segments[segments[0] === "balance" ? 2 : 1];
  return <App collection={collection} recordId={recordId} navigate={(collection, recordId) => {
    if (!collection) { void navigate({ to: "/" }); return; }
    // TanStack encodes splat segments. Pre-encoding them double-encodes the balance slash.
    const path = [collection, recordId].filter(value => value !== undefined).join("/");
    void navigate({ to: "/$", params: { _splat: path } });
  }} />;
}
const rootRoute = createRootRoute({ component: RoutedApp });
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/" });
const contentRoute = createRoute({ getParentRoute: () => rootRoute, path: "$" });
export const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, contentRoute]), history: createHashHistory() });
declare module "@tanstack/react-router" { interface Register { router: typeof router } }
