import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router.js";
import { Toaster } from "sonner";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/theme.css";
import { installThumbnailProvider } from "./ui/assetThumbnails.js";
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
// Rendered GLB thumbnails need the dev server's cache endpoint and three.js; the player build gets neither.
if (!__DEVDOCS_PLAYER__) void import("./viewer/thumbnailRenderer.js").then(module => installThumbnailProvider(module.createThumbnailProvider()));
createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={queryClient}><RouterProvider router={router}/>{!__DEVDOCS_PLAYER__ && <Toaster richColors/>}</QueryClientProvider></React.StrictMode>);
