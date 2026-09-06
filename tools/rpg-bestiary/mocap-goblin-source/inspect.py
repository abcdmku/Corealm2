import bpy, json
from pathlib import Path
bpy.ops.wm.open_mainfile(filepath=str(Path('test-results/fantasy-collection-source/goblin-animated-by-motion-capture/Goblin.blend').resolve()))
result={'objects':[{'name':o.name,'type':o.type,'scale':list(o.scale),'matrix':[list(r) for r in o.matrix_world],'modifiers':[(m.name,m.type) for m in o.modifiers],'materials':[m.name for m in o.data.materials] if o.type=='MESH' else None} for o in bpy.data.objects], 'materials':[{'name':m.name,'nodes':[(n.name,n.type,getattr(n,'image',None).name if getattr(n,'image',None) else None) for n in m.node_tree.nodes] if m.node_tree else None} for m in bpy.data.materials], 'images':[{'name':i.name,'size':list(i.size),'packed':bool(i.packed_file),'path':i.filepath} for i in bpy.data.images], 'bones':[{'name':b.name,'parent':b.parent.name if b.parent else None,'deform':b.use_deform} for b in bpy.data.objects['GoblinArmature'].data.bones], 'fps':bpy.context.scene.render.fps}
out=Path('test-results/mocap-goblin-source');out.mkdir(parents=True,exist_ok=True)
(out/'inspection.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))
