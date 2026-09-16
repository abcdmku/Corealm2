import { useEffect, useRef, useState } from 'react';
import { ViewerCore, emptyViewerSnapshot } from './ViewerCore.js';
import { POSE_CLIPS, type CharacterPose } from '../../../game/src/render/characterRig.js';
import { defaultItemPose, poseClip } from './clips.js';
import type { ViewerSnapshot, ViewerSource } from './types.js';

export type { ViewerSource, ViewerSnapshot } from './types.js';
export interface AssetViewerProps {
  source: ViewerSource;
  label?: string;
  onSnapshot?: (snapshot: ViewerSnapshot) => void;
  labUrl?: string;
}

/** The renderer a closed viewer left behind, waiting for the next one to open. */
const PARKED: ViewerCore[] = [];

export function AssetViewer(props: AssetViewerProps) {
  return <ViewerPanel key={JSON.stringify(props.source)} {...props} />;
}

function ViewerPanel({ source, label = '3D model', onSnapshot, labUrl = 'http://127.0.0.1:4173/?mode=combat' }: AssetViewerProps) {
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

  return <section className="asset-viewer" aria-label={label} data-viewer-ready={snapshot.ready && !error}
    data-viewer-body={snapshot.body ?? ''} data-viewer-clip={snapshot.clip ?? ''} data-viewer-time={snapshot.time.toFixed(4)}
    data-viewer-parts={snapshot.parts.length} data-viewer-playing={snapshot.playing}>
    <div className="viewer-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <h3>{label}</h3>
      <a href={labUrl} target="_blank" rel="noreferrer">Open in game lab</a>
    </div>
    {source.mode === 'outfit' && <div className="viewer-outfit-controls" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
      <label>Body <select aria-label="Body" value={body} onChange={event => setBody(event.target.value as 'male' | 'female')}>
        <option value="male">Male</option><option value="female">Female</option>
      </select></label>
      <label>Pose <select aria-label="Pose" value={pose} disabled={!snapshot.ready} onChange={event => choosePose(event.target.value as CharacterPose)}>
        {(Object.keys(POSE_CLIPS) as CharacterPose[]).map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
      </select></label>
      <details><summary>Equipment ({shownItems.length - hidden.length}/{shownItems.length})</summary>
        <div style={{ display: 'grid', gap: 8, padding: '12px 0' }}>{shownItems.map(id => <label key={id} style={{ display: 'flex', gap: 8 }}>
          <input type="checkbox" checked={!hidden.includes(id)} onChange={event => setHidden(previous => event.target.checked ? previous.filter(value => value !== id) : [...previous, id])} />
          {id.replaceAll('_', ' ')}
        </label>)}</div>
      </details>
    </div>}
    <div style={{ position: 'relative', minWidth: 0 }}>
      <div ref={viewport} className="viewer-viewport" style={{ height: 'clamp(300px, 48vw, 540px)', width: '100%', overflow: 'hidden', borderRadius: 8, background: '#202821' }} />
      {!snapshot.ready && !error && <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#e6e7dc', pointerEvents: 'none' }}>Loading production model…</div>}
      {error && <div role="alert" style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', padding: 24, gap: 12, background: '#202821', color: '#e6e7dc' }}>
        <strong>Model unavailable</strong><span>{error}</span><button type="button" onClick={() => setRetry(value => value + 1)}>Retry model</button>
      </div>}
    </div>
    <div className="viewer-playback" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
      <button type="button" disabled={!snapshot.clip || Boolean(error)} onClick={() => core.current?.setPlaying(!snapshot.playing)}>{snapshot.playing ? 'Pause' : 'Play'}</button>
      <label style={{ minWidth: 0, flex: '1 1 200px' }}>Animation <select aria-label="Animation" value={snapshot.clip ?? ''} disabled={!snapshot.clips.length || Boolean(error)}
        style={{ maxWidth: '100%' }} onChange={event => core.current?.selectClip(event.target.value)}>
        {!snapshot.clips.length && <option value="">No animation clips</option>}
        {groups.map(group => <optgroup key={group} label={group}>{snapshot.clips.filter(clip => clip.group === group).map(clip =>
          <option key={clip.name} value={clip.name}>{clip.name} · {clip.duration.toFixed(2)}s</option>)}</optgroup>)}
      </select></label>
      <label>Speed <select aria-label="Playback speed" value={snapshot.speed} onChange={event => core.current?.setSpeed(Number(event.target.value))}>
        {[.25, .5, 1, 1.5, 2].map(speed => <option key={speed} value={speed}>{speed}×</option>)}
      </select></label>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0' }}>
      <input aria-label="Animation time" type="range" min={0} max={snapshot.duration || 1} step={.001} value={snapshot.time}
        disabled={!snapshot.clip || Boolean(error)} style={{ flex: 1, minWidth: 0 }} onChange={event => { core.current?.setPlaying(false); core.current?.scrub(Number(event.target.value)); }} />
      <output style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{snapshot.time.toFixed(2)} / {snapshot.duration.toFixed(2)} s</output>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <label><input type="checkbox" checked={snapshot.wireframe} onChange={event => core.current?.setWireframe(event.target.checked)} /> Wireframe</label>
      <label><input type="checkbox" checked={snapshot.bounds} onChange={event => core.current?.setBounds(event.target.checked)} /> Bounds</label>
      <button type="button" disabled={!snapshot.ready} onClick={() => core.current?.resetCamera()}>Reset camera</button>
      <span style={{ fontSize: 12 }}>Drag to orbit · Scroll to zoom</span>
    </div>
    {snapshot.ready && <div className="viewer-readout" style={{ marginTop: 16, fontSize: 13 }}>
      <p>Drawn size at initial pose: {snapshot.size ? formatSize(snapshot.size) : 'measuring'}</p>
      {snapshot.manifestSize && <p>Manifest size: {formatSize(snapshot.manifestSize)}</p>}
      {source.mode === 'outfit' && <p>{snapshot.parts.length} bound parts · {snapshot.attachments.length} held or rigid parts · {snapshot.missingBones.length} missing bones</p>}
      <details><summary>Materials ({snapshot.materials.length})</summary><div style={{ maxHeight: 240, overflow: 'auto', marginTop: 12 }}>
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}><thead><tr><th>Name</th><th>Type</th><th>Texture maps</th></tr></thead>
          <tbody>{snapshot.materials.map((material, index) => <tr key={`${material.name}-${index}`}><td style={{ padding: '6px 12px 6px 0', overflowWrap: 'anywhere' }}>{material.name}</td><td>{material.type.replace('Mesh', '').replace('Material', '')}</td><td>{material.textures.join(', ') || 'None'}</td></tr>)}</tbody>
        </table>
      </div></details>
      {snapshot.attachments.length > 0 && <details style={{ marginTop: 12 }}><summary>Grip and sockets</summary>
        {snapshot.attachments.map(attachment => <p key={attachment.slot} style={{ overflowWrap: 'anywhere' }}><strong>{attachment.slot}</strong>: {attachment.asset} on {attachment.bone}<br />
          Position {attachment.position.map(value => value.toFixed(3)).join(', ')} m · Rotation {attachment.rotation.map(value => value.toFixed(3)).join(', ')} rad · Scale {attachment.scale.map(value => value.toFixed(3)).join(', ')}
        </p>)}
      </details>}
    </div>}
    <script type="application/json" data-viewer-state="true">{JSON.stringify(snapshot)}</script>
  </section>;
}
