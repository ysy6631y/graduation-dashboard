import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {emptyWorkspace,validWorkspace,mergeWorkspace,persistWorkspace,WorkspaceConflict} from './public/workspace-core.mjs';
import {ensureBudget,upsertQuote,setDecision,removeQuote,budgetSummary,projectItems,itemQuotes,itemKey} from './public/budget-core.mjs';
const clone=structuredClone;
const quote=(state,project='LUUM',title='패키지',amount=100000,id='q1')=>upsertQuote(state,project,{title,amount},id);

test('budget calculations: grouping, lowest vs confirmed, replacement, cancellation, edit, deletion and project isolation',()=>{
  const s=emptyWorkspace();assert(validWorkspace(s));ensureBudget(s).settings.push({id:'LUUM',perPerson:125000,members:4});
  const item=quote(s);quote(s,'LUUM',' 패키지 ',80000,'q2');quote(s,'리비두비','패키지',90000,'q3');
  assert.equal(projectItems(s,'LUUM').length,1);assert.equal(itemQuotes(s,item).length,2);
  assert.equal(budgetSummary(s,'LUUM').total,500000);assert.equal(budgetSummary(s,'LUUM').confirmed,0);
  setDecision(s,item,'confirmed','q1');assert.equal(budgetSummary(s,'LUUM').remaining,400000);
  setDecision(s,item,'confirmed','q2');assert.equal(budgetSummary(s,'LUUM').remaining,420000);
  quote(s,'LUUM','패키지',110000,'q2');assert.equal(budgetSummary(s,'LUUM').remaining,390000);
  setDecision(s,item,'inquiry');assert.equal(budgetSummary(s,'LUUM').confirmed,0);
  setDecision(s,item,'confirmed','q2');removeQuote(s,'q2');assert.equal(budgetSummary(s,'LUUM').confirmed,0);
  removeQuote(s,'q1');assert.equal(projectItems(s,'LUUM').length,0);assert.equal(projectItems(s,'리비두비').length,1);
  assert(validWorkspace(s));
});

test('budget validation rejects unsafe money, missing references, cross-project confirmation and malformed budget',()=>{
  const s=emptyWorkspace(),item=quote(s);quote(s,'리비두비','패키지',100,'q2');
  for(const amount of [-1,0.1,Infinity,NaN,1e9+1,'100']){const n=clone(s);n.budget.quotes[0].amount=amount;assert(!validWorkspace(n));}
  for(const budget of [null,{},[],{...s.budget,version:2}])assert(!validWorkspace({...s,budget}));
  const n=clone(s);n.budget.items[0].decision={status:'confirmed',quoteId:'q2'};assert(!validWorkspace(n));
  n.budget.items[0].decision={status:'comparing',quoteId:null};n.budget.quotes[0].url='javascript:alert(1)';assert(!validWorkspace(n));
  assert.throws(()=>setDecision(s,item,'confirmed','q2'));
});

test('simultaneous quote additions to the same product merge, competing selections conflict, old clients retain new budget data',async()=>{
  const base=emptyWorkspace(),a=clone(base),b=clone(base);
  quote(a,'LUUM','패키지',100,'q1');quote(b,'LUUM','패키지',200,'q2');
  const merged=mergeWorkspace(base,a,{...b,revision:1});assert(validWorkspace(merged));assert.equal(merged.budget.items.length,1);assert.equal(merged.budget.quotes.length,2);
  const c=clone(merged),d=clone(merged),key=itemKey('LUUM','패키지');setDecision(c,key,'confirmed','q1');setDecision(d,key,'confirmed','q2');
  assert.throws(()=>mergeWorkspace(merged,c,d),WorkspaceConflict);
  const old=clone(base);old.links['참고']='https://example.com';const retained=mergeWorkspace(base,old,merged);assert.deepEqual(retained.budget,merged.budget);
  const deletion=clone(merged);removeQuote(deletion,'q1');
  await assert.rejects(persistWorkspace({compareAndSwap:async()=>({ok:false,state:deletion})},merged,c),WorkspaceConflict);
  const edited=clone(c);edited.budget.quotes.find(q=>q.id==='q1').amount=333;const withLink=clone(c);withLink.links['참고']='https://example.com';
  const safe=mergeWorkspace(c,edited,withLink);assert.equal(budgetSummary(safe,'LUUM').confirmed,333);assert.equal(safe.links['참고'],'https://example.com');
});

test('budget SQL migration is additive and repeatable; real RPC validates budget, CAS, backups, memberships and revocation',async()=>{
  const db=new PGlite();try{
    await db.exec(`create role anon;create role authenticated;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    grant usage on schema public,auth to anon,authenticated;grant execute on all functions in schema auth to anon,authenticated;`);
    for(const file of ['202610190001_workspace_hardening.sql','202610190002_invite_access.sql','202610210001_optional_task_deadline.sql'])await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
    const legacy={tasks:[{id:'legacy',title:'기존 데이터',project:'룸',assignees:[],dueMode:'custom',due:'',done:false}],events:[],links:{}};
    await db.query('insert into workspace_state(id,payload,revision) values(1,$1,7)',[legacy]);
    const migration=await readFile('supabase/migrations/202610220001_budget_quotes.sql','utf8');await db.exec(migration);await db.exec(migration);
    const saved=(await db.query('select payload,revision from workspace_state')).rows[0];assert.deepEqual(saved.payload,legacy);assert.equal(saved.revision,7);
    await db.query("insert into workspace_access(id,invite_hash) values(1,encode(sha256(convert_to($1,'UTF8')),'hex'))",['a'.repeat(43)]);
    await db.exec(`set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'`);
    await assert.rejects(db.query('select save_workspace_state(7,$1)',[legacy]),/Team access required/);
    await db.query('select join_workspace($1,$2)',['a'.repeat(43),'이유진']);
    const payload=clone(legacy),item=quote(payload);quote(payload,'리비두비','패키지',200,'q2');ensureBudget(payload).settings.push({id:'LUUM',perPerson:125000,members:4});setDecision(payload,item,'confirmed','q1');
    assert.equal((await db.query('select workspace_payload_valid($1) ok',[payload])).rows[0].ok,true);
    assert.equal((await db.query('select save_workspace_state(7,$1) ok',[payload])).rows[0].ok,true);
    assert.equal((await db.query('select save_workspace_state(7,$1) ok',[legacy])).rows[0].ok,false);
    for(const value of [-1,0.5,1000000001,'100',null]){const bad=clone(payload);bad.budget.quotes[0].amount=value;assert.equal((await db.query('select workspace_payload_valid($1) ok',[bad])).rows[0].ok,false);}
    const bad=clone(payload);bad.budget.items[0].decision.quoteId='q2';await assert.rejects(db.query('select save_workspace_state(8,$1)',[bad]),/Invalid workspace payload/);
    assert.equal((await db.query('select count(*)::int n from workspace_backups')).rows[0].n,1);
    await db.query('select leave_workspace()');assert.equal((await db.query('select count(*)::int n from workspace_state')).rows[0].n,0);
  }finally{await db.close()}
});
