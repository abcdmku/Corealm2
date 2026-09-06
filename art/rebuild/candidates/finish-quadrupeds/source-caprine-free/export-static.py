import bpy, json, math, pathlib, hashlib
from mathutils import Matrix, Vector

root = pathlib.Path(__file__).resolve().parent
source = root / 'sheepies.blend'
bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
body = bpy.data.objects['Sheep 2']
rig = body.parent
rig.animation_data_clear()
rig.data.pose_position = 'REST'
bpy.context.view_layer.update()
image = next(i for i in bpy.data.images if i.packed_file and tuple(i.size) == (1024, 1024))
image.filepath_raw = str(root / 'p0ss-packed-diffuse.png')
image.file_format = 'PNG'
image.save()

depsgraph = bpy.context.evaluated_depsgraph_get()
mesh = bpy.data.meshes.new_from_object(body.evaluated_get(depsgraph))
mesh.transform(body.matrix_world)
forward = rig.matrix_world.to_3x3() @ (rig.data.bones['HEAD'].head_local - rig.data.bones['Lower Spine'].head_local)
angle = -math.pi / 2 - math.atan2(forward.y, forward.x)
mesh.transform(Matrix.Rotation(angle, 4, 'Z'))
low = Vector(tuple(min(v.co[k] for v in mesh.vertices) for k in range(3)))
high = Vector(tuple(max(v.co[k] for v in mesh.vertices) for k in range(3)))
translation = Vector((-(low.x + high.x) / 2, -(low.y + high.y) / 2, -low.z))
mesh.transform(Matrix.Translation(translation))

# Copy the evaluated surface and UV loops into a clean static mesh. Old Blender
# deform layers refer to groups absent from the static object and confuse export.
evaluated = mesh
mesh = bpy.data.meshes.new('p0ss_Sheep2_static_surface')
mesh.from_pydata([tuple(v.co) for v in evaluated.vertices], [], [tuple(p.vertices) for p in evaluated.polygons])
for original, copied in zip(evaluated.polygons, mesh.polygons):
    copied.use_smooth = original.use_smooth
for old_layer in evaluated.uv_layers:
    layer = mesh.uv_layers.new(name=old_layer.name)
    for old_uv, new_uv in zip(old_layer.data, layer.data):
        new_uv.uv = old_uv.uv
mesh.update()

preview = bpy.data.objects.new('p0ss_Sheep2_complete_body_STATIC_review', mesh)
bpy.context.collection.objects.link(preview)
material = bpy.data.materials.new('p0ss_original_packed_diffuse')
material.use_nodes = True
nodes = material.node_tree.nodes
shader = nodes.get('Principled BSDF')
shader.inputs['Roughness'].default_value = .87
texture = nodes.new('ShaderNodeTexImage')
texture.image = image
material.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
mesh.materials.clear()
mesh.materials.append(material)
for polygon in mesh.polygons:
    polygon.material_index = 0
preview['review_target'] = 'creature_cairn_bighorn'
preview['identity'] = 'Domestic sheep body base for possible Bighorn adaptation; not a bighorn model'
preview['source_author'] = 'p0ss'
preview['source_url'] = 'https://opengameart.org/content/sheep-rigged-textured-and-animated'
preview['license'] = 'CC-BY-SA-3.0'
preview['attribution'] = 'Sheep by p0ss; source boar texture photograph by titus tscharntke; CC-BY-SA 3.0'
preview['changes'] = 'Selected original Sheep 2 body; rest-pose static bake; rigid forward alignment and ground centering; packed diffuse relinked to glTF material. No shape or horn changes.'
preview['static_review_only'] = True
bpy.ops.object.select_all(action='DESELECT')
preview.select_set(True)
bpy.context.view_layer.objects.active = preview
for obj in list(bpy.data.objects):
    if obj != preview:
        bpy.data.objects.remove(obj, do_unlink=True)
output = root / 'p0ss-sheep2-static.glb'
bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', use_selection=True,
    export_animations=False, export_skins=False, export_extras=True, export_yup=True,
    export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='AUTO')
report = {
    'source': source.name, 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'output': output.name, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
    'source_mesh': 'Sheep 2', 'vertices': len(mesh.vertices), 'polygons': len(mesh.polygons),
    'uv_layers': [uv.name for uv in mesh.uv_layers], 'embedded_texture': image.name,
    'blender_dimensions': list(high-low), 'rigid_heading_radians': angle,
    'translation': list(translation), 'uniform_scale': 1,
    'static': True, 'exported_animation_count': 0, 'exported_skin_count': 0,
    'attribution': preview['attribution'], 'changes': preview['changes'],
}
(root / 'static-export.json').write_text(json.dumps(report, indent=2), encoding='utf8')
print(json.dumps(report))
