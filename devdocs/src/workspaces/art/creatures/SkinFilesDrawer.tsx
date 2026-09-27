import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { collectionQuery } from "../../../api/client.js";
import { Badge, Button, Segmented } from "../../../components/ui/index.js";
import { cn } from "../../../lib/utils.js";
import { Drawer } from "../../../ui/Drawer.js";
import { albedoMaps, modelFile, uvLayout, type ModelFile } from "../../../viewer/albedo.js";
import { FilePick, Note, Pairs, errorText, useFileDrop } from "./parts.js";
import { SkinApiUnavailable, fetchSkinMap, imageFileToPng, mapsToBase64, saveSkin, type CreatureSkin } from "./skinApi.js";
import { downloadName, formatBytes, isUploadType, repoPathOfSkinMap, shortSha, sizeWarning, type PixelSize } from "./skinFiles.js";

/*
  The raw file view: every material map of one skin (or of the model itself) as the actual image,
  with its size, path, hash and provenance, a zoomable checkerboard view, the model's map beside it,
  the mesh's UV layout over it, and "Replace this map…", which previews on the stage and saves with
  `merge` so only that material changes.
*/

export const SKIN_KIND_LABEL: Readonly<Record<CreatureSkin["kind"], string>> = { imagegen: "Generated", recolor: "Recolor", upload: "Uploaded", source: "Source" };

interface FileMap extends PixelSize { material: string; blob: Blob; url: string; path?: string; sha256?: string }
interface Replacement extends PixelSize { material: string; fileName: string; png: Blob; url: string; warning?: string }
type Zoom = "fit" | 1 | 2;
const ZOOMS: readonly { value: Zoom; label: string }[] = [{ value: "fit", label: "Fit" }, { value: 1, label: "100%" }, { value: 2, label: "200%" }];

async function toFileMap(material: string, blob: Blob, extra: Partial<FileMap> = {}): Promise<FileMap> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  bitmap.close();
  return { material, blob, width, height, url: URL.createObjectURL(blob), ...extra };
}

async function loadSkinFiles(skin: CreatureSkin): Promise<FileMap[]> {
  return Promise.all(Object.entries(skin.maps).map(async ([material, path]) => toFileMap(material, await fetchSkinMap(path), { path, sha256: skin.sha256?.[material] })));
}
async function loadModelFiles(assetId: string): Promise<FileMap[]> {
  return Promise.all((await albedoMaps(assetId)).map(map => toFileMap(map.material, map.png)));
}

