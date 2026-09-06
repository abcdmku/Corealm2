import bpy,json,shutil
from pathlib import Path
out=Path('tools/rpg-bestiary/forest-monster-source/derived').resolve()
out.mkdir(parents=True,exist_ok=True)
src=Path(bpy.data.filepath).parent
for f in (src/'texture').glob('*.png'): shutil.copy2(f,out/f.name)
arm=bpy.data.objects['Armature']
keep={'Armature','Monster','Tree'}
for obj in bpy.context.scene.objects:
    obj.select_set(obj.name in keep)
    if obj.name in keep: obj.hide_set(False); obj.hide_viewport=False; obj.hide_render=False
bpy.context.view_layer.objects.active=arm
for mat in bpy.data.materials:
    mat.use_nodes=True
    mat.node_tree.nodes.clear()
    bsdf=mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value=(1,1,1,1)
    bsdf.inputs['Roughness'].default_value=.88
    output=mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
    mat.node_tree.links.new(bsdf.outputs['BSDF'],output.inputs['Surface'])
if arm.animation_data:
    for track in arm.animation_data.nla_tracks: track.mute=True
props=bpy.ops.export_scene.gltf.get_rna_type().properties
common=dict(export_format='GLB',use_selection=True,export_animations=True,export_frame_range=True,export_force_sampling=True,export_skins=True,export_def_bones=False,export_yup=True,export_apply=False)
if 'export_animation_mode' in props: common['export_animation_mode']='ACTIVE_ACTIONS'
report=[]
for name,end in [('Idle',190),('Walk',40),('Melee_Hold',50),('Attack',30),('Dying',35)]:
    action=bpy.data.actions[name]
    arm.animation_data.action=action
    bpy.context.scene.frame_start=0
    bpy.context.scene.frame_end=end
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    file=out/(name+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(file),**common)
    report.append({'action':name,'frames':[0,end],'fps':bpy.context.scene.render.fps,'file':str(file)})
(out/'exports.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
