import bpy,os,sys,json,numpy as np
folder=os.path.dirname(os.path.abspath(__file__));sys.path.insert(0,folder)
from lynx_adaptation import adapt_cat
from actor_motion import ActorMotion
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=os.path.join(folder,'cat.historical-2017.original.fbx'),use_anim=True)
arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');body=bpy.data.objects['Cat']
for t in arm.animation_data.nla_tracks:t.mute=True
adapt_cat(body,arm,adapt_rest_rig=True,native_motion_rebake_authorized=True)
motion=ActorMotion(arm,body);rows=[]
for clip in ['Idle','Walk','Run']:
    for phase in [0,.125,.25,.375,.5,.625,.75,.875,1]:
        values=motion.sample(clip,phase*motion.duration[clip]);rows.append({**motion.last_audit,'bounds':[values.min(0).tolist(),values.max(0).tolist()]})
json.dump({'footVertices':{n:int(c['mask'].sum()) for n,c in motion.contacts.items()},'frames':rows,'scope':'Prototype vertical IK correction; phase/stride repair pending audited windows.'},open(os.path.join(folder,'actor-motion-ik-prototype.json'),'w'),indent=2)
print(json.dumps({'maxSoleErrorMm':max(r['maxSoleErrorMm'] for r in rows),'frames':len(rows),'footVertices':{n:int(c['mask'].sum()) for n,c in motion.contacts.items()}}))
