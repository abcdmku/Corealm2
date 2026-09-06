import bpy,json,pathlib
root=pathlib.Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(root/'tapir-source-adapted.blend'))
p=[v.co.copy() for v in bpy.data.objects['Plane'].data.vertices]
def bounds(points):
 lo=[min(v[i] for v in points) for i in range(3)];hi=[max(v[i] for v in points) for i in range(3)]
 return {'min':lo,'max':hi,'dimensions':[hi[i]-lo[i] for i in range(3)]}
head=bounds([v for v in p if v.y<-.85]);torso=bounds([v for v in p if -.43<v.y<.83 and v.z>.55])
d={'units':'meters','axisOrder':'Blender width X, longitudinal Y, height Z','headMask':'Final connected body vertices with Y < -0.85; excludes most ear crowns and neck','torsoMask':'Final connected body vertices -0.43 < Y < 0.83 and Z > 0.55; geometric region, not zoological landmarks','head':head,'torso':torso,'headLengthToTorsoLength':head['dimensions'][1]/torso['dimensions'][1],'headWidthToTorsoWidth':head['dimensions'][0]/torso['dimensions'][0],'reviewConcern':'Side CPU view retains oversized rear barrel and small head on protruding narrow neck. CPU review is not acceptance.'}
(root/'region-measurements.json').write_text(json.dumps(d,indent=2));print(json.dumps(d))
