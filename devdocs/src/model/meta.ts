/**
 * Authoring metadata (status, notes, requests, verdicts) through whichever backend is installed: the
 * checkout's files in repo mode, the server's own store on a live server. Needs `can("meta")`.
 */
import { backend } from "../api/backend.js";
import { AdminFailure } from "../api/session.js";
import { META_CONFLICT_MESSAGE } from "../../../game/src/content/metaOps.js";
import type { MetaDigestResponse, MetaPatch, MetaResponse } from "../../shared/metaContracts.js";

/** The backend read path. A balance collection keeps its separator: `meta/balance/sets/<id>`. */
export function metaPath(collection: string, entityId: string): string {
  return `meta/${collection.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(entityId)}`;
}

export const metaQueryKey = (collection: string, entityId: string) => ["meta", collection, entityId] as const;

export const readMeta = (collection: string, entityId: string): Promise<MetaResponse> => backend().get<MetaResponse>(metaPath(collection, entityId));
export const readMetaDigest = (collection: string): Promise<MetaDigestResponse> => backend().get<MetaDigestResponse>(metaPath(collection, "$all"));
export const writeMeta = (collection: string, entityId: string, patch: MetaPatch): Promise<MetaResponse> => backend().patchMeta(collection, entityId, patch);

/** A save refused because the record changed since it was read. Both stores answer it with the same message. */
export function isMetaConflict(error: unknown): boolean {
  return (error instanceof AdminFailure && error.status === 409) || (error instanceof Error && error.message === META_CONFLICT_MESSAGE);
}
