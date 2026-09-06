"""Read-only NPZ gait measurement. Writes only its own JSON and Markdown report."""
from pathlib import Path
import hashlib
import json
import numpy as np

ROOT = Path(__file__).resolve().parent
ROOTS = {'front_L': 'Foot_front_L2', 'front_R': 'Foot_front_L2.002',
         'hind_L': 'Foot_Back_L', 'hind_R': 'Foot_Back_R'}


def descendants(root, parents):
    result = {root}
    while True:
        new = result | {name for name, parent in parents.items() if parent in result}
        if new == result:
            return sorted(result)
        result = new


def windows(mask, phases):
    n = len(mask)
    if not np.any(mask):
        return []
    if np.all(mask):
        return [[0., 1.]]
    starts = [i for i in range(n) if mask[i] and not mask[(i-1) % n]]
    result = []
    for start in starts:
        end = start
        while mask[end % n]:
            end += 1
        result.append([float(phases[start]), float(phases[end % n]) + int(end >= n)])
    return result


def main():
    npz_path = ROOT/'lynx-weight-fit-data.npz'
    data = np.load(npz_path)
    meta = json.loads((ROOT/'lynx-weight-fit-data.json').read_text())
    rig = json.loads((ROOT/'historical-rig-audit.json').read_text())
    names = meta['boneNames']
    parents = {b['name']: b['parent'] for b in rig['bones']}
    # Native actions replace the FBX scene-placement transform. Sampled Blender
    # world space is already near-origin Z-up, -Y forward. See bake_data.py.
    # Applying the pre-action imported armature matrix here would be incorrect.
    truth = data['truth']
    rest = data['vertices'][:, :3]*.1
    report = {'sourceSha256': hashlib.sha256(npz_path.read_bytes()).hexdigest(),
              'coordinateSystem': 'native sampled world metres; Z up, -Y forward; source scene placement replaced by native actions',
              'method': 'Descendant influence sum >=0.5; fixed lowest 20% rest paw vertices form sole center; actual height is minimum across the entire selected foot. Candidate stance requires both interval endpoints within max(12mm,20% excursion) of that foot minimum and backward median sole-center sweep >25mm/s.',
              'contactAccepted': False, 'feet': {}, 'clips': {}}
    masks = {}
    soles = {}
    for label, root in ROOTS.items():
        groups = descendants(root, parents)
        mask = data['weights'][:, [names.index(n) for n in groups]].sum(axis=1) >= .5
        indices = np.flatnonzero(mask)
        if len(indices) < 20:
            raise RuntimeError(f'Too few foot vertices: {label}')
        sole = indices[rest[indices, 2] <= np.quantile(rest[indices, 2], .2)]
        masks[label], soles[label] = indices, sole
        report['feet'][label] = {'root': root, 'descendants': groups,
            'vertexCount': len(indices), 'soleVertexCount': len(sole),
            'restMinZMetres': float(rest[indices, 2].min()),
            'vertexIndices': indices.tolist(), 'soleVertexIndices': sole.tolist()}
    for clip in sorted({s['clip'] for s in meta['samples']}):
        order = sorted([i for i, s in enumerate(meta['samples']) if s['clip'] == clip],
                       key=lambda i: meta['samples'][i]['frame'])
        frames = np.array([meta['samples'][i]['frame'] for i in order])
        first, last = frames[0], frames[-1]
        duration = (last-first)/24
        # Last key duplicates phase zero. Keep it for interval derivative only.
        phase = (frames-first)/(last-first)
        record = {'durationSeconds': float(duration), 'feet': {}}
        for label in ROOTS:
            foot = truth[order][:, masks[label], :]
            sole = truth[order][:, soles[label], :]
            height = foot[:, :, 2].min(axis=1)
            center = np.median(sole, axis=1)
            forward = -center[:, 1]
            speed = -np.diff(forward)/np.diff(frames/24)
            threshold = max(.012, .2*float(np.ptp(height)))
            low = height <= height.min()+threshold
            stance = low[:-1] & low[1:] & (speed > .025)
            stance_windows = windows(stance, phase[:-1])
            sweep_windows = windows(speed > .025, phase[:-1])
            substantial_sweeps = [w for w in sweep_windows if w[1]-w[0] >= .15]
            accepted_speed = speed[stance]
            repair_windows = substantial_sweeps if clip.endswith('Walk') else stance_windows
            repair_mask = np.zeros(len(speed), dtype=bool)
            for a, b in repair_windows:
                unwrapped = np.where(phase[:-1] < a, phase[:-1]+1, phase[:-1])
                repair_mask |= (unwrapped >= a) & (unwrapped < b)
            repair_speeds = speed[repair_mask]
            confidence = 'low'
            if len(accepted_speed) >= 4 and len(stance_windows) == 1:
                spread = np.std(accepted_speed)/max(np.mean(accepted_speed), 1e-6)
                confidence = 'moderate' if spread < .4 else 'low'
            record['feet'][label] = {
                'minimumSoleZMetres': float(height.min()),
                'maximumMinimumSoleZMetres': float(height.max()),
                'soleHeightExcursionMetres': float(np.ptp(height)),
                'medianSoleCenterForwardRangeMetres': float(np.ptp(forward)),
                'loopCenterMismatchMetres': float(np.linalg.norm(center[-1]-center[0])),
                'candidateHeightThresholdMetres': threshold,
                'candidatePeriodicPhaseWindows': stance_windows,
                'backwardSweepPhaseWindows': sweep_windows,
                'suggestedRepairPhaseWindows': repair_windows,
                'repairSweepBackwardSpeedMedianMps': float(np.median(repair_speeds)) if len(repair_speeds) else None,
                'repairSweepBackwardSpeedP10P90Mps': np.quantile(repair_speeds, [.1,.9]).tolist() if len(repair_speeds) else None,
                'repairWindowConfidence': 'low; native swing can reach below support height' if clip.endswith('Walk') else confidence,
                'windowConvention': 'end above1 wraps through phase0',
                'candidateBackwardSpeedMedianMps': float(np.median(accepted_speed)) if len(accepted_speed) else None,
                'candidateBackwardSpeedP10P90Mps': np.quantile(accepted_speed, [.1,.9]).tolist() if len(accepted_speed) else None,
                'confidence': confidence,
                'samples': [{'phase': float(phase[i]), 'frame': float(frames[i]),
                    'minZMetres': float(height[i]), 'medianSoleCenter': center[i].tolist(),
                    'forwardMetres': float(forward[i]),
                    'backwardSpeedToNextMps': float(speed[i]) if i < len(speed) else None,
                    'candidateStanceToNext': bool(stance[i]) if i < len(stance) else None}
                    for i in range(len(frames))]}
        report['clips'][clip] = record
    (ROOT/'lynx-gait-contact-audit.json').write_text(json.dumps(report, indent=2)+'\n')
    lines = ['# Adapted Lynx native gait contact measurements', '',
        'CPU measurements use the full source-weighted adapted mesh targets. These are candidate repair windows, not accepted floor contacts. No GLB, source, animation or rig changed.', '',
        'Sampled native-action world positions are already near-origin metres. Z is up; negative Y is forward. Native actions replace the initial FBX scene-placement transform, as documented in bake_data.py. Each foot includes vertices with at least 0.5 summed weight in its exact hierarchy. Fixed lowest 20 percent rest vertices define the median sole center; the height measurement uses the actual minimum of all selected foot vertices.', '',
        '| Clip | Foot | Sole Z min / max, m | Forward range, m | Candidate phase windows | Backward speed, m/s | Confidence |',
        '| --- | --- | --- | --- | --- | --- | --- |']
    for clip, rec in report['clips'].items():
        for foot, item in rec['feet'].items():
            speed = item['candidateBackwardSpeedMedianMps']
            speed_text = f'{speed:.3f}' if speed is not None else 'none'
            lines.append(f"| {clip.split('|')[-1]} | {foot} | {item['minimumSoleZMetres']:.4f} / {item['maximumMinimumSoleZMetres']:.4f} | {item['medianSoleCenterForwardRangeMetres']:.4f} | {item['candidatePeriodicPhaseWindows']} | {speed_text} | {item['confidence']} |")
    lines += ['', 'Candidate intervals require both sampled endpoint sole heights within the larger of 12 mm or 20 percent of the observed vertical excursion above that foot minimum, plus backward center travel above 0.025 m/s. End phases greater than 1 wrap through zero. Half-frame samples give 1/48-second resolution. Windows are intentionally conservative; they are inputs for IK repair, not species timing metadata.', '',
        'Per-foot minima differ and backward speeds may disagree. A common ground plane and speed require a contact repair pass and renewed measurements. The median sole center tracks the visible paw surface rather than a possibly misleading bone pivot. This audit does not prove that the same sole vertices stay grounded or that a foot rolls without slipping.', '',
        'The JSON records exact source NPZ hash, every descendant group and vertex index, every phase height, center and interval speed. The adapted source already changed tail and ear rest bones; these measurements concern its current native Walk and Run targets only.']
    lines += ['', '## Repair windows', '',
        'Walk has a deeper right-front swing minimum than its backward support sweep, so a lowest-height threshold alone finds no valid stance for that paw. For Walk repair, use the substantial backward-sweep intervals below as low-confidence intended support windows, then solve common-floor planting. Run retains the conservative combined height/sweep windows. These suggestions need IK and renewed vertex measurement before acceptance.', '',
        '| Clip | Foot | Suggested periodic repair windows | Median backward speed m/s |', '| --- | --- | --- | --- |']
    for clip, rec in report['clips'].items():
        for foot, item in rec['feet'].items():
            lines.append(f"| {clip.split('|')[-1]} | {foot} | {item['suggestedRepairPhaseWindows']} | {item['repairSweepBackwardSpeedMedianMps']} |")
    (ROOT/'lynx-gait-contact-audit.md').write_text('\n'.join(lines)+'\n')
    print('\n'.join(lines[6:]))


if __name__ == '__main__':
    main()
