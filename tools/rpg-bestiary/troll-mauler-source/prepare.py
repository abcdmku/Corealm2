"""CPU-only pinned original Troll Mauler preparation. Never writes the original blend."""
import bpy,json,hashlib,math
import numpy as np
from mathutils import Vector,Euler,Matrix
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
OUT=Path(__file__).resolve().parent/'derived'; OUT.mkdir(exist_ok=True)
REPORT=ROOT/'test-results/troll-mauler-source'; REPORT.mkdir(exist_ok=True)
source=ROOT/'test-results/coherent-humanoid-source-cache/troll-mauler.blend'
assert hashlib.sha256(source.read_bytes()).hexdigest()=='83fc5e524d31020d8b7c9641517f965cecd65840b3119582b4e984649f708c51'
bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False)
rig=bpy.data.objects['Armature']; rig.animation_data.use_nla=False; rig.animation_data.action=bpy.data.actions['ArmatureAction']; bpy.context.scene.frame_set(1)
def set_action(a):
 rig.animation_data.action=a
 if len(a.slots):rig.animation_data.action_slot=a.slots[0]
set_action(bpy.data.actions['ArmatureAction']);bpy.context.scene.frame_set(1)
bpy.context.view_layer.update()
for o in bpy.data.objects:
 if o.type=='MESH':
  print('SOURCE_OBJECT',o.name,'visible',o.visible_get(),'rotation',list(o.rotation_euler),'collections',[c.name for c in o.users_collection])
  ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get()); me=ev.to_mesh(); co=[ev.matrix_world@v.co for v in me.vertices]; print('WORLD_BOUNDS',o.name,[[min(v[i] for v in co) for i in range(3)],[max(v[i] for v in co) for i in range(3)]]); ev.to_mesh_clear()
meshes=[bpy.data.objects[n] for n in ['med','cloth','eye med']]
def sample():
 result={}
 for f in range(1,41):
  bpy.context.scene.frame_set(f); bpy.context.view_layer.update(); dg=bpy.context.evaluated_depsgraph_get()
  for o in meshes:
   ev=o.evaluated_get(dg); me=ev.to_mesh(); result[(f,o.name)]=[ev.matrix_world@v.co for v in me.vertices]; ev.to_mesh_clear()
 return result
original=sample(); reduction={}
original_weights={o.name:[[(g.group,g.weight) for g in v.groups] for v in o.data.vertices] for o in meshes}
for o in meshes:
 discarded=[]
 for v in o.data.vertices:
  weights=sorted([(g.group,g.weight) for g in v.groups if g.weight>0 and o.vertex_groups[g.group].name in rig.data.bones],key=lambda p:-p[1]); total=sum(w for _,w in weights); keep=weights[:4]; denom=sum(w for _,w in keep)
  discarded.append((total-denom)/total if total else 0)
  for g in o.vertex_groups: g.remove([v.index])
  for g,w in keep: o.vertex_groups[g].add([v.index],w/denom,'REPLACE')
 reduction[o.name]={'maxDiscardedWeightFraction':max(discarded),'meanDiscardedWeightFraction':sum(discarded)/len(discarded)}
reduced=sample()
for o in meshes:
 errors=[(v-w).length for f in range(1,41) for v,w in zip(original[(f,o.name)],reduced[(f,o.name)])]
 reduction[o.name].update(maxIdleWorldError=max(errors),rmsIdleWorldError=math.sqrt(sum(e*e for e in errors)/len(errors)))
(REPORT/'weight-reduction.json').write_text(json.dumps(reduction,indent=2)); print('WEIGHT_REDUCTION',reduction)
bindings=[]
for o in meshes:
 m=o.data.materials[0]; m.use_nodes=True; nodes=m.node_tree.nodes; nodes.clear(); out=nodes.new('ShaderNodeOutputMaterial'); bs=nodes.new('ShaderNodeBsdfPrincipled'); bs.inputs['Roughness'].default_value=.83; m.node_tree.links.new(bs.outputs['BSDF'],out.inputs['Surface'])
 images={'med':('troll_baseTexBaked.png','troll_normals.png','troll_occlusion.png'),'cloth':('cloth uv.png','cloth uv_NRM.png','cloth uv_OCC.png'),'eye med':('Material Diffuse Color',None,None)}[o.name]
 binding={'materialName':m.name,'flipY':False}
 for key,name in zip(['baseColorPath','normalPath','occlusionPath'],images):
  if not name: continue
  im=bpy.data.images[name]; filename={'baseColorPath':'base','normalPath':'normal','occlusionPath':'occlusion'}[key]; dest=OUT/(o.name.replace(' ','-')+'-'+filename+'.png'); im.filepath_raw=str(dest); im.file_format='PNG'; im.save(); binding[key]=str(dest)
  if key=='baseColorPath':
   tex=nodes.new('ShaderNodeTexImage'); tex.image=im; m.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
  elif key=='normalPath':
   im.colorspace_settings.name='Non-Color'; tex=nodes.new('ShaderNodeTexImage'); tex.image=im; normal=nodes.new('ShaderNodeNormalMap'); m.node_tree.links.new(tex.outputs['Color'],normal.inputs['Color']); m.node_tree.links.new(normal.outputs['Normal'],bs.inputs['Normal'])
 bindings.append(binding)
