import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, mergeWorkspace, persistWorkspace, validWorkspace, validDate, safeURL, WorkspaceConflict, changedFields} from './public/workspace-core.mjs';
import {createCloudClient} from './public/cloud.mjs';
import {showTaskOnHome} from './public/workspace-core.mjs';
import {spawnSync} from 'node:child_process';

const task=(id='a')=>({id,title:'시안 정리',project:'리비두비',assignees:[],dueMode:'custom',due:'2026-10-21',done:false,link:''});
const initial=()=>({...emptyWorkspace(),tasks:[task()]});
test('home review cycles hide only prior completed work; current, reopened and unmatched-project work stay visible',()=>{
  const events=[{id:'review',kind:'review',project:'리비두비',date:'2026-10-20',startDate:'2026-10-20',endDate:'2026-10-21'}];
  const done={...task(),done:true,completedOn:'2026-10-19'};
  assert.equal(showTaskOnHome(done,events,'2026-10-21'),true);
  assert.equal(showTaskOnHome(done,events,'2026-10-22'),false);
  assert.equal(showTaskOnHome({...done,completedOn:'2026-10-22'},events,'2026-10-22'),true);
  assert.equal(showTaskOnHome({...done,done:false},events,'2026-10-22'),true);
  assert.equal(showTaskOnHome({...done,project:'룸'},events,'2026-10-22'),true);
  assert.equal(showTaskOnHome(done,[{...events[0],project:''}],'2026-10-22'),false);
  assert.equal(showTaskOnHome(done,[{...events[0],endDate:'2026-10-24'}],'2026-10-22'),true);
  assert.equal(showTaskOnHome(done,[{...events[0],deletedAt:'2026-10-19T00:00:00Z'}],'2026-10-22'),true);
  assert.equal(showTaskOnHome({...done,completedOn:undefined,due:'2026-10-20'},events,'2026-10-22'),false);
  assert.equal(showTaskOnHome(done,[],'2026-10-22'),true);
  const invalid=initial();invalid.tasks[0].completedOn='2026-02-30';assert.equal(validWorkspace(invalid),false);
});
test('strict input validation blocks malformed dates, script URLs, duplicate IDs and invalid demo flags',()=>{
  assert.equal(validWorkspace(initial()),true);
  for(const value of ['2026-02-30','2026-13-01','2026-1-01',null])assert.equal(validDate(value),false);
  for(const value of ['javascript:alert(1)','https://user:password@example.com','not a link'])assert.equal(safeURL(value),false);
  for(const patch of [{demo:'false'},{deletedAt:'bad'},{link:17},{link:'x'.repeat(4001)},{due:'2026-02-30'}]){
    const data=initial();Object.assign(data.tasks[0],patch);assert.equal(validWorkspace(data),false);
  }
  const duplicated=initial();duplicated.tasks.push(task());assert.equal(validWorkspace(duplicated),false);
});
test('three-way merge preserves distinct additions and changes to different fields',()=>{
  const base=initial(),mine=structuredClone(base),theirs=structuredClone(base);
  mine.tasks[0].title='내 수정';mine.tasks.push(task('b'));
  theirs.revision=2;theirs.tasks[0].done=true;theirs.tasks.push(task('c'));theirs.links.Figma='https://figma.com';
  const merged=mergeWorkspace(base,mine,theirs);
  assert.equal(merged.tasks[0].title,'내 수정');assert.equal(merged.tasks[0].done,true);
  assert.deepEqual(new Set(merged.tasks.map(t=>t.id)),new Set(['a','b','c']));assert.equal(merged.links.Figma,'https://figma.com');
  assert.deepEqual(changedFields(base.tasks[0],mine.tasks[0]),{title:'내 수정'});
});
test('same-field and delete-versus-edit conflicts are explicit; reverse merge preserves unrelated edits',()=>{
  const base=initial(),mine=structuredClone(base),theirs=structuredClone(base);
  mine.tasks[0].title='내 수정';theirs.tasks[0].title='팀원 수정';
  assert.throws(()=>mergeWorkspace(base,mine,theirs),WorkspaceConflict);
  theirs.tasks[0]=task();theirs.tasks[0].deletedAt='2026-10-19T00:00:00Z';
  assert.throws(()=>mergeWorkspace(base,mine,theirs),WorkspaceConflict);
  const current=structuredClone(theirs);current.links.Figma='https://figma.com';
  const restored=mergeWorkspace(theirs,base,current);
  assert.equal(restored.tasks[0].deletedAt,undefined);assert.equal(restored.links.Figma,'https://figma.com');
});
test('four simultaneous clients merge without lost records',async()=>{
  let stored=emptyWorkspace();
  const adapter={read:async()=>structuredClone(stored),compareAndSwap:async(revision,payload)=>{
    await new Promise(resolve=>setTimeout(resolve,5));
    if(revision!==stored.revision)return {ok:false,state:structuredClone(stored)};
    stored={...structuredClone(payload),revision:revision+1};return {ok:true,state:structuredClone(stored)};
  }};
  await Promise.all(['a','b','c','d'].map(id=>persistWorkspace(adapter,emptyWorkspace(),{...emptyWorkspace(),tasks:[task(id)]})));
  assert.equal(stored.revision,4);assert.equal(stored.tasks.length,4);
});

