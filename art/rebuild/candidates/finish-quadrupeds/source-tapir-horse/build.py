import bpy, bmesh, json, pathlib, hashlib, math
from mathutils import Vector, Matrix

ROOT=pathlib.Path(__file__).resolve().parent
SOURCE=ROOT.parent/'source-hoofed'
BLEND=SOURCE/'riggedHorse.blend'
original_hash=hashlib.sha256(BLEND.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(BLEND))
body=bpy.data.objects['Plane']
arm=bpy.data.objects['Armature']
src_matrix=body.matrix_world.copy()
original_points=[src_matrix@v.co for v in body.data.vertices]
source_groups=[{body.vertex_groups[g.group].name:g.weight for g in v.groups} for v in body.data.vertices]
source_faces=[list(p.vertices) for p in body.data.polygons]
original_bones=[{'name':b.name,'head':list(arm.matrix_world@b.head_local),'tail':list(arm.matrix_world@b.tail_local),'parent':b.parent.name if b.parent else None} for b in arm.data.bones]

def smooth(a,b,x):
 t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
def lerp(a,b,t):return a+(b-a)*t
def spline(rows,x):
 if x<=rows[0][0]:return rows[0][1]+(x-rows[0][0])*(rows[1][1]-rows[0][1])/(rows[1][0]-rows[0][0])
 if x>=rows[-1][0]:return rows[-1][1]+(x-rows[-1][0])*(rows[-1][1]-rows[-2][1])/(rows[-1][0]-rows[-2][0])
 for i in range(len(rows)-1):
  a,b=rows[i:i+2]
  if a[0]<=x<=b[0]:
   p=rows[max(0,i-1)];n=rows[min(len(rows)-1,i+2)];h=b[0]-a[0];t=(x-a[0])/h
   m0=(b[1]-p[1])/(b[0]-p[0]);m1=(n[1]-a[1])/(n[0]-a[0])
   return (2*t**3-3*t*t+1)*a[1]+(t**3-2*t*t+t)*h*m0+(-2*t**3+3*t*t)*b[1]+(t**3-t*t)*h*m1

LONGITUDINAL=[[-8.3,1.30],[-7.88,1.255],[-7.17,1.06],[-6.75,.93],[-5,.77],[-3,.57],[-2.27,.46],[0,.0],[3.27,-.60],[5.06,-.95],[6.3,-1.07]]
HEIGHT=[[-5.0083,.002],[-4.4,.07],[-2.2,.30],[0,.56],[1.5,.80],[3,1.085],[4.58,1.17]]
def warp(point):
 x,y,z=point
 f=spline(LONGITUDINAL,y)
 h=spline(HEIGHT,z)
 head=1-smooth(-6.6,-3.7,y)
 h=lerp(h,.928+.079*(z-2.65),head)
 # Broad cheek and short skull, not a scaled horse head graft.
 cheek=1-smooth(-6.8,-5.7,y)
 width=lerp(.194,.26,cheek)
 width*=1-.17*smooth(-2.8,.0,-y)*(1-head)
 xx=x*width
 # Wider leg stance without widening the upper torso.
 xx+=math.copysign(.037*(1-smooth(.42,.72,h)),x)
 # Higher rounded pelvis, lower shoulder; retain authored source rib contours.
 h+=.035*smooth(.2,2.8,y)*smooth(.65,.95,h)
 head_amount=1-smooth(-6.0,-4.1,y)
 dy=y+6.7474;dz=z-3.6938;theta=-.79
 hy=math.cos(theta)*dy-math.sin(theta)*dz
 hz=math.sin(theta)*dy+math.cos(theta)*dz
 hp=Vector((x*.205,-.915+hy*.18,1.055+hz*.18))
 nose=smooth(1.20,1.42,-hp.y);hp.x*=1-.25*nose;hp.z-=.035*nose
 result=Vector((xx,-f,h)).lerp(hp,head_amount)
 skull=1-smooth(-1.08,-.96,result.y)
 result.x*=1-.12*skull;result.z=lerp(result.z,.985+(result.z-.985)*.78,skull)
 nose=1-smooth(-1.41,-1.27,result.y)
 result.x*=1-.38*nose;result.y-=.046*nose;result.z-=.045*nose
 neck=smooth(-.99,-.83,result.y)*(1-smooth(-.64,-.51,result.y))*smooth(.79,1.02,result.z)
 result.z+=.054*neck
 return result

