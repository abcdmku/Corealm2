import {describe,it,expect} from 'vitest';
import {hostConfiguration} from '../game/src/multiplayer/hostConfiguration.js';
/** Tests never touch disk: every case supplies its own reader. */
const files=(entries:Record<string,unknown>)=>(path:string)=>path in entries?JSON.stringify(entries[path]):undefined;
const none=()=>undefined;
const guestFile={developmentGuests:true};
describe('reference deployment configuration',()=>{
 it('requires exactly one way to authenticate players',()=>{
  expect(()=>hostConfiguration([],{},none)).toThrow(/exactly one way to authenticate/);
  expect(()=>hostConfiguration(['--development-guests','--auth-module','auth.mjs'],{},none)).toThrow(/exactly one way to authenticate/);
  expect(()=>hostConfiguration(['--guests','--identity-url','https://identity.example.com/'],{},none)).toThrow(/exactly one way to authenticate/);
  expect(()=>hostConfiguration(['--auth-module','auth.mjs'],{COREALM_IDENTITY_URL:'https://identity.example.com/'},none)).toThrow(/exactly one way to authenticate/);
 });
 it('names the authentication each source selects',()=>{
  expect(hostConfiguration(['--identity-url','https://identity.example.com'],{},none))
   .toMatchObject({authentication:'account',identityUrl:'https://identity.example.com/',guests:false,developmentGuests:false});
  expect(hostConfiguration(['--development-guests'],{},none)).toMatchObject({authentication:'guest',guests:false,developmentGuests:true});
  expect(hostConfiguration([],{},files({'corealm-server.json':{guests:true}}))).toMatchObject({authentication:'guest',guests:true,developmentGuests:false});
  expect(hostConfiguration(['--auth-module','auth.mjs'],{},none)).toMatchObject({authentication:'module',authModule:'auth.mjs'});
 });
 it('lets an owner open guests to a network but never development guests',()=>{
  const remote=['--host','0.0.0.0','--public-endpoint','wss://lan.example.com/','--origins','https://play.example.com'];
  expect(hostConfiguration(['--guests',...remote],{},none)).toMatchObject({authentication:'guest',host:'0.0.0.0'});
  expect(()=>hostConfiguration(['--development-guests',...remote],{},none)).toThrow(/loopback/);
  expect(()=>hostConfiguration(['--guests','--development-guests',...remote],{},none)).toThrow(/loopback/);
 });
 it('keeps development guests local and bounds admission',()=>{
  expect(hostConfiguration(['--development-guests'],{},none)).toMatchObject({host:'127.0.0.1',
   worlds:[{id:'yard',name:'yard',seed:1337,capacity:64}],configFile:null});
  expect(hostConfiguration(['--development-guests','--authored'],{},none).worlds)
   .toEqual([{id:'corealm',name:'Corealm',seed:1337,capacity:64}]);
  expect(()=>hostConfiguration(['--development-guests','--host','0.0.0.0'],{},none)).toThrow(/loopback/);
  expect(()=>hostConfiguration(['--development-guests','--capacity','1001'],{},none)).toThrow(/Capacity/);
 });
 it('requires encrypted public discovery and exact browser origins',()=>{
  const env={COREALM_AUTH_MODULE:'auth.mjs',COREALM_HOST:'0.0.0.0',COREALM_PUBLIC_ENDPOINT:'wss://game.example.com/',COREALM_ALLOWED_ORIGINS:'https://play.example.com'};
  expect(hostConfiguration(['--authored'],env,none)).toMatchObject({worlds:[{id:'corealm',name:'Corealm',seed:1337,capacity:64}],
   allowedOrigins:['https://play.example.com']});
  expect(()=>hostConfiguration([],{...env,COREALM_ALLOWED_ORIGINS:'*'},none)).toThrow();
  expect(()=>hostConfiguration([],{...env,COREALM_PUBLIC_ENDPOINT:'ws://127.0.0.1:4180/'},none)).toThrow(/WSS/);
  expect(()=>hostConfiguration([],{...env,COREALM_ALLOWED_ORIGINS:''},none)).toThrow(/origins/);
  expect(()=>hostConfiguration(['--worlds','one,one'],env,none)).toThrow(/unique/);
 });
 it('reads corealm-server.json from the working directory when it exists',()=>{
  const read=files({'corealm-server.json':{port:4200,data:'./data',assetBaseUrl:'https://cdn.example.com/corealm',
   identityUrl:'https://identity.example.com/',worlds:[{id:'one',name:'One',seed:7,capacity:12},{id:'two'}]}});
  expect(hostConfiguration([],{},read)).toEqual({authored:false,authentication:'account',developmentGuests:false,guests:false,host:'127.0.0.1',port:4200,
   data:'./data',publicEndpoint:'ws://127.0.0.1:4200/',allowedOrigins:[],
   assetBaseUrl:'https://cdn.example.com/corealm/',identityUrl:'https://identity.example.com/',authModule:undefined,followRepoCatalog:false,baseUpdate:null,threads:true,threadMode:'auto',registerWithDirectory:false,adminUiDir:'dist/devdocs-server',
   configFile:'corealm-server.json',worlds:[{id:'one',name:'One',seed:7,capacity:12},{id:'two',name:'two',seed:1337,capacity:64}]});
 });
 it('reads the defaults of the runtime settings and the admin UI directory, and checks them',()=>{
  const identity=['--identity-url','https://identity.example.com/'];
  const file=hostConfiguration([],{},files({'corealm-server.json':{identityUrl:'https://identity.example.com/',name:'Raid Night',description:' Fridays ',registerWithDirectory:true,adminUiDir:'ui'}}));
  expect([file.name,file.description,file.registerWithDirectory,file.adminUiDir]).toEqual(['Raid Night','Fridays',true,'ui']);
  const flagged=hostConfiguration([...identity,'--name','LAN Box','--admin-ui-dir','build/ui','--register-with-directory'],{COREALM_SERVER_DESCRIPTION:'Weekends'},none);
  expect([flagged.name,flagged.description,flagged.registerWithDirectory,flagged.adminUiDir]).toEqual(['LAN Box','Weekends',true,'build/ui']);
  expect(()=>hostConfiguration([...identity,'--name','x'],{},none)).toThrow(/name must be 3 to 48/);
  expect(()=>hostConfiguration(identity,{COREALM_SERVER_DESCRIPTION:'d'.repeat(201)},none)).toThrow(/description must be 1 to 200 characters/);
  expect(()=>hostConfiguration(['--guests','--register-with-directory'],{},none)).toThrow(/registerWithDirectory needs an identity service URL/);
 });
 it('names the owner account from a flag, an environment variable or the file, and checks its shape',()=>{
  const identity=['--identity-url','https://identity.example.com/'];
  const owner='acc_OOOOOOOOOOOOOOOOOOOOOO';
  expect(hostConfiguration([...identity,'--owner-account',owner],{},none).ownerAccount).toBe(owner);
  expect(hostConfiguration(identity,{COREALM_OWNER_ACCOUNT:owner},none).ownerAccount).toBe(owner);
  expect(hostConfiguration([],{},files({'corealm-server.json':{identityUrl:'https://identity.example.com/',ownerAccount:owner}})).ownerAccount).toBe(owner);
  expect(hostConfiguration(identity,{},none).ownerAccount).toBeUndefined();
  expect(()=>hostConfiguration(identity,{COREALM_OWNER_ACCOUNT:'someone'},none)).toThrow(/ownerAccount must be an identity account id/);
  expect(()=>hostConfiguration([],{},files({'corealm-server.json':{identityUrl:'https://identity.example.com/',owner:'x'}}))).toThrow(/unknown setting "owner"/);
 });
 it('takes the config path from a flag or an environment variable and fails when it is missing',()=>{
  const read=files({'/etc/corealm/server.json':{...guestFile,port:4300}});
  expect(hostConfiguration(['--config','/etc/corealm/server.json'],{},read).port).toBe(4300);
  expect(hostConfiguration([],{COREALM_CONFIG:'/etc/corealm/server.json'},read).port).toBe(4300);
  expect(()=>hostConfiguration(['--config','/missing.json'],{},read)).toThrow(/\/missing\.json/);
  expect(hostConfiguration(['--development-guests'],{},read).configFile).toBeNull();
 });
 it('orders flag over environment over file over default',()=>{
  const read=files({'corealm-server.json':{...guestFile,port:4200,data:'file-data'}});
  expect(hostConfiguration([],{},read)).toMatchObject({port:4200,data:'file-data'});
  expect(hostConfiguration([],{COREALM_PORT:'4201',COREALM_DATA:'env-data'},read)).toMatchObject({port:4201,data:'env-data'});
  expect(hostConfiguration(['--port','4202','--data','flag-data'],{COREALM_PORT:'4201',COREALM_DATA:'env-data'},read))
   .toMatchObject({port:4202,data:'flag-data'});
  expect(hostConfiguration(['--development-guests'],{},none)).toMatchObject({port:4180,data:'local-worlds'});
 });
 it('lets the world shorthand and the capacity flag override the file world list',()=>{
  const read=files({'corealm-server.json':{...guestFile,worlds:[{id:'one',seed:7,capacity:12}]}});
  expect(hostConfiguration(['--worlds','alpha,beta'],{},read).worlds)
   .toEqual([{id:'alpha',name:'alpha',seed:1337,capacity:64},{id:'beta',name:'beta',seed:1337,capacity:64}]);
  expect(hostConfiguration([],{COREALM_WORLDS:'alpha'},read).worlds).toEqual([{id:'alpha',name:'alpha',seed:1337,capacity:64}]);
  expect(hostConfiguration(['--capacity','200'],{},read).worlds).toEqual([{id:'one',name:'one',seed:7,capacity:200}]);
 });
 it('rejects unknown keys, wrong types and unusable URLs in the file',()=>{
  const bad=(file:unknown)=>()=>hostConfiguration([],{},files({'corealm-server.json':file}));
  expect(bad({...guestFile,unknown:1})).toThrow(/unknown setting "unknown"/);
  expect(bad({...guestFile,port:'4200'})).toThrow(/port/);
  expect(bad({...guestFile,allowedOrigins:'https://play.example.com'})).toThrow(/allowedOrigins/);
  expect(bad({...guestFile,authored:'yes'})).toThrow(/authored/);
  expect(bad({...guestFile,worlds:[]})).toThrow(/worlds/);
  expect(bad({...guestFile,worlds:[{id:'one',region:'eu'}]})).toThrow(/unknown world setting "region"/);
  expect(bad({...guestFile,worlds:[{id:'one',name:'  '}]})).toThrow(/name/);
  expect(bad({...guestFile,worlds:[{id:'one',seed:1.5}]})).toThrow(/seed/);
  expect(bad({...guestFile,worlds:[{id:'one',capacity:0}]})).toThrow(/capacity/);
  expect(bad({...guestFile,worlds:[{id:'one'},{id:'one'}]})).toThrow(/unique/);
  expect(bad({...guestFile,assetBaseUrl:'http://cdn.example.com/'})).toThrow(/assetBaseUrl/);
  expect(bad({...guestFile,assetBaseUrl:'/assets/'})).toThrow(/assetBaseUrl/);
  expect(bad({...guestFile,identityUrl:'not a url'})).toThrow(/identityUrl/);
  expect(()=>hostConfiguration([],{},()=>'{')).toThrow(/JSON/);
  expect(()=>hostConfiguration([],{},()=>'[]')).toThrow(/object/);
 });
 it('carries a loopback asset host and an identity URL through overrides',()=>{
  const read=files({'corealm-server.json':{...guestFile,assetBaseUrl:'https://cdn.example.com/'}});
  expect(hostConfiguration(['--asset-base-url','http://127.0.0.1:4192'],{},read).assetBaseUrl).toBe('http://127.0.0.1:4192/');
  expect(hostConfiguration([],{COREALM_IDENTITY_URL:'https://identity.example.com/auth'},files({'corealm-server.json':{}})).identityUrl)
   .toBe('https://identity.example.com/auth/');
 });
});

