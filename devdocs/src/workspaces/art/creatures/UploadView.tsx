import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { collectionQuery } from "../../../api/client.js";
import { Button, Input } from "../../../components/ui/index.js";
import { cn } from "../../../lib/utils.js";
import type { AlbedoMap } from "../../../viewer/albedo.js";
import { FilePick, Note, Row, Rows, Section, errorText, useFileDrop } from "./parts.js";
import { SkinApiUnavailable, imageFileToPng, loadAlbedo, mapsToBase64, saveSkin, type CreatureSkin } from "./skinApi.js";
import { formatBytes, isUploadType, sizeWarning, type PixelSize } from "./skinFiles.js";

/*
  "Upload skin": one picker per material of this model. Each pick is converted to PNG and drawn on
  the stage through the actor draft before anything is saved. Materials left empty take the model's
  own map, so the saved skin is complete.
*/

interface Pick extends PixelSize { fileName: string; bytes: number; png: Blob; url: string; warning?: string }
interface ModelMap extends AlbedoMap { url: string }

export function UploadView({ assetId, bodyName, skins, readOnly, target, worn, pool, onWear, onPool, onPreviewMaps, onOpenFiles }: {
  assetId: string;
  bodyName: string;
  skins: readonly CreatureSkin[];
  readOnly: boolean;
  /** "Stag · deer_t5": the definition Wear and + Pool change. */
  target: string;
  worn: string | undefined;
  pool: readonly string[];
  onWear: (skinId: string) => void;
  onPool: (skinId: string) => void;
  onPreviewMaps: (maps: Record<string, string> | undefined) => void;
  onOpenFiles: (skinId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(() => `${bodyName} upload ${skins.filter(skin => skin.kind === "upload").length + 1}`);
  const [model, setModel] = useState<ModelMap[]>();
  const [loadError, setLoadError] = useState("");
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [pickError, setPickError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState<CreatureSkin>();

  const urls = useRef(new Set<string>());
  const track = (url: string) => { urls.current.add(url); return url; };
  // Leaving the form releases its images and puts the saved look back on the stage.
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); onPreviewMaps(undefined); }, [onPreviewMaps]);

  useEffect(() => {
    let live = true;
    loadAlbedo(assetId).then(maps => { if (live) setModel(maps.map(map => ({ ...map, url: track(URL.createObjectURL(map.png)) }))); }, error => { if (live) setLoadError(errorText(error)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  // Every pick previews at once; materials without one keep the model's map on the stage too.
  useEffect(() => {
    const entries = Object.entries(picks);
    onPreviewMaps(entries.length ? Object.fromEntries(entries.map(([material, pick]) => [material, pick.url])) : undefined);
  }, [picks, onPreviewMaps]);

  async function pick(material: string, file: File) {
    setPickError(""); setSaved(undefined);
    if (!isUploadType(file.type)) { setPickError(`${file.name} is not a PNG, JPEG or WebP image.`); return; }
    try {
      const { png, width, height } = await imageFileToPng(file);
      const expected = model?.find(map => map.material === material);
      const next: Pick = { fileName: file.name, bytes: file.size, png, width, height, url: track(URL.createObjectURL(png)), warning: expected ? sizeWarning(expected, { width, height }) : undefined };
      setPicks(current => ({ ...current, [material]: next }));
    } catch (error) { setPickError(errorText(error)); }
  }
  const clear = (material: string) => setPicks(current => { const { [material]: _, ...rest } = current; return rest; });

  async function save() {
    if (!model || !Object.keys(picks).length || !name.trim()) return;
    setSaving(true); setSaveError("");
    try {
      const maps = model.map(map => ({ material: map.material, png: picks[map.material]?.png ?? map.png }));
      const response = await saveSkin({ assetId, name: name.trim(), kind: "upload", maps: await mapsToBase64(maps) });
      await queryClient.invalidateQueries({ queryKey: collectionQuery("creatureSkins").queryKey });
      toast.success(`Saved skin ${response.skin.id}`);
      setSaved(response.skin);
      setPicks({});
      setName(`${bodyName} upload ${skins.filter(skin => skin.kind === "upload").length + 2}`);
    } catch (error) {
      setSaveError(error instanceof SkinApiUnavailable ? `${error.message} The upload still previews on the stage.` : errorText(error));
    } finally { setSaving(false); }
  }

  const count = Object.keys(picks).length;
  return <Section title="Upload a skin">
    <Note>Pick or drop a PNG, JPEG or WebP for each material; it previews on the stage before saving. Materials left empty keep the model's own map, copied into the skin so it is complete.</Note>
    <Rows>
      <Row label="Name"><Input aria-label="Uploaded skin name" value={name} onChange={event => setName(event.target.value)} /></Row>
    </Rows>
    {loadError && <Note tone="error">{loadError}</Note>}
    {!model && !loadError && <Note>Loading the model's maps…</Note>}
    <div className="flex flex-col gap-1.5">
      {model?.map(map => <MaterialPick key={map.material} map={map} pick={picks[map.material]} disabled={readOnly || saving}
        onFile={file => void pick(map.material, file)} onClear={() => clear(map.material)} />)}
    </div>
    {pickError && <Note tone="error">{pickError}</Note>}
    {saveError && <Note tone="error">{saveError}</Note>}
    <div className="flex items-center justify-end gap-2">
      <span className="mr-auto text-[11px] text-faint">{model ? `${count} of ${model.length} uploaded${count && count < model.length ? ", the rest from the model" : ""}` : ""}</span>
      <Button variant="ghost" size="xs" disabled={!count || saving} onClick={() => setPicks({})}>Clear</Button>
      <Button variant="default" size="xs" disabled={!count || saving || readOnly || !name.trim()} onClick={() => void save()}>{saving ? "Saving…" : "Save skin"}</Button>
    </div>
    {saved && <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted p-2" data-saved-skin={saved.id}>
      <span className="text-[11px] text-foreground">Saved <span className="font-semibold">{saved.name}</span> <code className="font-mono text-faint">{saved.id}</code></span>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" size="xs" aria-pressed={worn === saved.id} disabled={readOnly || worn === saved.id} onClick={() => onWear(saved.id)}>{worn === saved.id ? `Worn on ${target}` : `Wear on ${target}`}</Button>
        <Button variant="secondary" size="xs" disabled={readOnly || pool.includes(saved.id)} onClick={() => onPool(saved.id)}>{pool.includes(saved.id) ? "In pool" : "+ Pool"}</Button>
        <Button variant="ghost" size="xs" onClick={() => onOpenFiles(saved.id)}>View files</Button>
      </div>
    </div>}
  </Section>;
}

function MaterialPick({ map, pick, disabled, onFile, onClear }: { map: ModelMap; pick: Pick | undefined; disabled: boolean; onFile: (file: File) => void; onClear: () => void }) {
  const drop = useFileDrop(onFile, disabled);
  return <div className={cn("flex flex-col gap-1 rounded-md border border-border-subtle p-1.5", drop.over && "border-primary bg-selected", pick && "border-border")} data-material={map.material} {...drop.handlers}>
    <div className="flex min-w-0 items-center gap-2">
      <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-sm bg-art">
        <img src={pick?.url ?? map.url} alt="" className={cn("size-full object-cover", !pick && "opacity-60")} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <code className="truncate font-mono text-[11px] text-foreground" title={map.material}>{map.material}</code>
        <span className="truncate text-[11px] text-faint">Model map {map.width}×{map.height}</span>
        <span className={cn("truncate text-[11px]", pick ? "text-muted-foreground" : "text-faint")} title={pick?.fileName}>
          {pick ? `${pick.fileName} · ${pick.width}×${pick.height} · ${formatBytes(pick.bytes)}` : "Empty: keeps the model's map"}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-stretch gap-1">
        <FilePick name={`Upload map for ${map.material}`} label={pick ? "Change…" : "Choose…"} disabled={disabled} onFile={onFile} />
        {pick && <Button variant="ghost" size="xs" disabled={disabled} onClick={onClear}>Clear</Button>}
      </span>
    </div>
    {pick?.warning && <Note tone="warn">{pick.warning}</Note>}
  </div>;
}
