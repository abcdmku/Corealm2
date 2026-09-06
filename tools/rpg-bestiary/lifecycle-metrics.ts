/** Only adjacent living samples count as natural movement evidence. */
export function lifecycleMetrics(trace: any[]) {
  let movedMetres=0, movingTurnRadians=0, inPlaceTurnRadians=0;
  const advancing=new Set<string>(),motions=new Set<string>();
  const eligible=(s:any)=>!['setup','respawn-wait','respawn-rendered'].includes(s.stage)
    && !/^capture-(idle|respawn)-/.test(s.stage)
    && s.lab?.target?.health>0 && s.lab.target.state!=='dead' && s.motion?.motion!=='death';
  for(const s of trace)if(eligible(s))motions.add(s.lab.target.motion?.motion);
  for(let i=1;i<trace.length;i++){
    const a=trace[i-1],b=trace[i];
    if(!eligible(a)||!eligible(b)||b.at-a.at>700||b.at<=a.at||a.lab.target.entityId!==b.lab.target.entityId)continue;
    const pa=a.lab.target.position,pb=b.lab.target.position;
    const d=Math.hypot(pb[0]-pa[0],pb[2]-pa[2]);movedMetres+=d;
    if(!a.motion||!b.motion)continue;
    const turn=Math.abs(Math.atan2(Math.sin(b.motion.semanticRotationY-a.motion.semanticRotationY),Math.cos(b.motion.semanticRotationY-a.motion.semanticRotationY)));
    if(d>.0001){movingTurnRadians+=turn;if(a.motion.clip===b.motion.clip&&Math.abs(a.motion.time-b.motion.time)>.001)advancing.add(b.motion.motion);}
    else inPlaceTurnRadians+=turn;
  }
  return {movedMetres,movingTurnRadians,inPlaceTurnRadians,turnRadians:movingTurnRadians+inPlaceTurnRadians,advancing:[...advancing],motions:[...motions]};
}
