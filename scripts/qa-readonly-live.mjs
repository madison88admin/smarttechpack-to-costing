import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd(), true);
const base = process.argv[2] || 'http://localhost:3120';
const users = JSON.parse(process.env.TP_COSTING_PILOT_USERS_JSON || '{}');
const summaries = [];
for (const [username, user] of Object.entries(users)) {
  const login = await fetch(`${base}/api/auth/login`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,password:user.password}), signal:AbortSignal.timeout(15000)});
  const identity = await login.json();
  const summary = {role:user.role, login:login.status, actualRole:identity.role, checks:[]};
  if (identity.ok) {
    const cookie = login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
    const paths = ['/api/historical/search?q=Acrylic&limit=5','/api/historical/like-styles?yarnType=Acrylic&limit=5','/api/historical/distinct','/requests/import','/admin'];
    if(user.role==='pbd') paths.push('/api/nextgen/filter-options','/api/historical/search?q=QA-NONEXISTENT-829143&limit=5');
    for(const path of paths) {
      try {
        const response=await fetch(base+path,{headers:{Cookie:cookie},redirect:'manual',signal:AbortSignal.timeout(60000)});
        const text=await response.text(); let data; try{data=JSON.parse(text)}catch{}
        summary.checks.push({path,status:response.status,ok:data?.ok,rows:Array.isArray(data?.data)?data.data.length:undefined,counts:data?Object.fromEntries(Object.entries(data).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length])):undefined,hasSidebar:!data?text.includes('sidebar'):undefined,error:data?.error});
      }catch(error){summary.checks.push({path,error:error.message})}
    }
  }
  summaries.push(summary); console.log(JSON.stringify(summary));
}
console.log('Read-only checks complete; no request or costing records changed.');
