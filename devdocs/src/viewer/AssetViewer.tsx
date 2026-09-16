import { useEffect, useRef, useState } from 'react';
import { ViewerCore, emptyViewerSnapshot } from './ViewerCore.js';
import { POSE_CLIPS, type CharacterPose } from '../../../game/src/render/characterRig.js';
import { defaultItemPose, poseClip } from './clips.js';
import type { ViewerSnapshot, ViewerSource } from './types.js';
import { Button, Checkbox, ChoiceGroup, NativeSelect } from '../components/ui/index.js';
import { cn } from '../lib/utils.js';

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
}

/** The renderer a closed viewer left behind, waiting for the next one to open. */
const PARKED: ViewerCore[] = [];

export function AssetViewer(props: AssetViewerProps) {
  return <ViewerPanel key={JSON.stringify(props.source)} {...props} />;
}

function ViewerPanel({ source, label = '3D model', onSnapshot, labUrl = 'http://127.0.0.1:4173/?mode=combat', stage = false, controls = true }: AssetViewerProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const core = useRef<ViewerCore | null>(null);
  const callback = useRef(onSnapshot);
  callback.current = onSnapshot;
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
    void viewer.load(JSON.parse(resolvedKey) as ViewerSource).then(() => {
      if (active && source.mode === 'outfit') {
        const clip = poseClip(latestSnapshot.current.clips.map(entry => entry.name), selectedPose.current);
        if (clip) viewer.selectClip(clip);
      }
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [resolvedKey, retry]);

  const groups = [...new Set(snapshot.clips.map(clip => clip.group))];
  const shownItems = source.mode === 'outfit' ? [...source.itemIds, source.mainHandId, source.offHandId].filter((id): id is string => Boolean(id)) : [];
  const choosePose = (value: CharacterPose) => {
    selectedPose.current = value;
    setPose(value);
    const clip = poseClip(snapshot.clips.map(entry => entry.name), value);
    if (clip) core.current?.selectClip(clip);
  };
  const formatSize = (size: NonNullable<ViewerSnapshot['size']>) => `${size.x.toFixed(3)} × ${size.y.toFixed(3)} × ${size.z.toFixed(3)} m`;

  // In a stage the viewport fills the frame and the controls only show when asked for.
  const chrome = cn(stage && !controls && 'hidden', stage && 'px-2 py-1');
  return <section className={cn('asset-viewer flex min-w-0 flex-col text-[11px] text-muted-foreground', stage ? 'h-full' : 'gap-2')} aria-label={label} data-viewer-ready={snapshot.ready && !error}
    data-viewer-body={snapshot.body ?? ''} data-viewer-clip={snapshot.clip ?? ''} data-viewer-time={snapshot.time.toFixed(4)}
    data-viewer-parts={snapshot.parts.length} data-viewer-playing={snapshot.playing}>
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
    <div className={cn('viewer-playback flex flex-wrap items-center gap-x-3 gap-y-1.5', chrome)}>
      <Button size="sm" disabled={!snapshot.clip || Boolean(error)} onClick={() => core.current?.setPlaying(!snapshot.playing)}>{snapshot.playing ? 'Pause' : 'Play'}</Button>
      <label className={cn(LABEL, 'min-w-0 flex-[1_1_200px]')}>Animation <NativeSelect className={SELECT} wrapperClassName="min-w-0 flex-1" aria-label="Animation" value={snapshot.clip ?? ''} disabled={!snapshot.clips.length || Boolean(error)}
        onChange={event => core.current?.selectClip(event.target.value)}>
        {!snapshot.clips.length && <option value="">No animation clips</option>}
        {groups.map(group => <optgroup key={group} label={group}>{snapshot.clips.filter(clip => clip.group === group).map(clip =>
          <option key={clip.name} value={clip.name}>{clip.name} · {clip.duration.toFixed(2)}s</option>)}</optgroup>)}
      </NativeSelect></label>
      <span className={LABEL}>Speed <ChoiceGroup aria-label="Playback speed" value={String(snapshot.speed)} onValueChange={next => { if (next) core.current?.setSpeed(Number(next)); }}
        items={[.25, .5, 1, 1.5, 2].map(speed => ({ value: String(speed), label: `${speed}×` }))} /></span>
    </div>
    <div className={cn('flex items-center gap-3', chrome)}>
      <input aria-label="Animation time" type="range" min={0} max={snapshot.duration || 1} step={.001} value={snapshot.time}
        disabled={!snapshot.clip || Boolean(error)} className="h-4 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-default disabled:opacity-50" onChange={event => { core.current?.setPlaying(false); core.current?.scrub(Number(event.target.value)); }} />
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
          <tbody>{snapshot.materials.map((material, index) => <tr key={`${material.name}-${index}`} className="border-t border-border-subtle"><td className="[overflow-wrap:anywhere]">{material.name}</td><td>{material.type.replace('Mesh', '').replace('Material', '')}</td><td>{material.textures.join(', ') || 'None'}</td></tr>)}</tbody>
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
