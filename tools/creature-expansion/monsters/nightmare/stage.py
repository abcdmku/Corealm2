"""Extract the licensed Nightmare source while retaining Unity asset paths."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile

ROOT = Path(__file__).resolve().parents[4]
PACKAGE = Path.home() / 'AppData/Roaming/Unity/Asset Store-5.x/Dungeon Mason/3D ModelsCharactersCreatures/Dragon for Boss Monster PBR.unitypackage'
DEST = ROOT / 'test-results/creature-expansion/sources/monsters/nightmare'


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    entries = []
    with tarfile.open(PACKAGE, 'r:gz') as archive:
        members = {member.name: member for member in archive}
        for member in members.values():
            if not member.name.endswith('/pathname'):
                continue
            asset_path = archive.extractfile(member).read().decode('utf-8-sig').splitlines()[0].rstrip('\0')
            if 'nightmare' not in asset_path.lower():
                continue
            relative = PurePosixPath(asset_path)
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError(f'Unsafe Unity path: {asset_path}')
            target = DEST / 'raw' / Path(*relative.parts)
            guid = member.name.rsplit('/', 1)[0]
            source = members.get(guid + '/asset')
            if source is None:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            data = archive.extractfile(source).read()
            target.write_bytes(data)
            meta = members.get(guid + '/asset.meta')
            if meta:
                target.with_name(target.name + '.meta').write_bytes(archive.extractfile(meta).read())
            entries.append({'path': asset_path, 'guid': guid, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    report = {'package': str(PACKAGE), 'packageSha256': hashlib.sha256(PACKAGE.read_bytes()).hexdigest(), 'assets': entries}
    (DEST / 'source-index.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'extracted': len(entries), 'directory': str(DEST)}))


if __name__ == '__main__':
    main()