export function SkinFilesDrawer({ assetId, modelName, skin, readOnly, onClose, onPreviewMaps }: {
  assetId: string;
  modelName: string;
  /** Undefined: the model's own maps. */
  skin: CreatureSkin | undefined;
  readOnly: boolean;
  onClose: () => void;
  onPreviewMaps: (maps: Record<string, string> | undefined) => void;
}) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<FileMap[]>();
  const [model, setModel] = useState<FileMap[]>();
  const [glb, setGlb] = useState<ModelFile>();
  const [error, setError] = useState("");
  const [material, setMaterial] = useState<string>();
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [uv, setUv] = useState(false);
  const [compare, setCompare] = useState(false);
  const [uvUrls, setUvUrls] = useState<Record<string, string>>({});
  const [replacement, setReplacement] = useState<Replacement>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Object URLs made here are released with the view; the stage goes back to the saved look.
  const owned = useRef(new Set<string>());
  const own = (url: string) => { owned.current.add(url); return url; };
  useEffect(() => () => { for (const url of owned.current) URL.revokeObjectURL(url); onPreviewMaps(undefined); }, [onPreviewMaps]);

  // A merge rewrites files in place; the record's hashes change with them, so they key the reload.
  const version = JSON.stringify(skin ? skin.sha256 ?? skin.maps : null);
  useEffect(() => {
    let live = true;
    setError("");
    Promise.all([skin ? loadSkinFiles(skin) : undefined, loadModelFiles(assetId), modelFile(assetId)]).then(([own_, model_, glb_]) => {
      if (!live) return;
      for (const map of [...own_ ?? [], ...model_]) own(map.url);
      setFiles(own_ ?? model_); setModel(model_); setGlb(glb_);
      setMaterial(current => current && (own_ ?? model_).some(map => map.material === current) ? current : (own_ ?? model_)[0]?.material);
    }, failure => { if (live) setError(errorText(failure)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, version]);

  const shown = files?.find(map => map.material === material);
  const reference = model?.find(map => map.material === material);

  // The UV wireframe is drawn once per material, at the map's own size.
  useEffect(() => {
    if (!uv || !shown || uvUrls[shown.material]) return;
    let live = true;
    uvLayout(assetId, shown.material, shown).then(blob => { if (live) setUvUrls(current => ({ ...current, [shown.material]: own(URL.createObjectURL(blob)) })); }, failure => { if (live) setError(errorText(failure)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uv, shown, assetId]);

  async function pick(file: File, target: string) {
    setSaveError("");
    if (!isUploadType(file.type)) { setSaveError(`${file.name} is not a PNG, JPEG or WebP image.`); return; }
    try {
      const { png, width, height } = await imageFileToPng(file);
      const expected = model?.find(map => map.material === target);
      const next: Replacement = { material: target, fileName: file.name, png, width, height, url: own(URL.createObjectURL(png)), warning: expected ? sizeWarning(expected, { width, height }) : undefined };
      setReplacement(next);
      setMaterial(target);
      // The whole skin with this one map swapped, so the stage shows what saving would give.
      onPreviewMaps({ ...Object.fromEntries((files ?? []).map(map => [map.material, map.url])), [target]: next.url });
    } catch (failure) { setSaveError(errorText(failure)); }
  }
  const discard = () => { setReplacement(undefined); setSaveError(""); onPreviewMaps(undefined); };

  async function saveReplacement() {
    if (!skin || !replacement) return;
    setSaving(true); setSaveError("");
    try {
      await saveSkin({ assetId, skinId: skin.id, name: skin.name, kind: "upload", merge: true, maps: await mapsToBase64([replacement]) });
      await queryClient.invalidateQueries({ queryKey: collectionQuery("creatureSkins").queryKey });
      toast.success(`Replaced ${replacement.material} in ${skin.id}`);
      setReplacement(undefined);
      onPreviewMaps(undefined);
      setUvUrls({});
    } catch (failure) {
      setSaveError(failure instanceof SkinApiUnavailable ? `${failure.message} The replacement still previews on the stage.` : errorText(failure));
    } finally { setSaving(false); }
  }

  const title = skin ? skin.name : "Model's own maps";
  const pending = replacement && replacement.material === material ? replacement : undefined;
  const drop = useFileDrop(file => { if (material) void pick(file, material); }, !skin || readOnly || saving);

  return <Drawer wide title={<span className="flex min-w-0 items-center gap-2"><span className="truncate">{title}</span><span className="font-normal text-faint">files</span></span>} label={`${title} files`} onClose={onClose}
    className="min-[1800px]:w-[min(64rem,50vw)]"
    actions={skin ? <Badge variant="default" className="h-5 px-1.5 text-[11px]">{SKIN_KIND_LABEL[skin.kind]}</Badge> : <Badge variant="default" className="h-5 px-1.5 text-[11px]">Model</Badge>}>
    <div className="flex h-full min-h-0 flex-col gap-2" data-skin-files={skin?.id ?? "model"}>
      <div className="flex flex-wrap items-center gap-1.5">
        {files && files.length > 1 && <Segmented aria-label="Material">
          {files.map(map => <Button key={map.material} variant="segment" size="xs" aria-pressed={map.material === material} onClick={() => setMaterial(map.material)}>{map.material}</Button>)}
        </Segmented>}
        <Segmented aria-label="Zoom">
          {ZOOMS.map(option => <Button key={option.label} variant="segment" size="xs" aria-pressed={zoom === option.value} onClick={() => setZoom(option.value)}>{option.label}</Button>)}
        </Segmented>
        <Button variant="ghost" size="xs" className="h-7 border border-border" aria-pressed={uv} title="Draw the mesh's UV wireframe for this material over the map" onClick={() => setUv(value => !value)}>UV layout</Button>
        {skin && <Button variant="ghost" size="xs" className="h-7 border border-border" aria-pressed={compare} title="Show the model's own map beside this one" onClick={() => setCompare(value => !value)}>Compare with model map</Button>}
      </div>

      {error && <Note tone="error">{error}</Note>}
      <div className={cn("flex min-h-64 flex-1 gap-2", drop.over && "rounded-md ring-2 ring-primary")} {...drop.handlers}>
        {!shown ? <div className="grid flex-1 place-items-center rounded-md border border-border-subtle bg-art text-[11px] text-faint">{error ? "No maps" : "Loading maps…"}</div>
          : compare && reference ? <SyncedPair zoom={zoom}
            left={{ label: pending ? `Replacement · ${pending.fileName}` : "This skin", map: pending ?? shown, uv: uv ? uvUrls[shown.material] : undefined }}
            right={{ label: "Model's own map", map: reference, uv: uv ? uvUrls[shown.material] : undefined }} />
            : <MapView zoom={zoom} label={pending ? `Replacement · ${pending.fileName} · unsaved` : skin ? "Saved map" : "Model's own map"} map={pending ?? shown} uv={uv ? uvUrls[shown.material] : undefined} />}
      </div>

      {shown && <MapFacts assetId={assetId} skin={skin} map={shown} glb={glb} modelName={modelName} />}

      {pending && <div className="flex flex-col gap-1 rounded-md border border-border bg-muted p-2">
        <span className="text-[11px] text-foreground"><span className="font-semibold">Replacing {pending.material}</span> with {pending.fileName} ({pending.width}×{pending.height}), previewing on the stage.</span>
        {pending.warning && <Note tone="warn">{pending.warning}</Note>}
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="xs" disabled={saving} onClick={discard}>Discard</Button>
          <Button variant="default" size="xs" disabled={saving || readOnly} onClick={() => void saveReplacement()}>{saving ? "Saving…" : "Save replacement"}</Button>
        </div>
      </div>}
      {saveError && <Note tone="error">{saveError}</Note>}

      {shown && <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" size="xs" asChild><a href={shown.url} download={downloadName(skin?.id ?? assetId, shown.material)}>Download map</a></Button>
        <UvDownload assetId={assetId} owner={skin?.id ?? assetId} map={shown} />
        {skin && <FilePick name={`Replacement map for ${shown.material}`} label="Replace this map…" disabled={readOnly || saving} title="Pick a PNG, JPEG or WebP; it previews on the stage before saving" onFile={file => void pick(file, shown.material)} />}
        <span className="text-[11px] text-faint">{skin ? (readOnly ? "Read only" : "or drop an image on the map") : "Model maps are read only; upload a skin to replace them."}</span>
      </div>}
    </div>
  </Drawer>;
}

function UvDownload({ assetId, owner, map }: { assetId: string; owner: string; map: FileMap }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      // White lines read on any paint once layered in an image editor.
      const url = URL.createObjectURL(await uvLayout(assetId, map.material, map, "rgba(255, 255, 255, 1)"));
      const link = document.createElement("a");
      link.href = url; link.download = downloadName(owner, map.material, "-uv");
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { toast.error(errorText(failure)); } finally { setBusy(false); }
  };
  return <Button variant="secondary" size="xs" disabled={busy} onClick={() => void download()}>{busy ? "Drawing…" : "Download UV layout"}</Button>;
}

/** Size, path, hash and provenance of one map. */
function MapFacts({ assetId, skin, map, glb, modelName }: { assetId: string; skin: CreatureSkin | undefined; map: FileMap; glb: ModelFile | undefined; modelName: string }) {
  const rows: [string, React.ReactNode][] = [["Material", <code key="m" className="font-mono">{map.material}</code>], ["Pixels", `${map.width} × ${map.height}${map.width === map.height ? "" : ` (aspect ${(map.width / map.height).toFixed(3)})`}`]];
  if (skin && map.path) {
    rows.push(["File", <code key="f" className="font-mono" title={repoPathOfSkinMap(map.path)}>{repoPathOfSkinMap(map.path)}</code>]);
    rows.push(["File size", formatBytes(map.blob.size)]);
    rows.push(["SHA-256", map.sha256 ? <code key="s" className="font-mono" title={map.sha256}>{shortSha(map.sha256)}</code> : "Not recorded"]);
    const uploaded = skin.kind === "upload" || skin.uploaded?.includes(map.material);
    rows.push(["Origin", skin.kind === "upload" ? "Uploaded by hand" : uploaded ? `Uploaded by hand, over the ${SKIN_KIND_LABEL[skin.kind].toLowerCase()} map` : SKIN_KIND_LABEL[skin.kind]]);
    if (skin.uploaded?.length) rows.push(["Uploaded", skin.uploaded.join(", ")]);
    if (skin.generator) rows.push(["Generator", skin.generator]);
    if (skin.prompt) rows.push(["Prompt", <span key="p" title={skin.prompt}>{skin.prompt}</span>]);
    if (skin.recolor) rows.push(["Recolor", recolorText(skin.recolor)]);
    rows.push(["Created", skin.createdAt.slice(0, 16).replace("T", " ")]);
  } else {
    rows.push(["File", glb ? <span key="f" title={glb.file}>embedded in <code className="font-mono">{glb.file}</code></span> : `embedded in ${assetId}'s model`]);
    rows.push(["File size", `${formatBytes(map.blob.size)} as PNG${glb?.bytes ? ` · model ${formatBytes(glb.bytes)}` : ""}`]);
    rows.push(["SHA-256", glb?.sha256 ? <span key="s" title={glb.sha256}><code className="font-mono">{shortSha(glb.sha256)}</code> of the model file</span> : "Not recorded"]);
    rows.push(["Origin", `${modelName}'s own map${glb?.pack ? `, pack ${glb.pack}` : ""}`]);
  }
  return <Pairs rows={rows} />;
}

function recolorText(recolor: NonNullable<CreatureSkin["recolor"]>): string {
  const parts = [`hue ${recolor.hue > 0 ? "+" : ""}${recolor.hue}°`, `saturation ×${recolor.saturation.toFixed(2)}`, `value ×${recolor.value.toFixed(2)}`];
  if (recolor.near) parts.push(`only near ${recolor.near.hue}° ±${recolor.near.width}°`);
  parts.push(`from ${recolor.fromSkinId ?? "the model's maps"}`);
  return parts.join(", ");
}

interface Shown { label: string; map: PixelSize & { url: string }; uv?: string }

/** Two views of one material side by side, scrolled together. */
function SyncedPair({ zoom, left, right }: { zoom: Zoom; left: Shown; right: Shown }) {
  const a = useRef<HTMLDivElement>(null), b = useRef<HTMLDivElement>(null);
  const follow = (from: HTMLDivElement | null, to: HTMLDivElement | null) => { if (from && to) { to.scrollLeft = from.scrollLeft; to.scrollTop = from.scrollTop; } };
  return <>
    <MapView zoom={zoom} label={left.label} map={left.map} uv={left.uv} scroller={a} onScroll={() => follow(a.current, b.current)} />
    <MapView zoom={zoom} label={right.label} map={right.map} uv={right.uv} scroller={b} onScroll={() => follow(b.current, a.current)} />
  </>;
}

/** One map on a checkerboard: fit, 100% or 200%, scrolled to pan, with the UV layout over it. */
function MapView({ zoom, label, map, uv, scroller, onScroll }: { zoom: Zoom; label: string; map: PixelSize & { url: string }; uv?: string; scroller?: React.RefObject<HTMLDivElement | null>; onScroll?: () => void }) {
  const fallback = useRef<HTMLDivElement>(null);
  const ref = scroller ?? fallback;
  const [box, setBox] = useState<PixelSize>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setBox({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  const fit = box.width && box.height ? Math.min((box.width - 16) / map.width, (box.height - 16) / map.height) : 0;
  const scale = zoom === "fit" ? fit : zoom;
  return <div className="flex min-w-0 flex-1 flex-col gap-1">
    <span className="truncate text-[11px] text-muted-foreground">{label}{zoom === "fit" && fit ? ` · ${Math.round(fit * 100)}%` : ""}</span>
    <div ref={ref} onScroll={onScroll} className="flex min-h-0 flex-1 overflow-auto rounded-md border border-border-subtle bg-art p-2" data-map-zoom={zoom === "fit" ? "fit" : `${zoom * 100}`}>
      {scale > 0 && <div className="relative m-auto shrink-0 bg-[repeating-conic-gradient(var(--color-muted)_0_25%,var(--color-card)_0_50%)] bg-[length:16px_16px]"
        style={{ width: Math.round(map.width * scale), height: Math.round(map.height * scale) }}>
        <img src={map.url} alt="" draggable={false} className={cn("absolute inset-0 size-full", scale >= 1.5 && "[image-rendering:pixelated]")} />
        {uv && <img src={uv} alt="" draggable={false} className="absolute inset-0 size-full" data-uv-layout="" />}
      </div>}
    </div>
  </div>;
}
