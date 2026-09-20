import type { ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";

import {
  createCollectionsHandler,
  isCollectionsPath,
  isLoopbackDevdocsRequest,
  requestFromIncoming,
  type CollectionsHandlerOptions,
  type DevdocsJsonResponse,
} from "./handlers/collections.js";
import { createRequestsHandler, isRequestsPath } from "./handlers/requests.js";
import { createMetaHandler, isMetaPath } from "./handlers/meta.js";
import { BodyError, readJsonBody } from "./lib/body.js";
import { createAssetsHandler, isAssetsPath, ASSET_UPLOAD_MAX_REQUEST_BYTES } from './handlers/assets.js';
import { readRuntimeCatalogs } from "./catalogs.js";
import { isIconMasterPath, readIconMaster } from "./handlers/icons.js";
import { createCollectionWriteHandler, type CollectionWriteHandlerOptions } from "./handlers/writeCollections.js";
import { readRepoReferencePools } from "../../tools/content/referencePools.js";
import { createTransactionHandler, isTransactionPath } from "./handlers/transaction.js";
import { createFormulasHandler, isFormulasPath } from "./handlers/formulas.js";
import { installFormulaWatcher } from "./lib/formulaWatcher.js";
import { createValidateHandler, isValidatePath } from "./handlers/validate.js";
import { createGitHandler, isGitPath } from "./handlers/git.js";
import { createBulkHandler, isBulkPath } from './handlers/bulk.js';
import { createThumbnailsHandler, isThumbnailsPath, THUMBNAIL_MAX_REQUEST_BYTES, type ThumbnailsHandlerOptions } from './handlers/thumbnails.js';


export type DevdocsPluginOptions = CollectionsHandlerOptions & CollectionWriteHandlerOptions & ThumbnailsHandlerOptions;

function send(response: ServerResponse, result: Omit<DevdocsJsonResponse, "body"> & { body: string | Uint8Array }): void {
  response.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(result.body);
}

function installDevdocsMiddleware(server: ViteDevServer, options: DevdocsPluginOptions): void {
  const handleCollections = createCollectionsHandler({ extraCollections: readRuntimeCatalogs, ...options, editable: true });
  const formulaServices = installFormulaWatcher(server, options);
  options = {...options, compiler: formulaServices.compiler};
  const handleWrite = createCollectionWriteHandler({ referencePools: readRepoReferencePools, ...options });
  const handleTransaction = createTransactionHandler({referencePools: readRepoReferencePools,...options});
  const handleFormulas = createFormulasHandler(formulaServices);
  const handleValidate = createValidateHandler({ referencePools: readRepoReferencePools, ...options });
  const handleGit = createGitHandler();
  const handleBulk = createBulkHandler({ referencePools: readRepoReferencePools, ...options });
  const handleRequests = createRequestsHandler(options);
  const handleMeta = createMetaHandler(options);
  const handleAssets = createAssetsHandler(options);
  const handleThumbnails = createThumbnailsHandler(options);

  server.middlewares.use((request, response, next) => {
    const thumbnails = isThumbnailsPath(request.url);
    const collections = isCollectionsPath(request.url);
    const requests = isRequestsPath(request.url);
    const meta = isMetaPath(request.url);
    const icon = isIconMasterPath(request.url);
    const transaction = isTransactionPath(request.url);
    const formulas = isFormulasPath(request.url);
    const validate = isValidatePath(request.url);
    const git = isGitPath(request.url);
    const bulk = isBulkPath(request.url);
    const assets = isAssetsPath(request.url);

    if (!collections && !requests && !meta && !icon && !transaction && !formulas && !validate && !git && !bulk && !assets && !thumbnails) {
      next();
      return;
    }

    void (async () => {
      // Check origin before reading a mutation body, including malformed or oversized bodies.
      if (!isLoopbackDevdocsRequest(request)) return { status: 403, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Dev docs API accepts loopback requests only" }) };
      if (icon) return readIconMaster(requestFromIncoming(request));
      if (thumbnails) return handleThumbnails({ ...requestFromIncoming(request), body: request.method === 'PUT' ? await readJsonBody(request, THUMBNAIL_MAX_REQUEST_BYTES) : undefined });
      if (assets) return handleAssets({ ...requestFromIncoming(request), body: ['POST', 'PUT'].includes(request.method ?? '') ? await readJsonBody(request, ASSET_UPLOAD_MAX_REQUEST_BYTES) : undefined });

      if (git) return handleGit(requestFromIncoming(request));
      if (validate) return handleValidate(requestFromIncoming(request));
      if (bulk) return handleBulk({ ...requestFromIncoming(request), method: request.method, body: request.method === 'POST' ? await readJsonBody(request) : undefined });
      if (transaction || formulas) return (transaction ? handleTransaction : handleFormulas)({...requestFromIncoming(request), body:request.method === "POST" ? await readJsonBody(request) : undefined});
      if (collections && (request.method === "PUT" || request.method === "DELETE")) return handleWrite({ method: request.method, url: request.url, headers: request.headers, socket: request.socket, body: await readJsonBody(request) });
      if (meta) return handleMeta({ ...requestFromIncoming(request), method: request.method, url: request.url, headers: request.headers, socket: request.socket,
        body: request.method === "PATCH" ? await readJsonBody(request) : undefined });
      return (collections ? handleCollections : handleRequests)(requestFromIncoming(request));
    })().then((result) => {
      if (!result) {
        next();
        return;
      }
      send(response, result);
    }).catch((error: unknown) => {
      // The pure handler translates expected filesystem/schema failures. This guard keeps an
      // unexpected rejection from leaving a browser request hanging.
      send(response, {
        status: error instanceof BodyError ? error.status : 500,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        body: JSON.stringify({ error: error instanceof BodyError ? error.message : "Unable to process request" }),
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
      installDevdocsMiddleware(server, options);
    },
    // The editor writes these files itself and re-reads them through its API. The 3D viewer pulls
    // the compiled catalogue into the client graph, so without this every save is a full page
    // reload: it lands while the save is still in flight, trips the unsaved-changes prompt, and
    // throws away scroll, focus and undo.
    hotUpdate({ file, modules }) {
      if (this.environment.name !== "client") return;
      const changed = file.replaceAll("\\", "/");
      if (!/\/game\/content\/(?:data|compiled)\/[^/]+\.json$/.test(changed)) return;
      // Drop the cached copy so the next real load of the page reads the new file.
      for (const module of modules) this.environment.moduleGraph.invalidateModule(module);
      return [];
    },
  };
}

export default devdocsPlugin;
