// Refetch product data using the app's own API - use CustomerReference for product name
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

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = 'http://localhost:3002';

// 1. Fetch all products from database
const r = await fetch(`${supabaseUrl}/rest/v1/nextgen_products?select=id,nextgen_entity_id,style_number,name`, {
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Accept-Profile': 'tp_costing' }
});
const products = await r.json();
console.log(`Found ${products.length} products in database`);

let updated = 0;
let skipped = 0;
let noResult = 0;

for (const product of products) {
  const entityId = product.nextgen_entity_id;
  if (!entityId || entityId.startsWith('manual:')) {
    skipped++;
    continue;
  }

  // Search via the app's API
  const searchRes = await fetch(`${appUrl}/api/product/search?q=${encodeURIComponent(product.style_number)}`, {
    headers: { Cookie: 'tp_costing_role=pbd; tp_costing_user=Test' }
  });

  if (!searchRes.ok) {
    continue;
  }

  const searchData = await searchRes.json();
  const items = searchData.body?.Data || searchData.Data || [];
  if (items.length === 0) {
    noResult++;
    continue;
  }

  // Find the matching product by entityId or style number
  const match = items.find(item => 
    String(item.Id) === String(entityId) || 
    item.Name === product.style_number
  );

  if (!match) {
    continue;
  }

  // Use CustomerReference for product name (Buyer Style Name), fallback to Description
  const newName = match.CustomerReference || match.Description || match.Name || product.name;
  
  if (newName && newName !== product.name) {
    const updateRes = await fetch(`${supabaseUrl}/rest/v1/nextgen_products?id=eq.${product.id}`, {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Accept-Profile': 'tp_costing',
        'Content-Profile': 'tp_costing',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ name: newName })
    });

    if (updateRes.ok) {
      console.log(`  ${product.style_number}: "${product.name}" -> "${newName}"`);
      updated++;
    }
  }
}

console.log(`\nDone! Updated: ${updated}, Skipped (manual): ${skipped}, No result: ${noResult}, Total: ${products.length}`);
