import bpy,json
from pathlib import Path
out=Path('test-results/beetle-golem-source')
bpy.ops.wm.open_mainfile(filepath=str((out/'BeetleGolem_v3.blend').resolve()),load_ui=False,use_scripts=False)
data={'objects':[{'name':o.name,'type':o.type,'vertices':len(o.data.vertices) if o.type=='MESH' else None,'bones':len(o.data.bones) if o.type=='ARMATURE' else None,'modifiers':[(m.name,m.type) for m in o.modifiers]} for o in bpy.data.objects],'actions':[{'name':a.name,'range':list(a.frame_range),'slots':[s.identifier for s in a.slots]} for a in bpy.data.actions],'images':[{'name':i.name,'size':list(i.size),'packed':bool(i.packed_file),'filepath':i.filepath} for i in bpy.data.images],'materials':[{'name':m.name,'nodes':[(n.name,n.type,n.image.name if hasattr(n,'image') and n.image else None) for n in m.node_tree.nodes] if m.node_tree else []} for m in bpy.data.materials],'fps':bpy.context.scene.render.fps}
(out/'inventory.json').write_text(json.dumps(data,indent=2));print(json.dumps(data))
