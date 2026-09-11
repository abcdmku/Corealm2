export const DRAGON_DESIGNS = [
  {id:'baby_red_dragon',lineage:'DragonTerrorBringer',palette:'Red',baby:true,scale:.25,tempo:.76,
    description:'A red hatchling with a broad brow, blunt crown horns, short tail and developing wing fingers. It plants its rear claws and snaps its whole chest into a quick bite.'},
  {id:'baby_black_dragon',lineage:'DragonUsurper',palette:'Dark',baby:true,scale:.25,tempo:.78,
    description:'A black hatchling with a round throat, short hooked muzzle and broad small wing membranes. Its low four-legged stalk ends in a forward jaw strike.'},
  {id:'baby_lava_dragon',lineage:'DragonSoulEater',palette:'Red',baby:true,scale:.32,tempo:.79,lava:true,
    description:'A stocky volcanic hatchling with a plated throat, shortened tail and small folded wings. Molten fissures run between basalt scales across its ribs and wing roots.'},
  {id:'red_wilderness_dragon',lineage:'DragonTerrorBringer',palette:'Red',baby:false,scale:.59,tempo:1.12,
    description:'A tall red wyvern with a spear-shaped skull, hooked wing claws and a long blade tail. It braces on its powerful rear legs and drives its neck through a heavy strike.'},
  {id:'black_wilderness_dragon',lineage:'DragonUsurper',palette:'Dark',baby:false,scale:.51,tempo:1.12,
    description:'A black four-legged dragon with a long low neck, backward crown horns and broad sail wings. Its slow stalk gives way to an extended snapping lunge.'},
  {id:'purple_wilderness_dragon',lineage:'DragonSoulEater',palette:'purple',baby:false,scale:.75,tempo:1.08,arcane:true,
    description:'A deep violet dragon with a shielded throat, swept wing shoulders and a heavy horned skull. Blue-violet fissures run through its living scale plates and breathe with its folded wings.'},
];

export const SOURCE_CLIPS = {
  DragonTerrorBringer: {Idle:'idle01',Walk:'walk',Run:'Run',Attack:'Basic Attack',Hit:'GetHit',Death:'die',Breath:'Flame Attack'},
  DragonUsurper: {Idle:'idle01',Walk:'Walk',Run:'Run',Attack:'attackMouth',Hit:'getHit',Death:'Die',Breath:'attackFlame'},
  DragonSoulEater: {Idle:'Idle',Walk:'Walk',Run:'Run',Attack:'Basic Attack',Hit:'Get Hit',Death:'Die',Breath:'Fireball Shoot'},
};
