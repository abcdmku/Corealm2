import { useEffect, useRef, useState } from 'react';
import { ViewerCore, emptyViewerSnapshot } from './ViewerCore.js';
import { POSE_CLIPS, type CharacterPose } from '../../../game/src/render/characterRig.js';
import { defaultItemPose } from './clips.js';
import type { ViewerGaitMode, ViewerSnapshot, ViewerSource } from './types.js';
import { Button, Checkbox, ChoiceGroup, NativeSelect } from '../components/ui/index.js';
import { cn } from '../lib/utils.js';
import { onGameCatalog } from '../model/liveCatalog.js';

export type { ViewerSource, ViewerSnapshot } from './types.js';
export interface AssetViewerProps {
  source: ViewerSource;
  label?: string;
  onSnapshot?: (snapshot: ViewerSnapshot) => void;
  labUrl?: string;
  /** Fill a fixed frame (a record rail's model stage): the viewport takes the frame and the controls hide unless `controls`. */
  stage?: boolean;
  /** In a stage, show the animation, pose and material controls under the viewport. */
  controls?: boolean;
  /** Controlled state (a creature state or player pose from `snapshot.states`); changing it never reloads the model. */
  state?: string;
  onStateChange?: (state: string) => void;
  /** Keep playback controls visible below a full-height Art stage without the record-view controls. */
  compactPlayback?: boolean;
}

/** The renderer a closed viewer left behind, waiting for the next one to open. */
const PARKED: ViewerCore[] = [];

export function AssetViewer(props: AssetViewerProps) {
  return <ViewerPanel key={JSON.stringify(props.source)} {...props} />;
}

