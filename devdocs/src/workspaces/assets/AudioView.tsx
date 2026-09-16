import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Play, Square } from "lucide-react";
import { audioCatalogSchema, audioCueSchema, audioRegionIds } from "../../../../game/src/content/schema/audio.js";
import type { ContentRow } from "../../model/contracts.js";
import { useRecordDraft } from "../../model/draft.js";
import { fieldPath } from "../../model/fields.js";
import { gameUrl } from "../../model/gameUrl.js";
import { titleCase } from "../../model/summaries.js";
import { ChoiceField, ListField, NumberField } from "../../ui/field/index.js";
import { ErrorState, LoadingRows } from "../../ui/States.js";
import type { ViewProps } from "../types.js";
import { asRecord, list, num, text } from "../story/shared.js";
import "./assets.css";
import { Button } from "../../components/ui/index.js";

/*
  The audio catalog as three flat tables: cues, loops and regions. Every cell is a field from
  `ui/field` reading its label, unit and bounds off the audio schema; the ▶ buttons play a file
  through one shared <audio> element. A cue's playback rate is one value or a range, so the row
  carries the switch between the two shapes and keeps the number when it flips.
*/

interface Catalog extends ContentRow { cues?: Record<string, ContentRow>; loops?: Record<string, ContentRow>; regions?: Record<string, ContentRow> }

type Path = readonly (string | number)[];

/** The schema is the source: one lookup per column, not a table of hand-written units. */
const spec = (path: Path, value?: unknown) => fieldPath(audioCatalogSchema, path, value);
/** An exclusive bound on an integer is the next integer; on a real number validation flags it. */
const lower = (field: ReturnType<typeof spec>): number | undefined =>
  field?.min ?? (field?.exclusiveMin !== undefined && field.integer ? field.exclusiveMin + 1 : undefined);
/** Both ends of a playback-rate range are the same number schema; read it once. */
const RATE = fieldPath(audioCueSchema, ["playbackRate", 0], { playbackRate: [1, 1] });

