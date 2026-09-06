"""CPU-only extraction of recorded turns. No browser or candidate changes."""
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'test-results/legacy-turn-video'
OUT.mkdir(parents=True, exist_ok=True)
CATALOG = ROOT / 'art/rebuild/candidates/finish-motion/legacy-catalog.json'

def run(*args):
    return subprocess.check_output(args, stderr=subprocess.DEVNULL)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

for animal, times in [('coyote', [31.63, 31.76, 31.90, 32.05, 32.25, 32.50]), ('ibex', [34.0, 34.2, 34.4, 34.6, 34.8, 35.0])]:
    folder = ROOT / f'test-results/legacy-visual-{animal}'
    video = next((folder / 'video').glob('*.webm'))
    report_path = folder / 'report.json'
    report = json.loads(report_path.read_text())
    actor = report['assets'][0]
    catalog = json.loads(CATALOG.read_text())
    entry = next(entry for entry in catalog['assets'] if entry['id'] == actor['id'])
    candidate = CATALOG.parent / catalog['files'][actor['id']]
    if sha(candidate) != entry['sha256'].lower() or candidate.stat().st_size != entry['bytes']:
        raise RuntimeError('Current frozen candidate differs from its catalog')
    metadata = json.loads(run('ffprobe', '-v', 'error', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', str(video)))
    pts = np.array([float(frame['best_effort_timestamp_time']) for frame in metadata['frames']])
    raw = run('ffmpeg', '-v', 'error', '-i', str(video), '-vf', 'scale=320:200', '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-')
    pixels = np.frombuffer(raw, np.uint8).reshape((-1, 200, 320, 3))
    if len(pixels) != len(pts):
        raise RuntimeError('Decoded frame count differs from ffprobe timestamp count')
    anchors = []
    for capture in actor['captures']:
        image_path = folder / capture['file']
        before, after = capture['before']['elapsedMs'] / 1000, capture['after']['elapsedMs'] / 1000
        middle = (before + after) / 2
        target = np.frombuffer(run('ffmpeg', '-v', 'error', '-i', str(image_path), '-vf', 'scale=320:200', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'), np.uint8).reshape((200, 320, 3))
        search = np.flatnonzero((pts >= middle - 1.5) & (pts <= middle + 1.5))
        differences = np.abs(pixels[search].astype(np.int16) - target.astype(np.int16)).mean(axis=(1, 2, 3))
        index = int(search[int(np.argmin(differences))])
        anchors.append({'screenshot': str(image_path.relative_to(ROOT)), 'beforePageSeconds': before, 'afterPageSeconds': after,
                        'closestVideoFrame': index, 'closestVideoPTS': float(pts[index]), 'meanAbsoluteRGBDifference255': float(differences.min()),
                        'estimatedVideoMinusPageSeconds': float(pts[index] - middle),
                        'offsetIntervalFromCaptureBounds': [float(pts[index] - after - .04), float(pts[index] - before + .04)]})
    offset = float(np.median([anchor['estimatedVideoMinusPageSeconds'] for anchor in anchors]))
    # This is an empirical alignment, not a recorded common clock or a formal synchronization bound.
    uncertainty = max(abs(bound - offset) for anchor in anchors for bound in anchor['offsetIntervalFromCaptureBounds'])
    indices = [int(np.argmin(abs(pts - (time + offset)))) for time in times]
    target_folder = OUT / animal
    target_folder.mkdir(exist_ok=True)
    expression = '+'.join(f'eq(n,{index})' for index in sorted(set(indices)))
    run('ffmpeg', '-v', 'error', '-i', str(video), '-vf', f'select={expression.replace(",", chr(92) + ",")}', '-fps_mode', 'passthrough', '-y', str(target_folder / 'frame-%02d.png'))
    frame_files = {index: target_folder / f'frame-{i + 1:02d}.png' for i, index in enumerate(sorted(set(indices)))}
    trace = sorted(actor['samples'] + [capture[key] for capture in actor['captures'] for key in ('before', 'after')], key=lambda row: row['elapsedMs'])
    compact = lambda row: {'pageSeconds': row['elapsedMs'] / 1000, 'stage': row['stage'], 'position': row['entity']['position'], 'state': row['entity']['state'],
                           'health': row['entity']['combat']['health'], 'clip': row['motion']['clip'], 'time': row['motion']['time'],
                           'semanticYaw': row['motion']['semanticRotationY'], 'drawnYaw': row['motion']['drawnRotationY'], 'drawnPosition': row['motion']['drawnPosition']}
    frames = []
    sheet = Image.new('RGB', (1920, 872), '#17201f')
    font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 17)
    for k, index in enumerate(indices):
        page_time = float(pts[index] - offset)
        before = [row for row in trace if row['elapsedMs'] / 1000 <= page_time][-1]
        after = next(row for row in trace if row['elapsedMs'] / 1000 >= page_time)
        before_window = [row for row in trace if row['elapsedMs'] / 1000 <= page_time - uncertainty][-1]
        after_window = next(row for row in trace if row['elapsedMs'] / 1000 >= page_time + uncertainty)
        frame = {'image': str(frame_files[index].relative_to(ROOT)), 'videoFrameIndex': index, 'videoPTSSeconds': float(pts[index]),
                 'estimatedPageSeconds': page_time, 'empiricalTimingUncertaintySeconds': uncertainty, 'traceBefore': compact(before), 'traceAfter': compact(after),
                 'traceBeforeUncertaintyWindow': compact(before_window), 'traceAfterUncertaintyWindow': compact(after_window)}
        frames.append(frame)
        thumb = Image.open(frame_files[index]).resize((640, 400))
        x, y = (k % 3) * 640, (k // 3) * 436
        sheet.paste(thumb, (x, y))
        ImageDraw.Draw(sheet).text((x + 8, y + 404), f'{animal}  video {pts[index]:.2f}s  page ~{page_time:.2f}s  {before["motion"]["clip"]} -> {after["motion"]["clip"]}', font=font, fill='white')
    sheet.save(target_folder / 'contact-sheet.png')
    result = {'animal': animal, 'sourceVideo': str(video.relative_to(ROOT)), 'sourceVideoSha256': sha(video), 'sourceReportSha256': sha(report_path),
              'candidateProvenance': {'historicalServedCandidateSha256': None, 'historicalServedCatalogSha256': None,
                                      'extractionTimeCatalog': str(CATALOG.relative_to(ROOT)), 'extractionTimeCatalogSha256': sha(CATALOG),
                                      'extractionTimeVerifiedCandidateSha256': {actor['id']: sha(candidate)},
                                      'operatorAttestation': 'Motion lead states the original browser runs used these same frozen candidates. The original reports recorded served URLs but not served GLB hashes.',
                                      'scope': 'Current frozen bytes are independently verified here; this is not a machine-recorded historical browser-request digest.'},
              'gpuStarted': False, 'videoFrameCount': len(pts), 'anchors': anchors, 'estimatedVideoMinusPageSeconds': offset,
              'empiricalTimingUncertaintySeconds': uncertainty, 'frames': frames,
              'limits': ['Video and browser performance.now have no recorded shared origin. Matching existing screenshot pixels estimates their offset; timing uncertainty is empirical.',
                         'Semantic snapshots bracket estimated frame times; no exact per-frame pose telemetry was recorded.',
                         'Coyote includes Run-to-Attack turning. Ibex turns mostly in Idle/Attack with little translation; these are not uninterrupted moving-gait turn proofs.',
                         'Extraction preserves recorded frame pixels. Contact-sheet thumbnails are resized only; no generated or altered anatomy.']}
    (target_folder / 'report.json').write_text(json.dumps(result, indent=2))
    print(json.dumps({'animal': animal, 'offset': offset, 'uncertainty': uncertainty, 'anchorScores': [a['meanAbsoluteRGBDifference255'] for a in anchors], 'sheet': str(target_folder / 'contact-sheet.png')}))
