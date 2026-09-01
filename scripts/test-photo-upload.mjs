import fs from 'fs';
import path from 'path';
import os from 'os';

// Create a small test PNG (1x1 red pixel)
const pngBytes = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE,
  0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54,
  0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01,
  0x5B, 0x65, 0xBD, 0x62,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
]);

console.log('Test image size:', pngBytes.length, 'bytes');

// Upload via multipart form
const formData = new FormData();
formData.append('file', new Blob([pngBytes], { type: 'image/png' }), 'test-photo.png');

const r = await fetch('http://localhost:3001/api/costing/requests/9a447f18-538f-4273-a672-cb3463c289e8/photos', {
  method: 'POST',
  headers: {
    Cookie: 'tp_costing_role=factory; tp_costing_user=TestFactory'
  },
  body: formData
});

console.log('Upload status:', r.status);
const d = await r.json();
console.log('Response:', JSON.stringify(d, null, 2));

if (d.ok) {
  // Verify it's stored by listing photos
  console.log('\n--- Listing photos ---');
  const r2 = await fetch('http://localhost:3001/api/costing/requests/9a447f18-538f-4273-a672-cb3463c289e8/photos', {
    headers: { Cookie: 'tp_costing_role=factory; tp_costing_user=Test' }
  });
  const d2 = await r2.json();
  console.log('Photos:', JSON.stringify(d2, null, 2));

  // Check Supabase storage directly
  console.log('\n--- Checking Supabase storage ---');
  const supabaseUrl = 'http://5.223.78.194:8000';
  const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3MTY3NjgwMDAsImV4cCI6MTkwMDAwMDAwMH0.V-cG19BCJW3-uPmrK3mmSsuqfZJHuU1zqQAGDtZQM1g';
  const r3 = await fetch(`${supabaseUrl}/storage/v1/object/list/factory-photos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: '', limit: 100 })
  });
  console.log('Storage list status:', r3.status);
  const d3 = await r3.json();
  console.log('Storage objects:', JSON.stringify(d3, null, 2).slice(0, 1000));
}
