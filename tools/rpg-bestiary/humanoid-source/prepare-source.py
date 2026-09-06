"""Copy selected CC0 source files into the local humanoid build cache.

Run with --cache pointing at the existing Quaternius archive directory.
The source archives are read only; no download or source entitlement is inferred.
"""
import argparse
import hashlib
from pathlib import Path
import zipfile
import tarfile
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--cache', type=Path, required=True)
parser.add_argument('--animals', type=Path, default=Path.home() / 'AppData/Roaming/Unity/Asset Store-5.x/janpec/3D ModelsCharactersAnimals/Animal pack deluxe.unitypackage')
args = parser.parse_args()
out = Path(__file__).resolve().parent / 'derived'
out.mkdir(parents=True, exist_ok=True)
archive = args.cache / 'Medieval_Weapons_Pack_by_Quaternius.zip'
expected = '546d6e168d71cc3ea0c5d388a7834658619ac2ace8be960050e5fb1dbd344a2a'
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    raise RuntimeError('Medieval weapons source archive hash differs from verified project cache')
with zipfile.ZipFile(archive) as source:
    for name in ['Bow_Wooden.obj', 'Bow_Wooden.mtl', 'Arrow.obj', 'Arrow.mtl', 'Spear.obj', 'Spear.mtl', 'Hammer_Double.obj', 'Hammer_Double.mtl']:
        (out / name).write_bytes(source.read('OBJ/' + name))
if hashlib.sha256(args.animals.read_bytes()).hexdigest() != '0809f4ff5aebfdf93bc7915ed9295deb79b5c11f26075edb130b4d298bc4acc1':
    raise RuntimeError('Animal Pack Deluxe archive hash differs from verified project entitlement cache')
with tarfile.open(args.animals, 'r:gz') as source:
    names = {}
    for member in source:
        if member.name.endswith('/pathname'):
            name = source.extractfile(member).read().decode().splitlines()[0].strip('\x00').split('/')[-1]
            names[name] = member.name.split('/')[0] + '/asset'
    for name in ['Wolf_Rig.fbx', 'common_wolf_col2_unity.tga', 'common_wolf_nrml4.tga']:
        destination = out / name
        destination.write_bytes(source.extractfile(names[name]).read())
        if name.endswith('.tga'):
            Image.open(destination).save(out / (name + '.png'))
print('Prepared source weapon and wolf cache. Body, outfits, reptile head and animations use shipped GLBs.')
