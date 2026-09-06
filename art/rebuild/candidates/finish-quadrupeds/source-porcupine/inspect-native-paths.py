import bpy,json,pathlib
p=pathlib.Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(p/'cdmir-rat-original.blend'),load_ui=False,use_scripts=False)
for a in bpy.data.actions:
 print(json.dumps({'name':a.name,'range':list(a.frame_range),'idroot':a.id_root,'fcurves':len(a.fcurves),'paths':sorted(set(f.data_path for f in a.fcurves))[:8]}))
