"""Read the final GLB bytes and implement glTF LINEAR TRS interpolation on CPU."""
import os,json,struct,sys,numpy as np
from scipy.spatial.transform import Rotation,Slerp
folder=os.path.dirname(os.path.abspath(__file__));actor2='--actor2' in sys.argv;actor='--actor' in sys.argv or actor2;lynx='--lynx' in sys.argv or actor;lead='actor2-' if actor2 else ('actor-' if actor else ('lynx-' if lynx else ''))
raw=open(os.path.join(folder,'Lynx.actor-contact-v2.glb' if actor2 else ('Lynx.actor-baked.glb' if actor else ('Lynx.adapted-baked.glb' if lynx else 'Cat.corrected-baked.glb'))),'rb').read();jl=struct.unpack_from('<I',raw,12)[0];g=json.loads(raw[20:20+jl]);binary=raw[28+jl:]
def read(i):
    a=g['accessors'][i];bv=g['bufferViews'][a['bufferView']];size={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
    return np.frombuffer(binary,dtype={5126:np.float32,5123:np.uint16,5125:np.uint32}[a['componentType']],count=a['count']*size,offset=bv.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,size).astype(float)
animations={}
inverseBind=read(g['skins'][0]['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1)
for a in g['animations']:
    animations[a['name']]=[(c['target']['node'],c['target']['path'],read(a['samplers'][c['sampler']]['input'])[:,0],read(a['samplers'][c['sampler']]['output'])) for c in a['channels']]
parents={child:i for i,n in enumerate(g['nodes']) for child in n.get('children',[])}
def matrices(clip,time):
    values=[{'translation':n.get('translation',[0,0,0]),'rotation':n.get('rotation',[0,0,0,1]),'scale':n.get('scale',[1,1,1])} for n in g['nodes']]
    for ni,path,times,frames in animations[clip]:
        time2=np.clip(time,times[0],times[-1]);right=min(int(np.searchsorted(times,time2,side='right')),len(times)-1);left=max(0,right-1)
        ratio=0 if right==left else float((time2-times[left])/(times[right]-times[left]))
        if path=='rotation':
            q=frames[left];r=frames[right].copy()
            if np.dot(q,r)<0:r=-r
            dot=np.clip(np.dot(q,r),-1,1)
            if dot>.9995:result=(1-ratio)*q+ratio*r;result/=np.linalg.norm(result)
            else:
                angle=np.arccos(dot);result=(np.sin((1-ratio)*angle)*q+np.sin(ratio*angle)*r)/np.sin(angle)
        else:result=(1-ratio)*frames[left]+ratio*frames[right]
        values[ni][path]=result
    local=[]
    for v in values:
        mat=np.eye(4);mat[:3,:3]=Rotation.from_quat(v['rotation']).as_matrix()*v['scale'];mat[:3,3]=v['translation'];local.append(mat)
    world={}
    def visit(i):
        if i not in world:world[i]=(visit(parents[i])@local[i]) if i in parents else local[i]
        return world[i]
    return np.array([visit(j) for j in g['skins'][0]['joints']])@inverseBind
bake=np.load(os.path.join(folder,lead+'bake-data.npz'));N=bake['normalize'];ids=bake['Cat_cornerIds'];_,first=np.unique(ids,return_index=True)
attr=g['meshes'][0]['primitives'][0]['attributes'];p=np.c_[read(attr['POSITION'])[first],np.ones(len(first))];joint=read(attr['JOINTS_0'])[first].astype(int);w=read(attr['WEIGHTS_0'])[first];normal=read(attr['NORMAL'])[first]
fitmeta=json.load(open(os.path.join(folder,'weight-fit-data.json')));sourceweights=np.load(os.path.join(folder,'weight-fit-data.npz'))['weights'];names=fitmeta['boneNames'];dominant=sourceweights.argmax(axis=1)
regions=np.array(['tail' if names[j].lower().startswith('tail') else 'head' if any(x in names[j].lower() for x in ['head','mouth','nose','ear']) else 'paws' if any(x in names[j].lower() for x in ['foot','toe']) else 'limbs' if any(x in names[j].lower() for x in ['calf','thigh','shoulder','knee']) else 'body' for j in dominant])
def stats(x):return {'rmsMm':float(np.sqrt(np.mean(x*x))*1000),'p95Mm':float(np.quantile(x,.95)*1000),'p99Mm':float(np.quantile(x,.99)*1000),'maxMm':float(x.max()*1000),'samples':int(x.size)}
allerr=[];allangles=[];splits=[];samples=[];seams={};probes=[];contactRows=[];solePositions=[]
feet=json.load(open(os.path.join(folder,'lynx-gait-contact-audit.json')))['feet'] if actor else {}
soleIndices=np.unique(np.concatenate([f['soleVertexIndices'] for f in feet.values()])) if actor else []
for prefix in ['weight-fit-data','weight-random-data']:
    data=np.load(os.path.join(folder,lead+prefix+'.npz'));meta=json.load(open(os.path.join(folder,lead+prefix+'.json')))
    truthFrames=data['truth'];sourceMatrices=data['matrices']
    for ti,sample in enumerate(meta['samples']):
        clip=sample['clip'] if actor else ('Walk' if sample['clip'].endswith('|Walk') else 'Run');time=(sample['frame']-1)/24;skin=matrices(clip,time)
        blended=(skin[joint]*w[:,:,None,None]).sum(axis=1)
        pred=np.einsum('vij,vj->vi',blended,p)[:,:3]
        if ti in ([0,20,40,60,100,160,210] if actor else [0,20,40]):
            select=np.unique(np.r_[np.arange(0,len(p),499),7987,13069]);probes.append({'clip':clip,'time':time,'indices':first[select].tolist(),'positions':pred[select].tolist()})
        truth=truthFrames[ti]@N[:3,:3].T+N[:3,3]
        err=np.linalg.norm(pred-truth,axis=1)
        if actor:
            solePositions.append(pred[soleIndices].astype(np.float32))
            contactRows.append({'clip':clip,'time':time,'split':sample['split'],'wholeMinY':float(pred[:,1].min()),'feet':{name:{'minimumY':float(pred[info['vertexIndices'],1].min()),'center':np.median(pred[info['soleVertexIndices']],axis=0).tolist(),'support':meta['contactAudit'][ti]['support'][name.replace('hind','back')]} for name,info in feet.items()}})
        src=sourceMatrices[ti];srcN=np.einsum('ij,kjl->kil',N[:3,:3],src[:,:,:3]);full=np.einsum('vj,jkl->vkl',sourceweights,srcN)
        normal_actual=np.einsum('vij,vj->vi',blended[:,:3,:3],normal);normal_full=np.einsum('vij,vj->vi',full,normal)
        normal_actual/=np.maximum(np.linalg.norm(normal_actual,axis=1,keepdims=True),1e-12);normal_full/=np.maximum(np.linalg.norm(normal_full,axis=1,keepdims=True),1e-12)
        angles=np.degrees(np.arccos(np.clip(np.einsum('vi,vi->v',normal_actual,normal_full),-1,1)))
        allerr.append(err);allangles.append(angles);splits.append(sample['split']);samples.append(sample)
        if sample['split']=='train' and (abs(sample['frame']-1)<1e-5 or abs(sample['frame']-{'Idle':73,'Walk':28,'Run':15}[clip])<1e-5):
            seams.setdefault(clip,[]).append((pred,truth))
allerr=np.array(allerr);allangles=np.array(allangles);splits=np.array(splits)
report={'method':'Final GLB accessors and LINEAR quaternion/TRS interpolation, multiplied through actual joint pairs. Compared with full Blender-evaluated source at .1 scale after removing scene placement. No GPU proof.','verticesPerPose':len(p),'frameCount':len(allerr),'regions':{},'splits':{},'normals':{},'seams':{},'accepted':False}
for split in ['train','heldout','random']:
    mask=splits==split;report['splits'][split]={'frames':int(mask.sum()),**stats(allerr[mask])};a=allangles[mask]
    report['normals'][split]={'p95Degrees':float(np.quantile(a,.95)),'p99Degrees':float(np.quantile(a,.99)),'maxDegrees':float(a.max()),'method':'First exported corner normal per source vertex; standard weighted linear skin-normal response compared with full weights. Does not replace surface-normal/hardware shading review.'}
for region in np.unique(regions):report['regions'][region]={split:stats(allerr[splits==split][:,regions==region]) for split in ['train','heldout','random']}
for clip,pairs in seams.items():
    (p0,t0),(p1,t1)=pairs;report['seams'][clip]={'sourceEndpointDifference':stats(np.linalg.norm(t1-t0,axis=1)),'convertedEndpointDifference':stats(np.linalg.norm(p1-p0,axis=1)),'addedSeamError':stats(np.linalg.norm((p1-p0)-(t1-t0),axis=1))}
index=np.unravel_index(allerr.argmax(),allerr.shape);report['worst']={'sample':samples[index[0]],'vertex':int(index[1]),'region':str(regions[index[1]]),'mm':float(allerr[index]*1000)}
report['comparisonTarget']='Full Blender evaluated newly authored Idle and source-derived IK-repaired Walk/Run on adapted rig' if actor else ('Full Blender evaluated adapted rest rig and body; intentionally different from original Cat anatomy/motion' if lynx else 'Full original Blender native rig')
json.dump(report,open(os.path.join(folder,lead+'baked-interpolation-report.json'),'w'),indent=2);np.savez_compressed(os.path.join(folder,lead+'baked-validation-errors.npz'),errors=allerr,normalDegrees=allangles)
json.dump(probes,open(os.path.join(folder,lead+'baked-three-probes.json'),'w'))
if actor:
    json.dump({'frames':contactRows,'method':'Final GLB interpolated weighted paw surfaces; Y-up, forward+Z, sole center uses fixed lowest20% rest-paw vertex set. Wholemesh minima included.'},open(os.path.join(folder,lead+'final-contact-audit.json'),'w'),indent=2)
    np.savez_compressed(os.path.join(folder,lead+'final-sole-positions.npz'),positions=np.array(solePositions),indices=soleIndices)
print(json.dumps({k:v for k,v in report.items() if k not in ['regions','seams']}))
