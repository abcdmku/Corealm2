"""Extract the owner's licensed Dragon Boar sources for dragon-boar.mjs without copying the archive into git."""
import json
import os
from pathlib import Path
import tarfile

archive = Path(os.environ['APPDATA']) / 'Unity/Asset Store-5.x/Dungeon Mason/3D ModelsCharactersCreatures/Dragon the Soul Eater and Dragon Boar.unitypackage'
out = Path('test-results/wilderness-dragons/dragon-boar')
out.mkdir(parents=True, exist_ok=True)
index = []
with tarfile.open(archive, 'r:gz') as tf:
    members = {m.name: m for m in tf.getmembers()}
    for name, member in members.items():
        if not name.endswith('/pathname'):
            continue
        stem = name[:-len('/pathname')]
        pathname = tf.extractfile(member).read().decode('utf-8').splitlines()[0].strip('\x00')
        asset = members.get(stem + '/asset')
        if not asset or not asset.isfile() or 'DragonBoar' not in pathname:
            continue
        dest = out / pathname
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(tf.extractfile(asset).read())
        index.append(pathname)
(out / 'index.json').write_text(json.dumps(index, indent=2))
print('\n'.join(index))
