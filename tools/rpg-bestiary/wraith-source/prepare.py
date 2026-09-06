"""Extract the entitled original Wizard sources and wrap their binary geometry in GLB."""
import json
import hashlib
from pathlib import Path, PurePosixPath
import struct
import zipfile

archive = Path('../Corealm/.asset-cache/Modular_Character_Outfits_-_Fantasy[Source].zip')
expected = 'c1bdaa7c79bb43e8f082f8484a841ac8ec8afa0295a9cfa7e9b101cd0cd32cab'
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    raise RuntimeError('Wizard source archive differs from the reviewed SHA256')
output = Path(__file__).parent / 'source'
output.mkdir(exist_ok=True)
with zipfile.ZipFile(archive) as package:
    for name in package.namelist():
        filename = PurePosixPath(name).name
        if ('/glTF (Godot-Unreal)/Modular Parts/' in name and filename.startswith(('Male_Wizard', 'Female_Wizard', 'T_Wizard', 'T_Regular'))) or ('License' in filename and not name.endswith('/')):
            (output / filename).write_bytes(package.read(name))
for file in output.glob('*.gltf'):
    document = json.loads(file.read_text())
    binary = (output / document['buffers'][0].pop('uri')).read_bytes()
    data = json.dumps(document, separators=(',', ':')).encode()
    data += b' ' * (-len(data) % 4)
    binary += bytes(-len(binary) % 4)
    file.with_suffix('.glb').write_bytes(struct.pack('<III', 0x46546c67, 2, 28 + len(data) + len(binary)) + struct.pack('<II', len(data), 0x4e4f534a) + data + struct.pack('<II', len(binary), 0x004e4942) + binary)