body.parent=None;body.matrix_world=Matrix.Identity(4)
body.modifiers.clear()
for v,p in zip(body.data.vertices,original_points):v.co=warp(p)
# Original topology and UVs retained through this edit. The disconnected long
# mane and tail hair meshes are not part of the tapir body and are removed.
for o in list(bpy.data.objects):
 if o not in [body,arm] and o.type!='MESH':bpy.data.objects.remove(o,do_unlink=True)
for name in ['BezierCurve','BezierCurve.005']:
 if name in bpy.data.objects:bpy.data.objects.remove(bpy.data.objects[name],do_unlink=True)

# Compress source pinnae around their source attachment, using original ear
# weights as the region mask. Body/skull/ears remain one source-derived mesh.
ear_bases={b['name']:warp(Vector(b['head'])) for b in original_bones if b['name'] in ['Bone.001_L','Bone.001_R']}
for v,groups,original in zip(body.data.vertices,source_groups,original_points):
 for name,base in ear_bases.items():
  weight=groups.get(name,0)/max(sum(groups.values()),.000001)
  if weight>0:
   side=-1 if name.endswith('_L') else 1
   u=max(0,min(1,(original.z-3.55)/1.04))
   target=Vector((side*.131+(original.x-side*.46)*.16,-.910+(original.y+6.92)*.09,1.042+.085*math.sin(u*1.5708)))
   v.co=v.co.lerp(target,weight)

# Shorten the entire cranial/neck reach and soften the horse's deep jowl.
for v in body.data.vertices:
 x,y,z=v.co
 if y<-.52:v.co.y=-.52+(y+.52)*.81
 f=-v.co.y
 if .82<f<1.17 and z<.925:
  amount=smooth(.82,.94,f)*(1-smooth(1.1,1.17,f))
  v.co.z=lerp(z,.925+(z-.925)*.64,amount)

def nasal_refine(point):
 p=point.copy();f=-p.y
 bridge=smooth(.94,1.09,f)
 p.y+=max(0,f-.94)*.38
 p.x*=1+.42*bridge
 p.z=lerp(p.z,.91+(p.z-.91)*.53,bridge)
 # A short, mobile distal nose grows out of the same source muzzle vertices.
 tip=smooth(1.17,1.29,f)
 p.x*=1-.12*tip
 p.z-=.033*tip
 p.y-=.027*tip
 # Recede the original lower lip behind the overhanging upper nasal tip.
 p.y+=.062*smooth(1.06,1.23,f)*(1-smooth(.86,.93,point.z))
 p.z+=.029*smooth(1.08,1.22,f)*(1-smooth(.84,.90,point.z))
 return p
for v in body.data.vertices:v.co=nasal_refine(v.co)

# Eyes are complete original meshes, reduced and embedded in the reshaped cheek.
for name in ['Sphere','Sphere.002']:
 o=bpy.data.objects[name];points=[o.matrix_world@v.co for v in o.data.vertices];center=sum(points,Vector())/len(points);target=warp(center)
 target.x+=math.copysign(.027,target.x)
 target.z-=.029
 target.y+=.010
 if target.y<-.52:target.y=-.52+(target.y+.52)*.81
 o.matrix_world=Matrix.Identity(4)
 target=nasal_refine(target);target.x-=math.copysign(.0015,target.x)
 for v,p in zip(o.data.vertices,points):v.co=target+(warp(p)-warp(center))*.34

# Shorten the source body's existing tail topology around the original root.
tail_root=warp(Vector(next(b['head'] for b in original_bones if b['name']=='Bone.003')))
for v,groups in zip(body.data.vertices,source_groups):
 t=min(1,groups.get('Bone.003',0)+groups.get('Bone.004',0))
 if t>0:v.co=v.co.lerp(tail_root+(v.co-tail_root)*Vector((.60,.36,.34)),t)

