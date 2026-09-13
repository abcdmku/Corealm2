"""Extract the owned small-worm source, retaining Unity paths and importer metadata."""
from pathlib import Path
import tarfile

root = Path(__file__).resolve().parents[2]
cache = Path.home() / 'AppData/Roaming/Unity/Asset Store-5.x'
package = next(cache.rglob('Worms FREE.unitypackage'))
out = (root / '.asset-cache/red-worms').resolve()
out.mkdir(parents=True, exist_ok=True)
with tarfile.open(package) as archive:
    members = {m.name: m for m in archive}
    for name, member in members.items():
        if not name.endswith('/pathname'):
            continue
        relative = archive.extractfile(member).read().decode().splitlines()[0].strip('\0')
        source = name.rsplit('/', 1)[0] + '/asset'
        target = (out / relative).resolve()
        if source not in members:
            continue
        if not target.is_relative_to(out):
            raise ValueError('Unsafe asset path')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(archive.extractfile(members[source]).read())
        if source + '.meta' in members:
            Path(str(target) + '.meta').write_bytes(archive.extractfile(members[source + '.meta']).read())
print(out)
