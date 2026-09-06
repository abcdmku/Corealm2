import bpy,bmesh,json,pathlib,hashlib,math
root=pathlib.Path(r'C:/Users/Borg/Documents/GitHub/Corealm2/art/rebuild/candidates/finish-quadrupeds/source-tapir-horse')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root/'tapir-source-static.glb'))
meshes=[o for o in bpy.data.objects if o.type=='MESH'];points=[o.matrix_world@v.co for o in meshes for v in o.data.vertices]
report={'meshes':len(meshes),'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes),'finiteVertices':all(math.isfinite(x) for p in points for x in p),'armatures':sum(o.type=='ARMATURE' for o in bpy.data.objects),'actions':len(bpy.data.actions),'externalImagePaths':[i.filepath for i in bpy.data.images if i.filepath and not i.packed_file],'sourceUnchanged':hashlib.sha256((root.parent/'source-hoofed/riggedHorse.blend').read_bytes()).hexdigest()==json.loads((root/'candidate.json').read_text())['sourceSha256'],'visualAcceptance':False}
report['topology']=[]
for o in meshes:
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001);report['topology'].append({'name':o.name,'positionWeldTolerance':.000001,'boundaryEdges':sum(e.is_boundary for e in bm.edges),'nonManifoldEdges':sum(not e.is_manifold for e in bm.edges),'zeroAreaFaces':sum(f.calc_area()<1e-12 for f in bm.faces)});bm.free()
(root/'cpu-validation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
