// Check if Supabase storage is available
const supabaseUrl = 'http://5.223.78.194:8000';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzE2NzY4MDAwLCJleHAiOjE5MDAwMDAwMDB9.9DnIkwBB4dRVDKayjBvrqQNMjIm28X6DhUBYF9_3apo';

// Try to list storage buckets
const r = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
  headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey }
});
console.log('Storage buckets status:', r.status);
if (r.ok) {
  const buckets = await r.json();
  console.log('Buckets:', JSON.stringify(buckets, null, 2));
} else {
  const text = await r.text();
  console.log('Response:', text.slice(0, 500));
}
