import bpy,json
r=bpy.ops.export_scene.gltf.get_rna_type();print(json.dumps({p.identifier:{'default':str(p.default) if hasattr(p,'default') else '', 'enum':[i.identifier for i in p.enum_items] if p.type=='ENUM' else []} for p in r.properties if any(k in p.identifier for k in ['animation','skin','influence','sampling','nla','frame','action'])}))
