"""Stage owned Unity sources with their original relative paths and package hashes."""
import hashlib
import json
import tarfile
import gzip
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path.home() / 'AppData/Roaming/Unity/Asset Store-5.x'
OUT = ROOT / '.asset-cache/fairy-terraces/unity'
records = []
for package in sorted(CACHE.rglob('*.unitypackage')):
    if not any(name in package.name for name in ['Monster 0', 'Monster 3D', '30 Monster', 'Medieval Village', 'Pure Nature 2']):
        continue
    package_hash = hashlib.sha256(package.read_bytes()).hexdigest()
    destination = OUT / package_hash[:12]
    destination.mkdir(parents=True, exist_ok=True)
    files = []
    # Random access in gzip would decompress the 1.6 GB nature archive for every asset.
    # Unpack its container once, then read its members from a seekable tar.
    unpacked = destination / 'source.tar'
    with gzip.open(package, 'rb') as compressed, unpacked.open('wb') as plain:
        shutil.copyfileobj(compressed, plain)
    with tarfile.open(unpacked, 'r:') as archive:
        members = {member.name: member for member in archive}
        for name, member in members.items():
            if not name.endswith('/pathname'):
                continue
            asset_path = archive.extractfile(member).read().decode().splitlines()[0].strip('\x00')
            if Path(asset_path).suffix.lower() not in {'.fbx', '.obj', '.png', '.tga', '.jpg', '.mat', '.prefab'}:
                continue
            target = (destination / asset_path).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise ValueError('Unsafe source path')
            source = name.rsplit('/', 1)[0] + '/asset'
            if source not in members:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                target.write_bytes(archive.extractfile(members[source]).read())
            metadata = source + '.meta'
            if metadata in members and not Path(str(target) + '.meta').exists():
                Path(str(target) + '.meta').write_bytes(archive.extractfile(members[metadata]).read())
            files.append(asset_path)
    records.append({'package': package.name, 'archive': str(package), 'sha256': package_hash,
                    'directory': destination.relative_to(ROOT).as_posix(), 'files': files})
    unpacked.unlink()
    print(package.name, len(files), flush=True)
(OUT / 'sources.json').write_text(json.dumps(records, indent=2) + '\n')
