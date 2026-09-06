import os
os.environ['OPENBLAS_NUM_THREADS']='1'
import numpy as np,json,itertools,time
folder=os.path.dirname(os.path.abspath(__file__))
data=np.load(os.path.join(folder,'weight-fit-data.npz'));meta=json.load(open(os.path.join(folder,'weight-fit-data.json')))
vertices=data['vertices'];original=data['weights'];matrices=data['matrices'];truth=data['truth'];train=data['train'];names=meta['boneNames']
fitted=np.zeros_like(original);cache={};start=time.time()
def combinations(n,k):
    key=(n,k)
    if key not in cache:cache[key]=np.array(list(itertools.combinations(range(n),k)),dtype=np.int64)
    return cache[key]
for vi,(vertex,old) in enumerate(zip(vertices,original)):
    joints=np.flatnonzero(old>0)
    if len(joints)<=4:fitted[vi]=old;continue
    transformed=np.einsum('tkij,j->tki',matrices[train][:,joints],vertex)
    delta=transformed-truth[train,vi,None,:];A=delta.transpose(0,2,1).reshape((-1,len(joints)));G=A.T@A/len(A)
    best=float('inf');best_weights=None;best_indices=None
    for k in range(1,5):
        choices=combinations(len(joints),k)
        gram=G[choices[:,:,None],choices[:,None,:]]
        # Full enumeration of simplex faces finds the best convex <=4 support
        # among original nonzero joints. Tiny diagonal handles equal motions.
        regular=gram+np.eye(k)[None,:,:]*1e-14
        solved=np.linalg.solve(regular,np.ones((len(choices),k,1)))[:,:,0]
        denominator=solved.sum(axis=1);w=solved/denominator[:,None]
        valid=(w.min(axis=1)>=-1e-8)&np.isfinite(w).all(axis=1)
        costs=np.einsum('ni,nij,nj->n',w,gram,w);costs[~valid]=np.inf
        idx=int(np.argmin(costs))
        if costs[idx]<best:
            best=float(costs[idx]);best_weights=np.maximum(w[idx],0);best_weights/=best_weights.sum();best_indices=joints[choices[idx]]
    if best_weights is None:raise RuntimeError('No feasible support')
    fitted[vi,best_indices]=best_weights
    if vi%2000==0:print(json.dumps({'vertex':vi,'elapsed':round(time.time()-start,1)}),flush=True)
np.savez_compressed(os.path.join(folder,'fitted-four-weights.npz'),weights=fitted)
# Full, held-out reconstruction uses every matrix and never trains on these
# fractional frames. Native source deformation remains the target.
prediction=np.zeros_like(truth)
for j in range(len(names)):
    prediction+=np.einsum('tij,vj->tvi',matrices[:,j],vertices)*fitted[:,j][None,:,None]
errors=np.linalg.norm(prediction-truth,axis=2)
np.savez_compressed(os.path.join(folder,'baseline-fit-errors.npz'),errors=errors)
def metrics(e):
    return {'samples':int(e.size),'rmsMetres':float(np.sqrt(np.mean(e*e))),'p95Metres':float(np.quantile(e,.95)),'p99Metres':float(np.quantile(e,.99)),'maxMetres':float(np.max(e))}
dominant=np.argmax(original,axis=1)
regions=[]
for ji in dominant:
    name=names[ji].lower()
    regions.append('tail' if name.startswith('tail') else 'head' if any(s in name for s in ['head','mouth','nose','ear']) else 'paws' if any(s in name for s in ['foot','toe']) else 'limbs' if any(s in name for s in ['calf','thigh','shoulder','knee']) else 'body')
regions=np.array(regions)
report={'method':'Exact enumeration of all 1–4 original-joint subsets; equality-constrained nonnegative least squares per subset. Fits source integer animation keys only; fractional midframes held out. Original data and clips unchanged.',
    'vertexCount':len(vertices),'sourceSamples':len(train),'trainingFrames':int(train.sum()),'heldoutFrames':int((~train).sum()),'displayScale':.1,'elapsedSeconds':time.time()-start,
    'maxInfluences':int((fitted>0).sum(axis=1).max()),'maxWeightSumError':float(np.abs(fitted.sum(axis=1)-1).max()),
    'train':metrics(errors[train]),'heldout':metrics(errors[~train]),'regions':{},'perClip':{},'worstVertices':[],'accepted':False}
for region in np.unique(regions):
    mask=regions==region
    report['regions'][region]={'vertices':int(mask.sum()),'train':metrics(errors[train][:,mask]),'heldout':metrics(errors[~train][:,mask])}
for clip in sorted(set(s['clip'] for s in meta['samples'])):
    mask=np.array([s['clip']==clip for s in meta['samples']]);report['perClip'][clip]={'train':metrics(errors[train&mask]),'heldout':metrics(errors[(~train)&mask])}
for vi in np.argsort(errors.max(axis=0))[-25:][::-1]:
    frame=int(errors[:,vi].argmax());report['worstVertices'].append({'vertex':int(vi),'region':str(regions[vi]),'sourcePosition':vertices[vi,:3].tolist(),'errorMetres':float(errors[frame,vi]),'frame':meta['samples'][frame],
        'original':{names[j]:float(original[vi,j]) for j in np.flatnonzero(original[vi]>0)},'fitted':{names[j]:float(fitted[vi,j]) for j in np.flatnonzero(fitted[vi]>0)}})
with open(os.path.join(folder,'weight-fit-report.json'),'w') as f:json.dump(report,f,indent=2)
print(json.dumps({k:v for k,v in report.items() if k not in ['worstVertices']}),flush=True)
