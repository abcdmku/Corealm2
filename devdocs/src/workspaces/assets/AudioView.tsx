import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import type { ContentRow } from "../../model/contracts.js";
import { useRecordDraft } from "../../model/draft.js";
import { gameUrl } from "../../model/gameUrl.js";
import { titleCase } from "../../model/summaries.js";
import { NumberInput, Select, Static } from "../../ui/Sheet.js";
import { ErrorState, LoadingRows } from "../../ui/States.js";
import type { ViewProps } from "../types.js";
import { asRecord, list, num, text } from "../story/shared.js";
import "./assets.css";

/*
  The audio catalog as three flat tables: cues, loops and regions. Numeric columns edit the draft
  in place; the ▶ buttons play a file through one shared <audio> element.
*/

interface Catalog extends ContentRow { cues?: Record<string, ContentRow>; loops?: Record<string, ContentRow>; regions?: Record<string, ContentRow> }

const REGIONS = ["fallowmarch", "vellenwood", "karrowmoor", "kilnhalt", "wilderness", "gravelmaw", "crownward", "gloamgarden", "faeholme"] as const;

function variantUrl(variant: unknown): string | undefined { return typeof variant === "string" ? variant : text(asRecord(variant).url); }
const fileName = (url: string | undefined): string => url ? url.split("/").at(-1) ?? url : "—";

/** One audio element for the page; `play` swaps the source, `stop` pauses it. */
function usePlayer() {
  const element = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | undefined>(undefined);
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "none";
    const ended = () => setPlaying(undefined);
    audio.addEventListener("ended", ended);
    audio.addEventListener("error", ended);
    element.current = audio;
    return () => { audio.pause(); audio.removeEventListener("ended", ended); audio.removeEventListener("error", ended); element.current = null; };
  }, []);
  const stop = () => { element.current?.pause(); setPlaying(undefined); };
  const play = (url: string, loop = false) => {
    const audio = element.current;
    if (!audio) return;
    if (playing === url) { stop(); return; }
    audio.pause();
    audio.loop = loop;
    audio.src = gameUrl(url);
    audio.currentTime = 0;
    void audio.play().then(() => setPlaying(url)).catch(() => setPlaying(undefined));
  };
  return { playing, play, stop };
}

