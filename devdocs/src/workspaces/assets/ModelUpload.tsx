import { useEffect, useId, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileUp, LoaderCircle, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";

import type { AssetCategory, AssetEntry } from "../../../../game/src/render/assets.js";
import { ASSET_CATEGORIES, ASSET_ID } from "../../../../game/src/render/manifestOverlay.js";
import { measureModel, type ModelMeasurement } from "../../../../game/src/render/measureModel.js";
import { backend } from "../../api/backend.js";
import { titleCase } from "../../model/summaries.js";
import { AssetViewer } from "../../viewer/AssetViewer.js";
import { Button, Input, NativeSelect, buttonVariants } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
import { PANEL, PANEL_BODY, PANEL_HEADER } from "../../ui/layout.js";
import { FormError, SPIN } from "../../dev/panelParts.js";
import { saveModel } from "./modelStore.js";

/** The pack a new upload lands in unless the author names another. */
export function defaultUploadPack(): string { return backend().kind === "server" ? "server-uploads" : "devdocs-uploads"; }

const LABEL = "flex min-w-0 flex-col gap-0.5 text-[11px] text-muted-foreground";

/**
 * Upload a GLB: measure it here with the build's measurement, preview it in the production viewer,
 * choose its id, category, pack and tags, then store it where players load it (`modelStore.ts`).
 * With `replacing`, the id is fixed and the choices start from that model's entry.
 */
export function ModelUpload({ replacing, onClose, onSaved }: { replacing?: AssetEntry; onClose(): void; onSaved(entry: AssetEntry): void }) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const [file, setFile] = useState<File>();
  const [bytes, setBytes] = useState<ArrayBuffer>();
  const [measurement, setMeasurement] = useState<ModelMeasurement>();
  const [measureError, setMeasureError] = useState<string>();
  const [id, setId] = useState(replacing?.id ?? "");
  const [category, setCategory] = useState<AssetCategory>(replacing?.category ?? "character");
  const [pack, setPack] = useState(replacing?.pack ?? defaultUploadPack());
  const [is, setIs] = useState(replacing?.is ?? "");
  const [tags, setTags] = useState(replacing?.tags.join(", ") ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const preview = useMemo(() => file ? URL.createObjectURL(file) : undefined, [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function choose(selected: File | undefined) {
    setFile(selected); setBytes(undefined); setMeasurement(undefined); setMeasureError(undefined); setError(undefined);
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith(".glb")) { setMeasureError("Choose a .glb file: one binary glTF with its textures inside."); return; }
    try {
      const read = await selected.arrayBuffer();
      const measured = await measureModel(read);
      setBytes(read); setMeasurement(measured);
      if (!replacing && !id) setId(selected.name.replace(/\.glb$/i, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^[^a-z0-9]+/, "").slice(0, 96));
    } catch (failure) { setMeasureError(`That file is not a model this game can read: ${failure instanceof Error ? failure.message : String(failure)}`); }
  }

  const tagList = tags.split(",").map(tag => tag.trim()).filter(Boolean);
  const problem = !measurement ? "Choose a GLB first." : !ASSET_ID.test(id) ? "The id is lowercase letters, digits, - and _." : !pack.trim() ? "Name a pack." : !is.trim() ? "Say what the model is, in one word." : undefined;

  async function save() {
    if (problem || !bytes) { setError(problem); return; }
    setSaving(true); setError(undefined);
    try {
      const entry = await saveModel(bytes, { id, category, pack: pack.trim(), is: is.trim().toLowerCase(), tags: tagList });
      await queryClient.invalidateQueries({ queryKey: ["collection", "assets"] });
      toast.success(`${replacing ? "Replaced" : "Added"} ${entry.id}`);
      onSaved(entry);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setError(message); toast.error(message);
    } finally { setSaving(false); }
  }

  return <section className={cn(PANEL, "mb-3")} aria-labelledby={titleId} data-role="model-upload">
    <header className={PANEL_HEADER}>
      <UploadCloud size={14} className="shrink-0 text-muted-foreground" />
      <h2 id={titleId}>{replacing ? `Replace ${replacing.id}` : "Upload a model"}</h2>
      <span className="text-[11px] text-faint">{backend().kind === "server" ? "Stored on this server; players load it after joining." : "Written into the checkout: game/public/assets and manifest.json."}</span>
      <Button className="ml-auto" variant="ghost" size="icon-sm" aria-label="Close upload" onClick={onClose}><X size={13} /></Button>
    </header>
    <div className={cn(PANEL_BODY, "grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_20rem]")}>
      <div className="flex min-w-0 flex-col gap-2">
        <label className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "relative max-w-72 self-start overflow-hidden")}>
          <FileUp size={13} /><span className="truncate">{file?.name ?? "Choose GLB…"}</span>
          <input className="absolute inset-0 size-full cursor-pointer opacity-0" type="file" accept=".glb,model/gltf-binary" aria-label="Model GLB file" onChange={event => void choose(event.target.files?.[0])} />
        </label>
        {measureError && <FormError>{measureError}</FormError>}
        {measurement && <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]" data-role="measurement">
          <dt className="text-faint">Size</dt><dd>{measurement.size.x} × {measurement.size.y} × {measurement.size.z} m</dd>
          <dt className="text-faint">Base</dt><dd>{measurement.base.x}, {measurement.base.y}, {measurement.base.z}</dd>
          <dt className="text-faint">Bytes</dt><dd>{Math.round(measurement.bytes / 1024).toLocaleString()} KB</dd>
          <dt className="text-faint">Clips</dt><dd className="truncate" title={measurement.animations.join(", ")}>{measurement.animations.length ? measurement.animations.join(", ") : "none"}</dd>
          <dt className="text-faint">Materials</dt><dd className="truncate" title={measurement.materials.join(", ")}>{measurement.materials.length ? measurement.materials.join(", ") : "none"}</dd>
          {measurement.walkClipSeconds !== undefined && <><dt className="text-faint">Walk cycle</dt><dd>{measurement.walkClipSeconds} s</dd></>}
        </dl>}
        <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
          <label className={LABEL}>Id<Input aria-label="Model id" value={id} readOnly={Boolean(replacing)} onChange={event => setId(event.target.value)} placeholder="animal_moonhart" /></label>
          <label className={LABEL}>Category<NativeSelect aria-label="Category" value={category} disabled={Boolean(replacing)} onChange={event => setCategory(event.target.value as AssetCategory)}>{ASSET_CATEGORIES.map(value => <option key={value} value={value}>{titleCase(value)}</option>)}</NativeSelect></label>
          <label className={LABEL}>Pack<Input aria-label="Pack" value={pack} onChange={event => setPack(event.target.value)} /></label>
          <label className={LABEL}>Is<Input aria-label="What it is" value={is} onChange={event => setIs(event.target.value)} placeholder="animal" /></label>
          <label className={cn(LABEL, "col-span-2 max-md:col-span-1")}>Tags<Input aria-label="Tags" value={tags} onChange={event => setTags(event.target.value)} placeholder="deer, fairy, rigged" /></label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void save()} disabled={saving || Boolean(problem)} title={problem}>{saving ? <LoaderCircle size={13} className={SPIN} /> : <UploadCloud size={13} />}{saving ? "Saving…" : replacing ? "Replace model" : "Add model"}</Button>
          {id && ASSET_ID.test(id) && <code className="text-[11px] text-faint">assets/models/{category}/{id}.glb</code>}
        </div>
        {error && <FormError>{error}</FormError>}
      </div>
      <div className="min-w-0 [&_.viewer-viewport]:h-60!">
        {preview && measurement ? <AssetViewer source={{ mode: "glb", url: preview, manifestSize: measurement.size }} label="Upload preview" /> : <p className="py-8 text-center text-xs text-faint">The preview appears once a GLB is measured.</p>}
      </div>
    </div>
  </section>;
}
