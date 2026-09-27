/**
 * Devdocs skin and image-generation API. Repo editor only (loopback).
 *
 *   POST /__devdocs/skins               SaveSkinRequest      -> SaveSkinResponse
 *     Writes each map to `game/public/assets/skins/<assetId>/<skinId>/<material>.png` and upserts
 *     the `creatureSkins` record in one step. A new id is derived from the name when `skinId` is absent.
 *     With `merge` and an existing `skinId`, only the maps sent are replaced; the skin's other maps,
 *     kind, prompt and createdAt stay. A hand upload (`kind` "upload") into a generated, recolored
 *     or source skin lists the replaced material in `uploaded`; an upload skin is all hand-made already.
 *   POST /__devdocs/imagegen            ImagegenRequest      -> { job: ImagegenJob }
 *   GET  /__devdocs/imagegen            -> { jobs: ImagegenJob[] }        newest first
 *   GET  /__devdocs/imagegen/<jobId>    -> { job: ImagegenJob }
 *   POST /__devdocs/imagegen/<jobId>    -> { job: ImagegenJob }   retry a failed job; painted maps are reused
 *     A job asks the configured image model (Codex CLI by default; `DEVDOCS_IMAGEGEN_COMMAND`
 *     overrides) to repaint each reference albedo map from the prompt while keeping its UV layout.
 *     A finished job saves its result as an `imagegen` skin and names it in `skinId`.
 */
import type { CreatureSkin } from "../../game/src/content/schema/creatureSkins.js";

export type { CreatureSkin };

/** A PNG as base64 without the `data:` prefix. */
export type PngBase64 = string;

export interface SaveSkinRequest {
  assetId: string;
  skinId?: string;
  name: string;
  kind: "recolor" | "imagegen" | "source" | "upload";
  /** Replace only the maps sent in an existing skin (`skinId` required). */
  merge?: boolean;
  /** Material name -> PNG. */
  maps: Record<string, PngBase64>;
  recolor?: CreatureSkin["recolor"];
  prompt?: string;
  generator?: string;
}
export interface SaveSkinResponse { skin: CreatureSkin; revision: string }

export interface ImagegenRequest {
  assetId: string;
  /** Name for the resulting skin. */
  name: string;
  prompt: string;
  /** The current albedo maps to repaint, material name -> PNG. */
  references: Record<string, PngBase64>;
}

export type ImagegenStatus = "queued" | "running" | "done" | "failed";
export interface ImagegenJob {
  id: string;
  assetId: string;
  name: string;
  prompt: string;
  materials: string[];
  status: ImagegenStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Set when done: the saved skin. */
  skinId?: string;
  error?: string;
  /** The last lines of the generator's output, for a failed or slow job. */
  log?: string;
}
