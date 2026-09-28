import { CONTENT_MANIFEST_OVERLAY, type ContentManifestOverlay } from "../../../../game/src/multiplayer/contentAssetsContract.js";
import type { AssetEntry } from "../../../../game/src/render/assets.js";
import { editManifestOverlay } from "../../../../game/src/render/manifestOverlay.js";
import { measureModel, modelEntry, type ModelIdentity } from "../../../../game/src/render/measureModel.js";
import { backend, type DevdocsBackend } from "../../api/backend.js";
import { serverModels, serverModelsLoaded, viewerRegistry } from "../../viewer/registry.js";

/**
 * A model upload, the same in both modes: measure the GLB here, with the build's fields, then store
 * `assets/models/<category>/<id>.glb` through `putFiles` and record its manifest entry.
 *
 * Where the entry goes is the one difference. On a live server it is the server's overlay
 * (`CONTENT_MANIFEST_OVERLAY`), read, edited and stored beside the GLB, which clients, devdocs and the
 * server's publish check merge over the host manifest. In the repository it is `manifest.json`
 * itself (`POST /__devdocs/assets/models`), because the repository is the base game: its build, bake
 * and content check read that file, and there is no server to hold an overlay.
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

/** The overlay this upload edits: the one the page merged last, so a save carries every other server model. */
async function currentOverlay(): Promise<readonly AssetEntry[]> {
  await serverModelsLoaded();
  return serverModels();
}

export async function saveModel(bytes: ArrayBuffer, identity: ModelIdentity, on: DevdocsBackend = backend()): Promise<AssetEntry> {
  const entry = modelEntry(await measureModel(bytes), identity);
  const glb = { [`assets/${entry.file}`]: base64(new Uint8Array(bytes)) };
  if (on.kind === "server") {
    const overlay: ContentManifestOverlay = editManifestOverlay(await currentOverlay(), { entry });
    await on.putFiles({ ...glb, [CONTENT_MANIFEST_OVERLAY]: base64(new TextEncoder().encode(`${JSON.stringify(overlay, null, 2)}\n`)) });
    await serverModelsLoaded();
  } else {
    await on.putFiles(glb);
    await repoModels({ entry });
    await (await viewerRegistry()).loadManifest();
  }
  return entry;
}

/** Takes a model out of the manifest it was added to, and its file out of the store. */
export async function removeModel(id: string, on: DevdocsBackend = backend()): Promise<void> {
  if (on.kind === "server") {
    const current = await currentOverlay();
    const entry = current.find(row => row.id === id);
    if (!entry) throw new Error(`${id} is not one of this server's models`);
    const overlay = editManifestOverlay(current, { remove: id });
    await on.putFiles({ [CONTENT_MANIFEST_OVERLAY]: base64(new TextEncoder().encode(`${JSON.stringify(overlay, null, 2)}\n`)) });
    await on.admin("/admin/files", { method: "DELETE", body: { paths: [`assets/${entry.file}`] } }).catch(() => undefined);
    await serverModelsLoaded();
  } else {
    await repoModels({ remove: id });
    await (await viewerRegistry()).loadManifest();
  }
}
