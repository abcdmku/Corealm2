import bpy, json, pathlib
from mathutils import Vector

out=pathlib.Path(__file__).resolve().parent
source=out/'cdmir-rat-original.blend'
bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
objects=[]
for obj in bpy.data.objects:
    record={'name':obj.name,'type':obj.type,'parent':obj.parent.name if obj.parent else None,'location':list(obj.location),'scale':list(obj.scale),'dimensions':list(obj.dimensions),'hideRender':obj.hide_render,'hideViewport':obj.hide_viewport,'modifiers':[{'name':m.name,'type':m.type,'showRender':m.show_render,'showViewport':m.show_viewport} for m in obj.modifiers]}
    if obj.type=='MESH':
        mesh=obj.data;mesh.calc_loop_triangles()
        record.update(vertices=len(mesh.vertices),triangles=len(mesh.loop_triangles),materials=[m.name if m else None for m in mesh.materials],vertexGroups=[g.name for g in obj.vertex_groups],uvLayers=[u.name for u in mesh.uv_layers],worldBounds=[[min((obj.matrix_world@Vector(c))[a] for c in obj.bound_box) for a in range(3)],[max((obj.matrix_world@Vector(c))[a] for c in obj.bound_box) for a in range(3)]])
    if obj.type=='ARMATURE':record['bones']=[{'name':b.name,'parent':b.parent.name if b.parent else None,'head':list(b.head_local),'tail':list(b.tail_local),'deform':b.use_deform} for b in obj.data.bones]
    if obj.animation_data:record['animation']={'activeAction':obj.animation_data.action.name if obj.animation_data.action else None,'nla':[{'name':t.name,'strips':[{'name':s.name,'action':s.action.name if s.action else None,'start':s.frame_start,'end':s.frame_end} for s in t.strips]} for t in obj.animation_data.nla_tracks]}
    objects.append(record)
report={'source':source.name,'blenderVersion':bpy.app.version_string,'sceneFrame':bpy.context.scene.frame_current,'fps':bpy.context.scene.render.fps,'unitSystem':bpy.context.scene.unit_settings.system,'unitScale':bpy.context.scene.unit_settings.scale_length,'objects':objects,'actions':[{'name':a.name,'frameRange':list(a.frame_range)} for a in bpy.data.actions],'images':[{'name':i.name,'filepath':i.filepath,'size':list(i.size),'packed':bool(i.packed_file),'packedBytes':i.packed_file.size if i.packed_file else 0} for i in bpy.data.images],'materials':[{'name':m.name,'useNodes':m.use_nodes,'diffuseColor':list(m.diffuse_color),'nodes':[{'name':n.name,'type':n.type,'image':n.image.name if n.type=='TEX_IMAGE' and n.image else None} for n in m.node_tree.nodes] if m.node_tree else []} for m in bpy.data.materials]}
(out/'cdmir-blender-inventory.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'objects':[(r['name'],r['type'],r.get('triangles')) for r in objects],'actions':report['actions'],'images':report['images']}))
