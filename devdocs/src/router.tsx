import { createHashHistory, createRootRoute, createRoute, createRouter, useLocation, useNavigate } from "@tanstack/react-router";
import App from "./App.js";
import { parseRoute, routePath } from "./ui/workspaces.js";

function RoutedApp() {
  const pathname = useLocation({ select: location => location.pathname });
  const navigate = useNavigate();
  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const route = parseRoute(segments);
  return <App route={route} navigate={(target, recordId) => {
    const path = routePath(target, recordId);
    if (path === "/") { void navigate({ to: "/" }); return; }
    // TanStack encodes splat segments. Pre-encoding them would double-encode the slashes.
    void navigate({ to: "/$", params: { _splat: path.slice(1) } });
  }} />;
}
const rootRoute = createRootRoute({ component: RoutedApp });
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/" });
const contentRoute = createRoute({ getParentRoute: () => rootRoute, path: "$" });
export const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, contentRoute]), history: createHashHistory() });
declare module "@tanstack/react-router" { interface Register { router: typeof router } }
