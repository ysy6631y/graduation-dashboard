import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {chromium} from '@playwright/test';
import http from 'node:http';

const dir = await mkdtemp(tmpdir() + '/workspace-test-');
const server = spawn(process.execPath, ['server.mjs'], {env: {...process.env, WORKSPACE_LOCAL_ONLY:'1',PORT: '4175', DATA_DIR: dir}});
await new Promise((resolve, reject) => {server.stdout.once('data', resolve); server.once('error', reject);server.once('exit',code=>reject(Error('테스트 서버를 시작하지 못했습니다: '+code)))});
const browser = await chromium.launch({...(process.platform === 'darwin' ? {executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'} : {}), headless: true});
after(async () => {await browser.close(); server.kill()});
const base = 'http://127.0.0.1:4175';
const team = ['이유진', '임다혜', '윤서영', '강주원'];
const workspace = async () => (await fetch(base + '/api/workspace')).json();
const put = data => fetch(base + '/api/workspace', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
async function reset(data = {}) {
  assert.equal((await put({revision: (await workspace()).revision, tasks: [], events: [], links: {}, ...data})).status, 200);
}
const task = (title, extra = {}) => ({id: crypto.randomUUID(), title, project: '리비두비', assignees: ['이유진'], dueMode: 'custom', due: '2026-10-21', done: false, link: '', ...extra});
const review = (extra = {}) => ({id: crypto.randomUUID(), title: '팀 컨펌', kind: 'review', project: '', date: '2026-10-23', ...extra});
async function go(page, view) {
  await page.getByRole('button', {name: '메뉴 열기', exact: true}).click();
  await page.locator('.drawer').getByRole('button', {name: view, exact: true}).click();
}
async function openPage(view = '홈', viewport = {width: 1366, height: 768}) {
  const page = await browser.newPage({viewport}); page.setDefaultTimeout(10000);
  // Functional tests must not depend on the external font CDN being available.
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());
  await page.clock.install({time: new Date('2026-10-19T03:00:00Z')});
  await page.goto(base); await page.locator('.team-profiles').waitFor();
  if (view !== '홈') await go(page, view);
  return page;
}
async function finish(page, action = '추가하기') {
  await page.getByRole('button', {name: action, exact: true}).click();
  try{await page.locator('dialog').waitFor({state: 'hidden'})}
  catch(error){throw new Error(error.message+'\nToast: '+await page.locator('#toast').textContent()+'\nInvalid fields: '+JSON.stringify(await page.locator('dialog :invalid').evaluateAll(elements=>elements.map(el=>({name:el.name,message:el.validationMessage})))))}
}
async function add(page, data, selector = '[data-add]') {
  await page.locator(selector).first().click();
  await page.locator('[name=title]').fill(data.title);
  await page.locator('[name=project]').selectOption(data.project || '리비두비');
  await page.locator('[name=due]').fill(data.due || '2026-10-21');
  for (const name of data.assignees || []) {
    const member = page.locator('[data-member="' + name + '"]');
    if (await member.getAttribute('aria-pressed') !== 'true') await member.click();
  }
  if (data.link) {await page.locator('.task-options summary').click(); await page.locator('[name=link]').fill(data.link)}
  await finish(page);
}

test('event ranges cover every included day; same-day defaults and reversed dates validate', async () => {
  await reset(); const page=await openPage('전체 일정');
  await page.getByRole('button',{name:'＋ 일정 등록',exact:true}).click();
  await page.locator('[name=title]').fill('전시 설치 기간');
  await page.locator('[name=kind]').selectOption('milestone');
  await page.locator('[name=project]').selectOption('룸');
  await page.locator('[name=startDate]').fill('2026-10-20');
  assert.equal(await page.locator('[name=endDate]').inputValue(),'2026-10-20');
  await page.locator('[name=endDate]').fill('2026-10-22');
  await finish(page,'일정 저장');
  let event=(await workspace()).events[0];
  assert.equal(event.startDate,'2026-10-20');assert.equal(event.endDate,'2026-10-22');assert.equal(event.date,'2026-10-22');
  assert.equal(await page.locator('.event-period').textContent(),'10.20 – 10.22');
  const month=page.getByRole('region',{name:'월간 캘린더'});
  for(const day of ['2026-10-20','2026-10-21','2026-10-22']){
    assert.ok(await month.locator('[data-day="'+day+'"].has-event').isVisible());
    await month.getByRole('button',{name:day+' 일정',exact:true}).click();
    assert.ok(await page.locator('dialog').getByRole('button',{name:/전시 설치 기간/}).isVisible());
    await page.getByRole('button',{name:'닫기',exact:true}).click();
  }
  assert.equal(await month.locator('[data-day="2026-10-23"].has-event').count(),0);
  await page.getByRole('button',{name:'수정',exact:true}).click();
  await page.locator('[name=endDate]').fill('2026-10-19');
  await page.getByRole('button',{name:'일정 저장',exact:true}).click();
  assert.equal(await page.locator('[name=endDate]').evaluate(el=>el.validity.rangeUnderflow),true);
  assert.equal((await workspace()).events[0].endDate,'2026-10-22');
  await page.locator('[name=endDate]').fill('2026-10-24');await finish(page,'일정 저장');
  await page.reload();await go(page,'전체 일정');await page.locator('.event-period').waitFor();
  assert.equal(await page.locator('.event-period').textContent(),'10.20 – 10.24');
  await page.getByRole('button',{name:'＋ 일정 등록',exact:true}).click();
  await page.locator('[name=title]').fill('하루 컨펌');await page.locator('[name=startDate]').fill('2026-10-25');
  await finish(page,'일정 저장');event=(await workspace()).events.find(e=>e.title==='하루 컨펌');
  assert.equal(event.startDate,event.endDate);assert.equal(event.date,'2026-10-25');
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'＋ 일정 등록',exact:true}).click();
  assert.equal(await page.locator('dialog').evaluate(el=>el.scrollWidth>el.clientWidth),false);
  await page.screenshot({path:'event-range-mobile.png',fullPage:true});await page.close();
});

test('ranges cross months and years; review and exhibition D-days use their intended dates', async () => {
  const monthRange={id:'month-range',title:'월을 넘는 설치',kind:'milestone',project:'룸',startDate:'2026-10-30',endDate:'2026-11-02',date:'2026-11-02'};
  const yearRange={id:'year-range',title:'연말 전시',kind:'final',project:'',startDate:'2026-12-30',endDate:'2027-01-02',date:'2027-01-02'};
  const multiReview={id:'multi-review',title:'이틀 컨펌',kind:'review',project:'',startDate:'2026-10-21',endDate:'2026-10-22',date:'2026-10-21'};
  await reset({events:[monthRange,yearRange,multiReview]});const page=await openPage('전체 일정');
  const month=page.getByRole('region',{name:'월간 캘린더'});
  assert.ok(await month.locator('[data-day="2026-10-30"].has-event').isVisible());
  await page.getByRole('button',{name:'다음 달',exact:true}).click();
  assert.ok(await month.locator('[data-day="2026-11-01"].has-event').isVisible());
  assert.ok(await month.locator('[data-day="2026-11-02"].has-event').isVisible());
  assert.equal(await month.locator('[data-day="2026-11-03"].has-event').count(),0);
  await page.getByRole('button',{name:'다음 달',exact:true}).click();
  assert.ok(await month.locator('[data-day="2026-12-31"].has-event').isVisible());
  await page.getByRole('button',{name:'다음 달',exact:true}).click();
  await month.getByRole('button',{name:'2027-01-01 일정',exact:true}).click();
  assert.ok(await page.locator('dialog').getByRole('button',{name:/연말 전시.*2026.12.30.*2027.1.2/}).isVisible());
  await page.getByRole('button',{name:'닫기',exact:true}).click();
  await go(page,'홈');assert.equal(await page.locator('.review-date strong').textContent(),'10.21');
  const expected=await page.evaluate(()=>{const now=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});return 'D−'+Math.round((Date.parse('2027-01-02T00:00:00+09:00')-Date.parse(now+'T00:00:00+09:00'))/86400000)});
  assert.equal(await page.locator('.final-date').textContent(),expected);await page.close();
});

