import json,itertools
from pathlib import Path
import numpy as np
from scipy.optimize import nnls
p=Path('tools/rpg-bestiary/beetle-golem-source/derived/source.json');s=json.loads(p.read_text());mat=np.array(json.loads(Path('test-results/beetle-golem-source/skin-matrices.json').read_text())).reshape((-1,29,4,4)).transpose(0,1,3,2)
m=s['meshes'][0];cache={};changed=0
for i,w in enumerate(m['fullWeights']):
 if len(w)<=4:continue
 pos=m['positions'][i*3:i*3+3];key=str(pos)+str(w)
 if key not in cache:
  ids=[x[0] for x in w];weights=np.array([x[1] for x in w]);samples=np.einsum('tbij,j->tbi',mat[:,ids],np.array(pos+[1]))[:,:,:3];target=np.einsum('tbi,b->ti',samples,weights);origin=target.mean(0);a=(samples-origin[None,None,:]).transpose(0,2,1).reshape((-1,len(ids)));b=(target-origin).reshape(-1);best=None
  for subset in itertools.combinations(range(len(ids)),4):
   aa=np.vstack([a[:,subset],np.ones(4)*100]);bb=np.r_[b,100];ww,_=nnls(aa,bb);ww/=ww.sum();error=np.linalg.norm((a[:,subset]@ww-b).reshape((-1,3)),axis=1);score=np.max(error)+np.sqrt(np.mean(error**2))*.25
   if best is None or score<best[0]:best=(score,[ids[j] for j in subset],ww.tolist())
  cache[key]=best;changed+=1
 _,indices,weights=cache[key];m['skinIndices'][i*4:i*4+4]=indices;m['skinWeights'][i*4:i*4+4]=weights
s['weightReduction']['method']='Select four of native influences and nonnegative refit across 102 poses of six native runtime clips, minimizing maximum positional error plus 0.25 RMS; no new joints';s['weightReduction']['refitVertices']=changed
p.write_text(json.dumps(s,separators=(',',':')));print('refit',changed)
