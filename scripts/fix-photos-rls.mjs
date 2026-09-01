// Fix RLS policies for cbd_photos
const supabaseUrl = 'http://5.223.78.194:8000';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3MTY3NjgwMDAsImV4cCI6MTkwMDAwMDAwMH0.V-cG19BCJW3-uPmrK3mmSsuqfZJHuU1zqQAGDtZQM1g';

const sql = `
-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow all for service role" ON tp_costing.cbd_photos;

-- Disable RLS entirely (service role bypasses anyway, but let's be safe)
ALTER TABLE tp_costing.cbd_photos DISABLE ROW LEVEL SECURITY;

-- Also grant permissions
GRANT ALL ON tp_costing.cbd_photos TO anon, authenticated, service_role;
`;

const r = await fetch(`${supabaseUrl}/pg/query`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${serviceKey}`,
    'apikey': serviceKey
  },
  body: JSON.stringify({ query: sql })
});
console.log('Status:', r.status);
const text = await r.text();
console.log('Response:', text.slice(0, 500));
