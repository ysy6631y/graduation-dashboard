// Explicit live QA only. Creates hidden demo records, then removes only its own IDs.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {createCloudClient} from '../public/cloud.mjs';

if(!process.argv.includes('--run-live'))throw Error('Live QA requires --run-live');
const config=JSON.parse(await readFile(new URL('../public/cloud-config.json',import.meta.url),'utf8'));
const access=JSON.parse(await readFile(new URL('../data/cloud-access.json',import.meta.url),'utf8'));
const names=['이유진','임다혜','윤서영','강주원'],ids=names.map(()=>randomUUID()),clients=[];
const factory=(url,key,options)=>createClient(url,key,{...options,auth:{...options.auth,persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const outsider=await createCloudClient(config,factory);
let cleanupError;
try{
  outsider.invite='x'.repeat(43);await assert.rejects(outsider.join(names[0]),/초대 링크/);
  await assert.rejects(outsider.read(),/초대 링크/);
  const publicClient=factory(config.url,config.anonKey,{auth:{}});
  const denied=await publicClient.from('workspace_state').select('payload');assert.ok(denied.error||!denied.data?.length);
  for(const name of names){const client=await createCloudClient(config,factory);client.invite=access.invite;await client.join(name);clients.push(client)}
  const bases=await Promise.all(clients.map(client=>client.read()));
  await Promise.all(clients.map((client,i)=>client.save(bases[i],{...bases[i],tasks:[...bases[i].tasks,{id:ids[i],title:'[검증] 동시 저장 '+i,project:i%2?'룸':'리비두비',assignees:[names[i]],dueMode:'custom',due:'2026-12-31',done:false,link:'',demo:true}]})));
  const merged=await clients[0].read();for(const id of ids)assert.ok(merged.tasks.some(task=>task.id===id));
  let realtimeHits=0,stop;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Realtime subscription timeout')),20000);
    stop=clients[3].subscribe(()=>{realtimeHits++},status=>{
      console.log(JSON.stringify({realtimeStatus:status}));
      if(status==='SUBSCRIBED'){clearTimeout(timer);resolve()}
      if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timer);reject(Error('Realtime '+status))}
    });
  });
  const before=await clients[0].read(),proposed=structuredClone(before);const row=proposed.tasks.find(task=>task.id===ids[0]);row.done=true;row.completedOn='2026-10-19';
  await clients[0].save(before,proposed);
  for(let i=0;i<40&&!realtimeHits;i++)await new Promise(resolve=>setTimeout(resolve,200));
  stop();assert.ok(realtimeHits>0,'Realtime event was not received');
  assert.equal((await clients[1].read()).tasks.find(task=>task.id===ids[0]).done,true);
  console.log(JSON.stringify({fourAnonymousProfiles:true,outsiderBlocked:true,concurrentWrites:4,realtime:true,sharedCompletion:true}));
}finally{
  try{if(clients[0]){const latest=await clients[0].read();await clients[0].save(latest,{...latest,tasks:latest.tasks.filter(task=>!ids.includes(task.id))})}}
  catch(error){cleanupError=error}
  await Promise.allSettled([...clients,outsider].map(client=>client.logout()));
  if(cleanupError)throw cleanupError;
}
