import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { can } from "./api/backend.js";
import { router } from "./router.js";
import { installThumbnailProvider } from "./ui/assetThumbnails.js";

/**
 * The editor once a backend is installed. Everything under here reads the backend at module scope —
 * the workspace list is filtered by what the mode can do — so this module must not be imported until
 * `setBackend` has run. `main.tsx` is what keeps that true.
 */

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

// Rendered GLB thumbnails write their PNG back to the repo's cache endpoint, so they need the
// checkout. A live server and the player guide both draw the glyph instead.
if (can("assets")) void import("./viewer/thumbnailRenderer.js").then(module => installThumbnailProvider(module.createThumbnailProvider()));

export function Shell() {
  return <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
    {can("write") && <Toaster richColors />}
  </QueryClientProvider>;
}
