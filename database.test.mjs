import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('invite-only RLS grants four email-free sessions access, rejects outsiders, and revokes old invitations and sessions',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
      grant usage on schema public,auth to anon,authenticated;grant execute on all functions in schema auth to anon,authenticated;`);
    await db.exec(await readFile('supabase/migrations/202610190001_workspace_hardening.sql','utf8'));
    const migration=await readFile('supabase/migrations/202610190002_invite_access.sql','utf8');
    await db.exec(migration);await db.exec(migration);
    const invite='a'.repeat(43),nextInvite='b'.repeat(43);
    await db.query("insert into public.workspace_access(id,invite_hash) values(1,encode(sha256(convert_to($1,'UTF8')),'hex'))",[invite]);
    await db.exec(`set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';`);
    assert.equal((await db.query('select public.get_workspace_identity() member')).rows[0].member,null);
    await assert.rejects(db.query('select public.initialize_workspace_state()'),/Team access required/);
    await assert.rejects(db.query('select public.join_workspace($1,$2)',[nextInvite,'이유진']),/Invalid invite/);
    await assert.rejects(db.query('select public.join_workspace($1,$2)',[invite,'외부인']),/Choose a team profile/);
    for(const [i,name] of ['이유진','임다혜','윤서영','강주원'].entries()){
      await db.exec(`set request.jwt.claim.sub='00000000-0000-4000-8000-00000000000${i+1}';`);
      assert.equal((await db.query('select public.join_workspace($1,$2) member',[invite,name])).rows[0].member.display_name,name);
      await db.query('select public.initialize_workspace_state()');assert.equal((await db.query('select count(*)::int n from public.workspace_state')).rows[0].n,1);
    }
    await assert.rejects(db.query('select * from public.workspace_access'),/permission denied/);
    await assert.rejects(db.query('select * from public.workspace_members'),/permission denied/);
    await db.query('select public.leave_workspace()');assert.equal((await db.query('select count(*)::int n from public.workspace_state')).rows[0].n,0);
    await db.exec('reset role;');
    await db.query("update public.workspace_access set invite_hash=encode(sha256(convert_to($1,'UTF8')),'hex'),version=version+1 where id=1",[nextInvite]);
    await db.exec(`set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';`);
    assert.equal((await db.query('select count(*)::int n from public.workspace_state')).rows[0].n,0);
    await assert.rejects(db.query('select public.join_workspace($1,$2)',[invite,'이유진']),/Invalid invite/);
    await db.query('select public.join_workspace($1,$2)',[nextInvite,'이유진']);
    assert.equal((await db.query('select count(*)::int n from public.workspace_state')).rows[0].n,1);
    await db.exec('reset role;set role anon;');await assert.rejects(db.query('select * from public.workspace_state'),/permission denied/);
  }finally{await db.close()}
});

test('Postgres migration: allowlisted identity, RLS, CAS, payload validation and backups',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email',current_setting('request.jwt.claim.email',true)) $$;
      grant usage on schema public,auth to anon,authenticated;
      grant execute on all functions in schema auth to anon,authenticated;`);
    const migration=await readFile('supabase/migrations/202610190001_workspace_hardening.sql','utf8');
    await db.exec(migration);await db.exec(migration);
    await db.query('insert into public.team_members(email,display_name) values($1,$2)',['team@example.com','이유진']);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'; set request.jwt.claim.email='outsider@example.com';`);
    assert.equal((await db.query('select count(*)::int n from public.workspace_state')).rows[0].n,0);
    assert.equal((await db.query('select public.get_workspace_identity() member')).rows[0].member,null);
    await assert.rejects(db.query('select public.initialize_workspace_state()'),/Team access required/);
    await db.exec(`set request.jwt.claim.email='team@example.com';`);
    assert.equal((await db.query('select public.get_workspace_identity() member')).rows[0].member.display_name,'이유진');
    await db.query('select public.initialize_workspace_state()');
    const payload={tasks:[{id:'a',title:'등록',project:'룸',assignees:['이유진','임다혜'],dueMode:'custom',due:'2026-10-21',done:false,link:''}],events:[],links:{}};
    assert.equal((await db.query('select public.save_workspace_state(0,$1) ok',[payload])).rows[0].ok,true);
    assert.equal((await db.query('select public.save_workspace_state(0,$1) ok',[payload])).rows[0].ok,false);
    assert.equal((await db.query('select revision from public.workspace_state')).rows[0].revision,1);
    assert.equal((await db.query('select count(*)::int n from public.workspace_backups')).rows[0].n,1);
    for(const patch of [{due:'2026-02-30'},{link:'javascript:alert(1)'},{demo:'no'},{done:'true'},{completedOn:'2026-02-30'}]){
      const invalid=structuredClone(payload);Object.assign(invalid.tasks[0],patch);
      await assert.rejects(db.query('select public.save_workspace_state(1,$1)',[invalid]),/Invalid workspace payload/);
    }
    const event={id:'range',title:'설치',kind:'milestone',project:'룸',date:'2026-10-22',startDate:'2026-10-20',endDate:'2026-10-22'};
    for(const patch of [{date:undefined},{endDate:'2026-10-19'},{date:'2026-10-21'}]){
      const invalid={...payload,events:[{...event,...patch}]};
      assert.equal((await db.query('select public.workspace_payload_valid($1) ok',[invalid])).rows[0].ok,false);
    }
    await assert.rejects(db.exec(`update public.workspace_state set revision=99 where id=1`),/permission denied/);
    await assert.rejects(db.exec(`select * from public.team_members`),/permission denied/);
    await db.exec('reset role; update public.team_members set enabled=false; set role authenticated;');
    assert.equal((await db.query('select count(*)::int n from public.workspace_state')).rows[0].n,0);
    await assert.rejects(db.query('select public.save_workspace_state(1,$1)',[payload]),/Team access required/);
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select * from public.workspace_state'),/permission denied/);
  }finally{await db.close()}
});
