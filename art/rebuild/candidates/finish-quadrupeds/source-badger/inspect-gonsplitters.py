"""Inspect declared CC-BY-SA redistribution without executing Unity code.

Prerequisite: python -m pip install --target <this folder>/python-lib UnityPy
OBJ extraction retains source coordinates except UnityPy's documented X mirror
and winding conversion. No reshaping, rigging, decimation or materials invented.
"""
from pathlib import Path
import sys, json, hashlib, math
from collections import Counter

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'python-lib'))
import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler

env = UnityPy.load(str(ROOT / 'gonsplitters-gpbadger01'))
report = {'source':'gonsplitters-gpbadger01', 'types':dict(Counter(o.type.name for o in env.objects)), 'meshes':[], 'textures':[], 'transforms':[]}
for obj in env.objects:
    kind = obj.type.name
    if kind == 'Texture2D':
        data = obj.read()
        name = data.m_Name
        assert name.replace('_','').isalnum(), name
        data.image.save(ROOT / ('gonsplitters-' + name + '.png'))
        report['textures'].append({'name':name,'width':data.m_Width,'height':data.m_Height})
    elif kind == 'Mesh':
        data = obj.read()
        tree = obj.read_typetree()
        handler = MeshHandler(data)
        handler.process()
        assert all(math.isfinite(float(v)) for xyz in handler.m_Vertices for v in xyz), 'Nonfinite source vertices'
        (ROOT / 'gonsplitters-badger-source.obj').write_text(data.export(),encoding='utf8')
        report['meshes'].append({'name':data.m_Name,'vertices':len(handler.m_Vertices),'triangles':sum(x['indexCount']//3 for x in tree['m_SubMeshes']),'bindPoseCount':len(tree['m_BindPose']),'bounds':tree['m_LocalAABB'],'uvCount':len(handler.m_UV0),'finite':True})
    elif kind == 'Transform':
        report['transforms'].append(obj.read_typetree())
    elif kind == 'TextAsset':
        report['assetInfo'] = obj.read_typetree()
report['sourceLicense'] = 'CC-BY-SA 4.0 declared in included LICENSE and README; uploader credits original sculpt to mz4250. Original-creator license not independently retrieved.'
report['originalCreatorRoute'] = 'https://thangs.com/designer/mz4250/3d-model/Badger-18694'
report['originalCreatorAccess'] = '403 browser challenge on read-only page request; no bypass attempted.'
report['previewEvidence'] = 'Official package full-body collection preview inspected; badger small. Original bundle128px portrait inspected, feet cropped. Full-size all-angle geometry review pending root hardware session.'
report['adaptation'] = 'Static whole badger source. Requires posed-mesh rest correction, UV/material review, rig, weight painting and clips. Not accepted or integrated.'
report['hashes'] = {}
for name in ['Gonsplitters_Beasts_Collection-1.0.3.zip','gonsplitters-gpbadger01','gonsplitters-LICENSE','gonsplitters-README.md','gonsplitters-badger-source.obj','gonsplitters-official-preview.jpg']:
    content = (ROOT/name).read_bytes()
    report['hashes'][name] = {'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()}
(ROOT/'gonsplitters-inspection.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps({'meshes':report['meshes'],'types':report['types'],'hashes':report['hashes']}))