test('server rejects invalid ranges and legacy one-date events remain editable', async () => {
  const legacy=review();await reset({events:[legacy]});const page=await openPage('전체 일정');
  await page.getByRole('button',{name:'수정',exact:true}).click();
  assert.equal(await page.locator('[name=startDate]').inputValue(),legacy.date);
  assert.equal(await page.locator('[name=endDate]').inputValue(),legacy.date);
  await finish(page,'일정 저장');
  const saved=(await workspace()).events[0];assert.equal(saved.date,legacy.date);assert.equal(saved.startDate,saved.endDate);
  for(const invalid of [
    {...saved,startDate:'2026-10-25',endDate:'2026-10-24',date:'2026-10-25'},
    {...saved,startDate:'2026-02-30',endDate:'2026-03-01',date:'2026-02-30'},
    {...saved,startDate:'2026-10-23',endDate:undefined},
  ]){
    const state=await workspace();state.events=[invalid];assert.equal((await put(state)).status,400);
  }
  assert.deepEqual((await workspace()).events[0],saved);await page.close();
});

test('all add buttons open the same direct form without AI calls or premature writes', async () => {
  await reset(); const page = await openPage(); const aiRequests = [];
  page.on('request', req => {if (req.url().includes('/api/ai/')) aiRequests.push(req.url())});
  const count = await page.locator('[data-add]').count();
  for (let i = 0; i < count; i++) {
    const button = page.locator('[data-add]').nth(i), project = await button.getAttribute('data-add');
    await button.click();
    assert.ok(await page.getByRole('heading', {name: '작업 추가', exact: true}).isVisible());
    assert.equal(await page.locator('[name=project]').inputValue(), project);
    assert.equal(await page.locator('dialog textarea, #aiOrganize, #aiSettings, #manual').count(), 0);
    assert.equal(await page.locator('[data-member]').count(), 4);
    await page.locator('[data-member="이유진"]').click();
    await page.locator('[data-member="임다혜"]').click();
    await page.locator('[data-member="이유진"]').click();
    assert.equal(await page.locator('[name=assignees]').inputValue(), '임다혜');
    await page.locator('[name=title]').fill('저장 전 입력');
    assert.equal((await workspace()).tasks.length, 0);
    await page.getByRole('button', {name: '취소', exact: true}).click();
  }
  await go(page, '작업 현황'); await page.locator('[data-add]').click();
  assert.ok(await page.getByRole('heading', {name: '작업 추가', exact: true}).isVisible());
  await page.getByRole('button', {name: '취소', exact: true}).click();
  assert.equal((await workspace()).tasks.length, 0); assert.deepEqual(aiRequests, []); await page.close();
});

