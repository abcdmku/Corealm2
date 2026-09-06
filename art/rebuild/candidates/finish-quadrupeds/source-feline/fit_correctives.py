import os
os.environ['OPENBLAS_NUM_THREADS']='1'
import numpy as np,json,itertools,time,sys
from scipy.cluster.vq import kmeans2
folder=os.path.dirname(os.path.abspath(__file__));actor2='--actor2' in sys.argv;actor='--actor' in sys.argv or actor2;lynx='--lynx' in sys.argv or actor
dataset='actor2-weight-fit-data' if actor2 else ('actor-weight-fit-data' if actor else ('lynx-weight-fit-data' if lynx else 'weight-fit-data'))
d=np.load(os.path.join(folder,dataset+'.npz'));meta=json.load(open(os.path.join(folder,dataset+'.json')))
v=d['vertices'];old=d['weights'];m=d['matrices'];truth=d['truth'];train=d['train'];names=meta['boneNames']
baseline=np.load(os.path.join(folder,'fitted-four-weights.npz'))['weights'];errors=np.load(os.path.join(folder,'baseline-fit-errors.npz'))['errors']
dominant=np.argmax(old,axis=1)
regions=np.array(['tail' if names[j].lower().startswith('tail') else 'head' if any(x in names[j].lower() for x in ['head','mouth','nose','ear']) else 'paws' if any(x in names[j].lower() for x in ['foot','toe']) else 'limbs' if any(x in names[j].lower() for x in ['calf','thigh','shoulder','knee']) else 'body' for j in dominant])
helpers=[];helperRegions=[]
chains='--chains' in sys.argv
if lynx:
    helpers=list(np.load(os.path.join(folder,'anchor-corrective-fit.npz'))['helpers']);helperRegions=['source_shared_patch_'+str(i) for i in range(len(helpers))]
elif chains:
    groups=[('spine',10,[i for i,n in enumerate(names) if n.startswith('Spine') or n=='Hip']),
        ('neck',4,[i for i,n in enumerate(names) if n.startswith(('Head','Neck','Mouth','Nose','Ear'))]),
        ('tail',4,[i for i,n in enumerate(names) if n.startswith('Tail')])]
    for side in ['L','R']:
        for limb in ['front','back']:
            selected=[i for i,n in enumerate(names) if n in [f'Thigh_{limb}_{side}',f'Thigh_{limb.title()}_{side}',f'Calf_{limb}_{side}',f'Calf_{limb.title()}_{side}',f'Knee_{limb}_IK_{side}',f'Shoulder_{limb}_{side}']]
            groups.append((limb+'_'+side,4,selected))
    for region,count,ids in groups:
        component=old[:,ids];total=component.sum(axis=1);mask=(total>.01)&((old>0).sum(axis=1)>4)
        normalized=component[mask]/total[mask,None]
        centers,_=kmeans2(normalized,min(count,len(normalized)),iter=40,minit='++',seed=131)
        for center in centers:
            row=np.zeros(len(names));row[ids]=center/center.sum();helpers.append(row);helperRegions.append(region)
else:
    for region,count in [('body',12),('limbs',8),('head',4),('tail',4)]:
        mask=(regions==region)&(errors[train].max(axis=0)>.001)
        centers,_=kmeans2(old[mask],count,iter=30,minit='++',seed=121)
        for row in centers:helpers.append(row/row.sum());helperRegions.append(region)
anchors='--anchors' in sys.argv
if anchors:
    previous=np.load(os.path.join(folder,'anchor-corrective-fit.npz' if '--refine' in sys.argv else 'corrective-fit.npz'))
    if '--refine' in sys.argv:
        helpers=list(previous['helpers']);helperRegions=['shared_patch_'+str(i) for i in range(len(helpers))]
    worst=previous['errors'][train].max(axis=0)
    # A bounded shared patch dictionary; no per-vertex joints.
    distances=np.min(np.linalg.norm(old[:,None,:]-np.array(helpers)[None,:,:],axis=2),axis=1)
    for step in range(24):
        score=worst*np.minimum(distances/.15,1)
        vi=int(score.argmax());helpers.append(old[vi].copy());helperRegions.append('anchor_'+str(vi))
        distances=np.minimum(distances,np.linalg.norm(old-old[vi],axis=1))
