"""Stage the Unity animation YAML omitted by the general fairy source extractor."""
import gzip
import io
import json
import re
import struct
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'test-results/fairy-terraces-assets/monsters'
OUT.mkdir(parents=True, exist_ok=True)
sources = json.loads((ROOT / '.asset-cache/fairy-terraces/unity/sources.json').read_text())
records = []
packages = []
for source in sources:
    if 'Monster' in source['package']:
        with open(source['archive'], 'rb') as archive_file:
            header = archive_file.read(8192)
        extra_size = struct.unpack_from('<H', header, 10)[0]
        metadata = json.loads(header[16:12 + extra_size])
        slug = re.sub(r'[^a-z0-9]+', '-', metadata['title'].lower()).strip('-')
        url = f"https://assetstore.unity.com/packages/3d/characters/creatures/{slug}-{metadata['id']}"
        with urllib.request.urlopen(url, timeout=30) as response:
            canonical = response.url
        packages.append({'archiveSha256': source['sha256'], 'assetStoreId': metadata['id'],
                         'title': metadata['title'], 'source': canonical, 'archive': source['archive']})
    if not any(name in source['package'] for name in ['Monster 07 ', 'Monster 08 ', 'Monster 09 ']):
        continue
    with gzip.open(source['archive'], 'rb') as compressed:
        data = compressed.read()
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:') as archive:
        members = {m.name: m for m in archive}
        for name, member in members.items():
            if not name.endswith('/pathname'):
                continue
            relative = archive.extractfile(member).read().decode().splitlines()[0].strip('\x00')
            if not relative.endswith('.anim'):
                continue
            target = (OUT / 'sources' / relative).resolve()
            if not target.is_relative_to(OUT.resolve()):
                raise ValueError('Unsafe source animation path')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.extractfile(members[name.rsplit('/', 1)[0] + '/asset']).read())
            records.append({'sourcePackageSha256': source['sha256'], 'path': relative})
(OUT / 'animation-sources.json').write_text(json.dumps(records, indent=2) + '\n')
(OUT / 'package-metadata.json').write_text(json.dumps(packages, indent=2) + '\n')
print(json.dumps({'animations': len(records), 'out': str(OUT)}))
