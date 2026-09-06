import bpy,json
from pathlib import Path
out=Path('tools/rpg-bestiary/lava-golem-source/derived').resolve();out.mkdir(parents=True,exist_ok=True)
arm=bpy.data.objects['Armature']
for collection in bpy.data.collections:collection.hide_viewport=False;collection.hide_select=False
for obj in bpy.context.scene.objects:
    if obj.name in {'Armature','golem'}:obj.hide_set(False);obj.hide_viewport=False;obj.hide_render=False;obj.hide_select=False
    obj.select_set(obj.name in {'Armature','golem'})
bpy.context.view_layer.objects.active=arm
image=bpy.data.images['golem_emit.png']
if image.packed_file:(out/'golem_emit.png').write_bytes(bytes(image.packed_file.data))
else:image.filepath_raw=str(out/'golem_emit.png');image.file_format='PNG';image.save()
for mat in bpy.data.materials:
    mat.use_nodes=True;mat.node_tree.nodes.clear()
    bsdf=mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled');bsdf.inputs['Base Color'].default_value=(1,1,1,1);bsdf.inputs['Roughness'].default_value=.88
    output=mat.node_tree.nodes.new('ShaderNodeOutputMaterial');mat.node_tree.links.new(bsdf.outputs['BSDF'],output.inputs['Surface'])
for track in arm.animation_data.nla_tracks:track.mute=True
report=[]
for name,end in [('idle',300),('walk',100),('smash',120)]:
    arm.animation_data.action=bpy.data.actions[name];bpy.context.scene.frame_start=0;bpy.context.scene.frame_end=end;bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
    file=out/(name+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(file),export_format='GLB',use_selection=True,export_animations=True,export_frame_range=True,export_force_sampling=True,export_skins=True,export_def_bones=False,export_yup=True,export_apply=False,export_animation_mode='ACTIVE_ACTIONS')
    report.append({'action':name,'frames':[0,end],'fps':bpy.context.scene.render.fps,'file':str(file)})
(out/'exports.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
