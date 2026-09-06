"""Bounded four-native-influence nonnegative normalized pose fit; never alters topology."""
import json,itertools,time
from pathlib import Path
import numpy as np
from scipy.optimize import nnls,minimize
root=Path(__file__).resolve().parents[3]/'test-results/troll-mauler-source'
d=json.loads((root/'fit-input.json').read_text());mat=np.array(d['matrices']);out={};stats=[];start=time.time()
for mesh in d['meshes']:
 result=[]
 for index,(pos,weights) in enumerate(zip(mesh['positions'],mesh['weights'])):
  positive=[(g,w) for g,w in weights if w>0];ids=[g for g,w in positive];ww=np.array([w for g,w in positive]);ww/=ww.sum()
  if len(ids)<=4:result.append(list(zip(ids,ww.tolist())));continue
  samples=np.einsum('tbij,j->tbi',mat[:,ids],np.r_[pos,1])[:,:,:3];target=np.einsum('tbi,b->ti',samples,ww)
  center=target.mean(0);a=(samples-center).transpose(0,2,1).reshape((-1,len(ids)));b=(target-center).reshape(-1)
  gram=a.T@a;rhs=a.T@b;comb=np.array(list(itertools.combinations(range(len(ids)),4)))
  gs=gram[comb[:,:,None],comb[:,None,:]]+10000;rs=rhs[comb]+10000
  # Candidate ranking via batched equality-penalized solves; exact NNLS refits finalists.
  sol=np.linalg.solve(gs+np.eye(4)[None]*1e-8,rs[...,None])[...,0];sol=np.maximum(sol,0);sol/=np.maximum(sol.sum(1,keepdims=True),1e-12)
  score=np.einsum('bi,bij,bj->b',sol,gs-10000,sol)-2*np.einsum('bi,bi->b',sol,rhs[comb])
  candidates=np.argsort(score)[:min(24,len(comb))];best=None
  for choice in candidates:
   sub=comb[choice];aa=np.vstack([a[:,sub],np.ones(4)*100]);bb=np.r_[b,100];w,_=nnls(aa,bb);w/=w.sum()
   err=np.linalg.norm((a[:,sub]@w-b).reshape((-1,3)),axis=1);cost=max(err)+.25*np.sqrt(np.mean(err**2))
   if best is None or cost<best[0]:best=(cost,sub,w,float(max(err)))
  if best[3]>.012:
   for choice in candidates[:8]:
    sub=comb[choice];ap=a[:,sub].reshape((-1,3,4));bp=b.reshape((-1,3));w=sol[choice]
    def constraints(x):return x[4]-np.sum((ap@x[:4]-bp)**2,axis=1)
    opt=minimize(lambda x:x[4],np.r_[w,max(np.sum((ap@w-bp)**2,axis=1))],method='SLSQP',bounds=[(0,1)]*4+[(0,None)],constraints=[{'type':'eq','fun':lambda x:sum(x[:4])-1},{'type':'ineq','fun':constraints}],options={'maxiter':70,'ftol':1e-11})
    w=np.maximum(opt.x[:4],0);w/=w.sum();err=np.linalg.norm(ap@w-bp,axis=1);cost=max(err)+.25*np.sqrt(np.mean(err**2))
    if cost<best[0]:best=(cost,sub,w,float(max(err)))
  _,sub,w,maximum=best;result.append([[ids[j],float(v)] for j,v in zip(sub,w)]);stats.append(maximum)
 out[mesh['name']]=result;print(mesh['name'],'done',round(time.time()-start,2),flush=True)
(root/'refit-weights.json').write_text(json.dumps(out,separators=(',',':')))
(root/'refit-summary.json').write_text(json.dumps({'method':'Enumerate native four-influence subsets; rank constrained least-squares candidates, exact NNLS top24; normalize; choose minimum worst-pose error + .25 RMS. No new bones or vertices.','poses':len(mat),'refitVertices':len(stats),'maxFitError':max(stats),'elapsedSeconds':time.time()-start},indent=2))
print('maxFitError',max(stats),flush=True)