mapped_points=[list(v.co) for v in body.data.vertices]
(ROOT/'vertex-source-map.json').write_text(json.dumps({'source':str(BLEND.relative_to(ROOT.parent)),'sourceSha256':original_hash,'sourceVertexCount':len(original_points),'mapping':'native source vertex index unchanged before later neck edit, subdivision and local foot retopology; lower hoof topology is replaced and newly added foot vertices have no original index','originalWorldPositions':[list(p) for p in original_points],'adaptedPositionsBeforeFootEditing':mapped_points,'sourceVertexGroups':source_groups,'sourceFaces':source_faces,'sourceBones':original_bones},separators=(',',':')))

# Flatten the equine withers/neck ridge into a continuous tapir dorsal contour.
neck_points=[v.co.copy() for v in body.data.vertices]
for v in body.data.vertices:
 x,y,z=v.co
 if -.99<y<-.43 and z>.58 and not any(source_groups[v.index].get(n,0)/max(sum(source_groups[v.index].values()),.000001)>.45 for n in ['Bone.001_L','Bone.001_R']):
  nearby=[p for p in neck_points if abs(p.y-y)<.035 and p.z>.58]
  if nearby:
   low=min(p.z for p in nearby);high=max(p.z for p in nearby)
   roof=spline([[-.99,1.05],[-.85,1.045],[-.68,1.035],[-.43,1.065]],y)
   floor=spline([[-.99,.835],[-.85,.80],[-.68,.755],[-.43,.66]],y)
   t=max(0,min(1,(z-low)/max(.03,high-low)))
   amount=smooth(-.99,-.94,y)*(1-smooth(-.48,-.43,y))
   v.co.z=lerp(z,lerp(floor,roof,t),amount)

# Replace only the pinna crowns above the native ear roots. The two source
# attachment boundaries are bridged into cupped, rounded crowns.
bm=bmesh.new();bm.from_mesh(body.data);bm.verts.ensure_lookup_table()
deleted=[v for v in bm.verts if original_points[v.index].z>3.75 and abs(original_points[v.index].x)>.42 and any(source_groups[v.index].get(name,0)/max(sum(source_groups[v.index].values()),.000001)>.45 for name in ['Bone.001_L','Bone.001_R'])]
bmesh.ops.delete(bm,geom=deleted,context='VERTS')
ear_edges=set(e for e in bm.edges if e.is_boundary)
ear_loops=[]
while ear_edges:
 e=ear_edges.pop();loop=[e.verts[0],e.verts[1]]
 while True:
  choices=[q for q in loop[-1].link_edges if q in ear_edges]
  if not choices:break
  q=choices[0];ear_edges.remove(q);n=q.other_vert(loop[-1])
  if n==loop[0]:break
  loop.append(n)
 ear_loops.append(loop)
if len(ear_loops)!=2:raise RuntimeError('Expected two source ear roots, got '+str(len(ear_loops)))
ear_records=[]
for loop in ear_loops:
 center=sum((v.co for v in loop),Vector())/len(loop);side=-1 if center.x<0 else 1
 n=len(loop);prev=loop
 for j,v in enumerate(loop):
  theta=-math.pi+2*math.pi*j/n;v.co=Vector((center.x+math.cos(theta)*.022,center.y+math.sin(theta)*.017,center.z-.006))
 for t,width,thickness in [(.0,.022,.017),(.22,.036,.012),(.50,.044,.013),(.76,.038,.014),(.94,.023,.011),(1,.002,.003)]:
  ring=[]
  for j in range(n):
   theta=-math.pi+2*math.pi*j/n;x=math.cos(theta)*width;depth=math.sin(theta)*thickness
   if depth<0:depth+=.010*(1-(x/width)**2)*math.sin(math.pi*t)
   ring.append(bm.verts.new((center.x+x+side*t*.017,center.y+depth+t*.006,center.z+t*.105)))
  for j in range(n):bm.faces.new((prev[j],prev[(j+1)%n],ring[(j+1)%n],ring[j]))
  prev=ring
 cap=bm.verts.new((center.x+side*.017,center.y+.006,center.z+.107))
 for j in range(n):bm.faces.new((prev[j],prev[(j+1)%n],cap))
 ear_records.append({'side':side,'sourceRootBoundaryVertices':n,'center':list(center),'newTopology':'six crown rings with cupped front and rounded terminal cap'})
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(body.data);bm.free();body.data.update()

