export function sculptSpider(Sculpture){
  const s=new Sculpture('hollowroot_spider');s.body=s.bone('cephalothorax',[0,.58,.26]);s.head=s.bone('eye_mound',[0,.60,.48],s.body);s.abdomen=s.bone('abdomen',[0,.66,-.37],s.body);
  s.materials.shell.roughness=.64;s.materials.shellAlt.roughness=.72;s.materials.horn.roughness=.64;
  const TAU=Math.PI*2;
  // The ventral flattening is a smooth oval deformation. A piecewise scale at
  // the equator leaves a visible crease even with a dense triangulation.
  const oval=(material,bone,center,radius,{sides=48,rings=34,taper=0,flatten=0,relief=()=>0}={})=>s.surface(material,bone,(u,v)=>{
    const angle=u*TAU,axial=Math.cos(Math.PI*v),span=Math.sin(Math.PI*v),vertical=Math.sin(angle);
    const x=center[0]+Math.cos(angle)*span*radius[0]*(1+taper*axial);
    const z=center[2]+axial*radius[2];
    const y=center[1]+radius[1]*span*((1-flatten*.5)*vertical+flatten*.5*vertical*vertical);
    return [x,y+relief(x,z)*Math.max(0,vertical)**4*span,z];
  },sides,rings);
  oval('joint',s.body,[0,.515,.17],[.285,.14,.375],{sides:36,rings:26,flatten:.3,taper:.1});
  oval('shellAlt',s.body,[0,.61,.21],[.327,.22,.37],{sides:56,rings:40,flatten:.55,taper:.05,relief:(x,z)=>{
    const fovea=-.009*Math.exp(-((x/.033)**2+((z-.18)/.085)**2));
    const furrow=-.004*Math.exp(-(((Math.abs(x)-(.052+Math.abs(z-.18)*.45))/.026)**2))*Math.exp(-(((z-.18)/.22)**2));
    return fovea+furrow;
  }});
  oval('joint',s.abdomen,[0,.61,-.19],[.17,.13,.28],{sides:32,rings:26});
  // A single soft abdomen with shallow dorsal attachment dimples. No radial
  // corrugation, raised bands, or separate pieces break its silhouette.
  oval('shell',s.abdomen,[0,.72,-.59],[.438,.37,.60],{sides:72,rings:54,taper:.10,flatten:.23,relief:(x,z)=>{
    const anterior=Math.exp(-(((Math.abs(x)-.125)/.040)**2+((z+.36)/.062)**2));
    const posterior=Math.exp(-(((Math.abs(x)-.15)/.045)**2+((z+.62)/.072)**2));
    return -.006*anterior-.004*posterior;
  }});
  for(const side of [-1,1]){
    const hips=[[side*.25,.58,.43],[side*.29,.56,.27],[side*.28,.545,.075],[side*.22,.56,-.08]];
    const knees=[[side*.75,.69,.82],[side*.93,.63,.48],[side*.91,.63,-.20],[side*.69,.69,-.68]];
    const feet=[[side*.88,.055,1.14],[side*1.20,.055,.55],[side*1.17,.055,-.40],[side*.89,.055,-1.01]];
    for(let i=0;i<4;i++){
      s.leg(`leg_${side<0?'L':'R'}_${i+1}`,hips[i],knees[i],feet[i],{phase:(i%2)*.5+(side<0?0:.5),width:.059+(i===0?.006:0),spurs:1,toe:.105});
    }
    const jaw=s.bone(`chelicera_${side<0?'L':'R'}`,[side*.102,.525,.53],s.head);s.jaws.push({bone:jaw,side});
    s.tube('horn',jaw,[[side*.105,.548,.514],[side*.102,.517,.574],[side*.116,.466,.635],[side*.110,.424,.663]],[.043,.040,.031,.025],{sides:18,steps:24,flute:.008,ellipse:.72});
    s.tube('horn',jaw,[[side*.110,.426,.659],[side*.124,.373,.694],[side*.075,.341,.725],[side*.025,.375,.735]],[.026,.023,.011,0],{sides:16,steps:24,flute:0,ellipse:.76});
    const palp=s.bone(`pedipalp_${side}`,[side*.22,.55,.47],s.head),tip=s.bone(`pedipalp_tip_${side}`,[side*.30,.39,.74],palp);
    s.tube('shellAlt',palp,[[side*.21,.55,.46],[side*.275,.504,.60],[side*.30,.39,.74]],[.025,.021,.017],{sides:14,steps:22,flute:.01});
    s.tube('horn',tip,[[side*.30,.396,.732],[side*.274,.34,.775],[side*.231,.297,.806]],[.018,.013,0],{sides:14,steps:18,flute:0});
    s.feelers.push({a:palp,b:tip,side});
  }
  oval('shellAlt',s.head,[0,.699,.48],[.20,.073,.105],{sides:40,rings:28,flatten:.25});
  const eyes=[[-.039,.739,.562,.021],[.039,.739,.562,.021],[-.12,.737,.54,.016],[.12,.737,.54,.016],[-.070,.762,.496,.015],[.070,.762,.496,.015],[-.17,.733,.482,.014],[.17,.733,.482,.014]];
  for(const [x,y,z,r] of eyes)s.egg('eye',s.head,[x,y,z],[r,r*.62,r*.67],{sides:20,rings:16});
  for(const side of [-1,1]){
    const spinner=s.bone(`spinneret_${side}`,[side*.095,.50,-1.075],s.abdomen);s.bodyParts.push({bone:spinner,phase:side});
    s.tube('horn',spinner,[[side*.09,.50,-1.065],[side*.10,.47,-1.17],[side*.09,.465,-1.235]],[.040,.028,0],{sides:14,steps:18,flute:.025});
  }
  // UV seams need duplicate vertices, but those vertices share a native
  // geometric normal. Average both seam rings and coincident pole vertices.
  for(const geometries of s.parts.values())for(const geometry of geometries){
    const position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),groups=new Map();
    for(let i=0;i<position.count;i++){
      const key=[position.getX(i),position.getY(i),position.getZ(i)].map(value=>Math.round(value*1e6)).join(',');
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);
    }
    for(const vertices of groups.values()){
      if(vertices.length<2)continue;
      let x=0,y=0,z=0;
      for(const i of vertices){x+=normal.getX(i);y+=normal.getY(i);z+=normal.getZ(i);}
      const length=Math.hypot(x,y,z);
      if(length>1e-8)for(const i of vertices)normal.setXYZ(i,x/length,y/length,z/length);
    }
    normal.needsUpdate=true;
  }
  return s.finish();
}
