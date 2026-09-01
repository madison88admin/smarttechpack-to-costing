const BASE = "http://localhost:58406";

async function testLogin(username, password) {
  console.log(`\nTesting: ${username} / ${password}`);
  
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  
  const data = await res.json();
  console.log(`  Status: ${res.status}`);
  console.log(`  Response:`, JSON.stringify(data, null, 2));
  
  return { ok: res.ok, data };
}

async function main() {
  // Test with different user formats
  await testLogin("superadmin@test.local", "superadmin");
  await testLogin("factory@test.local", "factory");
  await testLogin("tp.factory@madison88.com", "factory");
}

main();
