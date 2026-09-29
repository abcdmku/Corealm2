import { CONTENT_ASSET_PATH, CONTENT_MANIFEST_OVERLAY, type ContentAssetIndex, type ContentManifestOverlay } from "../../../../game/src/multiplayer/contentAssetsContract.js";
import type { AssetEntry } from "../../../../game/src/render/assets.js";
import { editManifestOverlay } from "../../../../game/src/render/manifestOverlay.js";
import { measureModel, modelEntry, parseModel, type ModelIdentity } from "../../../../game/src/render/measureModel.js";
import { backend, type DevdocsBackend } from "../../api/backend.js";
import { AdminFailure } from "../../api/session.js";
import { adoptContentIndex, serverModels, serverModelsLoaded } from "../../model/serverFiles.js";
import { viewerRegistry } from "../../viewer/registry.js";
import { uploadedModelFile, type BundledModel } from "./modelFiles.js";

/**
 * A model upload, the same in both modes: measure the GLB here, with the build's fields, then store
 * its files through `putFiles` and record its manifest entry. A lone GLB is
 * `assets/models/<category>/<id>.glb`; a model with texture files gets its own folder,
 * `assets/models/<category>/<id>/<id>.glb` with each texture at the relative URI the GLB names.
 *
 * Where the entry goes is the one difference. On a live server it is the server's overlay
 * (`CONTENT_MANIFEST_OVERLAY`), which clients, devdocs and the server's publish check merge over the
 * host manifest. Two authors may edit it at once, so every overlay write reads the file index, edits
 * the overlay it names and writes with `expect: <index revision>`; a 409 `stale` re-reads and retries
 * once. In the repository it is `manifest.json` itself (`POST /__devdocs/assets/models`), because the
 * repository is the base game.
 */

function base64(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

async function repoModels(request: { entry: AssetEntry } | { remove: string }): Promise<void> {
  const response = await fetch("/__devdocs/assets/models", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(request) });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
    throw new Error(body?.error ?? `The model could not be saved (${response.status})`);
  }
}

/** The default contact point of an attack clip with no authored one. */
export const DEFAULT_CONTACT_NORMALIZED = 0.45;

/**
 * The attack timing combat reads for a creature model (`creatureMotionTiming.ts`): the first clip
 * named `attack…`, its length, and the contact point the clip's extras author (`contactNormalized`,
 * as the motion tools write it), else the build's default. None without an attack clip.
 */
export async function attackTiming(glb: ArrayBuffer): Promise<{ attackSeconds: number; contactNormalized: number } | null> {
  const gltf = await parseModel(glb);
  const clips = (gltf.parser.json as { animations?: { name?: string; extras?: { contactNormalized?: unknown } }[] }).animations ?? [];
  const at = clips.findIndex(clip => /^attack/i.test(clip.name ?? ""));
  const clip = at < 0 ? undefined : gltf.animations.find(animation => animation.name === clips[at]!.name);
  if (!clip || !(clip.duration > 0)) return null;
  const authored = clips[at]!.extras?.contactNormalized;
  return { attackSeconds: Math.round(clip.duration * 1e6) / 1e6,
    contactNormalized: typeof authored === "number" && authored > 0 && authored < 1 ? authored : DEFAULT_CONTACT_NORMALIZED };
}

/** A model's manifest entry: the build's measurement, its attack timing, and where its files go. */
export async function uploadEntry(model: BundledModel, identity: ModelIdentity): Promise<{ entry: AssetEntry; files: Record<string, Uint8Array> }> {
  const glb = model.glb.slice().buffer;
  const timing = await attackTiming(glb);
  const withResources = Object.keys(model.resources).length > 0;
  const entry: AssetEntry = { ...modelEntry(await measureModel(glb), identity), file: uploadedModelFile(identity.category, identity.id, withResources), ...(timing ?? {}) };
  const folder = `assets/${entry.file.slice(0, entry.file.lastIndexOf("/") + 1)}`;
  const files: Record<string, Uint8Array> = { [`assets/${entry.file}`]: model.glb };
  for (const [uri, bytes] of Object.entries(model.resources)) files[`${folder}${uri}`] = bytes;
  const refused = Object.keys(files).find(path => !CONTENT_ASSET_PATH.test(path));
  if (refused) throw new Error(`${refused} is not a path a model file may have.`);
  return { entry, files };
}

const encodeFiles = (files: Record<string, Uint8Array>): Record<string, string> =>
  Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, base64(bytes)]));

/**
 * Read the index, edit the overlay it names, write it only if the index has not moved. A 409 `stale`
 * means another author wrote in between: read again, edit their overlay, retry once.
 */
export async function editServerOverlay(on: DevdocsBackend, change: (current: readonly AssetEntry[]) => ContentManifestOverlay): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const index = await on.admin<ContentAssetIndex>("/admin/files");
    adoptContentIndex(index.files);
    await serverModelsLoaded();
    const overlay = change(serverModels());
    try {
      const next = await on.admin<ContentAssetIndex>("/admin/files", { method: "POST",
        body: { files: { [CONTENT_MANIFEST_OVERLAY]: base64(new TextEncoder().encode(`${JSON.stringify(overlay, null, 2)}\n`)) }, expect: index.revision } });
      adoptContentIndex(next.files);
      await serverModelsLoaded();
      return;
    } catch (error) {
      if (attempt === 0 && error instanceof AdminFailure && error.status === 409 && error.code === "stale") continue;
      throw error;
    }
  }
}

export async function saveModel(model: BundledModel, identity: ModelIdentity, on: DevdocsBackend = backend()): Promise<AssetEntry> {
  const { entry, files } = await uploadEntry(model, identity);
  // The model's own files first: they are new paths, so no other author's write can be lost.
  await on.putFiles(encodeFiles(files));
  if (on.kind === "server") await editServerOverlay(on, current => editManifestOverlay(current, { entry }));
  else {
    await repoModels({ entry });
    await (await viewerRegistry()).loadManifest();
  }
  return entry;
}

/**
 * Takes a model out of the manifest it was added to, and its files out of the store. On a server the
 * files go first: the store refuses (409 `file_referenced`) while content still names the model, and
 * then nothing changes.
 */
export async function removeModel(id: string, on: DevdocsBackend = backend()): Promise<void> {
  if (on.kind === "server") {
    await serverModelsLoaded();
    const entry = serverModels().find(row => row.id === id);
    if (!entry) throw new Error(`${id} is not one of this server's models`);
    const index = await on.admin<ContentAssetIndex>("/admin/files");
    const file = `assets/${entry.file}`, folder = file.slice(0, file.lastIndexOf("/") + 1);
    const paths = Object.keys(index.files).filter(path => path === file || (folder.endsWith(`/${id}/`) && path.startsWith(folder)));
    if (paths.length) adoptContentIndex((await on.admin<ContentAssetIndex>("/admin/files", { method: "DELETE", body: { paths } })).files);
    await editServerOverlay(on, current => editManifestOverlay(current, { remove: id }));
  } else {
    await repoModels({ remove: id });
    await (await viewerRegistry()).loadManifest();
  }
}
