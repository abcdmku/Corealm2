import bpy,json
from pathlib import Path
root=Path(__file__).resolve().parents[3]
bpy.ops.wm.open_mainfile(filepath=str(root/'test-results/coherent-humanoid-source-cache/troll-mauler.blend'),use_scripts=False)
names=['troll_baseTexBaked.png','troll_occlusion.png','cloth uv.png','cloth uv_OCC.png']
result={'images':[{'name':n,'colorspace':bpy.data.images[n].colorspace_settings.name,'isData':bpy.data.images[n].colorspace_settings.is_data,'alphaMode':bpy.data.images[n].alpha_mode,'packed':bool(bpy.data.images[n].packed_file)} for n in names],'scene':{'displayDevice':bpy.context.scene.display_settings.display_device,'viewTransform':bpy.context.scene.view_settings.view_transform,'viewExposure':bpy.context.scene.view_settings.exposure,'viewGamma':bpy.context.scene.view_settings.gamma}}
(root/'test-results/troll-mauler-source/source-colors.json').write_text(json.dumps(result,indent=2));print(result)
