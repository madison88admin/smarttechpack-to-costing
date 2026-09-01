// Check the product edit page for the main product image URL
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

// Fetch product edit page for 48466
const r = await fetch(`${baseUrl}/Product/Edit/48466`, { headers: { Cookie: cookieStr } });
const html = await r.text();

// Search for img tags with src containing "Document" or "Thumbnail" or "Image"
console.log('=== Image src URLs ===');
const imgSrcs = [...html.matchAll(/src="([^"]*(?:Document|Thumbnail|Image|FirstTumbnail)[^"]*)"/gi)];
imgSrcs.forEach(m => console.log('  ' + m[1]));

// Search for data-imageIndex
console.log('\n=== data-imageIndex ===');
const dataIndexes = [...html.matchAll(/data-imageIndex="([^"]*)"[^>]*src="([^"]*)"/gi)];
dataIndexes.forEach(m => console.log(`  index=${m[1]} src=${m[2]}`));

// Search for product_main_image
console.log('\n=== product_main_image ===');
const mainImg = html.match(/product_main_image[\s\S]{0,500}/i);
if (mainImg) console.log(mainImg[0].slice(0, 500));

// Search for any img with src
console.log('\n=== All img srcs ===');
const allImgs = [...html.matchAll(/<img[^>]*src="([^"]*)"[^>]*>/gi)];
allImgs.slice(0, 20).forEach(m => console.log('  ' + m[1]));
