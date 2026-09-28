import type { ImagegenJob } from "../../../devdocs/shared/skinContracts.js";
import { deriveItemIconArt, itemIconPublicPaths, sha256Hex } from "../content/itemIconArt.js";
import { applyMetaOperation, canonicalMetaFile, MetaFileSchema, type MetaFile } from "../content/metaOps.js";
import { formatContentJson } from "../content/compiler/canonical.js";
import { contentRevision } from "../content/compiler/revision.js";
import { parseValue } from "../content/schema/core.js";
import type { AdminActor, ServerAdminStorage } from "./adminStorage.js";
import type { ContentAssetStore } from "./contentAssets.js";
import { decodePng, encodePng } from "./imagegenPng.js";
import { ImagegenFailure, isSafeId, type IconJobFinisher, type ImagegenFinishContext } from "./imagegenRunner.js";

/**
 * Item icon image jobs (`kind: "icon"`, docs/item-icons.md), for both hosts. A job paints one
 * original from the author's prompt; `finish` hands it to the host's `store`, which derives the 256
 * master and the 48 inventory icon (`content/itemIconArt.ts`), writes both where players load them
 * and records the prompt, the original's sha256 and the time in the item's metadata `icon` block with
 * status `candidate`. The icon is live once stored; review approves or rejects it afterwards.
 *
 * The repo editor's store (`devdocs/server/handlers/icons.ts`) also keeps the original and its
 * registry entry, so `npm run icons` rebuilds the same files. A live server's store is `serverIconStore`.
 */

/** What a finished icon job hands its host. */
export interface IconOriginal {
  itemId: string;
  /** The painted PNG as the generator wrote it. */
  original: Buffer;
  prompt: string;
  /** The generator, e.g. `codex exec + gpt-image`. */
  generator: string;
  /** ISO time the job finished painting. */
  generatedAt: string;
}

export interface IconKindPorts<Owner> {
  /** Whether this host knows the item. An unknown id refuses the job before anything is painted. */
  hasItem(itemId: string): Promise<boolean>;
  /** Derives and stores both sizes and the provenance; answers every file written, by path. */
  store(icon: IconOriginal, context: ImagegenFinishContext<Owner>): Promise<string[]>;
  now?(): Date;
}

/** The instruction the image generator receives. The author's prompt is the art direction. */
export function iconTask(job: Pick<ImagegenJob, "itemId" | "name" | "prompt">, files: { output: string; reference?: { path: string } }): string {
  return [
    `Paint an inventory icon for the item "${job.name}" (${job.itemId}) in the Corealm game.`,
    ...(files.reference ? [`The attached image is a reference (the current icon or concept art); it is also on disk at ${files.reference.path}. Follow the art direction where they differ.`] : []),
    ``,
    `Art direction:`,
    job.prompt.trim(),
    ``,
    `Use your built-in image generation tool. Requirements:`,
    `- One isolated item, centred, filling about 80 percent of a square canvas with safe margins, readable at 48 pixels.`,
    `- A genuinely transparent alpha background: no floor, backdrop, cast shadow outside the object, border, tile, frame, label, text or watermark.`,
    `- Square, 1024x1024 or larger, saved as a PNG with an alpha channel.`,
    `- Save the result at exactly: ${files.output}`,
    `Do not change any other file. When the PNG is saved, reply DONE.`,
  ].join("\n");
}

export function createIconKind<Owner>(ports: IconKindPorts<Owner>): IconJobFinisher<Owner> {
  const now = ports.now ?? (() => new Date());
  return {
    async plan(request, references) {
      const itemId = request.itemId;
      if (!itemId || !isSafeId(itemId)) throw new ImagegenFailure(400, "An icon job needs the itemId it paints");
      if (!await ports.hasItem(itemId)) throw new ImagegenFailure(404, `No item ${JSON.stringify(itemId)}`);
      if (references.size > 1) throw new ImagegenFailure(400, "An icon job takes at most one reference image");
      const [reference] = references.keys();
      return [{ name: "icon", ...(reference === undefined ? {} : { reference }) }];
    },
    task: (job, _step, files) => iconTask(job, files),
    async finish(job, painted, context) {
      const image = painted[0];
      if (!image || !job.itemId) throw new ImagegenFailure(400, "The job painted no icon");
      return { outputs: await ports.store({ itemId: job.itemId, original: image.bytes, prompt: job.prompt, generator: context.generator, generatedAt: now().toISOString() }, context) };
    },
  };
}

/* ---------- A live server ---------- */

/** Both sizes as PNGs, derived without native addons. Throws for an original without real transparency. */
export async function deriveItemIconPngs(original: Uint8Array): Promise<{ master: Buffer; game: Buffer; sha256: string }> {
  const { master, game } = deriveItemIconArt(decodePng(original));
  return { master: encodePng(master), game: encodePng(game), sha256: await sha256Hex(original) };
}

export interface ServerIconStoreOptions {
  files: Pick<ContentAssetStore, "put">;
  meta: Pick<ServerAdminStorage, "authoringMeta" | "replaceAuthoringMeta">;
}

/**
 * Stores an icon on a live server as the job's creator: both sizes in the file store (live to players
 * at once, as every stored file is), then the `candidate` provenance in the item's metadata.
 */
export function serverIconStore(options: ServerIconStoreOptions): IconKindPorts<AdminActor>["store"] {
  return async (icon, { owner, log }) => {
    const derived = await deriveItemIconPngs(icon.original);
    const paths = itemIconPublicPaths(icon.itemId);
    await options.files.put({ [paths.master]: derived.master.toString("base64"), [paths.game]: derived.game.toString("base64") }, owner);
    log(`\n== stored ${paths.master} and ${paths.game}\n`);
    const by = owner.accountId ?? owner.credential;
    const operation = { kind: "icon" as const, status: "candidate" as const, sha256: derived.sha256, prompt: icon.prompt, generatedAt: icon.generatedAt };
    // Another save between the read and the write moves the revision: read again.
    for (let attempt = 1; ; attempt += 1) {
      const stored = await options.meta.authoringMeta("items");
      const records: MetaFile = stored ? parseValue(MetaFileSchema, JSON.parse(stored.records), "items.meta") : {};
      const next = canonicalMetaFile(applyMetaOperation(records, "items", icon.itemId, {}, operation, by, icon.generatedAt), "items");
      const text = formatContentJson(next);
      const written = await options.meta.replaceAuthoringMeta("items", stored ? stored.revision : null, { records: text, revision: contentRevision(text) }, owner,
        { action: "meta.icon", target: `items/${icon.itemId}`, after: operation });
      if (written) break;
      if (attempt >= 5) throw new Error("The item's metadata kept changing; Retry records the icon again");
    }
    return [paths.master, paths.game];
  };
}
