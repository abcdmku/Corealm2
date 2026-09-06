import bpy,json,pathlib,hashlib
from mathutils import Vector
root=pathlib.Path(r'C:/Users/Borg/Documents/GitHub/Corealm2/art/rebuild/candidates/finish-quadrupeds/source-hoofed');bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(root/'horse-source-static.glb'))
objs=[o for o in bpy.context.scene.objects if o.type=='MESH'];points=[o.matrix_world@v.co for o in objs for v in o.data.vertices]
# Blender importer converts glTF Y up to Blender Z up.
r={'meshCount':len(objs),'vertexCount':sum(len(o.data.vertices) for o in objs),'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objs),'boundsBlenderZUp':{'min':[min(p[i] for p in points) for i in range(3)],'max':[max(p[i] for p in points) for i in range(3)]},'images':[{'name':im.name,'width':im.size[0],'height':im.size[1],'packed':bool(im.packed_file)} for im in bpy.data.images],'armatures':sum(o.type=='ARMATURE' for o in bpy.data.objects),'actions':len(bpy.data.actions),'sha256':hashlib.sha256((root/'horse-source-static.glb').read_bytes()).hexdigest()}
assert r['meshCount']==5 and len(r['images'])==5 and r['actions']==0
assert abs(r['boundsBlenderZUp']['min'][2])<.00001 and abs(r['boundsBlenderZUp']['max'][2]-2.4)<.00001
(root/'horse-static-validation.json').write_text(json.dumps(r,indent=2));print(json.dumps(r))
