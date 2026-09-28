/**
 * Skins and image jobs, the same in both devdocs modes (`backend()` picks the routes).
 *
 * Saving a skin is two steps: `backend().putFiles` stores each map at
 * `assets/skins/<assetId>/<skinId>/<material>.png` (the checkout's `game/public` in repo mode, the
 * server's file store on a live server), then a normal content save upserts the `creatureSkins` row.
 * `SaveSkinRequest` describes that row: with `merge` and an existing `skinId` only the maps sent are
 * replaced and the skin's other maps, kind, prompt and createdAt stay; a hand upload into a
 * generated, recolored or source skin lists the replaced material in `uploaded`.
 *
 * Image jobs: repo `/__devdocs/imagegen`, server `/admin/imagegen` (offered when the server config
 * has an `imagegen` block).
 *   POST .../imagegen            ImagegenRequest -> { job }     GET .../imagegen -> { jobs } newest first
 *   GET  .../imagegen/<jobId>    -> { job }                     POST .../imagegen/<jobId> -> retry a failed job
 * A job runs the configured image model (Codex CLI by default) per reference, keeps the UV layout,
 * stores its outputs and, for a skin, publishes the `creatureSkins` row; painted maps survive a
 * failed save so a retry reuses them. Runner: `game/src/multiplayer/imagegenRunner.ts`.
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

export type ImagegenKind = "skin" | "icon";

export interface ImagegenRequest {
  /**
   * `skin` repaints a creature model's albedo maps (`references` required). `icon` paints an item's
   * inventory art following docs/item-icons.md (`itemId` required; `references` optional: the
   * current icon or concept art). Default `skin`.
   */
  kind?: ImagegenKind;
  itemId?: string;
  /** The model for a skin; for an icon, the item's model if it has one, else "". */
  assetId: string;
  /** Name for the resulting skin. */
  name: string;
  prompt: string;
  /** For a skin: the current albedo maps to repaint, material name -> PNG. For an icon: reference images by any name. */
  references: Record<string, PngBase64>;
}

export type ImagegenStatus = "queued" | "running" | "done" | "failed";
export interface ImagegenJob {
  id: string;
  kind: ImagegenKind;
  itemId?: string;
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
  /** Set when done: every file written, by public path (skin maps, or the 256 master and 48 icon). */
  outputs?: string[];
  error?: string;
  /** The last lines of the generator's output, for a failed or slow job. */
  log?: string;
}
