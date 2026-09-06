import bpy,json,pathlib
from mathutils import Vector
root=pathlib.Path(r'C:/Users/Borg/Documents/GitHub/Corealm2/art/rebuild/candidates/finish-quadrupeds/source-moose-horse');source=root.parent/'source-hoofed';c=json.loads((source/'horse-static-catalogue.json').read_text())['normalization'];lo=c['originalMinimum'];hi=c['originalMaximum'];scale=c['uniformScale'];center=Vector(((hi[0]+lo[0])/2,(hi[1]+lo[1])/2,lo[2]))
def norm(p):
 p=(p-center)*scale
 return [p.x,p.z,-p.y]
bpy.ops.wm.open_mainfile(filepath=str(source/'riggedHorse.blend'),load_ui=False,use_scripts=False)
arm=bpy.data.objects['Armature'];body=bpy.data.objects['Plane'];arm.data.pose_position='REST';bpy.context.view_layer.update();bones=[{'name':b.name,'sourceHead':norm(arm.matrix_world@b.head_local),'sourceTail':norm(arm.matrix_world@b.tail_local)} for b in arm.data.bones];names={b['name'] for b in bones}
verts=[{'index':v.index,'sourcePosition':norm(body.matrix_world@v.co),'weights':[[body.vertex_groups[w.group].name,w.weight] for w in v.groups]} for v in body.data.vertices]
orphan={}
for v in verts:
 for name,w in v['weights']:
  if name not in names:orphan.setdefault(name,[]).append({'index':v['index'],'weight':w})
out={'source':'../source-hoofed/riggedHorse.blend','normalization':'Same uniform transform and +Y/+Z conversion as frozen static OBJ catalogue','bones':bones,'bodyVertices':verts,'orphanGroups':{k:{'vertices':len(v),'overHalf':sum(x['weight']>.5 for x in v),'maxWeight':max(x['weight'] for x in v)} for k,v in orphan.items()},'actions':len(bpy.data.actions),'status':'source mapping only, unresolved orphan groups; not a valid skin'}
(root/'native-rig-source-map.json').write_text(json.dumps(out));print(json.dumps({'bones':len(bones),'vertices':len(verts),'orphanGroups':out['orphanGroups']}))