action=rig.animation_data.action; action.name='Idle'; action.use_fake_user=True
def move_world(name,offset):
 b=rig.pose.bones[name]; b.location=b.bone.matrix_local.to_quaternion().inverted()@Vector(offset)
def rotate(name,xyz): rig.pose.bones[name].rotation_quaternion=Euler(xyz,'XYZ').to_quaternion()
authored={}
for name,frames in [('Walk',48),('Run',36),('Attack',36),('Hit',16),('HitLeft',16),('HitRight',16),('Death',48)]:
 a=bpy.data.actions.new(name);a.use_fake_user=True;rig.animation_data.action=a
 for f in range(frames+1):
  p=f/frames
  for b in rig.pose.bones: b.matrix_basis=Matrix.Identity(4);b.rotation_mode='QUATERNION'
  if name in ['Walk','Run']:
   stride=.72 if name=='Walk' else 1.05; lift=.12 if name=='Walk' else .22
   for side,phase in [('L',p),('R',(p+.5)%1)]:
    phase%=1
    # Half-cycle planted travel, half-cycle returning swing; IK preserves original limbs.
    if phase<.5: forward=stride*(.5-2*phase); up=0
    else: t=(phase-.5)*2;forward=stride*(-.5+t);up=lift*math.sin(math.pi*t)
    move_world('foot_main.'+side,(0,-forward,up))
   move_world('Bone',(.035*math.sin(2*math.pi*p),-.025,-.025+.02*math.cos(4*math.pi*p)))
   rotate('Bone.002',(.045,0,.025*math.sin(2*math.pi*p)))
   rotate('arm.L',(.17*math.sin(2*math.pi*p),0,-.03));rotate('arm.R',(-.17*math.sin(2*math.pi*p),0,.03))
  elif name=='Attack':
   # Two-handed downward strike: gather, lift, contact at55%, then recover.
   def curve(knots):
    for (x,y),(xx,yy) in zip(knots,knots[1:]):
     if x<=p<=xx: t=(p-x)/(xx-x);t=t*t*(3-2*t);return y+(yy-y)*t
    return knots[-1][1]
   raise_amount=curve([(0,0),(.32,1),(.55,-.28),(.7,-.15),(1,0)])
   rotate('arm.L',(-.9*raise_amount,0,-.2*raise_amount));rotate('arm.R',(-.9*raise_amount,0,.2*raise_amount))
   rotate('forearm.L',(-.35*raise_amount,0,0));rotate('forearm.R',(-.35*raise_amount,0,0))
   rotate('Bone.002',(.17*raise_amount,0,0));move_world('Bone',(0,.06*raise_amount,-.06*abs(raise_amount)))
  elif name.startswith('Hit'):
   recoil=math.sin(math.pi*p)**2;side=-1 if name=='HitLeft' else 1 if name=='HitRight' else 0
   rotate('Bone.002',(-.14*recoil,.10*side*recoil,.10*side*recoil));move_world('Bone',(.05*side*recoil,.07*recoil,-.04*recoil))
  elif name=='Death':
   fall=max(0,min(1,(p-.15)/.7));fall=fall*fall*(3-2*fall)
   # Entire connected rig falls backward; adapter applies measured full-mesh floor correction.
   rotate('Bone.004',(-1.42*fall,0,.12*fall));move_world('Bone.004',(0,.5*fall,-.8*fall));rotate('arm.L',(.25*fall,0,0));rotate('arm.R',(.25*fall,0,0))
  for b in rig.pose.bones:
   b.keyframe_insert('location',frame=f,group=b.name);b.keyframe_insert('rotation_quaternion',frame=f,group=b.name);b.keyframe_insert('scale',frame=f,group=b.name)
 authored[name]={'frames':[0,frames],'fps':24,'provenance':'Corealm authored on original Troll Mauler bones; not a source motion','attackContactPhase':.55 if name=='Attack' else None}
