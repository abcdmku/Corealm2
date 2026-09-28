import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { backend, can } from "./api/backend.js";
import { router } from "./router.js";
import { installThumbnailProvider } from "./ui/assetThumbnails.js";

/**
 * The editor once a backend is installed. Everything under here reads the backend at module scope —
 * the workspace list is filtered by what the mode can do — so this module must not be imported until
 * `setBackend` has run. `main.tsx` is what keeps that true.
 */

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

// Thumbnails render in the browser. A checkout keeps them in its cache, a server that stores files in its asset store.
// On a server that can keep them, the page also prepares every creature whose look changed, in idle time.
if (can("assets") || can("publish")) void import("./viewer/thumbnailRenderer.js").then(module => {
  installThumbnailProvider(module.createThumbnailProvider());
  if (backend().kind === "server" && can("files")) void import("./viewer/thumbnailWarmer.js").then(warmer => warmer.startServerThumbnailWarmer(module.createThumbnailProvider()));
});

export function Shell() {
  return <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
    {can("write") && <Toaster richColors />}
  </QueryClientProvider>;
}
