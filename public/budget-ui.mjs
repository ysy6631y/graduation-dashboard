import {budgetProjects, budgetOf, projectItems, budgetSummary, upsertQuote, setDecision, removeQuote, cleanTitle, MAX_AMOUNT} from './budget-core.mjs';

export function createBudgetUI({getState, update, render, modal, toast, esc, icon, mergeWorkspace, safeURL}) {
  let project = 'LUUM';
  const $ = s => document.querySelector(s);
  const money = n => new Intl.NumberFormat('ko-KR').format(n) + '원';
  const itemById = id => budgetOf(getState()).items.find(i => i.id === id);
  const focus = selector => $(selector)?.focus();
  function row(quote) {
    const item=itemById(quote.itemId), confirmed=item.decision.quoteId===quote.id;
    return `<div class="estimate-row ${confirmed?'is-confirmed':''}" data-quote-id="${esc(quote.id)}">
      <button type="button" class="estimate-edit" data-edit-quote="${esc(quote.id)}" aria-label="${esc(item.title)}${quote.vendor?' · '+esc(quote.vendor):''} 수정">
        <span class="estimate-title">${esc(item.title)}</span><span class="estimate-vendor">${esc(quote.vendor||'—')}</span><span class="estimate-price">${money(quote.amount)}</span>
      </button><label class="estimate-confirm"><input type="checkbox" data-confirm-quote="${esc(quote.id)}" aria-label="${esc(item.title)}${quote.vendor?' · '+esc(quote.vendor):''} 확정" ${confirmed?'checked':''}><span class="visually-hidden">확정</span></label>
    </div>`;
  }
  function html() {
    const quotes=budgetOf(getState()).quotes.filter(q=>!q.deletedAt&&itemById(q.itemId)?.project===project);
    const confirmedCount=quotes.filter(q=>itemById(q.itemId).decision.quoteId===q.id).length;
    return `<section class="budget-page" aria-label="견적 관리"><div class="project-filters budget-projects" role="group" aria-label="견적 프로젝트">${budgetProjects.map(p=>`<button type="button" data-budget-project="${p}" aria-pressed="${p===project}" class="${p===project?'active ':''}${p==='LUUM'?'room-filter':'livy-filter'}">${p}</button>`).join('')}</div>
      <div class="estimate-summary"><span>총 견적</span><strong id="budgetConfirmed">${money(budgetSummary(getState(),project).confirmed)}</strong><small>확정 ${confirmedCount}건</small></div>
      <section class="budget-list" aria-label="견적 목록"><div class="section-head"><h2>견적 목록</h2><button class="primary" id="addQuote">＋ 견적 추가</button></div>
      ${quotes.length?`<div class="estimate-head" aria-hidden="true"><span>제작물</span><span>업체</span><span>견적 금액</span><span>확정</span></div>${quotes.map(row).join('')}`:`<div class="budget-empty">${icon('budget')}<strong>아직 등록된 견적이 없어요</strong><p>제작물 이름과 금액을 입력해 첫 견적을 등록해보세요.</p></div>`}</section></section>`;
  }
  function notice(message) {
    let el=$('#quoteError');
    if(!el){el=document.createElement('p');el.id='quoteError';el.className='budget-form-error';el.setAttribute('role','alert');$('#modalForm .modal-actions').before(el);}
    el.textContent=message;
  }
  function editQuote(quoteId=null) {
    const old=budgetOf(getState()).quotes.find(q=>q.id===quoteId), item=old&&itemById(old.itemId);
    const selectedProject=item?.project||project, original=old?{title:item.title,amount:old.amount,vendor:old.vendor,url:old.url,memo:old.memo}:null;
    const wasConfirmed=Boolean(old&&item.decision.quoteId===quoteId);
    let base=structuredClone(getState());
    const titles=projectItems(getState(),selectedProject).map(i=>i.title);
    modal(quoteId?'견적 수정':'견적 추가',`<p class="quote-project-label">${selectedProject}</p><div class="form-grid"><label>제작물 이름<input name="title" list="budgetItemNames" required maxlength="100" value="${esc(item?.title||'')}" placeholder="이름을 입력하세요" autocomplete="off" aria-describedby="quoteNameHint"><datalist id="budgetItemNames">${titles.map(t=>`<option value="${esc(t)}"></option>`).join('')}</datalist><span id="quoteNameHint" class="quote-field-hint">새 이름을 입력하거나 등록된 제작물을 선택할 수 있어요.</span></label><label>견적 금액 <span class="optional">원</span><input name="amount" type="number" inputmode="numeric" required min="0" max="${MAX_AMOUNT}" step="1" value="${old?.amount??''}" placeholder="0"></label></div><details class="task-options" ${old&&(old.vendor||old.url||old.memo)?'open':''}><summary>업체 정보·메모 <span class="optional">선택</span></summary><div class="form-grid"><label>업체명<input name="vendor" maxlength="100" value="${esc(old?.vendor||'')}" placeholder="예: 전시인쇄소"></label><label>업체 링크<input name="url" type="url" maxlength="4000" value="${esc(old?.url||'')}" placeholder="https://…"></label><label class="wide">한 줄 메모<input name="memo" maxlength="300" value="${esc(old?.memo||'')}" placeholder="예: 배송비 포함 · 제작 5일"></label></div></details><label class="quote-confirm-field"><input type="checkbox" name="confirmed" ${item?.decision.quoteId===quoteId?'checked':''}><span>제작비로 확정</span></label>`,'저장하기',async form=>{
      const values={title:cleanTitle(form.get('title')),amount:Number(form.get('amount')),vendor:form.get('vendor').trim(),url:form.get('url').trim(),memo:form.get('memo').trim()};
      if(!values.title)return notice('제작물 이름을 입력해주세요.');
      if(!safeURL(values.url))return notice('http 또는 https 업체 링크를 입력해주세요.');
      const targetId=quoteId||crypto.randomUUID(), confirmed=form.has('confirmed');let nextItem;
      const ok=await update(next=>{
        if(quoteId&&!budgetOf(next).quotes.some(q=>q.id===quoteId&&!q.deletedAt))throw Error('이미 삭제된 견적이에요. 목록을 확인해주세요.');
        let edited=values;
        if(original){
          const current=budgetOf(next).quotes.find(q=>q.id===quoteId), currentItem=budgetOf(next).items.find(i=>i.id===current.itemId);
          edited={title:currentItem.title,amount:current.amount,vendor:current.vendor,url:current.url,memo:current.memo,
            ...Object.fromEntries(Object.entries(values).filter(([key,value])=>value!==original[key]))};
        }
        nextItem=upsertQuote(next,selectedProject,edited,targetId);
        if(confirmed!==wasConfirmed||(wasConfirmed&&nextItem!==item.id)){
          if(confirmed)setDecision(next,nextItem,'confirmed',targetId);
          else if(budgetOf(next).items.find(i=>i.id===nextItem).decision.quoteId===targetId)setDecision(next,nextItem,'comparing');
        }
      },base);
      if(ok){project=selectedProject;render();$('#dialog').close();focus('#addQuote');toast(quoteId?'견적을 수정했어요.':'견적을 추가했어요.');}
      else {base=structuredClone(getState());notice('저장하지 못했어요. 입력은 유지했습니다. 최신 내용과 연결 상태를 확인하고 다시 저장해주세요.');}
    });
    $('#dialog').classList.add('task-dialog','quote-dialog');
    if(quoteId){const button=document.createElement('button');button.type='button';button.className='delete-action';button.textContent='삭제';button.onclick=()=>deleteQuote(quoteId);$('#modalForm .modal-actions').prepend(button);}
  }
  function deleteQuote(quoteId) {
    const quote=budgetOf(getState()).quotes.find(q=>q.id===quoteId&&!q.deletedAt);if(!quote)return;
    const item=itemById(quote.itemId);
    modal('견적을 삭제할까요?',`<p>${esc(item.title)} · ${money(quote.amount)}</p><p class="hint">${item.decision.quoteId===quoteId?'확정 제작비에서 제외됩니다. ':''}삭제 후 되돌릴 수 있어요.</p>`,'삭제하기',async()=>{
      const before=structuredClone(getState());let after;
      if(await update(next=>{removeQuote(next,quoteId);after=structuredClone(next)},before)){
        $('#dialog').close();toast('견적을 삭제했어요.',{label:'되돌리기',duration:15000,action:async()=>{
          if(await update(next=>Object.assign(next,mergeWorkspace(after,before,next))))toast('견적을 복원했어요.');
        }});
      }else notice('삭제하지 못했어요. 연결 상태와 최신 견적을 확인해주세요.');
    });
  }
  function bind() {
    if(!$('.budget-page'))return;
    document.querySelectorAll('[data-budget-project]').forEach(b=>b.onclick=()=>{project=b.dataset.budgetProject;render();focus(`[data-budget-project="${project}"]`)});
    $('#addQuote').onclick=()=>editQuote();
    document.querySelectorAll('[data-edit-quote]').forEach(b=>b.onclick=()=>editQuote(b.dataset.editQuote));
    document.querySelectorAll('[data-confirm-quote]').forEach(b=>b.onchange=async()=>{
      const quote=budgetOf(getState()).quotes.find(q=>q.id===b.dataset.confirmQuote), checked=b.checked, keyboardFocus=b.matches(':focus-visible');
      b.disabled=true;
      if(!await update(next=>setDecision(next,quote.itemId,checked?'confirmed':'comparing',checked?quote.id:null),structuredClone(getState())))toast('확정 여부를 저장하지 못했어요. 다시 확인해주세요.');
      if(keyboardFocus)document.querySelectorAll('[data-confirm-quote]').forEach(el=>{if(el.dataset.confirmQuote===quote.id)el.focus()});
    });
  }
  return {html,bind,isEditing:()=>false,leave:()=>{}};
}
