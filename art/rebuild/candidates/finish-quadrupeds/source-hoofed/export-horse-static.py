import bpy,pathlib,json,hashlib
from mathutils import Vector,Matrix
root=pathlib.Path(r'C:/Users/Borg/Documents/GitHub/Corealm2/art/rebuild/candidates/finish-quadrupeds/source-hoofed');source=root/'original/horse'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=str(source/'LD_HorseRtime02.obj'))
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
for mat in bpy.data.materials:
 mat.use_nodes=True;nodes=mat.node_tree.nodes;nodes.clear();out=nodes.new('ShaderNodeOutputMaterial');bsdf=nodes.new('ShaderNodeBsdfPrincipled');bsdf.inputs['Roughness'].default_value=.88;mat.node_tree.links.new(bsdf.outputs['BSDF'],out.inputs['Surface'])
 if 'Eye' in mat.name: diffuse='eye_texture.png';normal=None
 elif '003' in mat.name: diffuse='Hair12Main2k.png';normal='Hair12Main2kNorm.png'
 else: diffuse='HorseMain2k00.png';normal='HorseMain2k00Norm00.png'
 tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(source/diffuse));mat.node_tree.links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
 if normal:
  texn=nodes.new('ShaderNodeTexImage');texn.image=bpy.data.images.load(str(source/normal));texn.image.colorspace_settings.name='Non-Color';n=nodes.new('ShaderNodeNormalMap');mat.node_tree.links.new(texn.outputs['Color'],n.inputs['Color']);mat.node_tree.links.new(n.outputs['Normal'],bsdf.inputs['Normal'])
 if '003' in mat.name:
  mat.use_backface_culling=False;mat.node_tree.links.new(tex.outputs['Alpha'],bsdf.inputs['Alpha']);mat.surface_render_method='DITHERED'
points=[o.matrix_world@Vector(c) for o in meshes for c in o.bound_box];lo=Vector([min(v[i] for v in points) for i in range(3)]);hi=Vector([max(v[i] for v in points) for i in range(3)]);scale=2.4/(hi.z-lo.z);center=Vector(((hi.x+lo.x)/2,(hi.y+lo.y)/2,lo.z))
transform=Matrix.Scale(scale,4)@Matrix.Translation(-center)
for o in meshes:o.matrix_world=transform@o.matrix_world
bpy.context.view_layer.update()
out=root/'horse-source-static.glb';bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',export_animations=False,export_extras=True)
record={'id':'horse_lyndon_static_source','status':'static-source-review-only','file':out.name,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'bytes':out.stat().st_size,'geometryModified':False,'normalization':{'uniformScale':scale,'originalMinimum':list(lo),'originalMaximum':list(hi),'heightMeters':2.4},'meshObjects':len(meshes),'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes),'animations':[],'license':'CC0-1.0','author':'Lyndon Daniels','source':'https://opengameart.org/content/realtime-ranchers-3d-model-pack','changes':['Uniform world transform to 2.4 m total height and ground y=0 in glTF','Blender 4 node materials rebuilt from original diffuse and normal textures','Exported whole original OBJ body, mane, tail and eyes without geometry replacement'],'limitations':['Static; no production clip set','Original native derivative rig inventory preserved separately','Original low-poly hoof silhouette and baked shading still need production visual review']}
(root/'horse-static-catalogue.json').write_text(json.dumps(record,indent=2));print('RESULT',json.dumps(record))
