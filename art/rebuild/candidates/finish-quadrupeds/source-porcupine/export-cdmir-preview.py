import bpy, json, pathlib, hashlib, struct
from mathutils import Vector

out=pathlib.Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(out/'cdmir-rat-original.blend'),load_ui=False,use_scripts=False)
bpy.context.scene.frame_set(0)
bpy.context.view_layer.update()
depsgraph=bpy.context.evaluated_depsgraph_get()
names=['Armature','Body','Head','Eyes','Hair','Teeth']
evaluated=[]
for name in names:
    obj=bpy.data.objects[name]
    if obj.type!='MESH':continue
    ev=obj.evaluated_get(depsgraph);mesh=ev.to_mesh()
    points=[ev.matrix_world@v.co for v in mesh.vertices]
    evaluated.append({'name':name,'worldMin':[min(p[a] for p in points) for a in range(3)],'worldMax':[max(p[a] for p in points) for a in range(3)],'vertices':len(points),'vertexGroups':len(obj.vertex_groups)})
    ev.to_mesh_clear()

# Translate only the original packed albedo/normal images to current material
# nodes. No geometry, UV, bone, pose, animation, or image pixel edits.
translated=[]
for material_name,image_name in [('body','rat-body'),('head','rat-head'),('head.001','rat-head')]:
    mat=bpy.data.materials[material_name];mat.use_nodes=True
    bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value=.82
    tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images[image_name]
    mat.node_tree.links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
    normal=mat.node_tree.nodes.new('ShaderNodeTexImage');normal.image=bpy.data.images[image_name+'-Normalmap.png'];normal.image.colorspace_settings.name='Non-Color'
    convert=mat.node_tree.nodes.new('ShaderNodeNormalMap')
    mat.node_tree.links.new(normal.outputs['Color'],convert.inputs['Color']);mat.node_tree.links.new(convert.outputs['Normal'],bsdf.inputs['Normal'])
    translated.append({'material':material_name,'albedo':image_name,'normal':normal.image.name,'roughness':.82})

# Hair originally used a legacy alpha material; keep its original image and UVs.
hair=bpy.data.objects['Hair']
for slot in hair.material_slots:
    if not slot.material:continue
    mat=slot.material;mat.use_nodes=True
    bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images['hair']
    mat.node_tree.links.new(tex.outputs['Color'],bsdf.inputs['Base Color']);mat.node_tree.links.new(tex.outputs['Alpha'],bsdf.inputs['Alpha'])
    mat.surface_render_method='DITHERED';bsdf.inputs['Roughness'].default_value=.85
    translated.append({'material':mat.name,'albedo':'hair','alpha':'hair alpha','roughness':.85})

if bpy.context.object and bpy.context.object.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
for obj in bpy.context.view_layer.objects:obj.select_set(False)
for name in names:bpy.data.objects[name].select_set(True)
bpy.context.view_layer.objects.active=bpy.data.objects['Armature']
target=out/'cdmir-source-preview.glb'
bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,export_animations=False,export_skins=True,export_yup=True,export_apply=False,export_cameras=False,export_lights=False)
report={'file':target.name,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size,'selectedOriginalObjects':names,'geometryChanged':False,'rigChanged':False,'animationsExported':False,'materialsTranslated':translated,'aoNotTranslated':True,'worldBoundsBlenderZUp':evaluated,'units':'Source unit system NONE scale1.0. Exported with stock glTF Y-up transform; no size normalization.','limits':'Source inspection preview only. Material conversion is approximate, not final author appearance proof. Not a porcupine and not integrated or accepted.'}
raw=target.read_bytes();length=struct.unpack_from('<I',raw,12)[0];gltf=json.loads(raw[20:20+length])
report['exportedMeshNodes']=[n['name'] for n in gltf['nodes'] if 'mesh' in n]
report['hairExported']='Hair' in report['exportedMeshNodes']
report['geometryChanged']='No manual vertex edits; stock exporter may validate/triangulate invalid source mesh. See exportWarnings.'
report['exportWarnings']=['Source mesh Rat flagged invalid by Blender glTF exporter; output needs topology review.','Source vertices with more than4 influences exported with4 largest weights normalized.','Legacy vertex color omitted because source materials do not reference it.','Original Hair has abnormal evaluated bounds and was not exported by selection.']
(out/'cdmir-preview-export.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
