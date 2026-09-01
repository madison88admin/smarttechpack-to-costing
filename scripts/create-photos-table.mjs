// Create cbd_photos table via Supabase REST API
const supabaseUrl = 'http://5.223.78.194:8000';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3MTY3NjgwMDAsImV4cCI6MTkwMDAwMDAwMH0.V-cG19BCJW3-uPmrK3mmSsuqfZJHuU1zqQAGDtZQM1g';

// Try using the pg REST endpoint to execute raw SQL
// Supabase has a /pg/query endpoint or we can use the SQL endpoint
const sql = `CREATE TABLE IF NOT EXISTS tp_costing.cbd_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_cbd_id UUID REFERENCES tp_costing.factory_cbds(id) ON DELETE CASCADE,
  costing_request_id UUID REFERENCES tp_costing.costing_requests(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  content_type TEXT,
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tp_costing.cbd_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON tp_costing.cbd_photos FOR ALL USING (true) WITH CHECK (true);`;

// Try the Supabase SQL endpoint
const r = await fetch(`${supabaseUrl}/pg/query`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${serviceKey}`,
    'apikey': serviceKey
  },
  body: JSON.stringify({ query: sql })
});
console.log('pg/query status:', r.status);
const text = await r.text();
console.log('Response:', text.slice(0, 500));

// If that fails, try the REST SQL endpoint
if (!r.ok) {
  console.log('\nTrying /rest/v1/ endpoint...');
  const r2 = await fetch(`${supabaseUrl}/rest/v1/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceKey}`,
      'apikey': serviceKey
    },
    body: JSON.stringify({ query: sql })
  });
  console.log('REST status:', r2.status);
  const text2 = await r2.text();
  console.log('Response:', text2.slice(0, 500));
}