test('add, deadline order, joint assignment, edit, complete, reopen and refresh persist', async () => {
  await reset({events: [review()]}); const page = await openPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await add(page, {title: '공동 시안', assignees: ['이유진', '임다혜'], link: 'https://www.figma.com/'});
  await add(page, {title: '먼저 할 작업', due: '2026-10-20'});
  await add(page, {title: '룸 인터뷰 정리', project: '룸', due: '2026-10-22', assignees: ['윤서영']}, '.room [data-add]');
  assert.deepEqual(await page.locator('.project').first().locator('.task-name').allTextContents(), ['먼저 할 작업', '공동 시안']);
  assert.ok(await page.getByRole('img', {name: '담당자: 이유진, 임다혜', exact: true}).isVisible());
  assert.equal(await page.getByRole('link', {name: '공동 시안 작업 링크 열기'}).getAttribute('href'), 'https://www.figma.com/');
  await page.getByRole('button', {name: '공동 시안', exact: true}).click();
  await page.locator('[name=due]').fill('2026-10-22'); await page.locator('[data-member="강주원"]').click(); await finish(page, '저장하기');
  await page.getByRole('checkbox', {name: '공동 시안 완료', exact: true}).click(); await page.locator('.task.done').waitFor();
  await go(page, '작업 현황'); await page.getByRole('button', {name: '완료', exact: true}).click();
  await page.getByRole('checkbox', {name: '공동 시안 완료', exact: true}).click();
  await page.locator('.full-list .task').waitFor({state: 'hidden'});
  await page.getByRole('button', {name: '미완료', exact: true}).click(); await page.reload();
  await page.getByRole('button', {name: '공동 시안', exact: true}).waitFor();
  const stored = JSON.parse(await readFile(dir + '/workspace.json', 'utf8')), saved = stored.tasks.find(t => t.title === '공동 시안');
  assert.deepEqual(saved.assignees, ['이유진', '임다혜', '강주원']);
  assert.equal(saved.due, '2026-10-22'); assert.equal(saved.done, false);
  assert.equal(await page.locator('.task').count(), 3); assert.deepEqual(errors, []); await page.close();
});

test('legacy linked tasks keep their schedule until their deadline is changed', async () => {
  const event = review(), linked = task('기존 컨펌 연결 작업', {dueMode: event.id, due: '', assignees: ['기존 담당자']}), separate = task('개별 날짜 작업', {due: '2026-10-22'});
  await reset({events: [event], tasks: [linked, separate]}); const page = await openPage();
  await page.getByRole('button', {name: linked.title, exact: true}).click();
  assert.equal(await page.locator('[name=due]').inputValue(), event.date);
  await page.locator('[name=title]').fill('기존 담당자 유지'); await finish(page, '저장하기');
  let saved = (await workspace()).tasks.find(t => t.id === linked.id);
  assert.equal(saved.dueMode, event.id); assert.deepEqual(saved.assignees, ['기존 담당자']);
  await go(page, '전체 일정'); await page.getByRole('button', {name: '수정', exact: true}).click();
  await page.locator('[name=startDate]').fill('2026-10-24');
  await page.locator('[name=endDate]').fill('2026-10-24'); await finish(page, '일정 저장');
  await page.getByRole('button', {name: '기존 담당자 유지', exact: true}).click();
  assert.equal(await page.locator('[name=due]').inputValue(), '2026-10-24');
  await page.locator('[name=due]').fill('2026-10-25'); await finish(page, '저장하기');
  saved = (await workspace()).tasks.find(t => t.id === linked.id);
  assert.equal(saved.dueMode, 'custom'); assert.equal(saved.due, '2026-10-25');
  assert.equal((await workspace()).tasks.find(t => t.id === separate.id).due, '2026-10-22'); await page.close();
});

test('required fields, unassigned work, duplicate notice and optional link are usable', async () => {
  await reset({tasks: [task('같은 작업')]}); const page = await openPage();
  await page.locator('[data-add]').first().click(); await page.getByRole('button', {name: '추가하기', exact: true}).click();
  assert.equal(await page.locator('[name=title]').evaluate(el => el.validity.valueMissing), true);
  await page.locator('[name=title]').fill('같은 작업'); await page.locator('[name=project]').selectOption('리비두비');
  assert.ok(await page.locator('#taskDuplicate').isVisible());
  await page.locator('[name=project]').selectOption('룸'); assert.equal(await page.locator('#taskDuplicate').isVisible(), false);
  assert.equal(await page.locator('[name=due]').evaluate(el => el.required), false);
  assert.equal(await page.locator('.task-options').getAttribute('open'), null);
  await finish(page);
  const saved = (await workspace()).tasks.find(t => t.project === '룸');
  assert.deepEqual(saved.assignees, []); assert.equal(saved.link, '');assert.equal(saved.due, '');
  assert.ok(await page.locator('.room .unassigned').isVisible());
  assert.equal(await page.locator('.room').getByRole('button',{name:'같은 작업',exact:true}).locator('..').locator('.task-date').textContent(),'마감일 없음');await page.close();
});

test('home and all tasks prioritize unfinished dated, unfinished undated, then completed work',async()=>{
  const dated=task('날짜 있는 미완료',{due:'2026-10-20'}),undated=task('날짜 없는 미완료',{due:''}),done=task('완료된 작업',{due:'2026-10-18',done:true,completedOn:'2026-10-19'});
  await reset({tasks:[done,undated,dated]});const page=await openPage();
  assert.deepEqual(await page.locator('.project').first().locator('.task-name').allTextContents(),['날짜 있는 미완료','날짜 없는 미완료','완료된 작업']);
  await page.getByRole('button',{name:'전체 작업 ›',exact:true}).click();
  assert.deepEqual(await page.locator('.full-list .task-name').allTextContents(),['날짜 있는 미완료','날짜 없는 미완료','완료된 작업']);await page.close();
});