it('follows the repo catalog only when the flag asks, never from a configuration file', () => {
  expect(hostConfiguration(['--guests', '--follow-repo-catalog'], {}, () => undefined).followRepoCatalog).toBe(true);
  expect(hostConfiguration(['--guests'], {}, () => undefined).followRepoCatalog).toBe(false);
  expect(() => hostConfiguration([], {}, () => JSON.stringify({ guests: true, followRepoCatalog: true }))).toThrow(/followRepoCatalog/);
});

it('applies the bundled base at start only when the flag asks, with decisions from the flag or a file', () => {
  const decisions = '[{"collection":"lootTables","id":"shared_t0_frog","take":"mine"}]';
  const read = (files: Record<string, string>) => (path: string) => files[path];
  const baseUpdate = (args: string[], files: Record<string, string> = {}) => hostConfiguration(['--guests', ...args], {}, read(files)).baseUpdate;
  expect([baseUpdate([]), baseUpdate(['--apply-base-update']), baseUpdate(['--apply-base-update', '--decisions', decisions]),
    baseUpdate(['--apply-base-update', '--decisions-file', 'decisions.json'], { 'decisions.json': decisions })])
    .toEqual([null, { decisions: null }, { decisions }, { decisions }]);
  expect(() => baseUpdate(['--decisions', decisions])).toThrow(/go with --apply-base-update/);
  expect(() => baseUpdate(['--apply-base-update', '--decisions-file', 'missing.json'])).toThrow(/Decisions file not found: missing.json/);
  expect(() => baseUpdate(['--apply-base-update', '--decisions', decisions, '--decisions-file', 'decisions.json'], { 'decisions.json': decisions })).toThrow(/once/);
  expect(() => baseUpdate(['--apply-base-update', '--follow-repo-catalog'])).toThrow(/Choose one/);
  expect(() => hostConfiguration([], {}, () => JSON.stringify({ guests: true, applyBaseUpdate: true }))).toThrow(/applyBaseUpdate/);
});

it('runs a thread per world when there is more than one world, unless told otherwise', () => {
  const threads = (args: string[], env: Record<string, string> = {}, file: Record<string, unknown> = {}) => hostConfiguration(['--guests', ...args], env, () => JSON.stringify(file)).threads;
  expect([threads([]), threads(['--worlds', 'a,b']), threads(['--worlds', 'a,b', '--threads', 'off']), threads(['--threads', 'on'])]).toEqual([false, true, false, true]);
  expect([threads(['--worlds', 'a,b'], { COREALM_THREADS: 'off' }), threads([], {}, { threads: 'on' }), threads(['--threads', 'off'], {}, { threads: 'on' })]).toEqual([false, true, false]);
  expect(() => threads(['--threads', 'many'])).toThrow(/"auto", "on" or "off"/);
});
