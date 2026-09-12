"""Stage the original BK shader and detail normal omitted by the general extractor."""
import hashlib
import gzip
import json
import struct
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'test-results/fairy-terraces-assets/rocks'
OUT.mkdir(parents=True, exist_ok=True)
source = next(p for p in json.loads((ROOT / '.asset-cache/fairy-terraces/unity/sources.json').read_text())
              if 'Pure Nature 2' in p['package'])
with open(source['archive'], 'rb') as archive_file:
    actual_hash = hashlib.file_digest(archive_file, 'sha256').hexdigest()
if actual_hash != source['sha256']:
    raise ValueError('Local source archive changed since extraction')
with open(source['archive'], 'rb') as archive_file:
    header = archive_file.read(8192)
extra_size = struct.unpack_from('<H', header, 10)[0]
metadata = json.loads(header[16:12 + extra_size])
required = {'7b61ba13111c27c49bf11f4ff140e83f', 'f3854bd7648c4b2e825b724bd7450464'}
found = {}
with gzip.open(source['archive'], 'rb') as compressed, tarfile.open(fileobj=compressed, mode='r|') as archive:
    for member in archive:
        guid, _, part = member.name.partition('/')
        if guid not in required or part not in {'asset', 'asset.meta', 'pathname'}:
            continue
        data = archive.extractfile(member).read()
        record = found.setdefault(guid, {})
        record[part] = data
        if all(set(found.get(g, {})) >= {'asset', 'pathname'} for g in required):
            break
records = []
for guid, values in found.items():
    relative = values['pathname'].decode().splitlines()[0].strip('\x00')
    destination = (OUT / 'sources' / relative).resolve()
    if not destination.is_relative_to(OUT.resolve()):
        raise ValueError('Unsafe source path')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(values['asset'])
    if 'asset.meta' in values:
        Path(str(destination) + '.meta').write_bytes(values['asset.meta'])
    records.append({'guid': guid, 'path': destination.relative_to(ROOT).as_posix(),
                    'originalPath': relative, 'sha256': hashlib.sha256(values['asset']).hexdigest()})
if '7b61ba13111c27c49bf11f4ff140e83f' not in found:
    raise ValueError('Missing original Unity shader')
result = {'package': source['package'], 'archive': source['archive'], 'archiveSha256': source['sha256'],
          'archiveHashVerified': True,
          'packageMetadata': metadata, 'sourceDirectory': source['directory'], 'additionalSources': records,
          'unresolvedPackageGuids': sorted(required - set(found))}
(OUT / 'source-audit.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
