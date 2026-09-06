import bpy,pathlib,json
p=pathlib.Path(__file__).resolve().parent;bpy.ops.wm.open_mainfile(filepath=str(p/'cdmir-rat-original.blend'),load_ui=False,use_scripts=False)
bpy.context.scene.frame_set(0);bpy.context.view_layer.update();o=bpy.data.objects['Hair']
print(json.dumps({'inScene':o.name in bpy.context.scene.objects,'inViewLayer':o.name in bpy.context.view_layer.objects,'users':o.users,'collections':[c.name for c in o.users_collection],'visible':o.visible_get(),'matrixBasis':[list(r) for r in o.matrix_basis],'matrixLocal':[list(r) for r in o.matrix_local],'location':list(o.location),'rotation':list(o.rotation_euler),'scale':list(o.scale),'parent':o.parent.name,'armWorld':[list(r) for r in o.parent.matrix_world]}))
