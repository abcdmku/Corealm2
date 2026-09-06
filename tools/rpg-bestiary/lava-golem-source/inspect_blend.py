import bpy,json,os
from pathlib import Path
out=Path('test-results/lava-golem-source')
out.mkdir(parents=True,exist_ok=True)
def props(o):
    return {'name':o.name,'type':o.type,'parent':o.parent.name if o.parent else None,'location':list(o.location),'rotation':list(o.rotation_euler),'scale':list(o.scale),'dimensions':list(o.dimensions),'vertices':len(o.data.vertices) if o.type=='MESH' else None,'materials':[m.name if m else None for m in o.data.materials] if o.type=='MESH' else [],'modifiers':[{'type':m.type,'object':m.object.name if hasattr(m,'object') and m.object else None} for m in o.modifiers],'action':o.animation_data.action.name if o.animation_data and o.animation_data.action else None,'bones':[{'name':b.name,'parent':b.parent.name if b.parent else None,'head':list(b.head_local),'tail':list(b.tail_local),'deform':b.use_deform} for b in o.data.bones] if o.type=='ARMATURE' else []}
report={'version':bpy.app.version_string,'fps':bpy.context.scene.render.fps,'objects':[props(o) for o in bpy.data.objects],'actions':[{'name':a.name,'range':list(a.frame_range),'curves':len(a.fcurves) if hasattr(a,'fcurves') else None} for a in bpy.data.actions],'images':[{'name':im.name,'filepath':im.filepath,'size':list(im.size)} for im in bpy.data.images],'materials':[{'name':m.name,'nodes':[(n.name,n.type) for n in m.node_tree.nodes] if m.node_tree else [],'diffuse':list(m.diffuse_color)} for m in bpy.data.materials]}
(out/'blend-inspection.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))

