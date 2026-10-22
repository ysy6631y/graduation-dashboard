import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {chromium} from '@playwright/test';
const dir=await mkdtemp(tmpdir()+'/budget-browser-');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4183',DATA_DIR:dir,WORKSPACE_LOCAL_ONLY:'1'}});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error('Preview failed '+code)))});
const browser=await chromium.launch({...(process.platform==='darwin'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{}),headless:true});
after(async()=>{await browser.close();server.kill()});
const url='http://127.0.0.1:4183';
const state=async()=>(await fetch(url+'/api/workspace')).json();
const waitFor=async(fn)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}assert.fail('condition timed out')};
async function reset(){const before=await state();await fetch(url+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:before.revision,tasks:[],events:[],links:{}})})}
async function page(width=1366){const p=await browser.newPage({viewport:{width,height:900}});p.setDefaultTimeout(10000);await p.route(/^https:\/\/fonts\./,r=>r.abort());await p.goto(url);await p.getByRole('button',{name:'메뉴 열기',exact:true}).click();await p.locator('.drawer').getByRole('button',{name:'견적 관리',exact:true}).click();return p}
async function submit(p){await p.getByRole('button',{name:'저장하기',exact:true}).click();await p.locator('dialog').waitFor({state:'hidden'})}
async function add(p,title,amount,vendor=''){
  await p.getByRole('button',{name:'＋ 견적 추가',exact:true}).click();await p.locator('[name=title]').fill(title);await p.locator('[name=amount]').fill(String(amount));
  if(vendor){await p.locator('details summary').click();await p.locator('[name=vendor]').fill(vendor)}await submit(p);
}
const project=(p,name)=>p.getByRole('group',{name:'견적 프로젝트'}).getByRole('button',{name,exact:true}).click();
const total=(p)=>p.locator('#budgetConfirmed').innerText();
async function check(p,index,value=true){await p.locator('[data-confirm-quote]').nth(index).setChecked(value);await waitFor(async()=>await p.locator('[data-confirm-quote]').nth(index).isEnabled())}
async function deleteQuote(p,index=0){await p.locator('[data-edit-quote]').nth(index).click();await p.getByRole('button',{name:'삭제',exact:true}).click();await p.getByRole('button',{name:'삭제하기',exact:true}).click();await p.locator('dialog').waitFor({state:'hidden'})}

test('flat list: direct edit, confirmed-only total, exclusive selection, cancellation, deletion/undo, project isolation and persistence',async()=>{
  await reset();const p=await page();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  assert(await p.locator('.budget-empty').isVisible());assert.equal(await total(p),'0원');
  assert.equal(await p.locator('#budgetSettings,[data-budget-status]').count(),0);
  await add(p,'새 제작물',120000,'A 업체');await add(p,'새 제작물',90000,'B 업체');
  assert.equal(await p.locator('.estimate-row').count(),2);assert.equal(await total(p),'0원');
  await check(p,0);assert.equal(await total(p),'120,000원');await check(p,1);assert.equal(await total(p),'90,000원');assert.equal(await p.locator('[data-confirm-quote]:checked').count(),1);
  await p.locator('[data-edit-quote]').nth(1).click();assert.equal(await p.locator('[name=amount]').inputValue(),'90000');assert(await p.locator('[name=confirmed]').isChecked());await p.locator('[name=amount]').fill('100000');await submit(p);assert.equal(await total(p),'100,000원');
  await check(p,1,false);assert.equal(await total(p),'0원');
  await p.locator('[data-edit-quote]').first().click();await p.locator('[name=confirmed]').check();await submit(p);assert.equal(await total(p),'120,000원');
  await project(p,'리비두비');assert(await p.locator('.budget-empty').isVisible());await add(p,'새 제작물',50000);await check(p,0);assert.equal(await total(p),'50,000원');
  await project(p,'LUUM');assert.equal(await total(p),'120,000원');await p.reload();await p.getByRole('button',{name:'견적 관리 바로가기',exact:true}).click();assert.equal(await total(p),'120,000원');
  await deleteQuote(p,0);assert.equal(await total(p),'0원');await p.locator('#toast').getByRole('button',{name:'되돌리기',exact:true}).click();await waitFor(async()=>await total(p)==='120,000원');
  await deleteQuote(p,0);await deleteQuote(p,0);assert(await p.locator('.budget-empty').isVisible());await project(p,'리비두비');assert.equal(await total(p),'50,000원');assert.deepEqual(errors,[]);await p.close();
});

