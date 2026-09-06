"""CPU-only static source preview; run Blender with --disable-autoexec."""
import bpy, pathlib, json, hashlib, struct
root=pathlib.Path(__file__).resolve().parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=str(root/'gonsplitters-badger-source.obj'),forward_axis='NEGATIVE_Z',up_axis='Y')
mat=bpy.data.materials.new('Source_Unity_Standard_translated');mat.use_nodes=True;mat.use_backface_culling=True
n=mat.node_tree.nodes;l=mat.node_tree.links;bs=n.get('Principled BSDF')
def tex(name,noncolor=False):
    node=n.new('ShaderNodeTexImage');node.image=bpy.data.images.load(str(root/('gonsplitters-'+name+'.png')))
    if noncolor:node.image.colorspace_settings.name='Non-Color'
    return node
base=tex('badger_BaseColor_Opacity');l.new(base.outputs['Color'],bs.inputs['Base Color'])
# Source tint is stored explicitly in GLB after export, since arbitrary mix nodes are ignored.
raw=tex('badger_Normal',True).image
pixels=list(raw.pixels[:]);out=pixels[:]
for i in range(0,len(pixels),4):
    x=pixels[i+3]*2-1;y=pixels[i+1]*2-1;z=max(0,1-x*x-y*y)**.5
    out[i:i+4]=[(x+1)*.5,(y+1)*.5,(z+1)*.5,1]
normalImage=bpy.data.images.new('source_DXT5nm_unpacked',width=raw.size[0],height=raw.size[1]);normalImage.colorspace_settings.name='Non-Color';normalImage.pixels=out
normal=n.new('ShaderNodeTexImage');normal.image=normalImage;normalNode=n.new('ShaderNodeNormalMap');l.new(normal.outputs['Color'],normalNode.inputs['Color']);l.new(normalNode.outputs['Normal'],bs.inputs['Normal'])
gloss=tex('badger_Metal_Roughness',True);inverse=n.new('ShaderNodeMath');inverse.operation='SUBTRACT';inverse.inputs[0].default_value=1;l.new(gloss.outputs['Alpha'],inverse.inputs[1]);l.new(inverse.outputs[0],bs.inputs['Roughness']);bs.inputs['Metallic'].default_value=0
# AO in original separate texture; GLTF exporter recognizes its named group.
ao=tex('badger_AmbOc',True);group=bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree');group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat');node=n.new('ShaderNodeGroup');node.node_tree=group;l.new(ao.outputs['Color'],node.inputs['Occlusion'])
objects=[]
for obj in bpy.context.scene.objects:
    if obj.type=='MESH':
        obj.data.materials.clear();obj.data.materials.append(mat)
        objects.append({'name':obj.name,'vertices':len(obj.data.vertices),'polygons':len(obj.data.polygons),'scale':list(obj.scale)})
target=root/'gonsplitters-badger-source-preview.glb'
bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',export_animations=False,export_skins=False,export_yup=True)
data=target.read_bytes();jsonSize=struct.unpack_from('<I',data,12)[0];document=json.loads(data[20:20+jsonSize])
for material in document['materials']:
    material['pbrMetallicRoughness']['baseColorFactor']=[.906331718,.906331718,.906331718,1]
    material['doubleSided']=False
encoded=json.dumps(document,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
tail=data[20+jsonSize:];target.write_bytes(struct.pack('<III',0x46546c67,2,20+len(encoded)+len(tail))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+tail)
report={'file':target.name,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size,'objects':objects,'geometryReshaped':False,'rigged':False,'animations':0,'sourceCoordinates':'UnityPy OBJ X mirror, Blender axis import, GLTF Y-up export; no size normalization or pose edits','maps':'Original albedo with source tint; DXT5nm alpha/green reconstructed normal; roughness=1-source gloss alpha; original AO; opaque source mode retained','limits':'Static source selection preview only. Unity parallax height unavailable in glTF material, not translated. Node math/mix exporter material fidelity must be checked in report and hardware source view. Not art or runtime acceptance.'}
(root/'gonsplitters-preview-export.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
