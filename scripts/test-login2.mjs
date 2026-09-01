const BASE = "http://localhost:58406";

async function testLogin(username, password, ip) {
  console.log(`\nTesting: ${username} / ${password} (IP: ${ip})`);
  
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "X-Forwarded-For": ip
    },
    body: JSON.stringify({ username, password })
  });
  
  const data = await res.json();
  console.log(`  Status: ${res.status}`);
  if (res.ok) {
    console.log(`  ✅ Login successful! Role: ${data.role}`);
  } else {
    console.log(`  ❌ ${data.error}`);
  }
  
  return { ok: res.ok, data };
}

async function main() {
  // Use different IPs to avoid rate limit
  await testLogin("superadmin@test.local", "superadmin", "10.0.0.1");
  await testLogin("factory@test.local", "factory", "10.0.0.2");
  await testLogin("pbd@test.local", "pbd", "10.0.0.3");
}

main();
