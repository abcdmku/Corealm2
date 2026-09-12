"""Extract user ZIP members without overwriting duplicate filenames."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

source = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(r'C:\Users\Borg\.t3\userdata\attachments\3c7e3bd2-1709-4576-9a6c-a3d8b5fcadcc-533940f0-1953-43cf-9992-4c328d0c29b4-zip.zip')
assert hashlib.sha256(source.read_bytes()).hexdigest() == '1c1fdc8a4e9534e4740f13033790c79fb23439a532041e7ff78c1dcca7ddb073'
target = Path('test-results/medieval-bridge/source')
target.mkdir(parents=True, exist_ok=True)
rows = []
with zipfile.ZipFile(source) as archive:
    for index, member in enumerate(archive.infolist()):
        if member.is_dir():
            continue
        data = archive.read(member)
        path = target / f'{index}-{Path(member.filename).name}'
        path.write_bytes(data)
        rows.append(dict(member=member.filename, index=index, path=path.as_posix(), sha256=hashlib.sha256(data).hexdigest(), bytes=len(data)))
Path('tools/medieval-bridge/source-members.json').write_text(json.dumps(rows, indent=2))
