import {createWorkspaceClient} from './client.mjs';
import {changedFields, equal, mergeWorkspace, validWorkspace, safeURL, showTaskOnHome, WorkspaceConflict, emptyWorkspace} from './workspace-core.mjs';
const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const projects=['리비두비','룸'];let state={tasks:[],events:[],links:{},revision:0},view='홈',filter='미완료',taskProject='',person='',menu=false,busy=false;
const team=['이유진','임다혜','윤서영','강주원'];
let activeMember='';
try{const saved=localStorage.getItem('workspace-profile');if(team.includes(saved))activeMember=saved}catch{}
const visibleTasks=()=>state.tasks.filter(t=>!t.deletedAt&&!t.demo);
const visibleEvents=()=>state.events.filter(e=>!e.deletedAt&&!e.demo);
const iconPaths={menu:'M4 4h16v16H4z M9 4v16',home:'m3 10 9-7 9 7 M5 9v11h5v-6h4v6h5V9',tasks:'M8 5H5v16h14V5h-3 M8 3h8v5H8z M8 12h8 M8 16h6',calendar:'M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4 M8 14h2 M14 14h2 M8 17h2',folder:'M3 7h7l2 2h9v11H3z M3 7V4h7l2 3h7v2',people:'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M2 20v-2a6 6 0 0 1 12 0v2 M16 5a3 3 0 0 1 0 6 M17 14a5 5 0 0 1 5 5',close:'m6 6 12 12 M18 6 6 18'};
function icon(name){return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${iconPaths[name]||iconPaths.folder}"/></svg>`}
function avatar(name){const index=team.indexOf(name);return `<span class="avatar avatar-${index<0?'other':index}" title="${esc(name)}" aria-hidden="true">${esc(name.slice(-2))}</span>`}
function assigneeProfiles(names){return names.length?`<span class="avatar-stack" role="img" aria-label="담당자: ${esc(names.join(', '))}" title="${esc(names.join(' · '))}">${names.slice(0,4).map(avatar).join('')}</span>`:'<span class="unassigned">미정</span>'}
function profile(name){modal(`${name} 프로필`,`<div class="profile-detail">${avatar(name)}<div><strong>${name}</strong><p>졸업전시 팀</p></div></div>`,'담당 작업 보기',async()=>{activeMember=name;person=name;taskProject='';filter='미완료';view='작업 현황';try{localStorage.setItem('workspace-profile',name)}catch{}$('#dialog').close();render()})}
const id=()=>crypto.randomUUID(),today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}),validURL=s=>Boolean(s)&&safeURL(s),date=d=>d?`${Number(d.slice(5,7))}.${Number(d.slice(8,10))}`:'날짜 확인 필요';
const eventStart=e=>e.startDate||e.date;
const eventEnd=e=>e.endDate||e.date;
const eventDate=e=>e.kind==='review'?eventStart(e):eventEnd(e);
const includesDate=(e,d)=>eventStart(e)<=d&&d<=eventEnd(e);
function eventRange(e){const start=eventStart(e),end=eventEnd(e),showYear=start.slice(0,4)!==end.slice(0,4)||start.slice(0,4)!==today().slice(0,4);const label=d=>(showYear?d.slice(0,4)+'.':'')+date(d);return start===end?label(start):`${label(start)} – ${label(end)}`}
const due=t=>t.dueMode==='custom'?t.due:(()=>{const e=state.events.find(e=>e.id===t.dueMode);return e?eventDate(e):''})();
const sorted=arr=>[...arr].sort((a,b)=>(due(a)||'9999').localeCompare(due(b)||'9999')||a.title.localeCompare(b.title));
function nextReview(project){return visibleEvents().filter(e=>e.kind==='review'&&eventEnd(e)>=today()&&(!project||!e.project||e.project===project)).sort((a,b)=>eventDate(a).localeCompare(eventDate(b)))[0]}
const days=d=>Math.round((Date.parse(d+'T00:00:00+09:00')-Date.parse(today()+'T00:00:00+09:00'))/86400000);
const dday=d=>!d?'미정':days(d)===0?'D-day':days(d)>0?'D−'+days(d):'D+'+Math.abs(days(d));
let resourceTab='Figma',weekAnchor=today(),monthAnchor=today().slice(0,7),renderedDay=today();
const shiftDay=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};
function markers(d){const ps=new Set([...visibleEvents().filter(e=>includesDate(e,d)).map(e=>e.project),...visibleTasks().filter(t=>!t.done&&due(t)===d).map(t=>t.project)]);return [...ps].map(p=>`<i class="dot ${p==='룸'?'blue':p==='리비두비'?'pink':'gray'}"></i>`).join('')}
function calendarDay(d){return `<button class="calendar-day ${d===today()?'today':''} ${markers(d)?'has-event':''}" data-day="${d}" aria-label="${d} 일정"><span>${Number(d.slice(8))}</span><em>${markers(d)}</em></button>`}
function weekCalendar(){const day=new Date(weekAnchor+'T12:00:00Z').getUTCDay();const first=shiftDay(weekAnchor,-((day+6)%7));return `<section class="week-calendar" aria-label="주간 캘린더"><div class="calendar-heading"><strong>${weekAnchor.slice(0,4)}년 ${Number(weekAnchor.slice(5,7))}월</strong><div><button class="quiet small" data-week="-7" aria-label="이전 주">‹</button><button class="quiet small" data-week="7" aria-label="다음 주">›</button><button class="quiet small" data-week="today">오늘</button></div></div><div class="calendar-grid weekdays">${['월','화','수','목','금','토','일'].map(d=>`<span>${d}</span>`).join('')}</div><div class="calendar-grid week-days">${Array.from({length:7},(_,i)=>calendarDay(shiftDay(first,i))).join('')}</div></section>`}
function monthCalendar(){const first=monthAnchor+'-01',offset=(new Date(first+'T12:00:00Z').getUTCDay()+6)%7;const next=new Date(first+'T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);const count=new Date(next.getTime()-86400000).getUTCDate();return `<section class="month-calendar" aria-label="월간 캘린더"><div class="section-head"><h2>전체 일정</h2><button class="quiet small" data-view="전체 일정" aria-label="전체 일정 열기">↗</button></div><div class="calendar-heading"><strong>${monthAnchor.slice(0,4)}년 ${Number(monthAnchor.slice(5))}월</strong><div><button class="quiet small" data-month="-1" aria-label="이전 달">‹</button><button class="quiet small" data-month="1" aria-label="다음 달">›</button></div></div><div class="calendar-grid weekdays">${['월','화','수','목','금','토','일'].map(d=>`<span>${d}</span>`).join('')}</div><div class="calendar-grid month-days">${'<span></span>'.repeat(offset)}${Array.from({length:count},(_,i)=>calendarDay(monthAnchor+'-'+String(i+1).padStart(2,'0'))).join('')}</div><div class="calendar-legend"><span><i class="dot pink"></i> 리비두비</span><span><i class="dot blue"></i> 룸</span><span><i class="dot gray"></i> 공통</span></div></section>`}
function dayDetails(d){const events=visibleEvents().filter(e=>includesDate(e,d)),tasks=sorted(visibleTasks().filter(t=>due(t)===d));modal(`${d.replaceAll('-','.')} 일정`,`${events.map(e=>`<button type="button" class="day-event" data-day-event="${e.id}"><span class="day-event-title">${esc(e.title)}</span> <span>${eventRange(e)} · 수정 ↗</span></button>`).join('')}${tasks.map(t=>`<button type="button" class="day-event" data-day-task="${t.id}">${esc(t.title)} <span>${esc(t.project)}${t.done?' · 완료':''}</span></button>`).join('')}${events.length||tasks.length?'':'<div class="empty">일정이 없어요.</div>'}`,'',()=>{});document.querySelectorAll('[data-day-event]').forEach(b=>b.onclick=()=>eventForm(b.dataset.dayEvent));document.querySelectorAll('[data-day-task]').forEach(b=>b.onclick=()=>editTask(b.dataset.dayTask))}
let client, writeTail=Promise.resolve(), pendingWrites=0, lastConflict=null, lastWriteError=false, stopSubscription=null, toastTimer, entering=false;
const pendingDone=new Map();
function toast(message,{label,action,duration=5000}={}) {
  const element=$('#toast');clearTimeout(toastTimer);
  element.innerHTML=`<span>${esc(message)}</span>${action?`<button type="button">${esc(label||'다시 시도')}</button>`:''}`;
  element.style.display='flex';
  if(action)element.querySelector('button').onclick=async()=>{element.style.display='none';await action()};
  toastTimer=setTimeout(()=>element.style.display='none',duration);
}
function syncIndicator(){const el=$('#syncIndicator');if(!el)return;el.textContent=!navigator.onLine?'오프라인':lastWriteError?'저장 확인 필요':busy?'저장 중…':'';el.dataset.error=String(lastWriteError||!navigator.onLine)}
function update(mutator,base=null) {
  pendingWrites++;busy=true;syncIndicator();
  const job=writeTail.then(async()=>{
    lastConflict=null;
    try {
      const before=structuredClone(base||state),next=structuredClone(before);mutator(next);
      if(!validWorkspace(next))throw Error('작업명, 마감일, 일정 기간 또는 링크를 확인해주세요.');
      state=await client.save(before,next);lastWriteError=false;render();return true;
    }catch(error){
      if(error instanceof WorkspaceConflict){state=error.latest;lastConflict=error;render()}
      lastWriteError=true;toast(error.message||'저장하지 못했어요. 연결을 확인하고 다시 시도해주세요.');return false;
    }finally{pendingWrites--;busy=pendingWrites>0;syncIndicator()}
  });
  writeTail=job.catch(()=>{});return job;
}
async function setCompletion(taskId,done) {
  const token=Symbol();pendingDone.set(taskId,{done,token});syncIndicator();
  const ok=await update(next=>{const item=next.tasks.find(t=>t.id===taskId&&!t.deletedAt);if(!item)throw Error('삭제된 작업이에요. 삭제한 항목에서 확인해주세요.');if(item.done!==done){item.done=done;item.completedOn=done?today():null}});
  if(pendingDone.get(taskId)?.token===token)pendingDone.delete(taskId);
  render();
  if(!ok)toast('완료 상태를 저장하지 못했어요.',{label:'다시 시도',action:()=>setCompletion(taskId,done),duration:15000});
}
function taskRow(t){t={...t,done:pendingDone.get(t.id)?.done??t.done};const names=t.assignees.length?t.assignees.join(' · '):'미정';if(view==='홈')return `<div class="task focus-task ${t.done?'done':''}"><input type="checkbox" aria-label="${esc(t.title)} 완료" data-check="${t.id}" ${t.done?'checked':''}><button class="task-body" data-edit="${t.id}" aria-label="${esc(t.title)}" title="${esc(t.title)}"><span class="task-name">${esc(t.title)}</span><span class="assignees">${assigneeProfiles(t.assignees)}</span></button><span class="task-date">${date(due(t))}</span><span class="task-link-cell">${t.link?`<a class="task-link" href="${esc(t.link)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(t.title)} 작업 링크 열기">↗</a>`:''}</span></div>`;return `<div class="task ${t.done?'done':''}"><input type="checkbox" aria-label="${esc(t.title)} 완료" data-check="${t.id}" ${t.done?'checked':''}><button class="task-body" data-edit="${t.id}" aria-label="${esc(t.title)}" title="${esc(t.title)}"><span class="task-name">${esc(t.title)}</span><span class="project-label ${t.project==='룸'?'room-label':''}">${esc(t.project)}</span></button><span class="assignees" title="${esc(names)}">${assigneeProfiles(t.assignees)}</span><span class="task-date">${date(due(t))}</span><span class="task-link-cell">${t.link?`<a class="task-link" href="${esc(t.link)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(t.title)} 작업 링크 열기">↗</a>`:''}</span></div>`}
function eventRow(e,edit=false){return `<div class="event"><div class="date-box"><small>${Number(eventStart(e).slice(5,7))}월</small><b>${Number(eventStart(e).slice(8))}</b></div><div class="description"><strong>${esc(e.title)}</strong><p><span class="event-period">${eventRange(e)}</span> · ${esc(e.project||'공통')} · ${e.kind==='review'?'다음 컨펌':e.kind==='final'?'졸업전시 마감':'주요 일정'}</p></div><span class="dday">${dday(eventDate(e))}</span>${edit?`<button class="small quiet" data-event="${e.id}">수정</button>`:''}</div>`}
function resources(){return `<aside class="resources"><div class="section-head"><h2>자료 바로가기</h2><button class="quiet small" data-view="자료실" aria-label="자료실 열기">↗</button></div><div class="resource-tabs">${['Figma','Google Drive'].map(t=>`<button data-resource-tab="${t}" class="${resourceTab===t?'active':''}">${t==='Google Drive'?'Drive':t}</button>`).join('')}</div>${projects.map(p=>{const key=p+' '+resourceTab,url=state.links[key];return `<div class="resource"><span class="resource-icon ${p==='룸'?'room-icon':''}">${resourceTab==='Figma'?'F':'△'}</span>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(key)} 열기">${p} <span>↗</span></a>`:`<span class="resource-name">${p}</span>`}<button class="quiet small" data-link="${key}" aria-label="${key} ${url?'수정':'등록'}">${url?'수정':'등록'}</button></div>`}).join('')}</aside>`}
function home(){const review=nextReview(),final=visibleEvents().filter(e=>e.kind==='final'&&eventEnd(e)>=today()).sort((a,b)=>eventDate(a).localeCompare(eventDate(b)))[0];return `<section class="workspace-summary"><div><span class="summary-label">다음 컨펌</span>${review?`<button class="review-date" data-event="${review.id}"><strong>${date(eventDate(review))}</strong><span>${new Date(eventDate(review)+'T12:00:00+09:00').toLocaleDateString('ko-KR',{weekday:'long',timeZone:'Asia/Seoul'})} · ${dday(eventDate(review))}</span></button>`:'<button class="review-date unregistered" data-event="new">일정 등록 ＋</button>'}</div><div class="final-summary"><span class="summary-label">졸업전시</span>${final?`<button class="final-date" data-event="${final.id}">${dday(eventDate(final))}</button>`:'<span class="final-date">미정</span>'}<button class="quiet small" data-view="전체 일정">전체 일정 ↗</button></div></section><div class="focus-workspace"><section class="review-work"><div class="section-head"><h2>이번 컨펌까지 할 일</h2><button class="quiet small" data-add="">＋ 작업 추가</button></div><div class="projects">${projects.map((p,i)=>{const event=nextReview(p),tasks=sorted(visibleTasks().filter(t=>t.project===p&&showTaskOnHome(t,visibleEvents(),today())&&(!event||due(t)<=event.date)&&(!person||t.assignees.includes(person)))).sort((a,b)=>Number(a.done)-Number(b.done));const limit=8;return `<section class="project ${i?'room':''}"><div class="project-header"><h3><i class="project-dot"></i>${p}</h3><span>${event?date(eventDate(event))+' 컨펌':'컨펌 미정'}</span></div>${tasks.length?tasks.slice(0,limit).map(taskRow).join(''):'<div class="empty">이번 컨펌까지 등록된 작업이 없어요.</div>'}<button class="add-inline" data-add="${p}">＋ 작업 추가</button>${tasks.length>limit?`<button class="remaining quiet small" data-view="작업 현황" data-task-filter="전체" data-task-project="${p}">${tasks.length-limit}개 더 보기</button>`:''}</section>`}).join('')}</div><div class="work-footer"><button class="quiet small" data-view="작업 현황" data-task-filter="전체">전체 작업 ›</button></div></section><aside class="work-materials"><h2>작업 자료</h2>${['Figma','Google Drive'].map(type=>`<section class="material-card"><h3><span>${type==='Figma'?'F':'▱'}</span>${type}</h3><div class="material-projects">${projects.map(p=>{const key=p+' '+type,url=state.links[key];return `<div>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(key)} 열기">${p} ↗</a>`:`<span>${p}</span>`}<button class="quiet small" data-link="${key}" aria-label="${key} ${url?'수정':'등록'}">${url?'수정':'연결'}</button></div>`}).join('')}</div></section>`).join('')}</aside></div>`}
function render(){renderedDay=today();const people=[...new Set([...team,...visibleTasks().flatMap(t=>t.assignees)])];$('#app').innerHTML=`<aside class="shell-rail"><button class="rail-toggle" id="menu" aria-label="메뉴 열기" aria-expanded="${menu}">${icon('menu')}</button><nav aria-label="빠른 메뉴">${[['홈','home'],['작업 현황','tasks'],['전체 일정','calendar'],['자료실','folder']].map(([v,i])=>`<button class="rail-link ${view===v?'active':''}" data-view="${v}" aria-label="${v} 바로가기" title="${v}">${icon(i)}</button>`).join('')}</nav><button class="rail-bottom" id="settings" aria-label="작업실 설정" title="작업실 설정">${icon('people')}</button></aside><header><div class="breadcrumb"><span>졸업전시</span><span>›</span><strong>${view}</strong></div><div class="header-right"><span id="syncIndicator" role="status" aria-live="polite"></span><div class="team-profiles" aria-label="담당자 프로필">${team.map(name=>`<button class="profile-button ${activeMember===name?'selected':''}" data-profile="${name}" aria-label="${name} 프로필" title="${name}">${avatar(name)}</button>`).join('')}</div></div></header>${menu?`<div class="shade" id="shade"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="메뉴"><div class="section-head"><h2>졸업전시</h2><button id="closeMenu" aria-label="메뉴 닫기">${icon('close')}</button></div><nav>${['홈','작업 현황','전체 일정','자료실'].map(v=>`<button data-view="${v}" ${v===view?'class="primary"':''}>${icon(({'홈':'home','작업 현황':'tasks','전체 일정':'calendar','자료실':'folder'})[v])}<span>${v}</span></button>`).join('')}</nav></aside>`:''}<main><div class="titlebar"><div><h1>${view==='홈'?'Workspace':view}</h1></div><div class="toolbar">${view==='홈'||view==='작업 현황'?`<select id="person" aria-label="담당자 필터"><option value="">모든 담당자</option>${people.map(p=>`<option ${p===person?'selected':''}>${esc(p)}</option>`).join('')}</select><button class="primary" data-add="">＋ 작업 추가</button>`:view==='전체 일정'?'<button class="primary" data-event="new">＋ 일정 등록</button>':''}</div></div>${view==='홈'?home():view==='자료실'?resources():view==='전체 일정'?`<div class="schedule-browse">${weekCalendar()}${monthCalendar()}</div><div class="all-events">${visibleEvents().sort((a,b)=>eventStart(a).localeCompare(eventStart(b))).map(e=>eventRow(e,true)).join('')||'<div class="empty">등록된 주요 일정이 없어요.</div>'}</div><h2 style="margin:28px 0 16px">작업 마감 일정</h2><div class="full-list">${sorted(visibleTasks().filter(t=>!t.done)).map(taskRow).join('')||'<div class="empty">예정된 작업이 없어요.</div>'}</div>`:`<div class="task-filters"><div class="project-filters" role="group" aria-label="프로젝트 필터">${[['','전체 프로젝트'],...projects.map(p=>[p,p])].map(([value,label])=>`<button type="button" data-project-filter="${value}" class="${taskProject===value?'active':''} ${value==='룸'?'room-filter':value?'livy-filter':''}" aria-pressed="${taskProject===value}">${label}</button>`).join('')}</div><div class="filters">${['미완료','완료','전체'].map(f=>`<button data-filter="${f}" class="${filter===f?'active':''}">${f}</button>`).join('')}</div></div><div class="full-list">${sorted(visibleTasks().filter(t=>(!taskProject||t.project===taskProject)&&(filter==='전체'||t.done===(filter==='완료'))&&(!person||t.assignees.includes(person)))).map(taskRow).join('')||'<div class="empty">여기에 표시할 작업이 없어요.</div>'}</div>`}</main>`;
document.querySelectorAll('main, header, .shell-rail').forEach(element=>element.inert=menu);
$('#menu').onclick=()=>{menu=true;render();$('#closeMenu').focus()};$('#closeMenu')?.addEventListener('click',closeMenu);$('#shade')?.addEventListener('click',closeMenu);
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;taskProject=b.dataset.taskProject||'';if(b.dataset.taskFilter)filter=b.dataset.taskFilter;menu=false;render()});document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render()});$('#person')?.addEventListener('change',e=>{person=e.target.value;render()});document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>editTask(null,b.dataset.add||taskProject));document.querySelectorAll('[data-check]').forEach(b=>b.onchange=()=>setCompletion(b.dataset.check,b.checked));document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editTask(b.dataset.edit));document.querySelectorAll('[data-event]').forEach(b=>b.onclick=()=>eventForm(b.dataset.event));document.querySelectorAll('[data-link]').forEach(b=>b.onclick=()=>linkForm(b.dataset.link));document.querySelectorAll('[data-profile]').forEach(b=>b.onclick=()=>profile(b.dataset.profile));document.querySelectorAll('[data-project-filter]').forEach(b=>b.onclick=()=>{taskProject=b.dataset.projectFilter;render()});$('#settings').onclick=settings;syncIndicator();
}
function closeMenu(){menu=false;render();$('#menu').focus()}document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu)closeMenu()});
document.addEventListener('keydown',event=>{
  if(!menu||event.key!=='Tab')return;
  const controls=[...document.querySelectorAll('.drawer button')],first=controls[0],last=controls.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
});
document.addEventListener('click',e=>{const b=e.target.closest('[data-member]');if(!b)return;const field=b.closest('.member-picker'),input=field.querySelector('[name=assignees]');const names=input.value.split(',').map(n=>n.trim()).filter(Boolean),name=b.dataset.member;input.value=(names.includes(name)?names.filter(n=>n!==name):[...names,name]).join(', ');field.querySelectorAll('[data-member]').forEach(option=>option.setAttribute('aria-pressed',String(input.value.split(',').map(n=>n.trim()).includes(option.dataset.member))))});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.week){weekAnchor=b.dataset.week==='today'?today():shiftDay(weekAnchor,Number(b.dataset.week));render()}if(b.dataset.month){const d=new Date(monthAnchor+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+Number(b.dataset.month));monthAnchor=d.toISOString().slice(0,7);render()}if(b.dataset.day)dayDetails(b.dataset.day);if(b.dataset.resourceTab){resourceTab=b.dataset.resourceTab;render()}});
function modal(title,body,action,onSubmit){const d=$('#dialog');d.className='';d.innerHTML=`<form id="modalForm"><div class="modal-head"><h2>${title}</h2><button type="button" id="closeDialog" aria-label="닫기">×</button></div>${body}<div class="modal-actions"><button type="button" id="cancel">취소</button>${action?`<button class="primary" type="submit">${action}</button>`:''}</div></form>`;if(!d.open)d.showModal();$('#closeDialog').onclick=$('#cancel').onclick=()=>d.close();$('#modalForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await onSubmit(new FormData(e.target))}finally{if(b.isConnected)b.disabled=false}}}
const options=(chosen='',unset=true)=>`${unset?'<option value="">프로젝트 확인 필요</option>':''}${projects.map(p=>`<option ${p===chosen?'selected':''}>${p}</option>`).join('')}`;
function fields(t={}) {
  const members=[...new Set([...team,...(t.assignees||[])])];
  const linkedEvent=state.events.find(e=>e.id===t.dueMode);
  return `<div class="form-grid">
    <label class="wide">작업명<input name="title" required maxlength="300" placeholder="어떤 작업을 하나요?" value="${esc(t.title)}"></label>
    <label>프로젝트<select name="project" required><option value="">프로젝트 선택</option>${options(t.project,false)}</select></label>
    <label>마감일<input type="date" name="due" required value="${esc(t.id?due(t):'')}"></label>
    <fieldset class="member-picker wide"><legend>담당자 <span>여러 명 선택 가능</span></legend>
      <div class="member-options">${members.map(name=>`<button type="button" class="member-option" data-member="${esc(name)}" aria-pressed="${t.assignees?.includes(name)||false}">${avatar(name)}<span>${esc(name)}</span></button>`).join('')}</div>
      <input type="hidden" name="assignees" value="${esc(t.assignees?.join(', '))}">
    </fieldset>
  </div>
  ${linkedEvent?`<p class="hint">${esc(linkedEvent.title)} 일정과 연결돼 있어요. 마감일을 수정하면 개별 날짜로 저장돼요.</p>`:''}
  <p id="taskDuplicate" class="warning" hidden>같은 프로젝트에 같은 이름의 작업이 있어요.</p>
  <details class="task-options" ${t.link?'open':''}><summary>작업 링크 · 선택</summary><label><span class="visually-hidden">작업 링크</span><input type="url" name="link" placeholder="https://www.figma.com/…" value="${esc(t.link||'')}"></label></details>`;
}
function readTask(f,old={}) {
  const project=f.get('project'),deadline=f.get('due');
  const linkedEvent=state.events.find(e=>e.id===old.dueMode);
  const keepLink=linkedEvent&&deadline===eventDate(linkedEvent)&&(!linkedEvent.project||linkedEvent.project===project);
  const t={...old,id:old.id||id(),title:String(f.get('title')||'').trim(),project,
    assignees:[...new Set(String(f.get('assignees')||'').split(',').map(s=>s.trim()).filter(Boolean))],
    dueMode:keepLink?linkedEvent.id:'custom',due:deadline,
    link:String(f.get('link')||'').trim(),done:old.done||false};
  if(!t.title||!t.project)throw Error('작업명과 프로젝트를 확인해주세요.');
  if(!t.due)throw Error('마감일을 선택해주세요.');
  if(t.link&&!validURL(t.link))throw Error('http 또는 https 링크를 입력해주세요.');
  return t;
}
function editTask(taskId,project='') {
  const t=structuredClone(state.tasks.find(t=>t.id===taskId)||{id:id(),project,assignees:team.includes(person)?[person]:[],dueMode:'custom',due:''});
  let editBase=structuredClone(state);
  modal(taskId?'작업 수정':'작업 추가',fields(t),taskId?'저장하기':'추가하기',async f=>{
    try {
      const next=readTask(f,t);
      if(!await update(n=>{
        if(!taskId){n.tasks.push(next);return}
        const current=n.tasks.find(x=>x.id===taskId&&!x.deletedAt);
        if(!current)throw Error('삭제된 작업이에요. 삭제한 항목에서 확인해주세요.');
        Object.assign(current,changedFields(t,next));
      },editBase)){
        if(lastConflict){editBase=structuredClone(state);showConflict('tasks',taskId)}return;
      }
      if(!taskId){filter='미완료';if(view==='작업 현황'&&taskProject)taskProject=next.project;if(person&&!next.assignees.includes(person))person='';}
      render();
      if(!taskId&&view==='홈'&&!document.querySelector(`[data-edit="${next.id}"]`)){view='작업 현황';render();}
      $('#dialog').close();
      toast(taskId?'작업을 저장했어요.':'작업을 추가했어요.');
    }catch(e){toast(e.message)}
  });
  $('#dialog').classList.add('task-dialog');
  if(taskId)addDeleteButton('tasks',taskId);
  const checkDuplicate=()=>{
    const title=$('#modalForm [name=title]').value.replace(/\s/g,'');
    const selected=$('#modalForm [name=project]').value;
    $('#taskDuplicate').hidden=!title||!state.tasks.some(other=>!other.deletedAt&&other.id!==t.id&&Boolean(other.demo)===Boolean(t.demo)&&other.project===selected&&other.title.replace(/\s/g,'')===title);
  };
  $('#modalForm [name=title]').addEventListener('input',checkDuplicate);
  $('#modalForm [name=project]').addEventListener('change',checkDuplicate);
  checkDuplicate();
}
function eventForm(eventId) {
  const e=structuredClone(state.events.find(e=>e.id===eventId)||{id:id(),kind:'review',project:'',date:''});
  const isNew=eventId==='new';let editBase=structuredClone(state);
  modal(eventId==='new'?'주요 일정 등록':'주요 일정 수정',`<div class="form-grid">
    <label class="wide">일정 이름<input name="title" required maxlength="100" value="${esc(e.title)}" placeholder="예: 리비두비 2차 컨펌"></label>
    <label>종류<select name="kind">${[['review','다음 컨펌'],['final','졸업전시 마감'],['milestone','마일스톤']].map(([v,l])=>`<option value="${v}" ${v===e.kind?'selected':''}>${l}</option>`).join('')}</select></label>
    <label>프로젝트<select name="project"><option value="">공통</option>${options(e.project,false)}</select></label>
    <label>시작일<input name="startDate" type="date" required value="${esc(eventStart(e))}"></label>
    <label>종료일<input name="endDate" type="date" required value="${esc(eventEnd(e))}" min="${esc(eventStart(e))}"></label>
    </div><p class="hint">하루 일정은 시작일과 종료일을 같게 선택하세요.</p>
    ${state.tasks.some(t=>t.dueMode===e.id)?'<p class="hint">연결된 작업의 마감일도 함께 변경돼요.</p>':''}`,'일정 저장',async f=>{
      const next={...e,id:e.id||id(),...Object.fromEntries(f)};
      next.title=next.title.trim();
      if(!next.title||!next.startDate||!next.endDate||next.endDate<next.startDate)return toast('일정 이름과 시작일·종료일을 확인해주세요.');
      next.date=eventDate(next);
      if(await update(n=>{
        if(isNew){n.events.push(next);return}
        const current=n.events.find(x=>x.id===eventId&&!x.deletedAt);
        if(!current)throw Error('삭제된 일정이에요. 삭제한 항목에서 확인해주세요.');
        Object.assign(current,changedFields(e,next));
      },editBase)){
        render();$('#dialog').close();toast('일정을 저장했어요.');
      }else if(lastConflict){editBase=structuredClone(state);showConflict('events',eventId)}
    });
  $('#dialog').classList.add('event-dialog');
  if(!isNew)addDeleteButton('events',eventId);
  const start=$('#modalForm [name=startDate]'),end=$('#modalForm [name=endDate]');
  let previousStart=start.value;
  start.addEventListener('input',()=>{
    if(!end.value||(isNew&&end.value===previousStart))end.value=start.value;
    end.min=start.value;previousStart=start.value;
  });
}
function linkForm(key) {
  let base=structuredClone(state);
  modal(key,`<label>공유 링크<input name="url" type="url" value="${esc(state.links[key]||'')}" placeholder="https://…"></label><p class="hint">비워서 저장하면 연결을 해제해요.</p>`,'저장하기',async f=>{
    const url=f.get('url').trim();if(url&&!validURL(url))return toast('http 또는 https 링크를 입력해주세요.');
    if(await update(next=>next.links[key]=url,base))$('#dialog').close();
    else if(lastConflict){base=structuredClone(state);showConflict('links',key)}
  });
}
function showConflict(collection,recordId) {
  $('#conflictNotice')?.remove();
  const current=collection==='links'?state.links[recordId]:state[collection].find(item=>item.id===recordId);
  const panel=document.createElement('div');panel.id='conflictNotice';panel.className='conflict-notice';panel.setAttribute('role','alert');
  const latest=collection==='links'?(current||'연결 없음'):(current?.title||'삭제된 항목');
  panel.innerHTML=`<p>${current?.deletedAt?'팀원이 삭제한 항목이에요.':'현재 저장된 내용: '+esc(latest)}</p><p>입력은 유지했어요. 다시 저장하면 직접 바꾼 부분만 반영해요.</p>`;
  $('#modalForm .modal-head').after(panel);
}
function addDeleteButton(collection,recordId) {
  const button=document.createElement('button');button.type='button';button.className='delete-action';button.textContent='삭제';
  button.onclick=async()=>{button.disabled=true;const ok=await deleteItem(collection,recordId);if(!ok&&button.isConnected)button.disabled=false};
  $('#modalForm .modal-actions').prepend(button);
}
async function deleteItem(collection,recordId) {
  const before=structuredClone(state);let after;
  const ok=await update(next=>{
    const target=next[collection].find(item=>item.id===recordId&&!item.deletedAt);if(!target)throw Error('이미 삭제된 항목이에요.');
    if(collection==='events')for(const task of next.tasks){if(task.dueMode===recordId){task.due=eventDate(target);task.dueMode='custom'}}
    target.deletedAt=new Date().toISOString();after=structuredClone(next);
  },before);
  if(!ok)return false;
  $('#dialog').close();
  toast('삭제한 항목으로 옮겼어요.',{label:'되돌리기',duration:15000,action:async()=>{
    if(await update(next=>Object.assign(next,mergeWorkspace(after,before,next))))toast('복원했어요.');
  }});
  return true;
}
function deletedItems() {
  const rows=['tasks','events'].flatMap(collection=>state[collection].filter(item=>item.deletedAt&&!item.demo).map(item=>({collection,item})));
  modal('삭제한 항목',rows.length?rows.map(({collection,item})=>`<div class="trash-row"><div><strong>${esc(item.title)}</strong><p>${esc(item.project||'공통')} · ${collection==='tasks'?'작업':'일정'}</p></div><button type="button" data-restore="${esc(item.id)}" data-collection="${collection}">복원</button></div>`).join(''):'<div class="empty">삭제한 항목이 없어요.</div>','',()=>{});
  document.querySelectorAll('[data-restore]').forEach(button=>button.onclick=async()=>{
    button.disabled=true;
    if(await update(next=>{const item=next[button.dataset.collection].find(item=>item.id===button.dataset.restore);if(!item)throw Error('항목을 찾지 못했어요.');item.deletedAt=null})){deletedItems();toast('복원했어요.')}
    else if(button.isConnected)button.disabled=false;
  });
}
function downloadBackup() {
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download='졸업전시-백업-'+today()+'-r'+state.revision+'.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function settings() {
  const connection=client.mode==='cloud'?'공유 작업실 · '+esc(client.member?.display_name||''):'이 컴퓨터의 작업실';
  modal('작업실 설정',`<p class="connection-info">${connection}</p><div class="settings-actions"><button type="button" id="openTrash">삭제한 항목</button><button type="button" id="downloadBackup">백업 내려받기</button>${client.mode==='cloud'?'<button type="button" id="signOut">이 브라우저에서 나가기</button><p class="hint">다시 들어오려면 초대 링크가 필요해요.</p>':''}</div>`,'',()=>{});
  $('#openTrash').onclick=deletedItems;$('#downloadBackup').onclick=downloadBackup;
  $('#signOut')?.addEventListener('click',async()=>{
    if(busy)return toast('저장이 끝난 뒤 로그아웃해주세요.');
    try{await client.logout();$('#dialog').close();state=emptyWorkspace();loginScreen()}catch{toast('작업실에서 나가지 못했어요. 다시 시도해주세요.')}
  });
}
function loginScreen() {
  $('#app').className='auth-screen';
  const validInvite=/^[A-Za-z0-9_-]{40,128}$/.test(client?.invite||'');
  $('#app').innerHTML=`<main class="auth-card"><h1>졸업전시 작업실</h1><p>${validInvite?'이름을 선택하면 바로 들어갈 수 있어요.':'팀에서 받은 초대 링크로 들어와주세요.'}</p>${validInvite?`<div class="entry-profiles" role="group" aria-label="작업실 참여 이름">${team.map(name=>`<button type="button" data-join="${name}">${avatar(name)}<span>${name}</span></button>`).join('')}</div>`:''}<p id="loginStatus" role="status"></p></main>`;
  document.querySelectorAll('[data-join]').forEach(button=>button.onclick=async()=>{
    if(entering)return;entering=true;document.querySelectorAll('[data-join]').forEach(b=>b.disabled=true);
    try{
      await client.join(button.dataset.join);activeMember=button.dataset.join;person='';taskProject='';view='홈';
      try{localStorage.setItem('workspace-profile',activeMember)}catch{}
      await load();
    }catch(error){$('#loginStatus').textContent=error.message}
    finally{entering=false;document.querySelectorAll('[data-join]').forEach(b=>b.disabled=false)}
  });
}
async function load() {
  try {
    client||=await createWorkspaceClient();
    if(client.mode==='cloud'&&!await client.identity()){loginScreen();return}
    const next=await client.read();state=next;$('#app').className='';render();
    stopSubscription?.();stopSubscription=client.subscribe?.(()=>refresh());
  }catch(error){
    $('#app').className='auth-screen';
    $('#app').innerHTML=`<main class="auth-card"><h1>작업실에 연결하지 못했어요.</h1><p>${esc(error.message||'연결을 확인해주세요.')}</p><button id="retryConnect">다시 연결</button>${client?.mode==='cloud'&&client.user?'<button id="errorSignOut">이 브라우저에서 나가기</button>':''}</main>`;
    $('#retryConnect').onclick=load;$('#errorSignOut')?.addEventListener('click',async()=>{await client.logout();loginScreen()});
  }
}
async function refresh() {
  if(!client||busy||$('#dialog').open||(client.mode==='cloud'&&!client.user))return;
  try{const next=await client.read();if(next.revision>state.revision||renderedDay!==today()){if(next.revision>=state.revision)state=next;render()}syncIndicator()}catch{const el=$('#syncIndicator');if(el){el.textContent='연결 확인 필요';el.dataset.error='true'}}
}
await load();
client?.onSessionChange?.(()=>{if(entering)return;state=emptyWorkspace();load()});
setInterval(refresh,4000);
window.addEventListener('focus',refresh);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
window.addEventListener('online',()=>{syncIndicator();refresh()});
window.addEventListener('offline',syncIndicator);
window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue=''}});
