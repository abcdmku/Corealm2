import type { ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";

import {
  createCollectionsHandler,
  isCollectionsPath,
  requestFromIncoming,
  type CollectionsHandlerOptions,
  type DevdocsJsonResponse,
} from "./handlers/collections.js";

export type DevdocsPluginOptions = CollectionsHandlerOptions;

function send(response: ServerResponse, result: DevdocsJsonResponse): void {
  response.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(result.body);
}

function installCollectionsMiddleware(server: ViteDevServer, options: DevdocsPluginOptions): void {
  const handleCollections = createCollectionsHandler(options);
  server.middlewares.use((request, response, next) => {
    if (!isCollectionsPath(request.url)) {
      next();
      return;
    }

    void handleCollections(requestFromIncoming(request)).then((result) => {
      if (!result) {
        next();
        return;
      }
      send(response, result);
    }).catch(() => {
      // The pure handler translates expected filesystem/schema failures. This guard keeps an
      // unexpected rejection from leaving a browser request hanging.
      send(response, {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        body: JSON.stringify({ error: "Unable to read collection" }),
      });
    });
  });
}

/**
 * Vite dev-only middleware for the local dev docs API. `apply: "serve"` deliberately keeps this
 * route out of production and preview builds; the player bundle must have no dev API surface.
 */
export function devdocsPlugin(options: DevdocsPluginOptions = {}): Plugin {
  return {
    name: "corealm-devdocs-api",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      installCollectionsMiddleware(server, options);
    },
  };
}

export default devdocsPlugin;
