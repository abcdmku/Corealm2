import bpy,json,pathlib
out=pathlib.Path(r'C:/Users/Borg/Documents/GitHub/Corealm2/art/rebuild/candidates/finish-quadrupeds/source-porcupine')
bpy.ops.wm.open_mainfile(filepath=str(out/'cdmir-rat-original.blend'),load_ui=False,use_scripts=False)
a=bpy.data.objects['Armature'];r={}
for p in a.pose.bones:
 if 'Leg' not in p.name:continue
 r[p.name]={'parent':p.parent.name if p.parent else None,'head':list(p.bone.head_local),'tail':list(p.bone.tail_local),'rotationMode':p.rotation_mode,'constraints':[]}
 for c in p.constraints:
  d={'name':c.name,'type':c.type,'influence':c.influence}
  for field in ['target','subtarget','pole_target','pole_subtarget','chain_count','use_tail','use_stretch','pole_angle','owner_space','target_space','use_x','use_y','use_z','mix_mode']:
   if hasattr(c,field):
    v=getattr(c,field);d[field]=v.name if hasattr(v,'name') else v
  r[p.name]['constraints'].append(d)
(out/'contact-rig-inventory.json').write_text(json.dumps(r,indent=2))
print(json.dumps(r))
