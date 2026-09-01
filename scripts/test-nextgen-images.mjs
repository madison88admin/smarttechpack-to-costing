// Test the actual NextGen image URL patterns
import fs from 'fs';
const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    let val = match[2].trim();
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) val = val.slice(1, -1);
    env[match[1].trim()] = val;
  }
}

const baseUrl = env.NEXTGEN_BASE_URL;

// Login
const loginPage = await fetch(`${baseUrl}/Account/Login`, { cache: "no-store", redirect: "manual" });
const setCookies = loginPage.headers.getSetCookie?.() || [];
let cookieStr = '';
for (const c of setCookies) { cookieStr += c.split(';')[0] + '; '; }
const loginHtml = await loginPage.text();
const tokenMatch = loginHtml.match(/name="__RequestVerificationToken" type="hidden" value="([^"]+)"/);
const formData = new URLSearchParams();
formData.append('__RequestVerificationToken', tokenMatch[1]);
formData.append('UserName', env.NEXTGEN_USERNAME);
formData.append('Password', env.NEXTGEN_PASSWORD);
const loginRes = await fetch(`${baseUrl}/Account/Login`, {
  method: "POST", body: formData, cache: "no-store", redirect: "manual",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieStr }
});
const setCookies2 = loginRes.headers.getSetCookie?.() || [];
for (const c of setCookies2) { cookieStr += c.split(';')[0] + '; '; }

const entityId = '13250';
const ts = Date.now();

// Test the actual URL patterns found in the JS
const urls = [
  `/ProductManager/Image/${entityId}?t=${ts}`,
  `/Document/FirstTumbnailForEntity/5/${entityId}?t=${ts}`,
  `/Document/FirstTumbnailForEntity/6/${entityId}?t=${ts}`,
  `/Document/Thumbnail/${entityId}/1?t=${ts}`,
  `/Document/Thumbnail/${entityId}/2?t=${ts}`,
  `/Document/Thumbnail/${entityId}/0?t=${ts}`,
  `/Document/Image/${entityId}/1?t=${ts}`,
  `/Document/Image/${entityId}/2?t=${ts}`,
  `/Document/Image/${entityId}/0?t=${ts}`,
  `/Document/Image/${entityId}?t=${ts}`,
  `/Document/Thumbnail/${entityId}?t=${ts}`,
];

for (const u of urls) {
  const r = await fetch(`${baseUrl}${u}`, { headers: { Cookie: cookieStr }, redirect: 'manual' });
  const ct = r.headers.get('content-type') || '';
  const cl = r.headers.get('content-length') || '';
  console.log(`${u} -> ${r.status} ct=${ct.slice(0,30)} cl=${cl}`);
  if (r.ok && (ct.startsWith('Image') || ct.startsWith('image'))) {
    const buf = await r.arrayBuffer();
    console.log(`  *** IMAGE: ${buf.byteLength} bytes ***`);
  }
}

// Also try with different document type IDs (1-10) for Thumbnail and Image
console.log('\n=== Document/Image/{entityId}/{docTypeId} ===');
for (let dt = 0; dt <= 10; dt++) {
  const r = await fetch(`${baseUrl}/Document/Image/${entityId}/${dt}?t=${ts}`, { headers: { Cookie: cookieStr }, redirect: 'manual' });
  const ct = r.headers.get('content-type') || '';
  const cl = r.headers.get('content-length') || '';
  if (r.ok && (ct.startsWith('Image') || ct.startsWith('image'))) {
    console.log(`  docType=${dt} -> ${r.status} ct=${ct} cl=${cl}`);
  }
}

console.log('\n=== Document/Thumbnail/{entityId}/{docTypeId} ===');
for (let dt = 0; dt <= 10; dt++) {
  const r = await fetch(`${baseUrl}/Document/Thumbnail/${entityId}/${dt}?t=${ts}`, { headers: { Cookie: cookieStr }, redirect: 'manual' });
  const ct = r.headers.get('content-type') || '';
  const cl = r.headers.get('content-length') || '';
  if (r.ok && (ct.startsWith('Image') || ct.startsWith('image'))) {
    console.log(`  docType=${dt} -> ${r.status} ct=${ct} cl=${cl}`);
  }
}

// Try ProductManager/Image with different product IDs
console.log('\n=== ProductManager/Image for different products ===');
for (let pid = 13248; pid <= 13255; pid++) {
  const r = await fetch(`${baseUrl}/ProductManager/Image/${pid}?t=${ts}`, { headers: { Cookie: cookieStr }, redirect: 'manual' });
  const ct = r.headers.get('content-type') || '';
  const cl = r.headers.get('content-length') || '';
  if (r.ok && (ct.startsWith('Image') || ct.startsWith('image'))) {
    console.log(`  productId=${pid} -> ${r.status} ct=${ct} cl=${cl}`);
  }
}
