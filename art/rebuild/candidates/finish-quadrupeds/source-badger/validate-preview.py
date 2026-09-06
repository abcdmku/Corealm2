"""Read-only CPU GLB checks; no game code execution or rendering."""
import pathlib,json,struct,math,hashlib
root=pathlib.Path(__file__).resolve().parent
raw=(root/'gonsplitters-badger-source-preview.glb').read_bytes()
magic,version,total=struct.unpack_from('<III',raw)
assert magic==0x46546c67 and version==2 and total==len(raw)
size=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+size]);binary=raw[28+size:]
primitive=doc['meshes'][0]['primitives'][0];accessor=doc['accessors'][primitive['attributes']['POSITION']]
view=doc['bufferViews'][accessor['bufferView']];start=view.get('byteOffset',0)+accessor.get('byteOffset',0);stride=view.get('byteStride',12)
q=doc['nodes'][0].get('rotation',[0,0,0,1]);qx,qy,qz,qw=q
points=[]
for i in range(accessor['count']):
    x,y,z=struct.unpack_from('<fff',binary,start+i*stride)
    tx,ty,tz=2*(qy*z-qz*y),2*(qz*x-qx*z),2*(qx*y-qy*x)
    points.append((x+qw*tx+qy*tz-qz*ty,y+qw*ty+qz*tx-qx*tz,z+qw*tz+qx*ty-qy*tx))
assert all(math.isfinite(v) for p in points for v in p)
minimum=[min(p[a] for p in points) for a in range(3)];maximum=[max(p[a] for p in points) for a in range(3)]
material=doc['materials'][0];assert material['doubleSided']==False
assert material['pbrMetallicRoughness']['baseColorFactor']==[.906331718,.906331718,.906331718,1]
assert not doc.get('animations') and not doc.get('skins')
report={'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'worldBounds':{'min':minimum,'max':maximum,'size':[maximum[a]-minimum[a] for a in range(3)]},'positionCountAfterUVNormalSplit':accessor['count'],'triangles':doc['accessors'][primitive['indices']]['count']//3,'material':material,'animations':len(doc.get('animations',[])),'skins':len(doc.get('skins',[])),'validated':'GLB chunk sizes, finite vertices, node rotation in world bounds, source tint and backface culling, absence of invented rigs/clips. Does not prove visual quality.'}
(root/'gonsplitters-preview-validation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
