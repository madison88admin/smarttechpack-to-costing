import pg from "pg";

const client = new pg.Client({
  host: "5.223.78.194",
  port: 5432,
  database: "postgres",
  user: "postgres",
  password: "W300MHyrxwi5nV4r4ZM9AiCbgUbTMM0DHFPtPALJdE4=",
  schema: "tp_costing"
});

try {
  await client.connect();
  console.log("Connected to PostgreSQL");

  // Add columns to costing_requests
  await client.query(`
    ALTER TABLE tp_costing.costing_requests
      ADD COLUMN IF NOT EXISTS po_number text,
      ADD COLUMN IF NOT EXISTS mpo_number text,
      ADD COLUMN IF NOT EXISTS product_category text,
      ADD COLUMN IF NOT EXISTS buyer_style_number text,
      ADD COLUMN IF NOT EXISTS notes text
  `);
  console.log("Added columns: po_number, mpo_number, product_category, buyer_style_number, notes");

  // Add product_category to nextgen_products
  await client.query(`
    ALTER TABLE tp_costing.nextgen_products
      ADD COLUMN IF NOT EXISTS product_category text,
      ADD COLUMN IF NOT EXISTS buyer_style_number text
  `);
  console.log("Added columns to nextgen_products: product_category, buyer_style_number");

  // Verify
  const { rows } = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'tp_costing' AND table_name = 'costing_requests'
    ORDER BY ordinal_position
  `);
  console.log("\ncosting_requests columns:");
  rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));

} catch (err) {
  console.error("Error:", err.message);
} finally {
  await client.end();
}
