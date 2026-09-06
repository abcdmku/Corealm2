import bpy,json,sys,os,hashlib
from mathutils import Vector

folder=os.path.dirname(os.path.abspath(__file__))
historical='--historical' in sys.argv
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=os.path.join(folder,'cat.historical-2017.original.fbx' if historical else 'cat.original.fbx'),use_anim=historical)
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
images=[{'name':i.name,'filepath':i.filepath,'size':list(i.size),'packed':bool(i.packed_file)} for i in bpy.data.images]
materials=[]
for m in bpy.data.materials:
    materials.append({'name':m.name,'diffuse_color':list(m.diffuse_color),'use_nodes':m.use_nodes,
        'nodes':[{'type':n.type,'name':n.name,'image':n.image.filepath if n.type=='TEX_IMAGE' and n.image else None} for n in m.node_tree.nodes] if m.node_tree else []})
points=[o.matrix_world@v.co for o in meshes for v in o.data.vertices]
lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)]
report={'blender':bpy.app.version_string,'meshes':[{'name':o.name,'vertices':len(o.data.vertices),'polygons':len(o.data.polygons),'uv_layers':[u.name for u in o.data.uv_layers],
    'color_attributes':[{'name':c.name,'domain':c.domain,'count':len(c.data),'min':[min(v.color[i] for v in c.data) for i in range(4)],'max':[max(v.color[i] for v in c.data) for i in range(4)]} for c in o.data.color_attributes],
    'matrix_world':[list(r) for r in o.matrix_world]} for o in meshes],
    'images':images,'materials':materials,'boundsBlenderZUp':{'min':lo,'max':hi,'size':[hi[i]-lo[i] for i in range(3)]},'sceneUnitScale':bpy.context.scene.unit_settings.scale_length,
    'armatures':[{'name':o.name,'bones':len(o.data.bones),'deform_bones':sum(1 for b in o.data.bones if b.use_deform)} for o in bpy.context.scene.objects if o.type=='ARMATURE'],
    'actions':[{'name':a.name,'frame_range':list(a.frame_range)} for a in bpy.data.actions]}
with open(os.path.join(folder,'blender-historical-inspection.json' if historical else 'blender-source-inspection.json'),'w') as f:json.dump(report,f,indent=2)
print(json.dumps(report))
if '--export' in sys.argv:
    if historical:raise RuntimeError('Historical source export is not authorized by this inspection helper')
    # Preserve imported source topology, UVs, normals and material assignment.
    # glTF exporter handles the Blender Z-up to glTF Y-up basis conversion.
    bpy.ops.export_scene.gltf(filepath=os.path.join(folder,'Cat.source-import.glb'),export_format='GLB',
        export_animations=False,export_yup=True,export_normals=True,export_texcoords=True,
        export_materials='EXPORT',export_all_vertex_colors=True,export_cameras=False,export_lights=False)