test('many tasks stay compact and later added work is shown in task status', async () => {
  await reset({events: [review()], tasks: Array.from({length: 28}, (_, i) => task('긴 작업명으로 여러 줄에 걸쳐 표시되는 전시 디자인 수정 사항 확인하기 ' + i, {project: i < 20 ? '리비두비' : '룸', due: '2026-10-20'}))});
  const page = await openPage();
  for (const viewport of [{width: 1366, height: 768}, {width: 1440, height: 900}]) {
    await page.setViewportSize(viewport); await page.reload(); await page.locator('.project .task').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const layout=await page.evaluate(() => ({height:innerHeight,scroll:document.documentElement.scrollHeight,width:innerWidth}));
    assert.ok(layout.scroll > layout.height, JSON.stringify(layout));
    assert.equal(await page.locator('.task').count(),16);
    for(const project of ['.project:not(.room)','.project.room']){
      const metrics=await page.locator(project+' .task').first().evaluate(el=>{const style=getComputedStyle(el);return {gap:parseFloat(style.columnGap),padding:style.paddingLeft,height:el.getBoundingClientRect().height}});
      assert.equal(metrics.gap,16);assert.equal(metrics.padding,'20px');assert.equal(metrics.height,viewport.height===768?72:80);
      assert.equal(await page.locator(project).evaluate(el=>el.scrollHeight>el.clientHeight),false);
    }
    await page.screenshot({path:'home-eight-'+viewport.width+'.png',fullPage:true});
  }
  await go(page,'작업 현황');await page.getByRole('button',{name:'완료',exact:true}).click();await go(page,'홈');
  await page.locator('.remaining').first().click();
  assert.equal(await page.locator('.filters .active').textContent(),'전체');assert.equal(await page.locator('.full-list .task').count(),20);
  assert.equal(await page.locator('[data-project-filter="리비두비"]').getAttribute('aria-pressed'),'true');
  await go(page,'홈');
  await add(page, {title: '다음 컨펌 이후 작업', due: '2026-11-05', assignees: ['강주원']});
  assert.ok(await page.getByRole('heading', {name: '작업 현황', exact: true}).isVisible());
  assert.ok(await page.getByRole('button', {name: '다음 컨펌 이후 작업', exact: true}).isVisible());
  assert.equal((await workspace()).tasks.length, 29); await page.close();
});

test('four profiles add and share work through the same form and person filter', async () => {
  await reset(); const pages = [];
  for (const [i, name] of team.entries()) {
    const page = await openPage(); pages.push(page);
    await page.getByRole('button', {name: name + ' 프로필', exact: true}).click(); await finish(page, '담당 작업 보기');
    assert.equal(await page.locator('#person').inputValue(), name);
    await add(page, {title: name + ' 담당 작업', project: i % 2 ? '룸' : '리비두비', assignees: i === 0 ? ['이유진', '임다혜'] : [name]});
    assert.ok(await page.getByRole('button', {name: name + ' 담당 작업', exact: true}).isVisible());
    await page.reload(); await page.locator('[data-profile="' + name + '"].selected').waitFor();
  }
  await pages[1].getByRole('button', {name: '임다혜 프로필', exact: true}).click(); await finish(pages[1], '담당 작업 보기');
  assert.ok(await pages[1].getByRole('button', {name: '이유진 담당 작업', exact: true}).isVisible());
  await pages[0].reload();
  await pages[0].getByRole('button', {name: '이유진 프로필', exact: true}).click(); await finish(pages[0], '담당 작업 보기');
  await pages[0].locator('[data-add]').click(); await pages[0].locator('[name=title]').fill('다른 담당자에게 추가');
  await pages[0].locator('[name=project]').selectOption('룸'); await pages[0].locator('[name=due]').fill('2026-10-22');
  await pages[0].locator('[data-member="이유진"]').click(); await pages[0].locator('[data-member="강주원"]').click(); await finish(pages[0]);
  assert.equal(await pages[0].locator('#person').inputValue(), '');
  assert.ok(await pages[0].getByRole('button', {name: '다른 담당자에게 추가', exact: true}).isVisible());
  await Promise.all(pages.map(page => page.close()));
});

test('calendar opens the same editor and four resource links can be registered and opened', async () => {
  await reset({tasks: [task('달력에서 여는 작업')], events: [review()]}); const page = await openPage('전체 일정');
  const month = page.getByRole('region', {name: '월간 캘린더'});
  assert.ok(await page.getByRole('region', {name: '주간 캘린더'}).isVisible());
  const first = await page.locator('.week-days [data-day]').first().getAttribute('data-day');
  await page.getByRole('button', {name: '다음 주', exact: true}).click();
  assert.notEqual(await page.locator('.week-days [data-day]').first().getAttribute('data-day'), first);
  await month.getByRole('button', {name: '2026-10-21 일정', exact: true}).click();
  await page.locator('dialog').getByRole('button', {name: '달력에서 여는 작업', exact: false}).click();
  assert.ok(await page.getByRole('heading', {name: '작업 수정', exact: true}).isVisible());
  assert.equal(await page.locator('[name=due]').inputValue(), '2026-10-21');
  await page.getByRole('button', {name: '닫기', exact: true}).click(); await go(page, '자료실');
  for (const type of ['Figma', 'Google Drive']) {
    await page.getByRole('button', {name: type === 'Figma' ? 'Figma' : 'Drive', exact: true}).click();
    for (const project of ['리비두비', '룸']) {
      await page.getByRole('button', {name: project + ' ' + type + ' 등록', exact: true}).click();
      await page.locator('[name=url]').fill('https://example.com/' + encodeURIComponent(project + type)); await finish(page, '저장하기');
      assert.ok(await page.getByRole('link', {name: project + ' ' + type + ' 열기', exact: true}).isVisible());
    }
  }
  await page.route('https://example.com/**', route => route.fulfill({body: '<h1>Opened</h1>', contentType: 'text/html'}));
  const popupPromise = page.waitForEvent('popup'); await page.getByRole('link', {name: '룸 Google Drive 열기', exact: true}).click();
  const popup = await popupPromise; await popup.waitForLoadState(); assert.ok(popup.url().startsWith('https://example.com/'));
  await popup.close(); await page.close();
});

