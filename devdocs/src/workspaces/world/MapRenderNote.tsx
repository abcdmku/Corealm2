import { useEffect, useRef, useState } from "react";
import { can } from "../../api/backend.js";
import { Button } from "../../components/ui/index.js";
import { renderServerWorldMap, type RenderMapProgress } from "./renderMap.js";

/*
  Over the map when the server runs a world its map image does not show. An author who can store
  files renders it here: the capture page appears in the note while the world loads and its tiles
  are taken, then the renditions are encoded and stored, and the map redraws from the server.
*/

const PHASE: Record<RenderMapProgress["phase"], string> = {
  loading: "Loading the server's world",
  capturing: "Capturing tiles",
  encoding: "Encoding renditions",
  uploading: "Storing on the server",
  done: "Stored",
};

/** 1280 x 720 capture page, shown at a quarter. */
const FRAME = { width: 1280, height: 720, scale: 0.25 };

export function MapRenderNote({ revision, baking }: { revision?: string; baking: boolean }) {
  const [progress, setProgress] = useState<RenderMapProgress>();
  const [error, setError] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const abort = useRef<AbortController>(undefined);
  const running = progress !== undefined && progress.phase !== "done";
  useEffect(() => () => abort.current?.abort(), []);

  async function render() {
    if (!revision || !frame.current) return;
    const controller = new AbortController();
    abort.current = controller;
    setError(""); setProgress({ phase: "loading", done: 0, total: 1 });
    try {
      await renderServerWorldMap({ frame: frame.current, worldRevision: revision, signal: controller.signal, progress: setProgress });
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      setProgress(undefined);
    }
  }

  const offer = can("files") && Boolean(revision) && !baking;
  return <div className="absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-col gap-1.5 rounded-sm border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground" role="note" aria-label="World map image">
    <div className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate">
        {running ? `${PHASE[progress.phase]}${progress.phase === "loading" ? "…" : ` ${progress.done} / ${progress.total}`}`
          : progress?.phase === "done" ? "The map now shows this server's world."
          : "The map image is not of the world this server runs yet; terrain edits already show in game."}
      </span>
      {offer && !running && progress?.phase !== "done" && <Button variant="secondary" size="xs" className="shrink-0" onClick={() => void render()}
        title="Render this server's world in this browser and store the map on the server">Render map</Button>}
      {running && <Button variant="ghost" size="xs" className="shrink-0" onClick={() => { abort.current?.abort(); setProgress(undefined); }}>Stop</Button>}
    </div>
    {error && <p className="max-w-[420px] text-destructive [overflow-wrap:anywhere]" role="alert">{error}</p>}
    <div className="overflow-hidden rounded-sm border border-border-subtle" hidden={!running} style={{ width: FRAME.width * FRAME.scale, height: FRAME.height * FRAME.scale }}>
      <iframe ref={frame} title="Map capture page" className="origin-top-left border-0" style={{ width: FRAME.width, height: FRAME.height, transform: `scale(${FRAME.scale})` }} />
    </div>
  </div>;
}
