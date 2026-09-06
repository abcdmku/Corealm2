import os,json,numpy as np
folder=os.path.dirname(os.path.abspath(__file__))
r=json.load(open(os.path.join(folder,'actor-final-contact-audit.json')));frames=r['frames'];raw=np.load(os.path.join(folder,'actor-final-sole-positions.npz'));positions=raw['positions'];indices=raw['indices']
feet=json.load(open(os.path.join(folder,'lynx-gait-contact-audit.json')))['feet'];report={'accepted':False,'coordinateSystem':'Metres, Y-up, forward+Z','method':'Final GLB weighted sole vertices at298 integer/midpoint/random poses. Contact pairs require authored support at both endpoints; physical sole samples additionally require <=2mm floor clearance at both endpoints. World stance slip adds unchanged authored source-space movement speed to per-vertex pose velocity.','clips':{}}
def summary(values):
    a=np.array(values);return None if not len(a) else {'samples':int(len(a)),'median':float(np.median(a)),'p95':float(np.quantile(a,.95)),'max':float(a.max()),'min':float(a.min())}
for clip,speed in [('Idle',0),('Walk',.65),('Run',2.2)]:
    ids=sorted([i for i,f in enumerate(frames) if f['clip']==clip],key=lambda i:frames[i]['time']);row={'sourceSpaceSpeedTargetMps':speed,'wholeMeshMinY':min(frames[i]['wholeMinY'] for i in ids),'feet':{}}
    for name,foot in feet.items():
        select=np.flatnonzero(np.isin(indices,foot['soleVertexIndices']));backward=[];slip=[];vertical=[];contactheight=[]
        for i,j in zip(ids[:-1],ids[1:]):
            a,b=frames[i],frames[j];dt=b['time']-a['time']
            if dt<1e-6 or dt>.08 or not(a['feet'][name]['support'] and b['feet'][name]['support']):continue
            va=np.array(a['feet'][name]['center']);vb=np.array(b['feet'][name]['center']);backward.append(float(-(vb[2]-va[2])/dt))
            pa,pb=positions[i,select],positions[j,select];contact=(pa[:,1]<.002)&(pb[:,1]<.002)
            if contact.any():
                velocity=(pb[contact]-pa[contact])/dt;velocity[:,2]+=speed;slip.extend(np.linalg.norm(velocity[:,[0,2]],axis=1).tolist());vertical.extend(np.abs(velocity[:,1]).tolist())
            contactheight.extend([a['feet'][name]['minimumY'],b['feet'][name]['minimumY']])
        row['feet'][name]={'stanceCenterBackwardMps':summary(backward),'actualContactVertexWorldHorizontalSlipMps':summary(slip),'actualContactVertexVerticalSpeedMps':summary(vertical),'stanceMinimumY':summary(contactheight)}
    report['clips'][clip]=row
json.dump(report,open(os.path.join(folder,'actor-contact-report.json'),'w'),indent=2)
print(json.dumps(report))
