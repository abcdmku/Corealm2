import * as THREE from "three";
import { isolateMagicEmission } from "./magicGlow.js";
import { elementalFlowTexture, flowSampling } from "./elementalFlowTexture.js";

/** Lit elemental matter: its surface carries the shape, with emission confined to hot or wet detail. */
export function createElementalMatterMaterial(
  element: "wind" | "water" | "fire",
  clock: { value: number },
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: element === "water" ? .3 : element === "wind" ? .8 : .65,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  material.defines = { ...material.defines, MATTER_KIND: element === "wind" ? 0 : element === "water" ? 1 : 2 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms["matterTime"] = clock;
    shader.uniforms["flowTexture"] = {value:elementalFlowTexture()};
    const varyings = `varying vec3 vBodySample,vBodyColour;varying float vBodyAlpha,vBodyAlong,vBodySeed;`;
    shader.vertexShader = `attribute vec4 curveA,curveB,curveC,curveD,bodyTint;uniform float matterTime;${varyings}\n${shader.vertexShader}`
      .replace("#include <beginnormal_vertex>", `
        float u=position.y,v=1.0-u;
        vec3 bodyPosition=v*v*v*curveA.xyz+3.0*v*v*u*curveB.xyz+3.0*v*u*u*curveC.xyz+u*u*u*curveD.xyz;
        vec3 tangent=normalize(3.0*v*v*(curveB.xyz-curveA.xyz)+6.0*v*u*(curveC.xyz-curveB.xyz)+3.0*u*u*(curveD.xyz-curveC.xyz));
        vec3 chord=normalize(curveD.xyz-curveA.xyz);vec3 reference=abs(chord.y)>.85?vec3(1,0,0):vec3(0,1,0);
        vec3 right=normalize(cross(tangent,reference)),up=cross(right,tangent);
        float envelope=pow(max(0.0,sin(u*3.14159265)),.65);
        float fold=1.0+.2*sin(u*23.0-matterTime*6.0+bodyTint.a)*sin(u*3.14159);
        bodyPosition+=(right*position.x+up*position.z*curveC.w)*curveB.w*envelope*fold;
        #if MATTER_KIND == 2
          float flicker=u*13.0-matterTime*7.0+bodyTint.a;
          bodyPosition+=(right*sin(flicker*.47)+up*cos(flicker*.61))*curveB.w*.42*envelope;
          bodyPosition+=(right*position.x+up*position.z)*sin(flicker+atan(position.z,position.x)*3.0)*curveB.w*.20*envelope;
        #endif
        vec3 objectNormal=normalize(right*position.x+up*position.z/max(.1,curveC.w));
        vBodySample=vec3(position.x,u*6.0,position.z);vBodyColour=bodyTint.rgb;vBodyAlpha=curveD.w;vBodyAlong=u;vBodySeed=bodyTint.a;
      `)
      .replace("#include <begin_vertex>", "vec3 transformed=bodyPosition;");
    shader.fragmentShader = `uniform float matterTime;${varyings}${flowSampling}
      float matterHash(vec3 p){p=fract(p*.3183099+.17);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
      float matterNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(matterHash(i),matterHash(i+vec3(1,0,0)),f.x),mix(matterHash(i+vec3(0,1,0)),matterHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(matterHash(i+vec3(0,0,1)),matterHash(i+vec3(1,0,1)),f.x),mix(matterHash(i+vec3(0,1,1)),matterHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
      ${shader.fragmentShader}`
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec3 flow=vBodySample*vec3(2.7,1.6,2.7)+vec3(vBodySeed,-matterTime*3.,0.);
        #if MATTER_KIND == 2
          flow=vBodySample*vec3(3.0,.9,3.0)+vec3(vBodySeed,-matterTime*3.8,0.);
          flow+=vec3(matterNoise(flow*.7),matterNoise(flow*.6+7.0),matterNoise(flow*.8+13.0))*1.7;
        #endif
        vec2 streamUv=vec2(atan(vBodySample.z,vBodySample.x)/6.2831853*2.0,vBodyAlong*1.4);
        float grain=authoredFlow(streamUv,matterTime*1.6,vBodySeed);
        float crest=smoothstep(.55,.75,grain);
        #if MATTER_KIND == 0
          diffuseColor.rgb=vBodyColour*(.5+grain*.5);
          diffuseColor.a=vBodyAlpha*smoothstep(.23,.56,grain)*.65;
        #elif MATTER_KIND == 1
          diffuseColor.rgb=mix(vec3(.016,.095,.12),vBodyColour*.7,crest*.8);
          diffuseColor.a=vBodyAlpha*(.7+grain*.3)*(1.0-smoothstep(.5,1.0,vBodyAlong)*(1.0-smoothstep(.3,.57,grain)));
        #else
          diffuseColor.rgb=mix(vec3(.13,.002,.001),vec3(.42,.025,.001),grain);
          float body=smoothstep(.025,.40,grain+(1.0-vBodyAlong)*.14);
          diffuseColor.a=vBodyAlpha*body*(1.0-smoothstep(.80,1.0,vBodyAlong));
        #endif
        if(diffuseColor.a<.008)discard;
      `)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        #if MATTER_KIND == 0
          totalEmissiveRadiance=vBodyColour*crest*.18;
        #elif MATTER_KIND == 1
          float current=pow(.5+.5*sin(grain*20.-matterTime*5.+vBodyAlong*11.),8.);
          totalEmissiveRadiance=vec3(.12,.66,.85)*crest*(.8+current*1.2);
        #else
          float heat=smoothstep(.1,.67,grain)*(1.0-smoothstep(.75,1.0,vBodyAlong));
          totalEmissiveRadiance=mix(vec3(.42,.009,.002),vec3(3.8,.42,.006),heat);
          totalEmissiveRadiance=mix(totalEmissiveRadiance,vec3(6.,2.4,.45),smoothstep(.58,.87,grain));
          totalEmissiveRadiance+=vec3(1.7,.52,.09)*pow(.5+.5*sin(grain*23.-matterTime*4.6+vBodyAlong*9.),9.)*heat;
        #endif
      `);
  };
  isolateMagicEmission(material);
  return material;
}
