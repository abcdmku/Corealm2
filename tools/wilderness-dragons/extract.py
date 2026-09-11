"""Extract the owner's licensed dragon sources without copying the archive into git."""
import hashlib
import gzip
import json
import os
from pathlib import Path
import tarfile

archive = Path(os.environ['APPDATA']) / 'Unity/Asset Store-5.x/Dungeon Mason/3D ModelsCharactersCreatures/Dragon for Boss Monster PBR.unitypackage'
expected = '01b15c6e6ac1339acc40e653924691583cbf44303397878ae7f79a59112b7383'
assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected, 'Licensed source archive changed'
out = Path('test-results/wilderness-dragons/source').resolve()
out.mkdir(parents=True, exist_ok=True)
index = []
selected = {}
with gzip.open(archive, 'rb') as stream, tarfile.open(fileobj=stream, mode='r|') as tf:
    for member in tf:
        name = member.name
        if not name.endswith('/pathname'):
            continue
        relative = tf.extractfile(member).read().decode().splitlines()[0].strip('\x00')
        if not any(x in relative for x in ['DragonTerrorBringer', 'DragonUsurper', 'DragonSoulEater']):
            continue
        selected[name[:-len('/pathname')] + '/asset'] = relative
with gzip.open(archive, 'rb') as stream, tarfile.open(fileobj=stream, mode='r|') as tf:
    for asset in tf:
        relative = selected.get(asset.name)
        if relative is None or not asset.isfile(): continue
        target = (out / relative).resolve()
        assert target.is_relative_to(out)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(tf.extractfile(asset).read())
        index.append(relative)
(out / 'index.json').write_text(json.dumps(index, indent=2))
print(f'Extracted {len(index)} source files from the verified Dungeon Mason archive.')
