import * as THREE from "three";
import { elementalRefractionFragment, refractionUniforms } from "./elementalRefraction.js";

/** Refracting streams and splashes use the same curved spatial geometry as their attack path. */
export function createElementalLiquidMaterial(clock: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: refractionUniforms(clock,true,15),
    transparent:true,depthWrite:false,side:THREE.FrontSide,toneMapped:false,
    vertexShader:`attribute vec4 curveA,curveB,curveC,curveD,bodyTint;uniform float time;
      varying vec3 vRefNormal,vRefView,vRefLocal;varying float vRefAlpha,vRefSeed;
      void main(){float u=position.y,v=1.0-u;
        vec3 p=v*v*v*curveA.xyz+3.0*v*v*u*curveB.xyz+3.0*v*u*u*curveC.xyz+u*u*u*curveD.xyz;
        vec3 tangent=normalize(3.0*v*v*(curveB.xyz-curveA.xyz)+6.0*v*u*(curveC.xyz-curveB.xyz)+3.0*u*u*(curveD.xyz-curveC.xyz));
        vec3 chord=normalize(curveD.xyz-curveA.xyz),ref=abs(chord.y)>.85?vec3(1,0,0):vec3(0,1,0);
        vec3 right=normalize(cross(tangent,ref)),up=cross(right,tangent);
        float envelope=pow(max(0.0,sin(u*3.14159)),.5);
        float phase=u*18.0-time*7.0+bodyTint.a;
        float swell=1.0+.17*sin(phase)+.08*sin(phase*2.3);
        p+=(right*position.x+up*position.z*curveC.w)*curveB.w*envelope*swell;
        p+=right*sin(phase*.43)*curveB.w*.24*envelope;
        vec4 view=modelViewMatrix*vec4(p,1.0);
        vRefNormal=normalize(normalMatrix*(right*(position.x+sin(phase)*.2)+up*position.z/max(.1,curveC.w)));
        vRefView=-view.xyz;vRefLocal=vec3(position.x,u,position.z);vRefAlpha=curveD.w;vRefSeed=bodyTint.a;
        gl_Position=projectionMatrix*view;}`,
    fragmentShader:elementalRefractionFragment,
  });
}
