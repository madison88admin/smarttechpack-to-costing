import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { pgrestValue } from "@/lib/supabase/filters";
import { recordWorkflowEvent } from "@/lib/workflow/events";

export type FactoryAssignmentUser = {
  id: string;
  display_name: string;
  email: string | null;
  role: "factory";
  is_active: boolean;
};

export type FactoryAssignmentRequest = {
  id: string;
  request_number: string | null;
  factory_name: string | null;
  status: string;
  assigned_factory_user_id: string | null;
  created_at: string;
  updated_at: string;
  nextgen_products:
    | { style_number: string | null; name: string | null }
    | { style_number: string | null; name: string | null }[]
    | null;
};

export async function listFactoryAssignments() {
  const supabase = createSupabaseServiceClient();
  const [{ data: users, error: usersError }, { data: requests, error: requestsError }] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("id,display_name,email,role,is_active")
      .eq("role", "factory")
      .eq("is_active", true)
      .order("display_name", { ascending: true }),
    supabase
      .from("costing_requests")
      .select(`
        id,
        request_number,
        factory_name,
        status,
        assigned_factory_user_id,
        created_at,
        updated_at,
        nextgen_products (style_number, name)
      `)
      .not("status", "in", "(approved,rejected)")
      .order("updated_at", { ascending: false })
      .limit(200)
  ]);

  if (usersError) throw usersError;
  if (requestsError) throw requestsError;

  return {
    users: (users ?? []) as FactoryAssignmentUser[],
    requests: (requests ?? []) as FactoryAssignmentRequest[]
  };
}

export async function assignFactoryUser(
  requestId: string,
  factoryUserId: string | null,
  actorUserId: string | null,
  actorRole: string
) {
  const supabase = createSupabaseServiceClient();

  const { data: request, error: requestError } = await supabase
    .from("costing_requests")
    .select("id,assigned_factory_user_id")
    .eq("id", pgrestValue(requestId))
    .single();
  if (requestError || !request) throw requestError ?? new Error("Request not found");

  let assignee: FactoryAssignmentUser | null = null;
  if (factoryUserId) {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("id,display_name,email,role,is_active")
      .eq("id", pgrestValue(factoryUserId))
      .eq("role", "factory")
      .eq("is_active", true)
      .single();
    if (error || !data) throw error ?? new Error("Active factory user not found");
    assignee = data as FactoryAssignmentUser;
  }

  const { error: updateError } = await supabase
    .from("costing_requests")
    .update({ assigned_factory_user_id: factoryUserId, updated_at: new Date().toISOString() })
    .eq("id", pgrestValue(requestId));
  if (updateError) throw updateError;

  await recordWorkflowEvent(supabase, {
    costingRequestId: requestId,
    eventType: "factory_assignment_changed",
    actorRole,
    actorUserId,
    payload: {
      previousFactoryUserId: request.assigned_factory_user_id,
      factoryUserId,
      factoryUserName: assignee?.display_name ?? null
    }
  });

  return { requestId, factoryUserId, assignee };
}

export async function resolveFactoryProfileId(identityId: string | null) {
  if (!identityId) return null;
  const supabase = createSupabaseServiceClient();

  const byProfileId = await supabase
    .from("user_profiles")
    .select("id")
    .eq("id", pgrestValue(identityId))
    .eq("role", "factory")
    .eq("is_active", true)
    .maybeSingle();
  if (byProfileId.data?.id) return String(byProfileId.data.id);

  const byAuthId = await supabase
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", pgrestValue(identityId))
    .eq("role", "factory")
    .eq("is_active", true)
    .maybeSingle();
  return byAuthId.data?.id ? String(byAuthId.data.id) : null;
}

export async function factoryOwnsRequest(identityId: string | null, requestId: string) {
  const profileId = await resolveFactoryProfileId(identityId);
  if (!profileId) return false;
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("costing_requests")
    .select("id")
    .eq("id", pgrestValue(requestId))
    .eq("assigned_factory_user_id", pgrestValue(profileId))
    .maybeSingle();
  return Boolean(data?.id);
}
