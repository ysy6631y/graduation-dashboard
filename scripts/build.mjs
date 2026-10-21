import {build} from 'esbuild';
import {mkdir, copyFile, writeFile, readFile} from 'node:fs/promises';

let project={};
if(!process.argv.includes('--no-project-config')){
  try{project=JSON.parse(await readFile(new URL('../public/cloud-config.json',import.meta.url),'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
}
const url=process.env.SUPABASE_URL?.trim()||project.url||'';
const anonKey=process.env.SUPABASE_ANON_KEY?.trim()||project.anonKey||'';
if(Boolean(url)!==Boolean(anonKey))throw Error('Supabase URL과 공개 키를 함께 설정해주세요.');
if(process.argv.includes('--require-cloud')&&!url)throw Error('공유 저장소 설정 없이 배포할 수 없습니다.');
if(url&&!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url))throw Error('Supabase URL이 올바르지 않습니다.');
if(anonKey){
  let role='';
  try{role=JSON.parse(Buffer.from(anonKey.split('.')[1],'base64url').toString()).role}catch{}
  if(anonKey.startsWith('sb_secret_')||role==='service_role')throw Error('서버 전용 비밀 키는 배포할 수 없습니다. 공개 키를 사용하세요.');
  if(!anonKey.startsWith('sb_publishable_')&&role!=='anon')throw Error('Supabase 공개 publishable/anon 키를 확인해주세요.');
}
await mkdir('site',{recursive:true});
for(const file of ['index.html','style.css','reference.css','workspace.css','theme.css','usagi-loading.gif'])await copyFile('public/'+file,'site/'+file);
await build({entryPoints:['public/app.js'],outdir:'site',bundle:true,format:'esm',platform:'browser',target:'es2022',splitting:true,minify:true,chunkNames:'chunks/[name]-[hash]'});
await writeFile('site/runtime-config.js','window.WORKSPACE_CONFIG=Object.freeze('+JSON.stringify({url,anonKey})+');\n');
await writeFile('site/.nojekyll','');
console.log('정적 빌드 완료 · '+(url?'Supabase 연결 설정 포함':'로컬 확인용 · 배포 금지'));
