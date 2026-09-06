import bpy,json
from pathlib import Path
arm=bpy.data.objects['Armature']
for t in arm.animation_data.nla_tracks:t.mute=True
report=[]
for name,frame in [('Idle',0),('Walk',20),('Attack',12),('Dying',35)]:
    arm.animation_data.action=bpy.data.actions[name]
    bpy.context.scene.frame_set(frame)
    deps=bpy.context.evaluated_depsgraph_get()
    minimum=[float('inf')]*3;maximum=[float('-inf')]*3
    for objname in ['Monster','Tree']:
        obj=bpy.data.objects[objname].evaluated_get(deps)
        for vertex in obj.data.vertices:
            p=obj.matrix_world@vertex.co
            q=(p.x,p.z,-p.y)
            for i in range(3):minimum[i]=min(minimum[i],q[i]);maximum[i]=max(maximum[i],q[i])
    report.append({'take':name,'frame':frame,'min':minimum,'max':maximum})
Path('test-results/forest-monster-source/blender-pose-bounds.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
