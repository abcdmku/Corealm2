import type {SemanticEntity,Vec3} from "../contracts.js";

export const REMOTE_PLAYER_DRAW_DISTANCE = 32;
export const MAX_VISIBLE_REMOTE_PLAYERS = 256;

/** Presentation budget only. The session retains every authoritative interest update. */
export function visibleRemotePlayers(players:Iterable<SemanticEntity>,origin:Vec3):SemanticEntity[] {
  const candidates=[];
  for(const player of players){
    const distance=(player.position[0]-origin[0])**2+(player.position[2]-origin[2])**2;
    if(distance<=REMOTE_PLAYER_DRAW_DISTANCE**2)candidates.push({player,distance});
  }
  candidates.sort((a,b)=>a.distance-b.distance||(a.player.id<b.player.id?-1:a.player.id>b.player.id?1:0));
  return candidates.slice(0,MAX_VISIBLE_REMOTE_PLAYERS).map(candidate=>candidate.player);
}