function ViewerPanel({ source: given, label = '3D model', onSnapshot, labUrl = 'http://127.0.0.1:4173/?mode=combat', stage = false, controls = true, state, onStateChange, compactPlayback = false }: AssetViewerProps) {
  const section = useRef<HTMLElement>(null);
  // Dev-only automation hook: `element.dispatchEvent(new CustomEvent('viewer:set-source', { detail: source }))`
  // shows another source (an actor draft, say) in this viewer until the page passes a new one.
  const [override, setOverride] = useState<ViewerSource | null>(null);
  const source = override ?? given;
  const viewport = useRef<HTMLDivElement>(null);
  const core = useRef<ViewerCore | null>(null);
  const callback = useRef(onSnapshot);
  callback.current = onSnapshot;
  const stateCallback = useRef(onStateChange);
  stateCallback.current = onStateChange;
  const [snapshot, setSnapshot] = useState(emptyViewerSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [body, setBody] = useState<'male' | 'female'>(source.mode === 'outfit' ? source.body ?? 'male' : 'male');
  const [hidden, setHidden] = useState<string[]>([]);
  const [pose, setPose] = useState<CharacterPose>(source.mode === 'outfit' ? source.pose ?? defaultItemPose(source.mainHandId) : 'idle');
  const selectedPose = useRef(pose);
  const latestSnapshot = useRef(snapshot);
  const resolved: ViewerSource = source.mode === 'outfit'
    ? { ...source, body, itemIds: source.itemIds.filter(id => !hidden.includes(id)), mainHandId: hidden.includes(source.mainHandId ?? '') ? undefined : source.mainHandId,
      offHandId: hidden.includes(source.offHandId ?? '') ? undefined : source.offHandId }
    : source;
  const resolvedKey = JSON.stringify(resolved);
  // A source change is not ready until its own model loads: drop the previous model's snapshot in the
  // same render, before the load effect runs, so nothing reads its states or parts as current.
  const [snapshotKey, setSnapshotKey] = useState(resolvedKey);
  if (snapshotKey !== resolvedKey) {
    setSnapshotKey(resolvedKey);
    const { playing, speed, wireframe, bounds } = snapshot;
    const cleared = { ...emptyViewerSnapshot(), playing, speed, wireframe, bounds };
    latestSnapshot.current = cleared;
    setSnapshot(cleared);
  }

  useEffect(() => {
    if (!viewport.current) return;
    try {
      const report = (state: ViewerSnapshot) => { latestSnapshot.current = state; setSnapshot(state); callback.current?.(state); };
      // One live renderer at a time is reused across pages: see ViewerCore.park.
      const parked = PARKED.pop();
      const viewer = parked ?? new ViewerCore(viewport.current, report);
      if (parked) parked.attach(viewport.current, report);
      core.current = viewer;
      return () => {
        core.current = null;
        if (PARKED.length < 1) { viewer.park(); PARKED.push(viewer); } else viewer.dispose();
      };
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, []);

  useEffect(() => {
    const viewer = core.current;
    if (!viewer) return;
    let active = true;
    setError(null);
    callback.current?.(latestSnapshot.current);
    void viewer.load(JSON.parse(resolvedKey) as ViewerSource).then(() => {
      if (active && source.mode === 'outfit') viewer.setState(selectedPose.current);
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [resolvedKey, retry]);

  // A record saved moments ago may not have been in the catalog yet; try again once a newer one lands.
  useEffect(() => error ? onGameCatalog(() => setRetry(count => count + 1)) : undefined, [error]);

  // Automation hook: `element.dispatchEvent(new CustomEvent('viewer:set-state', { detail: 'attack' }))`
  // puts the model in a state the same way the controlled `state` prop does.
  useEffect(() => {
    const element = section.current;
    if (!element) return;
    const listener = (event: Event) => {
      const name = (event as CustomEvent<unknown>).detail;
      if (typeof name !== 'string' || !latestSnapshot.current.states.some(state => state.name === name && state.available)) return;
      core.current?.setState(name);
      stateCallback.current?.(name);
    };
    element.addEventListener('viewer:set-state', listener);
    return () => element.removeEventListener('viewer:set-state', listener);
  }, []);

  useEffect(() => {
    const element = section.current;
    if (!element) return;
    const seek = (event: Event) => {
      const time = (event as CustomEvent<unknown>).detail;
      if (typeof time === 'number' && Number.isFinite(time)) core.current?.scrub(time);
    };
    const play = (event: Event) => {
      const playing = (event as CustomEvent<unknown>).detail;
      if (typeof playing === 'boolean') core.current?.setPlaying(playing);
    };
    const gait = (event: Event) => {
      const mode = (event as CustomEvent<unknown>).detail;
      if (mode === 'preview' || mode === 'travel') core.current?.setGaitMode(mode);
    };
    const hit = (event: Event) => {
      const seconds = (event as CustomEvent<unknown>).detail;
      if (seconds === undefined || seconds === null) core.current?.layerHit();
      else if (typeof seconds === 'number' && Number.isFinite(seconds)) core.current?.layerHit(seconds);
    };
    element.addEventListener('viewer:set-time', seek);
    element.addEventListener('viewer:set-playing', play);
    element.addEventListener('viewer:set-gait-mode', gait);
    element.addEventListener('viewer:layer-hit', hit);
    return () => {
      element.removeEventListener('viewer:set-time', seek); element.removeEventListener('viewer:set-playing', play);
      element.removeEventListener('viewer:set-gait-mode', gait); element.removeEventListener('viewer:layer-hit', hit);
    };
  }, []);

  useEffect(() => {
    const element = section.current;
    if (!element || !import.meta.env.DEV) return;
    const listener = (event: Event) => { const next = (event as CustomEvent<unknown>).detail; if (next && typeof next === 'object' && 'mode' in next) setOverride(next as ViewerSource); };
    element.addEventListener('viewer:set-source', listener);
    return () => element.removeEventListener('viewer:set-source', listener);
  }, []);

  useEffect(() => {
    if (state && snapshot.ready && latestSnapshot.current.state !== state) core.current?.setState(state);
  }, [state, snapshot.ready]);

  const groups = [...new Set(snapshot.clips.map(clip => clip.group))];
  // An actor plays and seeks through the game's own motion system.
  const actor = source.mode === 'actor';
  const shownItems = source.mode === 'outfit' ? [...source.itemIds, source.mainHandId, source.offHandId].filter((id): id is string => Boolean(id)) : [];
  const chooseState = (name: string) => { core.current?.setState(name); stateCallback.current?.(name); };
  const gaitControls = actor && <GaitControls snapshot={snapshot} onMode={mode => core.current?.setGaitMode(mode)}
    onHit={() => { core.current?.layerHit(); core.current?.setPlaying(true); }} />;
  const choosePose = (value: CharacterPose) => {
    selectedPose.current = value;
    setPose(value);
    // setState, not selectClip: a gathering pose also takes its tool in hand.
    core.current?.setState(value);
  };
  const formatSize = (size: NonNullable<ViewerSnapshot['size']>) => `${size.x.toFixed(3)} × ${size.y.toFixed(3)} × ${size.z.toFixed(3)} m`;

  // In a stage the viewport fills the frame and the controls only show when asked for.
  const chrome = cn(stage && !controls && 'hidden', stage && 'px-2 py-1');
  return <section ref={section} className={cn('asset-viewer flex min-w-0 flex-col text-[11px] text-muted-foreground', stage ? 'h-full' : 'gap-2')} aria-label={label} data-viewer-ready={snapshot.ready && !error}
    data-viewer-body={snapshot.body ?? ''} data-viewer-clip={snapshot.clip ?? ''} data-viewer-time={snapshot.time.toFixed(4)}
    data-viewer-parts={snapshot.parts.length} data-viewer-playing={snapshot.playing}
    data-viewer-gait-mode={snapshot.gaitMode} data-viewer-travel-speed={snapshot.travelSpeedMps?.toFixed(4) ?? ''}
    data-viewer-current-state={snapshot.state ?? ''} data-viewer-tint={snapshot.appearance?.tint ?? ''} data-viewer-scale={snapshot.appearance?.scale.toFixed(4) ?? ''}>
    <div className={cn('viewer-heading flex flex-wrap items-center justify-between gap-3', chrome, stage && 'pr-[4.5rem]')}>
      <h3 className="text-xs font-semibold text-foreground">{label}</h3>
      <a className="text-link underline-offset-2 hover:underline" href={labUrl} target="_blank" rel="noreferrer">Open in game lab</a>
    </div>
    {source.mode === 'outfit' && <div className={cn('viewer-outfit-controls flex flex-wrap items-center gap-x-4 gap-y-1.5', chrome)}>
      <span className={LABEL}>Body <ChoiceGroup<'male' | 'female'> aria-label="Body" value={body} onValueChange={next => { if (next) setBody(next); }}
        items={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} /></span>
      <label className={LABEL}>Pose <NativeSelect className={SELECT} aria-label="Pose" value={pose} disabled={!snapshot.ready} onChange={event => choosePose(event.target.value as CharacterPose)}>
        {(Object.keys(POSE_CLIPS) as CharacterPose[]).map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
      </NativeSelect></label>
      <details className="basis-full"><summary className="cursor-pointer select-none">Equipment ({shownItems.length - hidden.length}/{shownItems.length})</summary>
        <div className="grid gap-1.5 py-2">{shownItems.map(id => <label key={id} className={LABEL}>
          <Checkbox checked={!hidden.includes(id)} onCheckedChange={checked => setHidden(previous => checked === true ? previous.filter(value => value !== id) : [...previous, id])} />
          {id.replaceAll('_', ' ')}
        </label>)}</div>
      </details>
    </div>}
    <div className={cn('relative min-w-0', stage && !controls && 'min-h-0 flex-1')}>
      <div ref={viewport} className={cn('viewer-viewport w-full overflow-hidden bg-art', stage ? (controls ? 'h-60' : 'h-full') : 'h-[clamp(300px,48vw,540px)] rounded-lg')} />
      {!snapshot.ready && !error && <div role="status" className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-muted-foreground">Loading production model…</div>}
      {error && <div role="alert" className="absolute inset-0 grid place-content-center justify-items-center gap-2 bg-art p-6 text-center text-xs text-foreground">
        <strong className="font-semibold">Model unavailable</strong><span className="text-muted-foreground [overflow-wrap:anywhere]">{error}</span><Button size="sm" onClick={() => setRetry(value => value + 1)}>Retry model</Button>
      </div>}
    </div>
    {compactPlayback && <div className="viewer-compact-playback flex shrink-0 items-center gap-2 border-t border-border-subtle bg-background/90 px-2 py-1">
      <Button size="xs" disabled={!snapshot.ready || Boolean(error)} onClick={() => core.current?.setPlaying(!snapshot.playing)}>{snapshot.playing ? 'Pause' : 'Play'}</Button>
      <NativeSelect aria-label="Playback speed" className="h-6 w-16 text-[11px]" value={String(snapshot.speed)} disabled={!snapshot.ready}
        onChange={event => core.current?.setSpeed(Number(event.target.value))}>
        {[.25, .5, 1, 1.5, 2].map(speed => <option key={speed} value={speed}>{speed}×</option>)}
      </NativeSelect>
      {gaitControls}
      <input aria-label="Animation time" type="range" min={0} max={snapshot.duration || 1} step={.001} value={snapshot.time}
        disabled={!snapshot.ready || !snapshot.clip || Boolean(error)} className="h-4 min-w-0 flex-1 cursor-pointer accent-primary disabled:opacity-50"
        onChange={event => core.current?.scrub(Number(event.target.value))} />
      <output className="shrink-0 font-mono text-[10px] tabular-nums">{snapshot.time.toFixed(2)} / {snapshot.duration.toFixed(2)} s</output>
    </div>}
    <div className={cn('viewer-playback flex flex-wrap items-center gap-x-3 gap-y-1.5', chrome)}>
      <Button size="sm" disabled={!snapshot.clip || Boolean(error)} onClick={() => core.current?.setPlaying(!snapshot.playing)}>{snapshot.playing ? 'Pause' : 'Play'}</Button>
      {!compactPlayback && gaitControls}
      {actor ? <label className={cn(LABEL, 'min-w-0 flex-[1_1_200px]')}>State <NativeSelect className={SELECT} wrapperClassName="min-w-0 flex-1" aria-label="State" value={snapshot.state ?? ''} disabled={!snapshot.ready || Boolean(error)}
        onChange={event => chooseState(event.target.value)}>
        {snapshot.states.map(entry => <option key={entry.name} value={entry.name} disabled={!entry.available}>{entry.name}{entry.clip ? ` · ${entry.clip}` : ''}{entry.synthetic ? ' (synthesised)' : ''}</option>)}
      </NativeSelect></label>
      : <label className={cn(LABEL, 'min-w-0 flex-[1_1_200px]')}>Animation <NativeSelect className={SELECT} wrapperClassName="min-w-0 flex-1" aria-label="Animation" value={snapshot.clip ?? ''} disabled={!snapshot.clips.length || Boolean(error)}
        onChange={event => core.current?.selectClip(event.target.value)}>
        {!snapshot.clips.length && <option value="">No animation clips</option>}
        {groups.map(group => <optgroup key={group} label={group}>{snapshot.clips.filter(clip => clip.group === group).map(clip =>
          <option key={clip.name} value={clip.name}>{clip.name} · {clip.duration.toFixed(2)}s</option>)}</optgroup>)}
      </NativeSelect></label>}
      <span className={LABEL}>Speed <ChoiceGroup aria-label="Playback speed" value={String(snapshot.speed)} onValueChange={next => { if (next) core.current?.setSpeed(Number(next)); }}
        items={[.25, .5, 1, 1.5, 2].map(speed => ({ value: String(speed), label: `${speed}×` }))} /></span>
    </div>
    <div className={cn('flex items-center gap-3', chrome)}>
      <input aria-label="Animation time" type="range" min={0} max={snapshot.duration || 1} step={.001} value={snapshot.time}
        disabled={!snapshot.clip || Boolean(error)} className="h-4 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-default disabled:opacity-50" onChange={event => core.current?.scrub(Number(event.target.value))} />
      <output className="font-mono text-[11px] text-muted-foreground tabular-nums">{snapshot.time.toFixed(2)} / {snapshot.duration.toFixed(2)} s</output>
    </div>
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', chrome)}>
      <label className={LABEL}><Checkbox checked={snapshot.wireframe} onCheckedChange={checked => core.current?.setWireframe(checked === true)} /> Wireframe</label>
      <label className={LABEL}><Checkbox checked={snapshot.bounds} onCheckedChange={checked => core.current?.setBounds(checked === true)} /> Bounds</label>
      <Button size="sm" disabled={!snapshot.ready} onClick={() => core.current?.resetCamera()}>Reset camera</Button>
      <span className="text-faint">Drag to orbit · Scroll to zoom</span>
    </div>
    {snapshot.ready && <div className={cn('viewer-readout flex min-w-0 flex-col gap-1 leading-normal', chrome, stage && 'pb-2')}>
      <p>Drawn size at initial pose: {snapshot.size ? formatSize(snapshot.size) : 'measuring'}</p>
      {snapshot.manifestSize && <p>Manifest size: {formatSize(snapshot.manifestSize)}</p>}
      {source.mode === 'outfit' && <p>{snapshot.parts.length} bound parts · {snapshot.attachments.length} held or rigid parts · {snapshot.missingBones.length} missing bones</p>}
      <details><summary className="cursor-pointer select-none">Materials ({snapshot.materials.length})</summary><div className="mt-1.5 max-h-60 overflow-auto [scrollbar-width:thin]">
        <table className="w-full border-collapse text-left [&_td]:py-1 [&_td]:pr-3 [&_td]:align-top [&_th]:py-1 [&_th]:pr-3 [&_th]:font-semibold [&_th]:text-foreground"><thead><tr><th>Name</th><th>Type</th><th>Texture maps</th></tr></thead>
          <tbody>{snapshot.materials.map((material, index) => <tr key={`${material.name}-${index}`} className="border-t border-border-subtle"><td className="[overflow-wrap:anywhere]">{material.name}</td><td>{typeof material.type === 'string' ? material.type.replace('Mesh', '').replace('Material', '') : 'Unknown'}</td><td>{material.textures.join(', ') || 'None'}</td></tr>)}</tbody>
        </table>
      </div></details>
      {snapshot.attachments.length > 0 && <details><summary className="cursor-pointer select-none">Grip and sockets</summary>
        {snapshot.attachments.map(attachment => <p key={attachment.slot} className="mt-1 [overflow-wrap:anywhere]"><strong className="text-foreground">{attachment.slot}</strong>: {attachment.asset} on {attachment.bone}<br />
          Position {attachment.position.map(value => value.toFixed(3)).join(', ')} m · Rotation {attachment.rotation.map(value => value.toFixed(3)).join(', ')} rad · Scale {attachment.scale.map(value => value.toFixed(3)).join(', ')}
        </p>)}
      </details>}
    </div>}
    <script type="application/json" data-viewer-state="true">{JSON.stringify(snapshot)}</script>
  </section>;
}

const LABEL = 'inline-flex items-center gap-1.5';
const SELECT = 'h-6 text-[11px]';

function GaitControls({ snapshot, onMode, onHit }: { snapshot: ViewerSnapshot; onMode: (mode: ViewerGaitMode) => void; onHit: () => void }) {
  return <>
    <ChoiceGroup<ViewerGaitMode> aria-label="Gait playback" value={snapshot.gaitMode} onValueChange={mode => { if (mode) onMode(mode); }}
      items={[{ value: 'preview', label: 'Preview' }, { value: 'travel', label: 'Travel' }]} />
    <Button size="xs" disabled={!snapshot.ready || !['idle', 'walk', 'run'].includes(snapshot.state ?? '') || !snapshot.states.some(state => state.name === 'hit' && state.available)}
      title="Play a hit over the current pose without restarting its animation" onClick={onHit}>Layer hit</Button>
    {snapshot.travelSpeedMps !== null && <output className="shrink-0 font-mono text-[10px] tabular-nums" title="Production ground speed and clip playback rate">
      {snapshot.travelSpeedMps.toFixed(2)} m/s · {snapshot.motion?.timeScale?.toFixed(2) ?? '—'}×
    </output>}
  </>;
}
