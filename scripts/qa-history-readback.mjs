import nextEnv from '@next/env';
import {createClient} from '@supabase/supabase-js';
nextEnv.loadEnvConfig(process.cwd(),true);
const url=process.env.NEXT_PUBLIC_SUPABASE_URL??process.env.SUPABASE_PUBLIC_URL??process.env.API_EXTERNAL_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.SERVICE_ROLE_KEY??process.env.SUPABASE_SECRET_KEY;
const db=createClient(url,key,{db:{schema:'tp_costing'},auth:{persistSession:false}});
console.log('Database host:',new URL(url).host);
const history=await db.from('historical_costings').select('id,costing_request_id,total_cost,currency,source,approved_at',{count:'exact'}).order('approved_at',{ascending:false}).limit(1000);
console.log(JSON.stringify({historicalTotal:history.count,scanned:history.data?.length,error:history.error?.message}));
const largeRead=await db.from('historical_costings').select('id').limit(5000);
console.log(JSON.stringify({requestedRows:5000,returnedRows:largeRead.data?.length,error:largeRead.error?.message}));
const linkedRead=await db.from('historical_costings').select('id,costing_request_id,total_cost,brand,customer,season').not('costing_request_id','is',null).limit(1000);
if(linkedRead.error) throw new Error(linkedRead.error.message);
const linked=linkedRead.data??[];
const ids=[...new Set(linked.map(r=>r.costing_request_id))];
if(ids.length){
 const requests=await db.from('costing_requests').select('id,request_number,status,brand,customer,season').in('id',ids);
 const cbds=await db.from('factory_cbds').select('costing_request_id,raw_payload,submitted_at').in('costing_request_id',ids).order('submitted_at',{ascending:false,nullsFirst:false});
 const issues=[];
 for(const row of linked){
   const request=requests.data?.find(r=>r.id===row.costing_request_id);
   const cbd=cbds.data?.find(r=>r.costing_request_id===row.costing_request_id);
   const total=cbd?.raw_payload?.grandTotal;
   if(typeof total==='number'&&Math.abs(Number(row.total_cost)-total)>0.00001)issues.push({request:request?.request_number,historical:row.total_cost,latestCbd:total,status:request?.status});
 }
 const missingMetadata=linked.map(row=>{const request=requests.data?.find(r=>r.id===row.costing_request_id);return {request:request?.request_number,missing:['brand','customer','season'].filter(key=>request?.[key]&&!row[key])}}).filter(row=>row.missing.length);
 console.log(JSON.stringify({linkedHistory:linked.length,requestReadError:requests.error?.message,cbdReadError:cbds.error?.message,latestSnapshotDifferences:issues,missingMetadata}));
}
const audit=await db.from('master_benchmark_history').select('*',{head:true,count:'exact'}).limit(1);
console.log(JSON.stringify({benchmarkHistoryAvailable:!audit.error,error:audit.error?.message}));
console.log('Database checks were read-only. Snapshot differences require revision review before classifying as calculation errors.');
