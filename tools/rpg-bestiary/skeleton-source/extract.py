"""Extract the locally entitled demo; never vendors the Unity package into git."""
from pathlib import Path
import hashlib
import tarfile
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
PACKAGE = Path.home() / 'AppData/Roaming/Unity/Asset Store-5.x/Polygon Blacksmith/3D ModelsCharactersCreatures/Dungeon Skeletons Demo.unitypackage'
EXPECTED = '9e9e40c66eda22d756dd256bf670fcf5edc28bf0b4bba5026daa204791fdf23c'
OUT = (ROOT / 'test-results/rpg-bestiary-skeleton').resolve()
if hashlib.sha256(PACKAGE.read_bytes()).hexdigest() != EXPECTED:
    raise RuntimeError('Entitled Dungeon Skeletons Demo package hash differs from reviewed inventory')
OUT.mkdir(parents=True, exist_ok=True)
with tarfile.open(PACKAGE) as archive:
    members = {member.name: member for member in archive.getmembers()}
    for name, member in members.items():
        if not name.endswith('/pathname'):
            continue
        relative = archive.extractfile(member).read().decode().splitlines()[0].split('\0')[0]
        asset = members.get(name.rsplit('/', 1)[0] + '/asset')
        if asset is None or not asset.isfile():
            continue
        target = (OUT / relative).resolve()
        if not target.is_relative_to(OUT):
            raise RuntimeError(f'Unsafe source path: {relative}')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(archive.extractfile(asset).read())
materials = OUT / 'Assets/DungeonCharacters/Skeletons_demo/models/Materials'
Image.open(materials / 'DemoEquipment.tga').convert('RGBA').save(materials / 'DemoEquipment.png')
print(OUT)
