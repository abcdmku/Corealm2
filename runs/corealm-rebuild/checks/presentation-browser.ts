import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

// DOM-only production module fixture. It never starts the renderer or allocates WebGL.
const url = process.env.COREALM_URL ?? "http://127.0.0.1:4175";
const out = "test-results/presentation-browser";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ["--disable-gpu"] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/presentation-fixture", (route) => route.fulfill({
    contentType: "text/html", body: '<html><head><link rel="stylesheet" href="/src/ui/styles.css"></head><body><div id="ui-root"></div></body></html>',
  }));
  await page.goto(`${url}/presentation-fixture`);
  const semantics = await page.evaluate(`(async () => {
    const {PanelFrame} = await import('/src/ui/panelFrame.ts');
    const {QuantitySelector} = await import('/src/ui/quantitySelector.ts');
    const {KeyBindingRegistry} = await import('/src/input/keyboard.ts');
    const registry = new KeyBindingRegistry();
    const host = document.querySelector('#ui-root');
    const a = new PanelFrame({id:'proof-a',title:'Inventory',registry,movable:true,placement:{left:'16px',top:'20px',width:'260px'}});
    const b = new PanelFrame({id:'proof-b',title:'Bank',registry,placement:{left:'90px',top:'140px',width:'260px'}});
    a.mount(host); b.mount(host); a.open(); b.open();
    for (let i=0;i<30;i++) a.raise();
    const stack = +a.root.style.zIndex > +b.root.style.zIndex && +a.root.style.zIndex < 30;
    registry.runEscapeStack();
    const escape = !a.isOpen() && b.isOpen();
    a.open();
    let changes = 0;
    const qty = new QuantitySelector('Transfer amount', () => changes++);
    a.body.append(qty.root);
    window.presentation = {a,b,qty,registry,getChanges:()=>changes};
    return {stack,escape};
  })()`);
  assert.deepEqual(semantics, { stack: true, escape: true });
  await page.locator("#panel-proof-a .qty__btn").last().click();
  await page.getByLabel("Transfer amount: custom amount").fill("17");
  assert.equal(await page.evaluate("window.presentation.qty.resolve(100)"), 17);
  assert.ok(await page.evaluate("window.presentation.getChanges() >= 2"));
  await page.locator("#panel-proof-a .qty__btn").first().click();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.evaluate("window.presentation.qty.resolve(100)"), 5);
  const header = page.locator("#panel-proof-a .panel__header");
  const box = (await header.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 25);
  await page.evaluate("window.dispatchEvent(new Event('blur'))");
  const before = await page.locator("#panel-proof-a").getAttribute("style");
  await page.mouse.move(box.x + 160, box.y + 125);
  await page.mouse.up();
  assert.equal(await page.locator("#panel-proof-a").getAttribute("style"), before);
  const screenshots: string[] = [];
  for (const [width,height] of [[1280,720],[800,600]]) {
    await page.setViewportSize({width:width!,height:height!});
    const path = `${out}/panels-${width}x${height}.png`;
    await page.screenshot({path}); screenshots.push(path);
  }
  const sets = await page.evaluate(`(async () => {
    const {EquipmentPanel}=await import('/src/ui/equipmentPanel.ts');
    const {EQUIP_SLOTS}=await import('/src/contracts.ts');
    const {content}=await import('/src/content/index.ts');
    const {ALL_ITEMS}=await import('/src/content/items.ts');
    const {getEquipmentSetBonuses}=await import('/src/content/equipmentSets.ts');
    content.register({items:ALL_ITEMS});
    const slots=Object.fromEntries(EQUIP_SLOTS.map(slot=>[slot,null]));
    slots.head={itemId:'grithe_helm',quantity:1}; slots.body={itemId:'grithe_cuirass',quantity:1};
    const api={getEquipment:()=>({slots,totals:getEquipmentSetBonuses(slots)}),getSpellbook:()=>({equippedWeapon:null})};
    const panel=new EquipmentPanel({api,registry:window.presentation.registry,tooltip:{attach(){},refresh(){}}});
    panel.frame.mount(document.querySelector('#ui-root')); panel.frame.open();
    const two=panel.frame.body.querySelector('.equip-sets').textContent;
    slots.head=null;panel.refresh();
    const one=panel.frame.body.querySelector('.equip-sets').textContent;
    slots.head={itemId:'grithe_helm',quantity:1};panel.refresh();
    return {two,one};
  })()`);
  assert.match(sets.two, /Copper set · 2\/5 pieces/);
  assert.match(sets.two, /2 pieces: \+2 armour \(active\)/);
  assert.match(sets.one, /Copper set · 1\/5 pieces/);
  assert.ok(!sets.one.includes("(active)"));
  await page.locator(".equip-sets li").last().scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/equipment-sets.png`});
  await page.evaluate(`(async () => {
    const {QuestPanel}=await import('/src/ui/questPanel.ts');
    const {HuntContractsSystem,createInitialHuntContracts}=await import('/src/systems/huntContracts.ts');
    const {EventBus}=await import('/src/core/events.ts');
    const state=createInitialHuntContracts(42);
    const hunts=new HuntContractsSystem({state:()=>state,markDirty(){},events:new EventBus(),playerId:()=> 'player',
      targets:()=>[{id:'bandit',name:'Road Bandit',regionId:'fallowmarch',regionName:'Farmland',enemyDefIds:['reaver_t1'],level:1,residents:8,reachable:true}],
      eligibility:()=>({combatLevel:1,regions:['fallowmarch']}),entity:()=>undefined,awardXp(){}});
    hunts.refreshOffers();
    const journal=new QuestPanel({api:{getQuests:()=>[]},registry:window.presentation.registry,pinnedQuestId:()=>null,huntContracts:()=>hunts});
    journal.frame.mount(document.querySelector('#ui-root'));journal.frame.open();
    window.presentation.journal=journal;window.presentation.hunts=hunts;
  })()`);
  await page.getByRole("button",{name:"Accept hunt",exact:true}).click();
  assert.equal(await page.evaluate("window.presentation.hunts.snapshot().active.status"),"active");
  await page.locator(".hunt-contracts progress").scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/journal-hunt.png`});
  await page.locator("#panel-quests .panel__close").click();
  assert.equal(await page.locator(".hunt-contracts").isVisible(),false);
  await page.evaluate("window.presentation.journal.frame.open()");
  assert.equal(await page.locator(".hunt-contracts progress").getAttribute("value"),"0");
  await page.evaluate(`(async () => {
    const THREE=await import('/@id/three');
    const {InputController}=await import('/src/input/mouse.ts');
    const canvas=document.createElement('canvas');canvas.style.cssText='position:fixed;inset:0;width:100%;height:100%';document.body.append(canvas);
    const tree={id:'oak',name:'Oak',archetype:'tree',state:'depleted',tier:1,regionId:'fallowmarch',position:[0,0,0],interactions:['chop']};
    const input=new InputController(canvas,{camera:new THREE.PerspectiveCamera(),scene:new THREE.Scene()},
      {yaw:0,rotate(){},zoom(){},panPixels(){}},{inspect:()=>({ok:true,value:tree}),stop:()=>({ok:true})},{setDirectInput(){}},
      {keybindings:window.presentation.registry,pickSources:{pickEntity:()=>({entityId:'oak',point:[0,0,0],distance:1}),pickGround:()=>null}});
    window.presentation.hover={input,tree,canvas};
  })()`);
  await page.mouse.move(400,570);
  await page.evaluate("window.presentation.hover.input.update()");
  assert.match(await page.locator(".hover-label").innerText(),/Oak · Depleted/);
  await page.evaluate("window.presentation.hover.tree.state='available'");
  await page.waitForFunction("window.presentation.hover.input.update(); !document.querySelector('.hover-label').textContent.includes('Depleted')");
  assert.match(await page.locator(".hover-label").innerText(),/Chop Oak/);
  await page.evaluate("window.presentation.hover.input.dispose();window.presentation.hover.canvas.remove()");
  assert.deepEqual(errors, []);
  await writeFile(`${out}/report.json`, JSON.stringify({passed:true,semantics,sets,quantity:17,radioArrow:5,blurStopsDrag:true,screenshots,errors},null,2));
  console.log(JSON.stringify({passed:true,out}));
} finally { await browser.close(); }
