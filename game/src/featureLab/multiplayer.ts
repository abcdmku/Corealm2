import {installBrowserSession,type BrowserSessionPorts} from "../multiplayer/browserSession.js";

export function installMultiplayerLab(ports:BrowserSessionPorts):Promise<void>{return installBrowserSession(ports,{fixture:true,crowds:true,equipment:true});}
