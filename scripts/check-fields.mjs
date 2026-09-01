// Check NextGen product edit page for "Buyer Style" field mapping
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

// Fetch product edit page
const r = await fetch(`${baseUrl}/Product/Edit/13250`, { headers: { Cookie: cookieStr } });
const html = await r.text();

// Search for "Buyer Style" in the HTML
console.log('=== "Buyer Style" references ===');
const buyerStyleMatches = [...html.matchAll(/Buyer Style[\s\S]{0,200}/gi)];
buyerStyleMatches.slice(0, 10).forEach((m, i) => {
  console.log(`\n--- ${i} ---`);
  console.log(m[0].slice(0, 200));
});

// Search for "ExternalReference" in the HTML
console.log('\n=== "ExternalReference" references ===');
const extRefMatches = [...html.matchAll(/ExternalReference[\s\S]{0,200}/gi)];
extRefMatches.slice(0, 10).forEach((m, i) => {
  console.log(`\n--- ${i} ---`);
  console.log(m[0].slice(0, 200));
});

// Search for "CustomerReference" in the HTML
console.log('\n=== "CustomerReference" references ===');
const custRefMatches = [...html.matchAll(/CustomerReference[\s\S]{0,200}/gi)];
custRefMatches.slice(0, 10).forEach((m, i) => {
  console.log(`\n--- ${i} ---`);
  console.log(m[0].slice(0, 200));
});

// Search for label text containing "Buyer" or "Style"
console.log('\n=== Labels with "Buyer" or "Style" ===');
const labelMatches = [...html.matchAll(/<label[^>]*>([^<]*(?:Buyer|Style)[^<]*)<\/label>/gi)];
labelMatches.forEach(m => console.log('  Label: ' + m[1]));

// Search for field names containing "buyer" or "style"
console.log('\n=== Field names with "buyer" or "style" ===');
const fieldMatches = [...html.matchAll(/(?:name|id|data-field)="([^"]*(?:buyer|style|external|reference)[^"]*)"/gi)];
fieldMatches.forEach(m => console.log('  Field: ' + m[1]));
