import bpy,json,sys,pathlib
root=pathlib.Path(r'C:/Users/Borg/Documents/GitHub/Corealm2/art/rebuild/candidates/finish-quadrupeds/source-hoofed')
bpy.ops.wm.open_mainfile(filepath=str(root/'riggedHorse.blend'),load_ui=False,use_scripts=False)
report={'blender':bpy.app.version_string,'objects':[],'images':[],'actions':[]}
for o in bpy.data.objects:
 r={'name':o.name,'type':o.type,'location':list(o.location),'rotation':list(o.rotation_euler),'scale':list(o.scale),'parent':o.parent.name if o.parent else None}
 if o.type=='MESH':r.update(vertices=len(o.data.vertices),polygons=len(o.data.polygons),materials=[m.name if m else None for m in o.data.materials],vertexGroups=[g.name for g in o.vertex_groups],modifiers=[{'name':m.name,'type':m.type,'object':getattr(getattr(m,'object',None),'name',None)} for m in o.modifiers],unweightedVertices=sum(not v.groups for v in o.data.vertices))
 if o.type=='ARMATURE':r['bones']=[{'name':b.name,'head':list(b.head_local),'tail':list(b.tail_local),'deform':b.use_deform} for b in o.data.bones]
 report['objects'].append(r)
for i in bpy.data.images:report['images'].append({'name':i.name,'path':i.filepath,'packed':bool(i.packed_file),'size':list(i.size)})
for a in bpy.data.actions:report['actions'].append({'name':a.name,'range':list(a.frame_range)})
(root/'horse-native-inventory.json').write_text(json.dumps(report,indent=2));print('INVENTORY',json.dumps(report))
