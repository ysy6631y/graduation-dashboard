import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {chromium} from '@playwright/test';
if(!process.argv.includes('--run-live'))throw Error('Live QA requires --run-live');
const access=JSON.parse(await readFile('data/cloud-access.json','utf8'));
const dir=await mkdtemp(tmpdir()+'/workspace-cloud-');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4176',DATA_DIR:dir,WORKSPACE_LOCAL_ONLY:'0'}});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error('QA server exited: '+code)))});
const browser=await chromium.launch({...(process.platform==='darwin'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{}),headless:true});
const pages=[];
try{
  let baseline;
  for(const name of ['이유진','임다혜','윤서영','강주원']){
    const page=await browser.newPage({viewport:{width:1366,height:768}});page.setDefaultTimeout(20000);pages.push(page);
    await page.goto('http://127.0.0.1:4176/#invite='+access.invite);
    await page.getByRole('button',{name,exact:true}).click();await page.locator('.team-profiles').waitFor();
    assert.equal(new URL(page.url()).hash,'');
    await page.reload();await page.locator('.team-profiles').waitFor();
    await page.getByRole('button',{name:'작업 현황 바로가기',exact:true}).click();
    await page.getByRole('button',{name:'전체',exact:true}).click();
    const titles=await page.locator('.full-list .task-name').allTextContents();
    if(baseline)assert.deepEqual(titles,baseline);else baseline=titles;
  }
  console.log(JSON.stringify({fourBrowserInviteEntries:true,emailNotRequired:true,reloadPersistence:true,sharedActualRecords:true}));
}finally{
  for(const page of pages){
    try{if(await page.locator('#settings').count()){await page.getByRole('button',{name:'작업실 설정',exact:true}).click();await page.getByRole('button',{name:'이 브라우저에서 나가기',exact:true}).click();await page.getByText('팀에서 받은 초대 링크로 들어와주세요.',{exact:true}).waitFor()}}catch{}
  }
  await browser.close();server.kill();
}
