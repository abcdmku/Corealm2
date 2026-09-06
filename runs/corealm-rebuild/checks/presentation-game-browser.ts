import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver } from "../../../tools/lib/driver.js";
import { installTestDeadline } from "../../../tools/lib/deadline.js";

// Root schedules this GPU check. The default compact lab includes the production shop fixture.
const out = `test-results/presentation-game-browser/${Date.now()}`;
await mkdir(out, { recursive:true });
const deadline = installTestDeadline("Presentation game browser", 59000);
const driver = new GameDriver({url:process.env.COREALM_URL ?? "http://127.0.0.1:4175",close:async()=>{}},
  {headless:true,browserArgs:["--use-angle=d3d11","--enable-gpu","--ignore-gpu-blocklist","--mute-audio"]});
const report: Record<string,unknown> = {passed:false,panels:[]};
try {
  await driver.launch();
  await driver.open(24000,process.env.COREALM_ROUTE ?? "/index.html?mode=combat&shop=1");
  const page=driver.page!;
  page.setDefaultTimeout(3500);
  report.renderer = await page.evaluate(`(() => {
    const canvas=document.querySelector('canvas');
    const gl=canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    const extension=gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : null;
  })()`);
  assert.equal(typeof report.renderer,"string","unmasked hardware renderer must be available");
  assert(!/swiftshader|llvmpipe|software|basic render/i.test(String(report.renderer)),`software renderer rejected: ${report.renderer}`);
  const errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.keyboard.press("Escape");
  if(await page.locator(".title").isVisible()) await page.getByRole("button",{name:"Return to game",exact:true}).click();
  for(const [width,height] of [[1280,720],[800,600]]) {
    await page.setViewportSize({width:width!,height:height!});
    await page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    for(const [id,key] of [["inventory","i"],["equipment","e"],["quests","j"],["skills","k"],["spellbook","b"],["controls","h"],["map","m"]]) {
      await page.keyboard.press(key!);
      const panel=page.locator(`#panel-${id}`);
      await panel.waitFor({state:"visible"});
      const bounds=await panel.boundingBox(); assert(bounds);
      assert(bounds.x>=-1 && bounds.y>=-1 && bounds.x+bounds.width<=width!+1 && bounds.y+bounds.height<=height!+1,`${id} outside ${width}x${height}`);
      const text=await panel.innerText(); assert(text.trim().length>0);
      await page.screenshot({path:`${out}/${id}-${width}x${height}.png`});
      await page.keyboard.press("Escape");
      assert.equal(await panel.isVisible(),false);
      (report.panels as unknown[]).push({id,width,height,bounds,text});
    }
    for(const [id,method] of [["bank","openBank"],["shop","openShop"]]) {
      if(id==="bank") await page.evaluate("if(window.__shopLab) {const entity=window.__gameDebug.getEntity(window.__shopLab.bankId);if(entity && !window.__gameDebug.teleport(entity.interactionPosition ?? entity.position)) throw new Error('Bank fixture approach failed')}");
      if(id==="shop") await page.evaluate("if(window.__shopLab && !window.__gameDebug.teleport(window.__shopLab.interactionPosition)) throw new Error('Shop fixture approach failed')");
      await page.evaluate(`window.__gameDebug.${method}(${id==='shop' ? "'coldbrace_general'" : ""})`);
      const panel=page.locator(`#panel-${id}`);
      await panel.waitFor({state:"visible"});
      if(id==="shop") await panel.locator(".shop-row").first().waitFor({state:"visible"});
      const bounds=await panel.boundingBox();assert(bounds);
      assert(bounds.x>=-1&&bounds.y>=-1&&bounds.x+bounds.width<=width!+1&&bounds.y+bounds.height<=height!+1,`${id} outside ${width}x${height}`);
      await page.screenshot({path:`${out}/${id}-${width}x${height}.png`});
      (report.panels as unknown[]).push({id,width,height,bounds,text:await panel.innerText(),setup:"debug panel open; real controls and Escape"});
      await page.keyboard.press("Escape");
      assert.equal(await panel.isVisible(),false);
    }
    await page.keyboard.press("Escape");
    await page.getByRole("button",{name:"Settings",exact:true}).click();
    await page.locator("#panel-settings").waitFor({state:"visible"});
    const settingsBounds=await page.locator("#panel-settings").boundingBox();assert(settingsBounds);
    assert(settingsBounds.x>=-1&&settingsBounds.y>=-1&&settingsBounds.x+settingsBounds.width<=width!+1&&settingsBounds.y+settingsBounds.height<=height!+1,`settings outside ${width}x${height}`);
    await page.screenshot({path:`${out}/settings-${width}x${height}.png`});
    (report.panels as unknown[]).push({id:"settings",width,height,bounds:settingsBounds,text:await page.locator("#panel-settings").innerText()});
    await page.locator("#panel-settings .panel__close").click();
    if(await page.locator(".title").isVisible()) await page.getByRole("button",{name:"Return to game",exact:true}).click();
  }
  assert.deepEqual(errors,[]);
  assert.deepEqual(driver.pageErrors,[]);
  assert.deepEqual(driver.consoleErrors,[]);
  assert.equal((report.panels as unknown[]).length,20,"ten panels at both viewports");
  report.passed=true;
  report.errors=errors;
} catch(error) {
  report.error=String(error);
  await driver.page?.screenshot({path:`${out}/failure.png`});
  report.focus=await driver.page?.evaluate("({tag:document.activeElement?.tagName,text:document.activeElement?.textContent?.slice(0,100),title:document.querySelector('.title')?.hidden})");
  report.bindings=await driver.page?.evaluate("window.__gameDebug.getKeyBindings()");
  await writeFile(`${out}/failure-${Date.now()}.json`,JSON.stringify(report,null,2));
  throw error;
}
finally {
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
  await driver.close(); deadline();
}
