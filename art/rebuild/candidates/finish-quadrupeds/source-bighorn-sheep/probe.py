import bpy,json,pathlib
from mathutils import Vector
root=pathlib.Path('C:/Users/Borg/Documents/GitHub/Corealm2/art/rebuild/candidates/finish-quadrupeds/source-bighorn-sheep')
bpy.ops.wm.open_mainfile(filepath=str(root.parent/'source-caprine-free/sheepies.blend'),load_ui=False,use_scripts=False)
b=bpy.data.objects['Sheep 2'];r=b.parent;m=r.matrix_world.inverted()@b.matrix_world
points=[m@v.co for v in b.data.vertices]
report={'bodyMatrix':list(map(list,b.matrix_world)), 'rigMatrix':list(map(list,r.matrix_world)), 'bounds':[[min(p[k]for p in points),max(p[k]for p in points)]for k in range(3)],'groups':{},'sourceFPS':bpy.context.scene.render.fps}
for g in b.vertex_groups:
 ids=[v.index for v in b.data.vertices if any(w.group==g.index and w.weight>.4 for w in v.groups)]
 if ids:report['groups'][g.name]={'count':len(ids),'bounds':[[min(points[i][k] for i in ids),max(points[i][k]for i in ids)]for k in range(3)]}
(root/'source-probe.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
