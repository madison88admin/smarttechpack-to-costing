// Test: full CBD submission flow as factory user
async function test() {
  // Login as factory
  const loginRes = await fetch("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "factory", password: "factory" })
  });
  const factoryCookie = loginRes.headers.get("set-cookie")?.split(";")[0];
  console.log("Factory login:", loginRes.status, factoryCookie?.substring(0, 30));

  // List requests visible to factory
  const listRes = await fetch("http://localhost:3000/api/costing/requests?status=sent_to_factory&limit=5", {
    headers: { Cookie: factoryCookie ?? "" }
  });
  const listData = await listRes.json();
  console.log("Requests visible:", listData.total, "items");
  
  if (listData.data && listData.data.length > 0) {
    for (const req of listData.data.slice(0, 3)) {
      console.log(`  - ${req.request_number ?? req.id.slice(0,8)} | ${req.factory_name} | ${req.status}`);
    }
  }

  // Try to submit CBD on first available request
  const requestId = listData.data?.[0]?.id;
  if (!requestId) {
    console.log("No requests available for factory");
    return;
  }
  console.log("\nSubmitting CBD for:", requestId.slice(0, 8));

  // Simulate exactly what the form sends
  const cbdBody = {
    status: "submitted",
    currency: "USD",
    laborCost: "5.50",
    overheadCost: "2.00",
    profitMargin: "15",
    moq: "1000",
    leadTimeDays: "45",
    materialBufferPercent: "3",
    packagingCost: "0.50",
    testingCost: "0.25",
    brandNominatedItems: "",
    m88Packaging: "",
    yarnType: "Cotton",
    knitType: "Single Jersey",
    machineType: "Circular",
    construction: "Knitted",
    knittingTime: "12",
    productCategory: "T-Shirt",
    costingLearning: "",
    recurringIssueTags: "",
    notes: "Test CBD submission",
    freightCost: "1.50",
    dutyRate: "5",
    insuranceCost: "0.30",
    customsClearanceCost: "0.20",
    inlandTransportCost: "0.40",
    wholesaleMarkup: "60",
    retailMarkup: "120",
    lines: [
      { bomLineId: "test-1", materialName: "Cotton Jersey 180gsm", consumption: 1.2, uom: "kg", unitCost: "3.50", currency: "USD" },
      { bomLineId: "test-2", materialName: "Neck Tape", consumption: 0.05, uom: "m", unitCost: "0.10", currency: "USD" },
      { bomLineId: "test-3", materialName: "Care Label", consumption: 1, uom: "pc", unitCost: "0.05", currency: "USD" },
      { bomLineId: "test-4", materialName: "Poly Bag", consumption: 1, uom: "pc", unitCost: "0.02", currency: "USD" }
    ]
  };

  const cbdRes = await fetch(`http://localhost:3000/api/costing/requests/${requestId}/cbd`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: factoryCookie ?? "" },
    body: JSON.stringify(cbdBody)
  });
  const cbdData = await cbdRes.json();
  console.log("CBD Submit status:", cbdRes.status);
  console.log("CBD Submit response:", JSON.stringify(cbdData, null, 2).substring(0, 500));

  if (cbdRes.status === 201) {
    console.log("\n✅ CBD saved successfully!");
    // Check what status the request moved to
    const checkRes = await fetch(`http://localhost:3000/api/costing/requests?limit=100`, {
      headers: { Cookie: factoryCookie ?? "" }
    });
    const checkData = await checkRes.json();
    const updated = checkData.data?.find(r => r.id === requestId);
    console.log("Request status after CBD:", updated?.status);
  } else {
    console.log("\n❌ CBD save FAILED");
  }
}

test().catch(console.error);