test('save failures and conflicting edits preserve input and can be retried', async () => {
  await reset({tasks: [task('동시 수정 작업')]}); const a = await openPage('작업 현황'), b = await openPage('작업 현황');
  for (const page of [a, b]) await page.getByRole('button', {name: '동시 수정 작업', exact: true}).click();
  await a.locator('[name=title]').fill('첫 번째 팀원 수정'); await finish(a, '저장하기');
  await b.locator('[name=title]').fill('두 번째 팀원 수정'); await b.getByRole('button', {name: '저장하기', exact: true}).click();
  await b.getByRole('status').filter({hasText: '같은 항목이 변경됐어요.'}).waitFor();
  assert.equal(await b.locator('[name=title]').inputValue(), '두 번째 팀원 수정');
  assert.equal((await workspace()).tasks[0].title, '첫 번째 팀원 수정');
  await finish(b, '저장하기'); assert.equal((await workspace()).tasks[0].title, '두 번째 팀원 수정');
  await b.locator('[data-add]').click(); await b.locator('[name=title]').fill('실패 후 재시도');
  await b.locator('[name=project]').selectOption('룸'); await b.locator('[name=due]').fill('2026-10-22');
  await b.route('**/api/workspace', route => route.request().method() === 'PUT' ? route.fulfill({status: 500, contentType: 'application/json', body: JSON.stringify({error: '테스트 저장 실패'})}) : route.continue());
  await b.getByRole('button', {name: '추가하기', exact: true}).click();
  await b.getByRole('status').filter({hasText: '테스트 저장 실패'}).waitFor();
  assert.equal(await b.locator('[name=title]').inputValue(), '실패 후 재시도'); assert.equal((await workspace()).tasks.length, 1);
  await b.unroute('**/api/workspace'); await finish(b); assert.equal((await workspace()).tasks.length, 2);
  await a.close(); await b.close();
});

test('example UI is removed and old samples stay hidden; responsive menus and forms fit small screens', async () => {
  const example = task('[예시] 기존 작업', {demo: true}); await reset({tasks: [example]}); const page = await openPage();
  assert.equal(await page.locator('.task').count(), 0);
  assert.equal(await page.getByRole('button', {name: '예시 보기', exact: true}).count(), 0);
  assert.equal(await page.locator('#demo, .sample-badge').count(),0);
  await add(page, {title: '실제 작업', project: '룸', assignees: ['윤서영'], due: '2026-10-22'});
  assert.equal(await page.getByRole('button', {name: '[예시] 기존 작업', exact: true}).count(), 0);
  assert.ok((await workspace()).tasks.some(t => t.id === example.id && t.demo));
  for (const viewport of [{width: 1366, height: 768}, {width: 768, height: 1024}, {width: 390, height: 844}, {width: 320, height: 740}]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();
    assert.equal(await page.locator('main').evaluate(el=>el.inert),true);
    const lastMenuButton=viewport.width<=600?'#mobileSettings':'.drawer [data-view="자료실"]';
    await page.keyboard.press('Shift+Tab');assert.equal(await page.locator(lastMenuButton).evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Tab');assert.equal(await page.locator('#closeMenu').evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Escape');assert.equal(await page.locator('main').evaluate(el=>el.inert),false);
    if(viewport.width<=600){
      assert.equal(await page.locator('#settings').isVisible(),false);
      await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();
      const settings=page.locator('#mobileSettings');
      assert.equal(await settings.innerText(),'');
      assert.ok((await settings.boundingBox()).height>=44);
      await settings.click();await page.locator('dialog[open]').waitFor();
      assert.equal(await page.locator('.drawer').count(),0);
      await page.getByRole('button',{name:'닫기',exact:true}).click();
      assert.equal(await page.locator('#menu').evaluate(el=>el===document.activeElement),true);
    }else assert.equal(await page.locator('#settings').isVisible(),true);
    for (const view of ['작업 현황', '전체 일정', '자료실', '홈']) {
      await go(page, view); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.locator('#demo, .sample-badge').count(),0);
      assert.equal(await page.getByRole('button',{name:example.title,exact:true}).count(),0);
    }
    await page.locator('[data-add]').first().click();
    assert.equal(await page.locator('dialog').evaluate(el => el.scrollWidth > el.clientWidth), false);
    assert.equal(await page.locator('dialog').evaluate(el => el.getBoundingClientRect().width > innerWidth), false);
    if ([1366, 390].includes(viewport.width)) await page.screenshot({path: 'task-form-' + viewport.width + '.png', fullPage: true});
    await page.getByRole('button', {name: '취소', exact: true}).click();
  }
  assert.equal((await workspace()).tasks.length, 2); await page.close();
});

test('slow saves queue every completion change, including reopening the same task', async()=>{
  const a=task('빠른 체크 A'),b=task('빠른 체크 B');await reset({tasks:[a,b]});
  const page=await openPage('작업 현황');await page.getByRole('button',{name:'전체',exact:true}).click();
  await page.route('**/api/workspace',async route=>{if(route.request().method()==='PUT')await new Promise(r=>setTimeout(r,350));await route.continue()});
  await page.getByRole('checkbox',{name:'빠른 체크 A 완료',exact:true}).check();
  await page.getByRole('checkbox',{name:'빠른 체크 B 완료',exact:true}).check();
  await page.getByRole('checkbox',{name:'빠른 체크 A 완료',exact:true}).uncheck();
  await page.waitForFunction(()=>document.querySelector('#syncIndicator')?.textContent==='');
  const data=await workspace();assert.equal(data.tasks.find(t=>t.id===a.id).done,false);assert.equal(data.tasks.find(t=>t.id===b.id).done,true);
  await page.reload();await go(page,'작업 현황');await page.getByRole('button',{name:'전체',exact:true}).click();
  assert.equal(await page.getByRole('checkbox',{name:'빠른 체크 A 완료',exact:true}).isChecked(),false);
  assert.equal(await page.getByRole('checkbox',{name:'빠른 체크 B 완료',exact:true}).isChecked(),true);await page.close();
});

