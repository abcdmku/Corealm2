"""Sample newly authored Idle and repaired source-derived locomotion, CPU only."""
import bpy,os,sys,json,numpy as np
folder=os.path.dirname(os.path.abspath(__file__));sys.path.insert(0,folder)
from lynx_adaptation import adapt_cat
revision2='--v2' in sys.argv
if revision2:
    from actor_motion_v2 import ActorMotion
else:
    from actor_motion import ActorMotion
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=os.path.join(folder,'cat.historical-2017.original.fbx'),use_anim=True)
arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');body=bpy.data.objects['Cat']
for track in arm.animation_data.nla_tracks:track.mute=True
adapt_cat(body,arm,adapt_rest_rig=True,native_motion_rebake_authorized=True)
motion=ActorMotion(arm,body)
contactfile=os.path.join(folder,'lynx-gait-contact-audit.json')
if os.path.exists(contactfile):
    contacts=json.load(open(contactfile))
    # Explicit reviewed windows are installed here by the actor author.
bones=list(arm.data.bones);names=[b.name for b in bones];lookup={n:i for i,n in enumerate(names)}
vertices=np.array([list(v.co)+[1] for v in body.data.vertices]);weights=np.zeros((len(vertices),len(bones)))
for v in body.data.vertices:
    for g in v.groups:
        if body.vertex_groups[g.group].name in lookup:weights[v.index,lookup[body.vertex_groups[g.group].name]]=g.weight
weights/=weights.sum(axis=1,keepdims=True);rest=[b.matrix_local.inverted() for b in bones]
matrices=[];truth=[];samples=[];audits=[];random_only='--random' in sys.argv;dense='--dense' in sys.argv;rng=np.random.default_rng(260909)
for clip in ['Idle','Walk','Run']:
    duration=motion.duration[clip];last=1+duration*24
    variants=[('dense',np.linspace(0,duration,round(duration*192)+1))] if dense else ([('random',np.sort(rng.uniform(0,duration,23)))] if random_only else [('train',np.arange(1,last+.001)/24-1/24),('heldout',(np.arange(1,last)+.5)/24-1/24)])
    if dense and revision2 and clip!='Idle':
        events=[]
        for windows in motion.stance_windows[clip].values():
            for start,end in windows:
                for height in [.0045,.005,.0055,.006,.0065]:
                    lo,hi=0,.08
                    for _ in range(50):
                        middle=(lo+hi)/2;value=.1*(middle-.01*(1-np.exp(-middle/.01)))
                        if value<height:lo=middle
                        else:hi=middle
                    distance=(lo+hi)/2
                    events.extend([(start*duration-distance)%duration,(end*duration+distance)%duration])
                events.extend([(start*duration)%duration,(end*duration)%duration])
        variants=[('dense',np.unique(np.r_[variants[0][1],events]))]
    for split,times in variants:
        for time in times:
            value=motion.sample(clip,float(time));world=arm.matrix_world;local=world.inverted()@body.matrix_world
            matrix=np.array([np.asarray(world@arm.pose.bones[b.name].matrix@rest[i]@local)[:3,:]*.1 for i,b in enumerate(bones)])
            matrices.append(matrix);samples.append({'clip':clip,'frame':1+float(time)*24,'time':float(time),'split':split});audits.append(motion.last_audit)
            if not dense:truth.append(value*.1)
    print(json.dumps({'clip':clip,'samples':len(samples)}),flush=True)
matrices=np.array(matrices)
N=np.array([[1,0,0,0],[0,0,1,-motion.floor*.1],[0,-1,0,0],[0,0,0,1]],float)
if dense:
    source=np.load(os.path.join(folder,'lynx-bake-data.npz'));arrays={k:source[k] for k in source.files if k not in ['matrices','normalize']};arrays.update(matrices=matrices,normalize=N)
    arrays['restMatrices']=np.array([np.asarray(b.matrix_local) for b in bones])
    prefix='actor-bake-data';report=json.load(open(os.path.join(folder,'lynx-bake-data.json')));report.update(boneNames=names,samples=samples,actorMotion=True)
else:
    truth=np.array(truth);full=np.zeros_like(truth)
    for j in range(len(bones)):full+=np.einsum('tij,vj->tvi',matrices[:,j],vertices)*weights[:,j][None,:,None]
    error=np.linalg.norm(full-truth,axis=2)
    arrays={'vertices':vertices,'weights':weights,'matrices':matrices,'truth':truth,'train':np.array([s['split']=='train' for s in samples])}
    prefix='actor-weight-random-data' if random_only else 'actor-weight-fit-data'
    report={'boneNames':names,'samples':samples,'sourceReconstructionMaxMetres':float(error.max()),'sourceReconstructionMeanMetres':float(error.mean()),'actorMotion':True}
if revision2:prefix=prefix.replace('actor-','actor2-')
np.savez_compressed(os.path.join(folder,prefix+'.npz'),**arrays)
report.update(floorSourceUnits=motion.floor,normalization=N.tolist(),provenance='New3s neutral-rest Idle; adapted source Walk/Run with actual-sole IK correction. Original source archives and source-review GLBs remain unchanged.',contactAudit=audits)
json.dump(report,open(os.path.join(folder,prefix+'.json'),'w'),indent=2)
print(json.dumps({'file':prefix,'maxContactResidualMm':max(a['maxSoleErrorMm'] for a in audits),'sourceReconstructionMaxMetres':report.get('sourceReconstructionMaxMetres')}))
