import { revision, formulaRevision, tables, version } from '../../content/compiled/catalog.json';
import { catalogInstalled, installCatalog } from './catalogInstall.js';

/**
 * The catalog compiled into this build, installed as the fallback by importing this module.
 *
 * This is the ONE module that statically imports `content/compiled/catalog.json`, so it is the one
 * module whose import decides whether a process carries 2.8 MB of content. A process that reads
 * content from the repo — vitest, every tool, devdocs, the browser client — imports it for its side
 * effect before it imports anything under `content/`:
 *
 *     import "../game/src/content/bundledCatalog.js";
 *
 * A process that runs on a catalog from a database calls `installCatalog` instead and never imports
 * this file; that is what keeps the server executable off the build's content.
 *
 * Installing here is a fallback, not an override: a server that already installed its database's
 * catalog and then reaches this module through a shared tool entry keeps the catalog it installed.
 * The M4 guard still holds, because `installCatalog` throws when the content graph has already
 * evaluated — importing this module too late is an error, and a loud one.
 */
if (!catalogInstalled()) installCatalog({ version: version as 1, revision, formulaRevision, tables: tables as unknown as Record<string, unknown> });
