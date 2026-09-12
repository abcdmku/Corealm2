"""Stage original Osmanthus image pixels for the GLB converter."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'test-results/fairy-terraces-assets/broadleaf'
source = next(p for p in json.loads((ROOT / '.asset-cache/fairy-terraces/unity/sources.json').read_text())
              if 'Pure Nature 2' in p['package'])
base = ROOT / source['directory'] / 'Assets/BK/PureNature_AsianMountains/Models/Trees/Osmanthus'
(OUT / 'source-textures').mkdir(parents=True, exist_ok=True)
records = []
for role, filename in [('leaf_albedo', 'OsmanthusLeaves_a.tga'), ('leaf_normal', 'OsmanthusLeaves_n.tga'),
                       ('bark_albedo', 'OsmanthusTrunk_a.png'), ('bark_normal', 'OsmanthusTrunk_n.png'),
                       ('bark_mask', 'OsmanthusTrunk_mask.png')]:
    path = base / filename
    image = Image.open(path).convert('RGBA')
    target = OUT / 'source-textures' / f'{role}.png'
    image.save(target)
    records.append({'role': role, 'source': path.relative_to(ROOT).as_posix(),
                    'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                    'staged': target.relative_to(ROOT).as_posix(), 'size': list(image.size),
                    'losslessPixelConversion': True})
audit = {'sourceDirectory': source['directory'], 'archive': source['archive'],
         'archiveSha256': source['sha256'], 'package': source['package'], 'textures': records}
(OUT / 'source-audit.json').write_text(json.dumps(audit, indent=2) + '\n')
print(json.dumps(audit, indent=2))
