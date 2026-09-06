import bpy,json
from pathlib import Path
out=Path('tools/rpg-bestiary/beetle-golem-source/derived');out.mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(Path('test-results/beetle-golem-source/BeetleGolem_v3.blend').resolve()),load_ui=False,use_scripts=False)
for i,img in enumerate(bpy.data.images):
 if img.packed_file:(out/f'original-map-{i}.png').write_bytes(img.packed_file.data)
mesh=bpy.data.objects['Mesh.001'];print('materials',[(s.name,s.material.diffuse_color[:],s.material.specular_intensity,s.material.roughness) for s in mesh.material_slots]);print('textures',[(t.name,t.type,t.image.name if hasattr(t,'image') and t.image else None) for t in bpy.data.textures]);print('weightmax',max(len(v.groups) for v in mesh.data.vertices));print('mod',[(m.name,m.type) for m in mesh.modifiers]);print('uv',len(mesh.data.uv_layers));print('transform',mesh.matrix_world[:],bpy.data.objects['Armature'].matrix_world[:])