test('responsive flat list and keyboard row editing at 320–1366px',async()=>{
  await reset();const p=await page();await add(p,'긴 제작물 이름을 입력해도 확인할 수 있는 견적',120000,'A 인쇄');await add(p,'다른 제작물',60000);
  for(const width of [320,390,768,1366]){
    await p.setViewportSize({width,height:900});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await p.locator('[data-edit-quote]').first().focus();await p.keyboard.press('Enter');await p.locator('dialog[open]').waitFor();assert.equal(await p.locator('dialog').evaluate(e=>e.scrollWidth>e.clientWidth),false);
    assert.equal(await p.locator('[name=title]').getAttribute('aria-describedby'),'quoteNameHint');
    await p.locator('#quoteNameHint').waitFor();
    await p.screenshot({path:'budget-form-'+width+'.png'});
    const modalCheck=p.locator('[name=confirmed]');
    await modalCheck.click();assert(await modalCheck.isChecked());
    assert.equal(await modalCheck.evaluate(e=>getComputedStyle(e).outlineStyle),'none');
    const box=await modalCheck.boundingBox();assert.equal(box.width,box.height);
    await modalCheck.click();await modalCheck.focus();await p.keyboard.press('Space');assert(await modalCheck.isChecked());await p.keyboard.press('Space');assert(!await modalCheck.isChecked());
    await p.getByRole('button',{name:'취소',exact:true}).click();
    const hitArea=await p.locator('.estimate-confirm').first().boundingBox();assert(hitArea.width>=44&&hitArea.height>=44);
    const check=p.locator('[data-confirm-quote]').first();
    await check.click();await waitFor(async()=>await total(p)==='120,000원');
    assert.equal(await check.evaluate(e=>getComputedStyle(e).outlineStyle),'none');
    await check.click();await waitFor(async()=>await total(p)==='0원');
    await check.focus();await p.keyboard.press('Space');await waitFor(async()=>await total(p)==='120,000원');assert.equal(await p.locator('dialog[open]').count(),0);
    await p.keyboard.press('Space');await waitFor(async()=>await total(p)==='0원');
    await p.locator('#toast').evaluate(e=>e.style.display='none');await p.screenshot({path:'budget-'+width+'.png',fullPage:true});
  }await p.close();
});

test('two clients share flat quotes and failed saves preserve form input for retry',async()=>{
  await reset();const a=await page(),b=await page();await Promise.all([add(a,'동일 제작물',1000,'A'),add(b,'동일 제작물',2000,'B')]);
  await waitFor(async()=> (await state()).budget.quotes.length===2);assert.equal((await state()).budget.items.length,1);
  await b.evaluate(()=>window.dispatchEvent(new Event('focus')));await waitFor(async()=>await b.locator('.estimate-row').count()===2);
  let failed=true;await a.route('**/api/workspace',async r=>{if(failed&&r.request().method()==='PUT')await r.fulfill({status:503,contentType:'application/json',body:'{"error":"저장 실패 테스트"}'});else await r.continue()});
  await a.getByRole('button',{name:'＋ 견적 추가',exact:true}).click();await a.locator('[name=title]').fill('재시도 견적');await a.locator('[name=amount]').fill('3000');await a.getByRole('button',{name:'저장하기',exact:true}).click();await a.locator('#quoteError').waitFor();assert.equal(await a.locator('[name=title]').inputValue(),'재시도 견적');assert.equal((await state()).budget.quotes.length,2);
  failed=false;await submit(a);await b.evaluate(()=>window.dispatchEvent(new Event('focus')));await waitFor(async()=>await b.locator('.estimate-row').count()===3);await a.close();await b.close();
});
