import {EventBus} from "../core/events.js";
import type {Vec3,GameCommand,CommandOutcome} from "../contracts.js";
import type {GameState} from "../state/store.js";
import type {DirectInput,Movement} from "../systems/movement.js";

/** Predicts only the local drawn pose. Replicated reads and all gameplay outcomes remain authoritative. */
export class MovementPrediction {
  private readonly events=new EventBus();
  private readonly movement:Movement;
  private state:GameState|null=null;
  private lastUpdate=0;
  private lastFrame=0;
  private simMs=0;
  private held:DirectInput={forward:0,strafe:0,cameraYaw:0};
  private correction:Vec3=[0,0,0];
  private facingCorrection=0;
  private pathKey="";
  private pending:{token:number;command:GameCommand;sequence:number|null}|null=null;
  private commandToken=0;
  /** Start a visual-only path on input, before the network round trip. */
  command(command:GameCommand):number|null{
    if(command.method==="steer"&&(command.args[0]!==0||command.args[1]!==0))this.pending=null;
    if(!this.state||(command.method!=="moveTo"&&command.method!=="stop"))return null;
    if(command.method==="moveTo"&&!("position" in command.args[0])){this.pending=null;return null;}
    const token=++this.commandToken;
    this.pending={token,command,sequence:null};this.applyPending();return token;
  }
  acknowledge(token:number|null,outcome:CommandOutcome):void{
    if(token===null||this.pending?.token!==token)return;
    if(outcome.status==="accepted")this.pending.sequence=outcome.sequence;
    else this.pending=null;
  }
  cancel(token:number|null):void{if(token!==null&&this.pending?.token===token)this.pending=null;}
  private applyPending():void{
    if(!this.state||!this.pending)return;
    const command=this.pending.command;
    if(command.method==="moveTo"&&"position" in command.args[0])this.movement.startPath(this.state,command.args[0].position,null,this.simMs);
    else if(command.method==="stop")this.movement.stop(this.state,this.simMs);
  }
  constructor(source:Movement){this.movement=source.createPrediction(this.events);}
  input(value:DirectInput):void{this.held={...value};this.movement.setDirectInput(this.held);}
  reconcile(state:GameState,now:number,simMs:number,acknowledgedCommand=0):void{
    // Preserve the pose actually on screen, including the remaining correction.
    // Using the raw predicted state here caused a fresh snap on every server tick.
    const drawn=this.sample(now),prior=drawn?.position,next=state.player.position;
    const movement=state.player.movement;
    const pathKey=JSON.stringify([movement.mode,movement.path,movement.destination,movement.destinationEntityId]);
    if(this.state&&pathKey!==this.pathKey)this.movement.replaceIntent(this.state,simMs,true);
    this.pathKey=pathKey;
    this.correction=prior&&Math.hypot(prior[0]-next[0],prior[1]-next[1],prior[2]-next[2])<1.5
      ?[prior[0]-next[0],prior[1]-next[1],prior[2]-next[2]]:[0,0,0];
    const close=prior&&Math.hypot(prior[0]-next[0],prior[1]-next[1],prior[2]-next[2])<1.5;
    const turn=drawn ? drawn.facingRad-state.player.facingRad : 0;
    this.facingCorrection=close ? Math.atan2(Math.sin(turn),Math.cos(turn)) : 0;
    // Prediction writes only the player. Keep inventory, quests and the world out of the
    // 10 Hz clone path; the prediction movement has no reward or shortcut callbacks.
    this.state={...state,player:structuredClone(state.player)};this.lastUpdate=this.lastFrame=now;this.simMs=simMs;
    if(this.pending?.sequence!==null&&this.pending?.sequence!==undefined&&acknowledgedCommand>=this.pending.sequence)this.pending=null;
    this.applyPending();
    this.movement.setDirectInput(this.held);
  }
  private paused=false;private timeScale=1;
  /** Debug time control. A paused world predicts no movement, and a scaled one predicts at the scale. */
  setPace(paused:boolean,timeScale:number):void{this.paused=paused;this.timeScale=timeScale;}
  sample(now:number):{position:Vec3;facingRad:number}|null{
    if(!this.state)return null;
    const delta=this.paused?0:Math.max(0,Math.min(50,now-this.lastFrame))*this.timeScale;this.lastFrame=now;
    if(now-this.lastUpdate<=250){
      for (let elapsed = 0; elapsed < delta;) {
        const step = Math.min(20, delta - elapsed);
        this.movement.update(this.state, step, this.simMs); this.simMs += step; elapsed += step;
      }
      this.events.flush();
    }
    const point=this.state.player.position,weight=Math.exp(-(now-this.lastUpdate)/150);
    return {position:[point[0]+this.correction[0]*weight,point[1]+this.correction[1]*weight,point[2]+this.correction[2]*weight],facingRad:this.state.player.facingRad+this.facingCorrection*weight};
  }
  clear():void{this.state=null;this.pending=null;this.pathKey="";this.correction=[0,0,0];this.facingCorrection=0;this.input({forward:0,strafe:0,cameraYaw:0});}
}