helpers=np.array(helpers);hm=np.einsum('hj,tjik->thik',helpers,m)
allm=np.concatenate([m,hm],axis=1);fit=np.zeros((len(v),len(names)+len(helpers)));fit[:,:len(names)]=baseline
cache={};start=time.time()
def choices(n,k):
    if (n,k) not in cache:cache[n,k]=np.array(list(itertools.combinations(range(n),k)),dtype=np.int64)
    return cache[n,k]
for vi,vertex in enumerate(v):
    if (old[vi]>0).sum()<=4:continue
    if chains:
        nearest=[]
        for label in set(helperRegions):
            which=np.array([i for i,r in enumerate(helperRegions) if r==label]);mask=helpers[which].sum(axis=0)>0;total=old[vi,mask].sum()
            if total>.01:
                target=np.zeros(len(names));target[mask]=old[vi,mask]/total
                nearest.extend((which[np.argsort(np.linalg.norm(helpers[which]-target,axis=1))[:2]]+len(names)).tolist())
        nearest=np.array(nearest,dtype=np.int64)
    else:nearest=np.argsort(np.linalg.norm(helpers-old[vi],axis=1))[:5]+len(names)
    joints=np.r_[np.flatnonzero(old[vi]>0),nearest]
    delta=np.einsum('tkij,j->tki',allm[train][:,joints],vertex)-truth[train,vi,None,:]
    A=delta.transpose(0,2,1).reshape((-1,len(joints)));G=A.T@A/len(A)
    best=float('inf')
    for k in range(1,5):
        combo=choices(len(joints),k);gram=G[combo[:,:,None],combo[:,None,:]]
        solve=np.linalg.solve(gram+np.eye(k)[None,:,:]*1e-14,np.ones((len(combo),k,1)))[:,:,0]
        w=solve/solve.sum(axis=1)[:,None];valid=(w.min(axis=1)>=-1e-8)&np.isfinite(w).all(axis=1)
        costs=np.einsum('ni,nij,nj->n',w,gram,w);costs[~valid]=np.inf;index=int(costs.argmin())
        if costs[index]<best:best=float(costs[index]);weights=np.maximum(w[index],0);weights/=weights.sum();ids=joints[combo[index]]
    fit[vi]=0;fit[vi,ids]=weights
    if vi%2000==0:print(json.dumps({'vertex':vi,'elapsed':time.time()-start}),flush=True)
pred=np.zeros_like(truth)
for j in range(allm.shape[1]):pred+=np.einsum('tij,vj->tvi',allm[:,j],v)*fit[:,j][None,:,None]
err=np.linalg.norm(pred-truth,axis=2)
def stats(x):return {'rmsMm':float(np.sqrt(np.mean(x*x))*1000),'p95Mm':float(np.quantile(x,.95)*1000),'p99Mm':float(np.quantile(x,.99)*1000),'maxMm':float(x.max()*1000),'samples':int(x.size)}
report={'prototype':('Anatomical chain mixture helpers' if chains else str(len(helpers))+' shared region/patch mixture helpers')+'. Each helper can be represented by two standard TRS joints; animated decomposition is a separate pending proof.',
    'helperCount':len(helpers),'actualJointIncreaseIfTwoTRS':len(helpers)*2,'trainingFrames':int(train.sum()),'heldoutFrames':int((~train).sum()),'train':stats(err[train]),'heldout':stats(err[~train]),'regions':{},'maxInfluences':int((fit>0).sum(axis=1).max()),'renderableValidated':False}
for region in np.unique(regions):report['regions'][region]={'vertices':int((regions==region).sum()),'train':stats(err[train][:,regions==region]),'heldout':stats(err[~train][:,regions==region])}
report['helperLabels']=helperRegions
prefix='actor-corrective-fit' if actor else ('lynx-corrective-fit' if lynx else ('anchor-corrective-fit' if anchors else ('chain-corrective-fit' if chains else 'corrective-fit')))
if actor2:prefix='actor2-corrective-fit'
np.savez_compressed(os.path.join(folder,prefix+'.npz'),weights=fit,helpers=helpers,helperMatrices=hm,errors=err)
with open(os.path.join(folder,prefix+'-report.json'),'w') as f:json.dump(report,f,indent=2)
print(json.dumps(report),flush=True)