function variantUrl(variant: unknown): string | undefined { return typeof variant === "string" ? variant : text(asRecord(variant).url); }
const fileName = (url: string | undefined): string => url ? url.split("/").at(-1) ?? url : "—";
const Empty = () => <span className="cell-empty">—</span>;

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
  const readOnly = !draft.editable;
  const catalog = draft.draft;
  const loopIds = useMemo(() => Object.keys(asRecord(catalog?.loops)), [catalog]);
  if (draft.loading) return <div className="ws-page"><LoadingRows /></div>;
  if (draft.error) return <ErrorState message={draft.error} />;
  if (!catalog) return <ErrorState message="The audio catalog is empty." />;
  const cues = Object.entries(asRecord(catalog.cues)).map(([id, cue]) => [id, asRecord(cue)] as const);
  const loops = Object.entries(asRecord(catalog.loops)).map(([id, loop]) => [id, asRecord(loop)] as const);
  const regions = asRecord(catalog.regions);
  const set = (path: Path, value: unknown) => draft.setPath(path, value);

  const numberCell = (path: Path, value: unknown, label: string): ReactNode => {
    const field = spec(path, catalog);
    return <NumberField value={num(value)} optional={field?.optional ?? true} integer={field?.integer} min={lower(field)} max={field?.max} step={field?.step}
      unit={field?.unit} readOnly={readOnly} ariaLabel={label} onChange={next => set(path, next)} />;
  };
  const choiceCell = (path: Path, value: unknown, label: string, options: readonly string[], allowEmpty?: string): ReactNode => {
    const field = spec(path, catalog);
    return <ChoiceField value={text(value)} options={options.length ? options : field?.choices?.map(String) ?? []} allowEmpty={allowEmpty}
      readOnly={readOnly} ariaLabel={label} width="id" onChange={next => set(path, next)} />;
  };
  const playButton = (url: string | undefined, label: string, loop = false) => {
    if (!url) return <Empty />;
    const active = player.playing === url;
    return <Button variant="ghost" size="icon-sm" aria-label={active ? `Stop ${label}` : `Play ${label}`} aria-pressed={active} title={url} onClick={() => active ? player.stop() : player.play(url, loop)}>{active ? <Square size={12} /> : <Play size={12} />}</Button>;
  };

  /** Fixed or range, switched per row: the number carries over both ways so nothing is retyped. */
  const rateCell = (id: string, rate: unknown): ReactNode => {
    const path = ["cues", id, "playbackRate"] as const;
    const range = Array.isArray(rate) ? rate as unknown[] : undefined;
    const setRange = (at: 0 | 1, next: number | undefined) => {
      const pair: [number, number] = [num(range?.[0]) ?? 1, num(range?.[1]) ?? 1];
      pair[at] = next ?? 1;
      set(path, [Math.min(pair[0], pair[1]), Math.max(pair[0], pair[1])]);
    };
    const switchShape = (mode: string | undefined) => {
      if (mode === "range" && !range) { const held = num(rate) ?? 1; set(path, [held, held]); }
      if (mode === "fixed" && range) set(path, num(range[0]) ?? 1);
    };
    return <span className="audio-rate">
      <ChoiceField className="audio-rate-mode" value={range ? "range" : "fixed"} options={[{ value: "fixed", label: "Fixed" }, { value: "range", label: "Range" }]}
        readOnly={readOnly} ariaLabel={`${id} playback rate shape`} onChange={switchShape} />
      {range
        ? <><NumberField value={num(range[0])} min={lower(RATE)} step={RATE?.step} readOnly={readOnly} ariaLabel={`${id} minimum playback rate`} onChange={next => setRange(0, next)} />
          <span className="muted">–</span>
          <NumberField value={num(range[1])} min={lower(RATE)} step={RATE?.step} readOnly={readOnly} ariaLabel={`${id} maximum playback rate`} onChange={next => setRange(1, next)} /></>
        : numberCell(path, rate, `${id} playback rate`)}
    </span>;
  };

  /** A region plays one loop or a pool of them; a pool is a list of the same choice. */
  const loopCell = (regionId: string, key: "music" | "ambient", region: ContentRow): ReactNode => {
    const path: Path = ["regions", regionId, key];
    const value = region[key];
    const options = loopIds.filter(id => id.startsWith(`${key}.`));
    const urlOf = (loop: string | undefined) => loop ? text(asRecord(asRecord(catalog.loops)[loop]).url) : undefined;
    if (Array.isArray(value)) {
      const pool = value.map(entry => typeof entry === "string" ? entry : "");
      return <ListField<string> items={pool} readOnly={readOnly} emptyText="None" addLabel={`Add ${key} loop`} className="audio-pool"
        onAdd={() => options.find(option => !pool.includes(option)) ?? options[0] ?? ""}
        onChange={next => set(path, next.length ? next : undefined)}
        renderItem={(loop, api) => <>
          {playButton(urlOf(loop), `${regionId} ${key} ${api.index + 1}`, true)}
          <ChoiceField value={loop} options={options} readOnly={readOnly} width="id" ariaLabel={`${regionId} ${key} loop ${api.index + 1}`} onChange={next => api.update(next ?? "")} />
        </>} />;
    }
    const current = text(value);
    return <span className="audio-loop-cell">
      {playButton(urlOf(current), `${regionId} ${key}`, true)}
      {choiceCell(path, value, `${regionId} ${key} loop`, options, "none")}
    </span>;
  };

  return <div className="ws-page audio-page">
    {draft.diagnostics.length > 0 && <ul className="audio-diagnostics" role="alert">{draft.diagnostics.map((diagnostic, index) => <li key={index}><code>{diagnostic.path}</code> {diagnostic.message}</li>)}</ul>}

    <div className="ws-heading"><h1>Cues</h1><span className="facts"><span>One-shot effects; a cue picks one of its variants</span></span></div>
    <div className="matrix audio-table"><table>
      <thead><tr><th>Cue</th><th></th><th>Variants</th><th>First file</th><th>{spec(["cues", "", "gain"])?.label ?? "Gain"}</th><th>Max voices</th><th>Minimum interval</th><th>Playback rate</th></tr></thead>
      <tbody>{cues.map(([id, cue]) => {
        const variants = list(cue.variants);
        const first = variantUrl(variants[0]);
        return <tr key={id}>
          <td className="mono">{id}</td>
          <td className="audio-play-cell">{playButton(first, id)}</td>
          <td className="cell-num">{variants.length}</td>
          <td className="is-muted mono" title={first}>{fileName(first)}</td>
          <td>{numberCell(["cues", id, "gain"], cue.gain, `${id} gain`)}</td>
          <td>{numberCell(["cues", id, "maxConcurrent"], cue.maxConcurrent, `${id} max concurrent voices`)}</td>
          <td>{numberCell(["cues", id, "minIntervalMs"], cue.minIntervalMs, `${id} minimum interval`)}</td>
          <td>{rateCell(id, cue.playbackRate)}</td>
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
          <td>{choiceCell(["loops", id, "bus"], loop.bus, `${id} bus`, [])}</td>
          <td>{numberCell(["loops", id, "gain"], loop.gain, `${id} gain`)}</td>
          <td>{numberCell(["loops", id, "fadeMs"], loop.fadeMs, `${id} fade`)}</td>
          <td>{numberCell(["loops", id, "loopStart"], loop.loopStart, `${id} loop start`)}</td>
          <td>{numberCell(["loops", id, "loopEnd"], loop.loopEnd, `${id} loop end`)}</td>
        </tr>;
      })}</tbody>
    </table></div>

    <div className="ws-heading"><h1>Regions</h1><span className="facts"><span>Which loops play where</span></span></div>
    <div className="matrix audio-table"><table>
      <thead><tr><th>Region</th><th>Music</th><th>Ambient</th><th>Music areas</th></tr></thead>
      <tbody>{audioRegionIds.map(regionId => {
        const region = asRecord(regions[regionId]);
        // Areas carry a centre, a radius and their own ids; the map is where they are authored.
        const areas = list(region.musicAreas).map(asRecord);
        return <tr key={regionId}>
          <td>{titleCase(regionId)}</td>
          <td>{loopCell(regionId, "music", region)}</td>
          <td>{loopCell(regionId, "ambient", region)}</td>
          <td className="is-muted">{areas.length ? areas.map(area => `${text(area.id) ?? "?"} → ${text(area.music) ?? "?"}`).join(" · ") : "—"}</td>
        </tr>;
      })}</tbody>
    </table></div>
  </div>;
}
