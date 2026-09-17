import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
nextEnv.loadEnvConfig(process.cwd(), true);
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_PUBLIC_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { db: { schema: 'tp_costing' }, auth: { persistSession: false } });
const { data: rows, error } = await db.from('historical_costings').select('id,costing_request_id,brand,customer,season').not('costing_request_id', 'is', null);
if (error) throw error;
let changed = 0;
for (const row of rows) {
  const { data: request, error } = await db.from('costing_requests').select('brand,customer,season').eq('id', row.costing_request_id).single();
  if (error) throw error;
  for (const field of ['brand', 'customer', 'season']) {
    if (row[field] != null || !request[field]) continue;
    if (process.argv.includes('--apply')) {
      const { error } = await db.from('historical_costings').update({ [field]: request[field] }).eq('id', row.id).is(field, null);
      if (error) throw error;
    }
    changed++;
  }
}
console.log(JSON.stringify({ apply: process.argv.includes('--apply'), missingFields: changed, scanned: rows.length }));