export default function AudioView(_props: ViewProps) {
  const draft = useRecordDraft<Catalog>("audio", "$collection");
  const player = usePlayer();
  const editable = draft.editable;
  const catalog = draft.draft;
  const loopIds = useMemo(() => Object.keys(asRecord(catalog?.loops)), [catalog]);
  if (draft.loading) return <div className="ws-page"><LoadingRows /></div>;
  if (draft.error) return <ErrorState message={draft.error} />;
  if (!catalog) return <ErrorState message="The audio catalog is empty." />;
  const cues = Object.entries(asRecord(catalog.cues)).map(([id, cue]) => [id, asRecord(cue)] as const);
  const loops = Object.entries(asRecord(catalog.loops)).map(([id, loop]) => [id, asRecord(loop)] as const);
  const regions = asRecord(catalog.regions);
  const set = (path: readonly (string | number)[], value: unknown) => draft.setPath(path, value);
  const numberCell = (path: readonly (string | number)[], value: unknown, label: string, options: { integer?: boolean; min?: number; step?: number } = {}) =>
    editable ? <NumberInput value={num(value)} onChange={next => set(path, next)} ariaLabel={label} integer={options.integer} min={options.min} step={options.step} /> : <Static mono>{num(value) ?? "—"}</Static>;
  const playButton = (url: string | undefined, label: string, loop = false) => {
    if (!url) return <span className="cell-empty">—</span>;
    const active = player.playing === url;
    return <button type="button" className={`icon-button audio-play${active ? " is-active" : ""}`} aria-label={active ? `Stop ${label}` : `Play ${label}`} aria-pressed={active} title={url} onClick={() => active ? player.stop() : player.play(url, loop)}>{active ? <Square size={12} /> : <Play size={12} />}</button>;
  };
  return <div className="ws-page audio-page">
    {draft.diagnostics.length > 0 && <ul className="story-diagnostics" role="alert">{draft.diagnostics.map((diagnostic, index) => <li key={index}><code>{diagnostic.path}</code> {diagnostic.message}</li>)}</ul>}

    <div className="ws-heading"><h1>Cues</h1><span className="facts"><span>One-shot effects; a cue picks one of its variants</span></span></div>
    <div className="matrix audio-table"><table>
      <thead><tr><th>Cue</th><th></th><th>Variants</th><th>First file</th><th>Gain</th><th>Max voices</th><th>Min interval</th><th>Playback rate</th></tr></thead>
      <tbody>{cues.map(([id, cue]) => {
        const variants = list(cue.variants);
        const first = variantUrl(variants[0]);
        const rate = cue.playbackRate;
        return <tr key={id}>
          <td className="mono">{id}</td>
          <td className="audio-play-cell">{playButton(first, id)}</td>
          <td className="cell-num">{variants.length}</td>
          <td className="is-muted mono" title={first}>{fileName(first)}</td>
          <td>{numberCell(["cues", id, "gain"], cue.gain, `${id} gain`, { min: 0, step: 0.01 })}</td>
          <td>{numberCell(["cues", id, "maxConcurrent"], cue.maxConcurrent, `${id} max concurrent`, { integer: true, min: 1 })}</td>
          <td>{editable ? <NumberInput value={num(cue.minIntervalMs)} onChange={next => set(["cues", id, "minIntervalMs"], next)} ariaLabel={`${id} minimum interval`} integer min={0} unit="ms" /> : <Static mono>{num(cue.minIntervalMs) !== undefined ? `${num(cue.minIntervalMs)} ms` : "—"}</Static>}</td>
          <td>{Array.isArray(rate)
            ? <span className="audio-range">{numberCell(["cues", id, "playbackRate", 0], rate[0], `${id} minimum playback rate`, { min: 0.01, step: 0.01 })}<span className="muted">–</span>{numberCell(["cues", id, "playbackRate", 1], rate[1], `${id} maximum playback rate`, { min: 0.01, step: 0.01 })}</span>
            : numberCell(["cues", id, "playbackRate"], rate, `${id} playback rate`, { min: 0.01, step: 0.01 })}</td>
        </tr>;
      })}</tbody>
    </table></div>

    <div className="ws-heading"><h1>Loops</h1><span className="facts"><span>Music and ambience beds</span></span></div>
    <div className="matrix audio-table"><table>
      <thead><tr><th>Loop</th><th></th><th>File</th><th>Bus</th><th>Gain</th><th>Fade</th><th>Loop start</th><th>Loop end</th></tr></thead>
      <tbody>{loops.map(([id, loop]) => {
        const url = text(loop.url);
        return <tr key={id}>
          <td className="mono">{id}</td>
          <td className="audio-play-cell">{playButton(url, id, true)}</td>
          <td className="is-muted mono" title={url}>{fileName(url)}</td>
          <td>{editable ? <Select value={text(loop.bus)} onChange={next => set(["loops", id, "bus"], next)} options={["music", "ambient", "sfx"]} ariaLabel={`${id} bus`} width="num" /> : <Static>{text(loop.bus) ?? "—"}</Static>}</td>
          <td>{numberCell(["loops", id, "gain"], loop.gain, `${id} gain`, { min: 0, step: 0.01 })}</td>
          <td>{editable ? <NumberInput value={num(loop.fadeMs)} onChange={next => set(["loops", id, "fadeMs"], next)} ariaLabel={`${id} fade`} integer min={0} unit="ms" /> : <Static mono>{num(loop.fadeMs) !== undefined ? `${num(loop.fadeMs)} ms` : "—"}</Static>}</td>
          <td>{editable ? <NumberInput value={num(loop.loopStart)} onChange={next => set(["loops", id, "loopStart"], next)} ariaLabel={`${id} loop start`} min={0} step={0.1} unit="s" /> : <Static mono>{num(loop.loopStart) !== undefined ? `${num(loop.loopStart)} s` : "—"}</Static>}</td>
          <td>{editable ? <NumberInput value={num(loop.loopEnd)} onChange={next => set(["loops", id, "loopEnd"], next)} ariaLabel={`${id} loop end`} min={0} step={0.1} unit="s" /> : <Static mono>{num(loop.loopEnd) !== undefined ? `${num(loop.loopEnd)} s` : "—"}</Static>}</td>
        </tr>;
      })}</tbody>
    </table></div>

    <div className="ws-heading"><h1>Regions</h1><span className="facts"><span>Which loops play where</span></span></div>
    <div className="matrix audio-table"><table>
      <thead><tr><th>Region</th><th>Music</th><th>Ambient</th><th>Music areas</th></tr></thead>
      <tbody>{REGIONS.map(regionId => {
        const region = asRecord(regions[regionId]);
        const loopCell = (key: "music" | "ambient") => {
          const value = region[key];
          if (Array.isArray(value)) return <Static mono>{value.map(String).join(", ")}</Static>;
          const current = text(value);
          const play = playButton(current ? text(asRecord(asRecord(catalog.loops)[current]).url) : undefined, `${regionId} ${key}`, true);
          if (!editable) return <span className="audio-loop-cell">{play}<Static mono>{current ?? "—"}</Static></span>;
          return <span className="audio-loop-cell">{play}<Select value={current} onChange={next => set(["regions", regionId, key], next || undefined)} options={loopIds.filter(id => id.startsWith(key === "music" ? "music." : "ambient."))} allowEmpty="none" ariaLabel={`${regionId} ${key} loop`} width="id" /></span>;
        };
        const areas = list(region.musicAreas).map(asRecord);
        return <tr key={regionId}>
          <td>{titleCase(regionId)}</td>
          <td>{loopCell("music")}</td>
          <td>{loopCell("ambient")}</td>
          <td className="is-muted">{areas.length ? areas.map(area => `${text(area.id) ?? "?"} → ${text(area.music) ?? "?"}`).join(" · ") : "—"}</td>
        </tr>;
      })}</tbody>
    </table></div>
  </div>;
}
