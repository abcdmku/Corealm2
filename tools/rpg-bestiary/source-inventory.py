"""Inspect entitled package pathnames without extracting or redistributing sources."""
import hashlib
import json
from pathlib import Path
import tarfile

cache = Path.home() / 'AppData/Roaming/Unity/Asset Store-5.x'
out = Path('art/rebuild/candidates/finish-bestiary')
out.mkdir(parents=True, exist_ok=True)
records = []
for package in sorted(cache.rglob('*.unitypackage')):
    if 'Creatures' not in str(package):
        continue
    assets = []
    with tarfile.open(package, 'r:gz') as archive:
        for member in archive:
            if member.name.endswith('/pathname'):
                resource = archive.extractfile(member)
                if resource:
                    name = resource.read().decode('utf-8').splitlines()[0].strip('\x00')
                    if name.lower().endswith(('.fbx', '.obj', '.anim', '.mat', '.png', '.tga')):
                        assets.append(name)
    records.append({'package': package.name, 'publisher': package.parent.parent.name,
                    'sha256': hashlib.sha256(package.read_bytes()).hexdigest(),
                    'license': 'Standard Unity Asset Store EULA; local entitlement cache', 'assets': assets})
(out / 'source-inventory.json').write_text(json.dumps(records, indent=2) + '\n')
print(json.dumps([{'package': r['package'], 'models': [p for p in r['assets'] if p.lower().endswith('.fbx')]} for r in records], indent=2))
