"""Extract only the two pinned CC0 insect FBXs from the existing source cache."""
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent
inventory = json.loads((root.parent / 'replacement-inventory/nature.json').read_text())
for record in inventory['sources']:
    if record['id'] not in ('spider', 'wasp'):
        continue
    archive = Path(record['archivePath'])
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == record['archiveSha256']
    with zipfile.ZipFile(archive) as source:
        data = source.read(record['archiveMember'])
    assert hashlib.sha256(data).hexdigest() == record['memberSha256']
    output = root / 'derived' / Path(record['archiveMember']).name
    output.parent.mkdir(exist_ok=True)
    output.write_bytes(data)
