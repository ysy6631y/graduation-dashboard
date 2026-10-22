import http from 'node:http';
import {readFile, mkdir, rename, open, readdir, unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {emptyWorkspace, validWorkspace} from './public/workspace-core.mjs';

const root=fileURLToPath(new URL('.',import.meta.url));
try{process.loadEnvFile(root+'.env')}catch(error){if(error.code!=='ENOENT')throw error}
const dir=process.env.DATA_DIR||root+'data',port=Number(process.env.PORT||4173);
await mkdir(dir,{recursive:true});
let project={};
if(process.env.WORKSPACE_LOCAL_ONLY!=='1'){
  try{project=JSON.parse(await readFile(root+'public/cloud-config.json','utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
}
const config=process.env.WORKSPACE_LOCAL_ONLY==='1'?{url:'',anonKey:''}:{url:process.env.SUPABASE_URL?.trim()||project.url||'',anonKey:process.env.SUPABASE_ANON_KEY?.trim()||project.anonKey||''};
if(Boolean(config.url)!==Boolean(config.anonKey))throw Error('SUPABASE_URL과 SUPABASE_ANON_KEY를 함께 설정해주세요.');
if(config.url&&!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config.url))throw Error('Supabase URL을 확인해주세요.');
if(config.anonKey){
  let role='';try{role=JSON.parse(Buffer.from(config.anonKey.split('.')[1],'base64url').toString()).role}catch{}
  if(config.anonKey.startsWith('sb_secret_')||role==='service_role'||(!config.anonKey.startsWith('sb_publishable_')&&role!=='anon'))throw Error('서버 전용 비밀 키는 사용할 수 없습니다. Supabase 공개 키를 확인해주세요.');
}
let state;
try{state=JSON.parse(await readFile(dir+'/workspace.json','utf8'));if(!validWorkspace(state))throw Error('저장된 작업실 형식을 확인해주세요. 원본은 변경하지 않았습니다.')}
catch(error){if(error.code!=='ENOENT')throw error;state=emptyWorkspace()}
let queue=Promise.resolve(),cloudBundle=null;
const security={
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin',
  'X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()',
};
function send(response,status,value){
  response.writeHead(status,{...security,'Content-Type':'application/json','Cache-Control':'no-store'});
  response.end(JSON.stringify(value));
}
async function atomicWrite(path,value){
  const file=await open(path+'.tmp','w',0o600);
  try{await file.writeFile(value);await file.sync()}finally{await file.close()}
  await rename(path+'.tmp',path);
}
async function backup(previous){
  const directory=dir+'/backups';await mkdir(directory,{recursive:true});
  const path=directory+'/workspace-r'+String(previous.revision).padStart(12,'0')+'.json';
  try{const file=await open(path,'wx',0o600);try{await file.writeFile(JSON.stringify(previous,null,2));await file.sync()}finally{await file.close()}}
  catch(error){if(error.code!=='EEXIST')throw error}
}
async function pruneBackups(){
  const directory=dir+'/backups';
  const names=(await readdir(directory)).filter(name=>/^workspace-r\d{12}\.json$/.test(name)).sort().reverse();
  for(const name of names.slice(100))await unlink(directory+'/'+name);
}
async function readBody(request,response){
  if(!request.headers['content-type']?.startsWith('application/json')){send(response,415,{error:'JSON 형식으로 요청해주세요.'});return null}
  let body='';for await(const chunk of request){body+=chunk;if(Buffer.byteLength(body)>1_000_000){send(response,413,{error:'한 번에 저장할 수 있는 양을 초과했어요.'});return null}}
  try{return JSON.parse(body)}catch{send(response,400,{error:'요청 내용을 확인해주세요.'});return null}
}
const files={'/budget-core.mjs':'budget-core.mjs','/budget-ui.mjs':'budget-ui.mjs','/budget.css':'budget.css','/':'index.html','/app.js':'app.js','/style.css':'style.css','/reference.css':'reference.css','/workspace.css':'workspace.css','/theme.css':'theme.css','/client.mjs':'client.mjs','/workspace-core.mjs':'workspace-core.mjs','/usagi-loading.gif':'usagi-loading.gif'};
const server=http.createServer(async(request,response)=>{
  try{
    if(!['127.0.0.1:'+port,'localhost:'+port].includes(request.headers.host))return send(response,403,{error:'로컬 주소로 접속해주세요.'});
    if(request.url==='/api/health')return send(response,200,{status:'ok',mode:config.url?'cloud':'local'});
    if(request.url==='/api/workspace'&&request.method==='GET')return send(response,200,state);
    if(request.url==='/api/workspace'&&request.method==='PUT'){
      if(request.headers.origin&&request.headers.origin!=='http://'+request.headers.host)return send(response,403,{error:'허용되지 않은 요청입니다.'});
      const input=await readBody(request,response);if(!input)return;
      queue=queue.catch(()=>{}).then(async()=>{
        if(!Number.isSafeInteger(input.revision)||input.revision<0)return send(response,400,{error:'저장 버전을 확인해주세요.'});
        if(input.revision!==state.revision)return send(response,409,{error:'다른 창에서 변경했어요.',state});
        if(!validWorkspace(input))return send(response,400,{error:'작업명, 일정 기간 또는 링크를 확인해주세요.'});
        const next={...input,revision:state.revision+1};
        await backup(state);await atomicWrite(dir+'/workspace.json',JSON.stringify(next,null,2));state=next;
        send(response,200,state);pruneBackups().catch(()=>{});
      });
      await queue;return;
    }
    if(request.url.startsWith('/api/'))return send(response,404,{error:'찾을 수 없어요.'});
    if(!['GET','HEAD'].includes(request.method))return send(response,405,{error:'허용되지 않은 요청입니다.'});
    const path=new URL(request.url,'http://localhost').pathname;
    let content;
    if(path==='/runtime-config.js')content='window.WORKSPACE_CONFIG=Object.freeze('+JSON.stringify(config)+');';
    else if(path==='/cloud.mjs'){
      if(!cloudBundle){const {build}=await import('esbuild');cloudBundle=(await build({entryPoints:[root+'public/cloud.mjs'],bundle:true,external:['./workspace-core.mjs'],format:'esm',platform:'browser',target:'es2022',write:false})).outputFiles[0].text}
      content=cloudBundle;
    }else{
      if(!files[path])return send(response,404,{error:'찾을 수 없어요.'});
      content=await readFile(root+'public/'+files[path]);
    }
    response.writeHead(200,{...security,'Content-Type':/\.(m?js)$/.test(path)?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.gif')?'image/gif':'text/html','Cache-Control':'no-store'});
    response.end(request.method==='HEAD'?undefined:content);
  }catch(error){
    console.error(error.code||error.message);
    if(!response.headersSent)send(response,error.code==='ENOSPC'?507:500,{error:error.code==='ENOSPC'?'저장 공간이 부족해요. 입력을 유지하고 다시 시도해주세요.':'저장하지 못했어요. 입력 내용을 유지하고 다시 시도해주세요.'});
    else response.end();
  }
});
server.listen(port,'127.0.0.1',()=>console.log('Dashboard: http://127.0.0.1:'+port));
async function shutdown(){server.close();await queue.catch(()=>{});process.exit(0)}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