bpy.context.view_layer.objects.active=body;body.select_set(True)
sub=body.modifiers.new('Source topology refinement','SUBSURF');sub.levels=1;sub.render_levels=1
bpy.ops.object.modifier_apply(modifier=sub.name)

# Local retopology removes the original hoof walls below the pastern. Bridge
# each source cut boundary into one lobed foot patch with a flat sole. The
# upper limbs, torso and head retain the deformed source mesh.
bm=bmesh.new();bm.from_mesh(body.data)
bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=(0,0,.128),plane_no=(0,0,1),clear_inner=True,clear_outer=False)
boundary=[e for e in bm.edges if e.is_boundary and all(abs(v.co.z-.128)<.0001 for v in e.verts)]
loops=[];unused=set(boundary)
while unused:
 edge=unused.pop();ring=[edge.verts[0],edge.verts[1]]
 while True:
  matches=[e for e in ring[-1].link_edges if e in unused]
  if not matches:break
  e=matches[0];unused.remove(e);n=e.other_vert(ring[-1])
  if n==ring[0]:break
  ring.append(n)
 loops.append(ring)
if len(loops)!=4:raise RuntimeError('Expected four source leg boundaries, got '+str(len(loops)))
foot_records=[]
for loop in loops:
 center=sum((v.co for v in loop),Vector())/len(loop);front=center.y<0;side=-1 if center.x<0 else 1
 loop=sorted(loop,key=lambda v:math.atan2(v.co.y-center.y,v.co.x-center.x))
 source_n=len(loop);n=source_n*3;prev=loop
 # Upper source boundary is preserved. New dense rings are attached through
 # its exact vertex order, with no disconnected toe components.
 for height,width,length,offset in [(.092,.060,.069,-.007),(.055,.083,.110,-.022),(.020,.086,.116,-.025),(.002,.082,.112,-.025)]:
  ring=[]
  for j in range(n):
   theta=-math.pi+2*math.pi*j/n;u=math.cos(theta);q=math.sin(theta)
   xx=u*width;yy=q*length+offset
   front_amount=1-smooth(-.87,-.2,q)
   cleft=math.exp(-((u-.36)/.13)**2)+math.exp(-((u+.36)/.13)**2)
   yy+=.038*cleft*front_amount*(1-smooth(.07,.11,height))
   # Terminal nail faces are restrained flat planes on the three main lobes.
   # Smooth transitions retain one watertight skin, avoiding separate toe balls.
   if height<.056 and q<-.4:
    for toe_u in [-.73,0,.73]:
     nail=1-smooth(.13,.24,abs(u-toe_u))
     plane=-.116 if toe_u==0 else -.092
     yy=lerp(yy,plane,nail*.88)
   if front:
    # Smaller fourth toe is on the outside, behind the three main digits.
    outer=smooth(.58,.96,u*side)*math.exp(-((q+.12)/.34)**2)
    xx+=side*.035*outer*(1-smooth(.055,.095,height))
   ring.append(bm.verts.new((center.x+xx,center.y+yy,height)))
  if len(prev)!=n:
   for j in range(source_n):
    nextj=(j+1)%source_n;start=j*3;end=((j+1)*3)%n
    bm.faces.new((prev[j],prev[nextj],ring[end]))
    for k in range(2,-1,-1):bm.faces.new((prev[j],ring[(start+k+1)%n],ring[(start+k)%n]))
  else:
   for j in range(n):
    k=(j+1)%n;bm.faces.new((prev[j],prev[k],ring[k],ring[j]))
  prev=ring
 sole=bm.verts.new((center.x,center.y-.02,.002))
 for j in range(n):bm.faces.new((prev[j],prev[(j+1)%n],sole))
 foot_records.append({'name':('fore' if front else 'hind')+('_left' if side<0 else '_right'),'boundaryVerticesPreserved':source_n,'newFootVertices':4*n+1,'center':list(center),'intendedDigits':4 if front else 3,'construction':'locally retopologized source pastern into one contiguous foot, lobed front contour with physical clefts, smaller outer fourth fore toe, flat sole','sourceMapping':'source cut boundary retained; newly authored vertices have no original vertex index'})
