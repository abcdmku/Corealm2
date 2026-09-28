"""Stage the Unity animation YAML omitted by the general fairy source extractor."""
import gzip
import hashlib
import io
import json
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'test-results/fairy-terraces-assets/monsters'
OUT.mkdir(parents=True, exist_ok=True)
sources = json.loads((ROOT / '.asset-cache/fairy-terraces/unity/sources.json').read_text(encoding='utf-8'))
manifest = json.loads((ROOT / 'game/public/assets/manifest.json').read_text(encoding='utf-8'))
records = []
packages = []
for source in sources:
    if 'Monster' in source['package']:
        metadata = next((pack for pack in manifest['packs'] if pack.get('archiveSha256') == source['sha256']), None)
        if not metadata:
            raise ValueError(f"Missing verified package metadata: {source['package']}")
        packages.append({'archiveSha256': source['sha256'], 'assetStoreId': metadata.get('assetStoreId'),
                         'title': metadata['name'], 'source': metadata['source'], 'archive': source['archive']})
    if not any(name in source['package'] for name in ['Monster 07 ', 'Monster 08 ', 'Monster 09 ']):
        continue
    if hashlib.sha256(Path(source['archive']).read_bytes()).hexdigest() != source['sha256']:
        raise ValueError(f"Changed source archive: {source['package']}")
    source_directory = (ROOT / source['directory']).resolve()
    if not source_directory.is_relative_to((ROOT / '.asset-cache/fairy-terraces/unity').resolve()):
        raise ValueError('Source directory escapes the package cache')
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
            target = (source_directory / relative).resolve()
            if not target.is_relative_to(source_directory):
                raise ValueError('Unsafe source animation path')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.extractfile(members[name.rsplit('/', 1)[0] + '/asset']).read())
            records.append({'sourcePackageSha256': source['sha256'], 'path': relative,
                            'file': (Path(source['directory']) / relative).as_posix(), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
(OUT / 'animation-sources.json').write_text(json.dumps(records, indent=2) + '\n', encoding='utf-8')
(OUT / 'package-metadata.json').write_text(json.dumps(packages, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'animations': len(records), 'out': str(OUT)}))