function mockCloud({member={display_name:'이유진'},payload=emptyWorkspace(),signedIn=true}={}){
  let row={revision:0,payload},listener,removed=0;
  const sdk={auth:{
    getSession:async()=>({data:{session:signedIn?{user:{id:'user-1',email:'team@example.com'}}:null}}),
    onAuthStateChange:fn=>{listener=fn;return {data:{subscription:{unsubscribe(){}}}}},
    signOut:async()=>({error:null}),signInAnonymously:async()=>({data:{user:{id:'user-1',is_anonymous:true}},error:null}),
  },rpc:async(name,args)=>{
    if(name==='get_workspace_identity')return {data:member};
    if(name==='join_workspace'){
      if(args.invite_token!=='a'.repeat(43))return {error:{code:'42501'}};
      member={display_name:args.member_name,user_id:'user-1'};return {data:member};
    }
    if(name==='leave_workspace'){member=null;return {data:null}}
    if(name==='save_workspace_state'){
      const ok=args.expected_revision===row.revision;
      if(ok)row={payload:structuredClone(args.next_payload),revision:row.revision+1};
      return {data:ok};
    }
    return {data:true};
  },from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:structuredClone(row)})})})}),
  channel:()=>({on(){return this},subscribe(){return this}}),removeChannel:()=>removed++};
  return {sdk,emit:session=>listener('SIGNED_OUT',session),removed:()=>removed};
}
test('cloud adapter gates anonymous, unlisted and legacy data; CAS and sign-out use the real adapter contract',async()=>{
  const config={url:'https://test.supabase.co',anonKey:'public-test-only'};
  for(const [options,pattern] of [[{signedIn:false},/초대 링크/],[{member:null},/초대 링크/],[{payload:{tasks:[],links:[]}},/원본은 변경하지/]]){
    const mock=mockCloud(options),client=await createCloudClient(config,()=>mock.sdk);await assert.rejects(client.read(),pattern);
  }
  const mock=mockCloud(),client=await createCloudClient(config,()=>mock.sdk);
  const before=await client.read();const next={...before,tasks:[task()]};
  assert.equal((await client.save(before,next)).revision,1);
  assert.equal((await client.compareAndSwap(0,next)).ok,false);
  client.subscribe(()=>{});await client.logout();assert.equal(client.user,null);assert.equal(mock.removed(),1);
});
test('invite flow joins anonymously without email, rejects invalid links and clears access when leaving',async()=>{
  const mock=mockCloud({signedIn:false,member:null});
  const client=await createCloudClient({url:'https://test.supabase.co',anonKey:'public-test-only'},()=>mock.sdk);
  await assert.rejects(client.join('이유진'),/초대 링크/);
  client.invite='b'.repeat(43);await assert.rejects(client.join('이유진'),/잘못된 초대 링크/);
  client.invite='a'.repeat(43);await assert.rejects(client.join('다른 사람'),/이름/);
  await client.join('임다혜');assert.equal((await client.identity()).display_name,'임다혜');
  assert.equal((await client.read()).revision,0);await client.logout();assert.equal(client.invite,'');assert.equal(await client.identity(),null);
});
test('release build refuses missing cloud configuration and privileged server keys',()=>{
  const env={...process.env,SUPABASE_URL:'',SUPABASE_ANON_KEY:''};
  let run=spawnSync(process.execPath,['scripts/build.mjs','--require-cloud','--no-project-config'],{env,encoding:'utf8'});assert.notEqual(run.status,0);assert.match(run.stderr,/공유 저장소 설정 없이/);
  run=spawnSync(process.execPath,['scripts/build.mjs','--require-cloud'],{env:{...env,SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'sb_secret_DO_NOT_USE'},encoding:'utf8'});assert.notEqual(run.status,0);assert.match(run.stderr,/비밀 키는 배포할 수 없습니다/);
});