bmesh.ops.triangulate(bm,faces=list(bm.faces),quad_method='BEAUTY',ngon_method='EAR_CLIP')
bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=.0000001)
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(body.data);bm.free();body.data.update()

# Keep a separate mapped native rig for later authoring. Source weights in the
# complete body survive subdivision. No animation or skin readiness asserted.
bpy.context.view_layer.objects.active=arm
arm.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
for b in arm.data.edit_bones:
 orig=next(row for row in original_bones if row['name']==b.name)
 b.head=warp(Vector(orig['head']));b.tail=warp(Vector(orig['tail']))
bpy.ops.object.mode_set(mode='OBJECT');arm.matrix_world=Matrix.Identity(4)
arm.hide_render=True

# Original UVs and source body normal map retained. Coat is authored on the
# whole body; original horse albedo/mane texture is not pasted onto the tapir.
body.data.materials.clear()
mat=bpy.data.materials.new('Tapir short coat');mat.use_nodes=True
nodes=mat.node_tree.nodes;bs=nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.92
col=body.data.color_attributes.new(name='TapirCoat',type='FLOAT_COLOR',domain='POINT')
for v in body.data.vertices:
 x,y,h=v.co;f=-y
 front=.28+.08*smooth(.55,1.07,h)-.06*smooth(.15,.35,abs(x));rear=-.81+.09*(1-smooth(.56,1.06,h))
 saddle=smooth(rear-.018,rear+.022,f)*(1-smooth(front-.018,front+.022,f))*smooth(.38,.59,h)
 grain=.022*math.sin(x*213+y*187)*math.sin(h*233-y*119)
 shade=lerp(.028,.32,saddle)*(1+grain)
 # Keratin stays on the low terminal foreface, not a high horse hoof cuff.
 if h<.048:
  for foot in foot_records:
   cx,cy,_=foot['center']
   if abs(x-cx)<.135 and abs(y-cy)<.17 and y<cy-.075:shade*=.4
 col.data[v.index].color=(shade*.99,shade,shade*.94,1)
attribute=nodes.new('ShaderNodeVertexColor');attribute.layer_name='TapirCoat';mat.node_tree.links.new(attribute.outputs['Color'],bs.inputs['Base Color'])
normal=nodes.new('ShaderNodeTexImage');normal.image=bpy.data.images.load(str(SOURCE/'original/horse/HorseMain2k00Norm00.png'));normal.image.colorspace_settings.name='Non-Color'
nm=nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.055;mat.node_tree.links.new(normal.outputs['Color'],nm.inputs['Color']);mat.node_tree.links.new(nm.outputs['Normal'],bs.inputs['Normal']);body.data.materials.append(mat)
for name in ['Sphere','Sphere.002']:
 eye=bpy.data.objects[name];eye.data.materials.clear();em=bpy.data.materials.new(name+' tapir');em.diffuse_color=(.009,.012,.010,1);em.use_nodes=True;eb=em.node_tree.nodes.get('Principled BSDF');eb.inputs['Base Color'].default_value=(.009,.012,.010,1);eb.inputs['Roughness'].default_value=.40;eye.data.materials.append(em)
for o in bpy.data.objects:
 if o.type=='MESH':
  o.hide_render=False
  o.data.validate(clean_customdata=True);o.data.update()
  for p in o.data.polygons:p.use_smooth=True

bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'tapir-source-adapted.blend'))
bpy.ops.object.select_all(action='DESELECT')
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in meshes:o.select_set(True)
out=ROOT/'tapir-source-static.glb'
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_animations=False,export_skins=False,export_extras=True)
points=[o.matrix_world@v.co for o in meshes for v in o.data.vertices]
low=[min(p[i] for p in points) for i in range(3)];high=[max(p[i] for p in points) for i in range(3)]
source_low=[min(p[i] for p in original_points) for i in range(3)];source_high=[max(p[i] for p in original_points) for i in range(3)]
report={'status':'source-derived-static-proposal-not-visually-accepted','file':out.name,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'bytes':out.stat().st_size,'sourceSha256':original_hash,'sourceAuthor':'Lyndon Daniels','rigAuthor':'ChadM','license':'CC0-1.0','source':'https://opengameart.org/content/realtime-ranchers-3d-model-pack','nativeRigSource':'https://opengameart.org/content/rigged-horse','anatomyReference':'https://animals.sandiegozoo.org/animals/tapir','sourceBodyBoundsBlender':{'min':source_low,'max':source_high},'adaptedBoundsBlender':{'min':low,'max':high},'adaptedBoundsGltf':{'min':[low[0],low[2],-high[1]],'max':[high[0],high[2],-low[1]]},'bodyOriginalVertices':len(original_points),'bodyFinalVertices':len(body.data.vertices),'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes),'sourceVertexMap':'vertex-source-map.json','proportionMeasurements':{'sourceNormalizationMetersPerUnit':.2502531187886256,'sourceBodyDimensionsMeters':[(source_high[i]-source_low[i])*.2502531187886256 for i in range(3)],'adaptedDimensionsMeters':[high[i]-low[i] for i in range(3)],'boneLengths':[{'name':b['name'],'sourceMeters':(Vector(b['tail'])-Vector(b['head'])).length*.2502531187886256,'adaptedMeters':(warp(Vector(b['tail']))-warp(Vector(b['head']))).length} for b in original_bones]},'nativeRigBoneCount':len(original_bones),'animations':[],'skinsExported':False,'footForms':foot_records,'earForms':ear_records,'longitudinalMap':LONGITUDINAL,'heightMap':HEIGHT,'limitations':['CPU source proposal only; no production or art acceptance','Native rig retains missing Bone.005 group issue; no actions present','Mapped rig and preserved weights are authoring data, not a usable production rig','Digit clefts need close front/rear production views','Horse-origin body must prove tapir species identity before further rigging']}
report['proportionMeasurements']['boneLengthPhase']='Primary spatial warp only, before cranial shortening, nasal refinement, neck sculpt and local ear/foot retopology; not final fitted rig measurements.'
report['revision']='Shorter broader nasal bridge, upper nasal overhang, reduced eye radius and flattened primary nail fronts; preceding static revision preserved in revision-before-nasal-nails.'
report['regionalChanges']={'cranialReachScale':.81,'nasalBridgeReachScaleBeyond094m':.62,'nasalBridgeWidthScale':1.42,'nasalDepthScale':.53,'eyeScaleRelativeToFirstWarp':.34,'newEarTopology':True,'newFootTopology':True}
(ROOT/'candidate.json').write_text(json.dumps(report,indent=2))
if hashlib.sha256(BLEND.read_bytes()).hexdigest()!=original_hash:raise RuntimeError('Source changed')
print('RESULT',json.dumps(report))

# CPU-only source review snapshots. These do not replace production lab views.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=12
scene.render.resolution_x=640;scene.render.resolution_y=480;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('Tapir review world');scene.world.use_nodes=True;scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.65,.65,.65,1);scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.18;scene.view_settings.view_transform='Standard';scene.view_settings.exposure=0;scene.view_settings.gamma=1
for name,loc,energy,size in [('Key',(-3,-4,5),350,4),('Fill',(3,1,3),240,3)]:
 data=bpy.data.lights.new(name,'AREA');o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=loc;data.energy=energy;data.shape='DISK';data.size=size;o.rotation_euler=(Vector((0,0,.6))-o.location).to_track_quat('-Z','Y').to_euler()
camdata=bpy.data.cameras.new('ReviewCamera');cam=bpy.data.objects.new('ReviewCamera',camdata);scene.collection.objects.link(cam);scene.camera=cam;camdata.type='ORTHO';camdata.ortho_scale=3.1
for name,loc in [('side',(4,0,1.1)),('front',(0,-4,1)),('rear',(0,4,1)),('three-quarter',(3,-4,2.2))]:
 cam.location=loc;cam.rotation_euler=(Vector((0,-.1,.62))-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(ROOT/(name+'-cpu.png'));bpy.ops.render.render(write_still=True)

for name,target,loc,scale in [('head',Vector((0,-.98,1.03)),Vector((1.4,-2.5,1.25)),.95),('forefoot',Vector((-.246,-.425,.08)),Vector((-.246,-2,.30)),.40)]:
 camdata.ortho_scale=scale;cam.location=loc;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(ROOT/(name+'-cpu.png'));bpy.ops.render.render(write_still=True)
