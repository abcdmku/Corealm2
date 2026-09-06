import bpy, pathlib, math, sys
from mathutils import Vector
root=pathlib.Path(__file__).resolve().parent
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
source=root/(args[0] if args else 'bighorn-source-adaptation.blend')
folder=root/(args[1] if len(args)>1 else 'cpu-stills-v1');folder.mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
scene=bpy.context.scene
for obj in bpy.data.objects:
    if obj.type=='ARMATURE':obj.animation_data_clear();obj.data.pose_position='REST'
scene.frame_set(0);bpy.context.view_layer.update()
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=16
scene.cycles.use_denoising=True;scene.render.resolution_x=720;scene.render.resolution_y=720;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
scene.world=bpy.data.worlds.new('CPU review neutral world');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.24,.26,.29,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.7
scene.view_settings.view_transform='AgX'
for loc,power,size in [((3,-4,5),550,4),((-3,1,3),300,3)]:
    bpy.ops.object.light_add(type='AREA',location=loc);bpy.context.object.data.energy=power;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=size
    bpy.context.object.rotation_euler=(Vector((0,0,.7))-bpy.context.object.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,0))
ground=bpy.context.object;mat=bpy.data.materials.new('Neutral ground');mat.diffuse_color=(.22,.24,.26,1);ground.data.materials.append(mat)
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO';camera.data.ortho_scale=1.85
target=Vector((0,-.10,.66))
for name,location in [('front',(0,-4,.9)),('side',(4,-.10,.9)),('threequarter',(3,-4,1.35))]:
    camera.location=location;camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(folder/(name+'.png'));bpy.ops.render.render(write_still=True)
