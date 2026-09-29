"""Extract the owner's licensed studio creature packages without copying them into git.

    py -3 tools/creature-bodies/extract.py [rhino|ghoul|monster10 ...]

Each package is verified by SHA-256 and unpacked to test-results/creature-bodies/source/<key>/
(git-ignored), keeping the Unity asset paths. Nothing here converts or edits a source file.
"""
import gzip
import hashlib
import os
import sys
import tarfile
from pathlib import Path

STORE = Path(os.environ['APPDATA']) / 'Unity/Asset Store-5.x'
PACKAGES = {
    'rhino': ('Maksim Bugrimov/3D ModelsCharactersCreatures/Fantasy Rhino.unitypackage',
              'c3fca8ff44e3102c0bb880e6db70ee1cdc5850b1cd4a6465c5d761f8276f10e8', 'Assets/Rhino/'),
    'ghoul': ('Simple Game Assets/3D ModelsCharactersHumanoidsFantasy/Necromancer Army - Ghoul.unitypackage',
              '6cd261bf7f43c60776a3d0814f0c427e35c6f21602c2560b5d9b211d1b680fd7', 'Assets/SimpleAssets/Necromancers/Ghoul/'),
    'monster10': ('PixeliusVita/3D ModelsCharactersCreatures/Free Fantasy Monster 10 Rig Animation PixeliusVita.unitypackage',
                  '7bf8bea77679d5c6eaa60c7c32dd652a881d6875071c42c26d0fd9ea5815a634', 'Assets/Stylized3DMonster/Monster10/'),
}


def extract(key):
    relative, expected, prefix = PACKAGES[key]
    archive = STORE / relative
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected, f'{key}: licensed source archive changed'
    out = Path('test-results/creature-bodies/source', key).resolve()
    selected = {}
    with gzip.open(archive, 'rb') as stream, tarfile.open(fileobj=stream, mode='r|') as tf:
        for member in tf:
            if member.name.endswith('/pathname'):
                path = tf.extractfile(member).read().decode().splitlines()[0].strip('\x00')
                if path.startswith(prefix) and not path.endswith('.unitypackage'):
                    selected[member.name[:-len('/pathname')] + '/asset'] = path
    count = 0
    with gzip.open(archive, 'rb') as stream, tarfile.open(fileobj=stream, mode='r|') as tf:
        for asset in tf:
            path = selected.get(asset.name)
            if path is None or not asset.isfile():
                continue
            target = (out / path).resolve()
            assert target.is_relative_to(out)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(tf.extractfile(asset).read())
            count += 1
    print(f'{key}: extracted {count} files to {out}')


for key in sys.argv[1:] or PACKAGES:
    extract(key)
