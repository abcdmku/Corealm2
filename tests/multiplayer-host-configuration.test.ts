import {describe,it,expect} from 'vitest';
import {hostConfiguration} from '../game/src/multiplayer/hostConfiguration.js';
describe('reference deployment configuration',()=>{
 it('requires an explicit identity policy',()=>{
  expect(()=>hostConfiguration([],{})).toThrow(/authentication/);
  expect(()=>hostConfiguration(['--development-guests','--auth-module','auth.mjs'],{})).toThrow(/authentication/);
 });
 it('keeps development guests local and bounds admission',()=>{
  expect(hostConfiguration(['--development-guests'],{})).toMatchObject({host:'127.0.0.1',capacity:64,worldIds:['yard']});
  expect(()=>hostConfiguration(['--development-guests','--host','0.0.0.0'],{})).toThrow(/loopback/);
  expect(()=>hostConfiguration(['--development-guests','--capacity','1001'],{})).toThrow(/Capacity/);
 });
 it('requires encrypted public discovery and exact browser origins',()=>{
  const env={COREALM_AUTH_MODULE:'auth.mjs',COREALM_HOST:'0.0.0.0',COREALM_PUBLIC_ENDPOINT:'wss://game.example.com/',COREALM_ALLOWED_ORIGINS:'https://play.example.com'};
  expect(hostConfiguration(['--authored'],env)).toMatchObject({worldIds:['corealm'],allowedOrigins:['https://play.example.com']});
  expect(()=>hostConfiguration([], {...env,COREALM_ALLOWED_ORIGINS:'*'})).toThrow();
  expect(()=>hostConfiguration([], {...env,COREALM_PUBLIC_ENDPOINT:'ws://127.0.0.1:4180/'})).toThrow(/WSS/);
  expect(()=>hostConfiguration([], {...env,COREALM_ALLOWED_ORIGINS:''})).toThrow(/origins/);
  expect(()=>hostConfiguration(['--worlds','one,one'],env)).toThrow(/unique/);
 });
});