# Compare original vs top-four weights under the same authored poses.
def authored_sample():
 result={}
 for name,entry in authored.items():
  set_action(bpy.data.actions[name])
  for f in range(0,entry['frames'][1]+1,3):
   bpy.context.scene.frame_set(f);bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
   for o in meshes:
    ev=o.evaluated_get(dg);me=ev.to_mesh();result[(name,f,o.name)]=[ev.matrix_world@v.co for v in me.vertices];ev.to_mesh_clear()
 return result
four=authored_sample()
reduced_weights={o.name:[[(g.group,g.weight) for g in v.groups] for v in o.data.vertices] for o in meshes}
def set_weights(weights):
 for o in meshes:
  for v,entries in zip(o.data.vertices,weights[o.name]):
   for g in o.vertex_groups:g.remove([v.index])
   for g,w in entries:o.vertex_groups[g].add([v.index],w,'REPLACE')
set_weights(original_weights);full=authored_sample();set_weights(reduced_weights)
# Export small CPU fit inputs, preserving existing source influences only.
fitposes=[];fitkeys=[]
for name in ['Idle',*authored]:
 set_action(bpy.data.actions[name])
 for f in range(1 if name=='Idle' else 0,41 if name=='Idle' else authored[name]['frames'][1]+1,3):
  bpy.context.scene.frame_set(f);bpy.context.view_layer.update()
  fitposes.append([np.array(rig.matrix_world@b.matrix@b.bone.matrix_local.inverted()@rig.matrix_world.inverted()).tolist() for b in rig.pose.bones]);fitkeys.append([name,f])
fitdata={'matrices':fitposes,'poses':fitkeys,'bones':[b.name for b in rig.pose.bones],'meshes':[]}
for o in meshes:
 fitdata['meshes'].append({'name':o.name,'positions':[list(o.matrix_world@v.co) for v in o.data.vertices],'weights':[[[fitdata['bones'].index(o.vertex_groups[g].name),w] for g,w in entries if o.vertex_groups[g].name in fitdata['bones']] for entries in original_weights[o.name]]})
(REPORT/'fit-input.json').write_text(json.dumps(fitdata,separators=(',',':')))
if (REPORT/'refit-weights.json').exists():
 fitted=json.loads((REPORT/'refit-weights.json').read_text());converted={}
 for o in meshes:
  converted[o.name]=[[(o.vertex_groups[fitdata['bones'][g]].index,w) for g,w in entries] for entries in fitted[o.name]]
 set_weights(converted);four=authored_sample()
errors={}
for name in authored:
 vals=[(v-w).length for key in four if key[0]==name for v,w in zip(four[key],full[key])]
 errors[name]={'maxWorldError':max(vals),'rmsWorldError':math.sqrt(sum(x*x for x in vals)/len(vals)),'byMesh':{o.name:max((v-w).length for key in four if key[0]==name and key[2]==o.name for v,w in zip(four[key],full[key])) for o in meshes}}
(REPORT/'authored-weight-reduction.json').write_text(json.dumps(errors,indent=2))
set_action(action);bpy.context.scene.frame_set(1)
fitted_idle=sample()
for o in meshes:
 errs=[(v-w).length for f in range(1,41) for v,w in zip(original[(f,o.name)],fitted_idle[(f,o.name)])]
 reduction[o.name]['fittedMaxIdleWorldError']=max(errs)
bpy.ops.object.select_all(action='DESELECT')
for o in [rig,*meshes]: o.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(OUT/'troll-mauler.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=True,export_frame_range=False,export_skins=True,export_all_influences=False,export_yup=True)
(OUT/'source.json').write_text(json.dumps({'sourceUrl':'https://opengameart.org/content/troll-mauler','author':'piacenti','license':'CC-BY-3.0','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'textureBindings':bindings,'weightReduction':reduction,'authoredWeightReduction':errors,'authoredClips':authored,'nativeClips':{'Idle':'ArmatureAction frames 1–40 at 24 fps; CPU inferred idle/breathing'}},indent=2))