test('four browsers can add concurrently; different fields merge without overwriting another member',async()=>{
  await reset();const pages=await Promise.all(team.map(()=>openPage('작업 현황')));
  await Promise.all(pages.map(async(page,i)=>{
    await page.locator('[data-add]').click();await page.locator('[name=title]').fill('동시 등록 '+i);
    await page.locator('[name=project]').selectOption(i%2?'룸':'리비두비');await page.locator('[name=due]').fill('2026-10-22');
    await page.locator('[data-member="'+team[i]+'"]').click();
  }));
  await Promise.all(pages.map(page=>finish(page)));assert.equal((await workspace()).tasks.length,4);
  const target=(await workspace()).tasks[0];const [a,b]=pages;
  for(const page of [a,b]){await page.reload();await go(page,'작업 현황');await page.getByRole('button',{name:target.title,exact:true}).click()}
  await a.locator('[name=title]').fill('이름만 수정');await finish(a,'저장하기');
  await b.locator('[name=due]').fill('2026-10-27');await finish(b,'저장하기');
  const saved=(await workspace()).tasks.find(t=>t.id===target.id);assert.equal(saved.title,'이름만 수정');assert.equal(saved.due,'2026-10-27');
  await Promise.all(pages.map(page=>page.close()));
});

test('delete, undo and trash restore work; deleting a linked event preserves task deadline',async()=>{
  const event=review({id:'linked-review'}),item=task('삭제 복원 작업',{dueMode:'linked-review',due:''});
  await reset({tasks:[item],events:[event]});const page=await openPage('작업 현황');
  await page.getByRole('button',{name:item.title,exact:true}).click();await page.getByRole('button',{name:'삭제',exact:true}).click();
  await page.locator('dialog').waitFor({state:'hidden'});assert.ok((await workspace()).tasks[0].deletedAt);
  await page.getByRole('button',{name:'되돌리기',exact:true}).click();await page.getByRole('button',{name:item.title,exact:true}).waitFor();
  assert.equal((await workspace()).tasks[0].deletedAt,undefined);
  await page.getByRole('button',{name:item.title,exact:true}).click();await page.getByRole('button',{name:'삭제',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'작업실 설정',exact:true}).click();await page.getByRole('button',{name:'삭제한 항목',exact:true}).click();
  await page.getByRole('button',{name:'복원',exact:true}).click();await page.getByText('삭제한 항목이 없어요.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'닫기',exact:true}).click();await go(page,'전체 일정');
  await page.getByRole('button',{name:'수정',exact:true}).click();await page.getByRole('button',{name:'삭제',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});
  const data=await workspace();assert.ok(data.events[0].deletedAt);assert.equal(data.tasks[0].dueMode,'custom');assert.equal(data.tasks[0].due,event.date);
  await page.getByRole('button',{name:'되돌리기',exact:true}).click();await page.getByRole('button',{name:'수정',exact:true}).waitFor();
  assert.equal((await workspace()).tasks[0].dueMode,'linked-review');
  const {readdir}=await import('node:fs/promises');assert.ok((await readdir(dir+'/backups')).length>0);
  await page.close();
});

test('local API rejects cross-origin writes, invalid content and dangerous links without changing saved data',async()=>{
  await reset();const before=await workspace();
  const cross=await fetch(base+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json',Origin:'https://outside.example'},body:JSON.stringify(before)});assert.equal(cross.status,403);
  assert.equal((await fetch(base+'/api/workspace',{method:'PUT',body:'bad'})).status,415);
  assert.equal((await put({...before,tasks:[task('보호',{link:'https://user:secret@example.com'})]})).status,400);
  assert.deepEqual(await workspace(),before);
});

test('completion is preserved after the review date; completed work can be reopened and unfinished work never expires',async()=>{
  const completed=task('완료 기록 보존',{due:'2026-10-20'}),unfinished=task('남은 작업 보존',{due:'2026-10-19'});
  await reset({tasks:[completed,unfinished],events:[review({date:'2026-10-21'})]});
  const page=await openPage();
  await page.getByRole('checkbox',{name:completed.title+' 완료',exact:true}).check();
  await page.locator('.task.done').waitFor();
  assert.ok(await page.getByRole('button',{name:completed.title,exact:true}).isVisible());
  await go(page,'작업 현황');
  assert.equal(await page.getByRole('button',{name:completed.title,exact:true}).count(),0);
  await page.getByRole('button',{name:'완료',exact:true}).click();
  assert.ok(await page.getByRole('button',{name:completed.title,exact:true}).isVisible());
  await page.clock.setSystemTime(new Date('2026-10-24T03:00:00Z'));
  await page.reload();await page.locator('.team-profiles').waitFor();
  assert.equal(await page.getByRole('button',{name:completed.title,exact:true}).count(),0);
  assert.ok(await page.getByRole('button',{name:unfinished.title,exact:true}).isVisible());
  let data=await workspace();assert.equal(data.tasks.length,2);assert.equal(data.tasks.find(t=>t.id===completed.id).done,true);assert.equal(data.tasks.find(t=>t.id===completed.id).completedOn,'2026-10-19');
  await go(page,'작업 현황');await page.getByRole('button',{name:'완료',exact:true}).click();
  await page.getByRole('checkbox',{name:completed.title+' 완료',exact:true}).uncheck();
  await page.locator('.full-list .task').waitFor({state:'hidden'});
  data=await workspace();assert.equal(data.tasks.find(t=>t.id===completed.id).done,false);
  await page.getByRole('button',{name:'미완료',exact:true}).click();
  assert.ok(await page.getByRole('button',{name:completed.title,exact:true}).isVisible());await page.close();
});

test('home rolls over while open, scopes review cycles per project, and keeps newly finished overdue work until the next review',async()=>{
  const old=task('지난 리비두비 완료',{done:true,completedOn:'2026-10-19',due:'2026-10-20'});
  const legacy=task('기존 완료 이력',{done:true,due:'2026-10-20'});
  const room=task('룸 컨펌 전 완료',{project:'룸',done:true,completedOn:'2026-10-19',due:'2026-10-20'});
  const overdue=task('뒤늦게 끝낸 작업',{due:'2026-10-18'});
  await reset({tasks:[old,legacy,room,overdue],events:[
    review({project:'리비두비',date:'2026-10-21'}),review({project:'룸',date:'2026-10-23'}),review({date:'2026-10-26'}),
  ]});
  const page=await openPage('홈',{width:1440,height:900});
  await page.clock.setSystemTime(new Date('2026-10-21T14:59:59Z'));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  assert.ok(await page.getByRole('button',{name:old.title,exact:true}).isVisible());
  await page.clock.setSystemTime(new Date('2026-10-21T15:00:01Z'));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByRole('button',{name:old.title,exact:true}).waitFor({state:'hidden'});
  assert.equal(await page.getByRole('button',{name:legacy.title,exact:true}).count(),0);
  assert.ok(await page.getByRole('button',{name:room.title,exact:true}).isVisible());
  assert.ok(await page.getByRole('button',{name:overdue.title,exact:true}).isVisible());
  await page.getByRole('checkbox',{name:overdue.title+' 완료',exact:true}).check();
  await page.locator('.project:not(.room) .task.done').waitFor();
  assert.equal((await workspace()).tasks.find(t=>t.id===overdue.id).completedOn,'2026-10-22');
  assert.ok(await page.getByRole('button',{name:overdue.title,exact:true}).isVisible());
  await page.clock.setSystemTime(new Date('2026-10-27T03:00:00Z'));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.locator('.project .task').first().waitFor({state:'hidden'});
  assert.equal(await page.locator('.project .task').count(),0);
  assert.equal((await workspace()).tasks.length,4);
  await go(page,'작업 현황');await page.getByRole('button',{name:'완료',exact:true}).click();
  assert.equal(await page.locator('.full-list .task').count(),4);
  await page.getByRole('checkbox',{name:old.title+' 완료',exact:true}).uncheck();
  await page.getByRole('button',{name:old.title,exact:true}).waitFor({state:'hidden'});
  await go(page,'홈');assert.ok(await page.getByRole('button',{name:old.title,exact:true}).isVisible());
  await page.close();
});

test('production bundle supports invite-name entry without email and rejects missing or invalid invitations',async()=>{
  const build=spawn(process.execPath,['scripts/build.mjs','--require-cloud'],{env:{...process.env,SUPABASE_URL:'https://qa-only.supabase.co',SUPABASE_ANON_KEY:'sb_publishable_qa_only_not_a_real_key'}});
  let buildErrors='';build.stderr.on('data',chunk=>buildErrors+=chunk);
  assert.equal(await new Promise(resolve=>build.once('exit',resolve)),0,buildErrors);
  const prefix='/graduation-dashboard/';
  const staticServer=http.createServer(async(req,res)=>{
    const path=new URL(req.url,'http://local').pathname;
    if(!path.startsWith(prefix)||path.includes('..')){res.writeHead(404);res.end();return}
    const relative=path.slice(prefix.length)||'index.html';
    try{const data=await readFile('site/'+relative);res.setHeader('Content-Type',/\.(m?js)$/.test(relative)?'text/javascript':relative.endsWith('.css')?'text/css':'text/html');res.end(data)}catch{res.writeHead(404);res.end()}
  });
  await new Promise(resolve=>staticServer.listen(0,'127.0.0.1',resolve));
  const page=await browser.newPage();page.setDefaultTimeout(10000);
  const url='http://127.0.0.1:'+staticServer.address().port+prefix;
  const uid='00000000-0000-4000-8000-000000000001';
  const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:uid,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.qa';
  let joined=false,fail=true,signups=0;
  await page.route('https://qa-only.supabase.co/**',route=>{
    const path=new URL(route.request().url()).pathname;
    let body={},status=200;
    if(path==='/auth/v1/signup'){signups++;body={access_token:token,refresh_token:'qa-refresh',token_type:'bearer',expires_in:3600,user:{id:uid,aud:'authenticated',role:'authenticated',is_anonymous:true,created_at:new Date().toISOString()}}}
    else if(path.endsWith('/rpc/join_workspace')){
      if(fail){status=403;body={code:'42501',message:'Invalid invite'}}
      else {joined=true;body={display_name:'임다혜',user_id:uid}}
    }else if(path.endsWith('/rpc/get_workspace_identity'))body=joined?{display_name:'임다혜',user_id:uid}:null;
    else if(path.includes('/workspace_state'))body={payload:{tasks:[],events:[],links:{}},revision:0};
    else if(path.endsWith('/rpc/leave_workspace'))joined=false;
    route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  try{
    await page.goto(url);
    await page.getByText('팀에서 받은 초대 링크로 들어와주세요.',{exact:true}).waitFor();
    assert.equal(signups,0);assert.equal(await page.locator('input[type=email]').count(),0);
    await page.goto(url+'#invite='+'a'.repeat(43));await page.reload();
    await page.getByRole('button',{name:'임다혜',exact:true}).click();
    await page.getByRole('status').filter({hasText:'잘못된 초대 링크'}).waitFor();
    assert.equal(await page.locator('.team-profiles').count(),0);
    fail=false;await page.getByRole('button',{name:'임다혜',exact:true}).click();
    await page.locator('.team-profiles').waitFor();assert.equal(signups,1);
    assert.equal(new URL(page.url()).hash,'');
    await page.reload();await page.locator('.team-profiles').waitFor();
    await page.getByRole('button',{name:'작업실 설정',exact:true}).click();
    await page.getByRole('button',{name:'이 브라우저에서 나가기',exact:true}).click();
    await page.getByText('팀에서 받은 초대 링크로 들어와주세요.',{exact:true}).waitFor();
    assert.equal(joined,false);
  }finally{await page.close();await new Promise(resolve=>staticServer.close(resolve))}
});

test('capture eight project tasks and the working more transition with isolated preview data',async()=>{
  const titles={
    '리비두비':['패키지 메인 시안','패키지 뒷면 정보 정리','브랜드 컬러 최종 확인','일러스트 에셋 정리','리플릿 레이아웃','제품 목업 제작','인쇄 사양 확인','전시 패널 디자인','발주 파일 점검','최종 인쇄 파일 전달'],
    '룸':['메인 화면 인터랙션','온보딩 흐름 정리','공간 모델링 수정','서비스 소개 영상','프로토타입 연결','인터뷰 결과 반영','전시 영상 자막','발표 자료 레이아웃','모바일 화면 점검','최종 프로토타입 공유'],
  };
  const tasks=Object.entries(titles).flatMap(([project,names])=>names.map((title,i)=>task(title,{project,due:'2026-10-'+String(20+Math.floor(i/3)).padStart(2,'0'),assignees:i%3===0?[team[i%4],team[(i+1)%4]]:[team[i%4]]})));
  await reset({tasks,events:[review()]});
  const page=await openPage('홈',{width:1440,height:1000});
  await page.evaluate(()=>document.fonts.ready);
  for(const selector of ['.project:not(.room)','.project.room']){
    assert.equal(await page.locator(selector+' .task').count(),8);
    assert.equal(await page.locator(selector+' .remaining').textContent(),'2개 더 보기');
  }
  await page.screenshot({path:'home-eight-preview.png',fullPage:true});
  await page.locator('.project:not(.room) .remaining').click();
  assert.equal(await page.locator('.filters .active').textContent(),'전체');
  assert.equal(await page.locator('.full-list .task').count(),10);
  assert.equal(await page.locator('[data-project-filter="리비두비"]').getAttribute('aria-pressed'),'true');
  assert.ok(await page.getByRole('button',{name:'발주 파일 점검',exact:true}).isVisible());
  assert.ok(await page.getByRole('button',{name:'최종 인쇄 파일 전달',exact:true}).isVisible());
  await page.screenshot({path:'tasks-more-preview.png',fullPage:true});
  await go(page,'홈');await page.locator('.project.room .remaining').click();
  assert.equal(await page.locator('[data-project-filter="룸"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.full-list .task').count(),10);
  assert.ok((await page.locator('.full-list .project-label').allTextContents()).every(label=>label==='룸'));
  await page.screenshot({path:'tasks-room-preview.png',fullPage:true});
  await page.close();
});

test('project filters combine with completion and person; adding defaults to selected project and all-project navigation resets scope',async()=>{
  await reset({tasks:[
    task('같은 작업명',{project:'리비두비',assignees:['이유진']}),
    task('같은 작업명',{project:'룸',assignees:['임다혜']}),
    task('리비두비 완료',{done:true,assignees:['이유진']}),
    task('룸 완료',{project:'룸',done:true,assignees:['임다혜']}),
    task('공동 작업',{assignees:['이유진','임다혜']}),
  ]});
  const page=await openPage('작업 현황');
  assert.equal(await page.locator('.full-list .task').count(),3);
  await page.getByRole('button',{name:'룸',exact:true}).click();
  assert.equal(await page.locator('.full-list .task').count(),1);
  assert.equal(await page.locator('.full-list .project-label').textContent(),'룸');
  await page.getByRole('button',{name:'완료',exact:true}).click();
  assert.ok(await page.getByRole('button',{name:'룸 완료',exact:true}).isVisible());
  await page.getByRole('button',{name:'리비두비',exact:true}).click();
  assert.ok(await page.getByRole('button',{name:'리비두비 완료',exact:true}).isVisible());
  await page.locator('#person').selectOption('임다혜');assert.equal(await page.locator('.full-list .task').count(),0);
  await page.getByRole('button',{name:'미완료',exact:true}).click();
  assert.ok(await page.getByRole('button',{name:'공동 작업',exact:true}).isVisible());
  await page.getByRole('button',{name:'전체 프로젝트',exact:true}).click();
  assert.equal(await page.locator('.full-list .task').count(),2);
  await page.getByRole('button',{name:'룸',exact:true}).click();
  await page.locator('[data-add]').click();assert.equal(await page.locator('[name=project]').inputValue(),'룸');
  await page.locator('[name=title]').fill('룸에서 바로 추가');await page.locator('[name=due]').fill('2026-10-22');
  await finish(page);assert.ok(await page.getByRole('button',{name:'룸에서 바로 추가',exact:true}).isVisible());
  await go(page,'홈');await page.getByRole('button',{name:'전체 작업 ›',exact:true}).click();
  assert.equal(await page.locator('[data-project-filter=""]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.filters .active').textContent(),'전체');
  for(const width of [320,390,768]){
    await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.getByRole('button',{name:'리비두비',exact:true}).click();
    assert.equal(await page.locator('[data-project-filter="리비두비"]').getAttribute('aria-pressed'),'true');
  }
  await page.close();
});

test('mobile drawer settings exports a readable backup without changing workspace data',async()=>{
  await reset({tasks:[task('백업 확인 작업')]});
  const page=await openPage('홈',{width:390,height:844});
  const before=await workspace();
  await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();
  await page.getByRole('button',{name:'작업실 설정',exact:true}).click();
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'백업 내려받기',exact:true}).click();
  const download=await downloaded;
  assert.match(download.suggestedFilename(),/^졸업전시-백업-.*\.json$/);
  const backup=JSON.parse(await readFile(await download.path(),'utf8'));
  assert.deepEqual(backup.tasks,before.tasks);
  assert.deepEqual(backup.events,before.events);
  assert.deepEqual(backup.links,before.links);
  assert.deepEqual(await workspace(),before);
  await page.close();
});
