import bpy,json,pathlib
root=pathlib.Path(r'C:/Users/Borg/Documents/GitHub/Corealm2/art/rebuild/candidates/finish-quadrupeds/source-tapir-horse')
bpy.ops.wm.open_mainfile(filepath=str(root.parent/'source-hoofed/riggedHorse.blend'))
report={'objects':[],'bones':[]}
for o in bpy.data.objects:
 if o.type=='MESH':
  points=[o.matrix_world@v.co for v in o.data.vertices]
  report['objects'].append({'name':o.name,'min':[min(v[i] for v in points) for i in range(3)],'max':[max(v[i] for v in points) for i in range(3)],'groups':[{ 'name':g.name,'count':sum(any(w.group==g.index and w.weight>.5 for w in v.groups) for v in o.data.vertices)} for g in o.vertex_groups]})
 if o.type=='ARMATURE':
  for b in o.data.bones:report['bones'].append({'name':b.name,'head':list(o.matrix_world@b.head_local),'tail':list(o.matrix_world@b.tail_local)})
(root/'source-landmarks.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
