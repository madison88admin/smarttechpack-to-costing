import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCurrentRole, type UserRole } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES: UserRole[] = ["admin", "manager", "pbd", "costing", "md"];

export async function GET() {
  const role = getCurrentRole();
  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseServiceClient();

  // Distinct values from historical_costings (databank seeded 2828 rows)
  // Use ilike-free distinct fetch via group-like limit to avoid full table scan issues
  const [yarn, knit, machine, construction, category, factory, brand, customer, season] = await Promise.all([
    fetchDistinct(supabase, "yarn_type"),
    fetchDistinct(supabase, "knit_type"),
    fetchDistinct(supabase, "machine_type"),
    fetchDistinct(supabase, "construction"),
    fetchDistinct(supabase, "product_category"),
    fetchDistinct(supabase, "factory_name"),
    fetchDistinct(supabase, "brand"),
    fetchDistinct(supabase, "customer"),
    fetchDistinct(supabase, "season"),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      yarnTypes: yarn,
      knitTypes: knit,
      machineTypes: machine,
      constructions: construction,
      categories: category,
      factories: factory,
      brands: brand,
      customers: customer,
      seasons: season,
    },
  });
}

async function fetchDistinct(supabase: ReturnType<typeof createSupabaseServiceClient>, col: string): Promise<string[]> {
  const { data, error } = await supabase.from("historical_costings").select(col).not(col, "is", null).limit(5000);
  if (error || !data) return [];
  const uniq = new Set<string>();
  for (const row of data as unknown as Record<string, unknown>[]) {
    const v = String((row as Record<string, unknown>)[col] ?? "").trim();
    if (v && v !== "#N/A" && v !== "null") uniq.add(v);
  }
  return [...uniq].sort((a, b) => a.localeCompare(b)).slice(0, 120);
}
