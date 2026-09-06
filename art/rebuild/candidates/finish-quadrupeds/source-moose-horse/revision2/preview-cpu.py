import bpy,math,pathlib
from mathutils import Vector
root=pathlib.Path(r'C:/Users/Borg/Documents/GitHub/Corealm2/art/rebuild/candidates/finish-quadrupeds/source-moose-horse/revision2');bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(root/'moose-from-horse-static.glb'))
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=12;scene.cycles.use_denoising=True;scene.render.resolution_x=960;scene.render.resolution_y=800;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('World');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.28,.30,.32,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.8
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.006));plane=bpy.context.object;mat=bpy.data.materials.new('Floor');mat.diffuse_color=(.18,.20,.19,1);plane.data.materials.append(mat)
for loc,power,size in [((3,-4,6),1100,5),((-3,2,4),700,4)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,1.4))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add();camera=bpy.context.object;camera.data.type='ORTHO';camera.data.ortho_scale=4.3;scene.camera=camera
for name,location in [('three-quarter',(4,-6,3.2)),('side',(6,0,2.2)),('front',(0,-6,2.0))]:
 camera.location=location;camera.rotation_euler=(Vector((0,0,1.42))-camera.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(root/(name+'-cpu.png'));bpy.ops.render.render(write_still=True)
