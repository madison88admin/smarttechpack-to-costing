import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { UserRole } from "./roles";
import { hashPassword } from "./passwords";

export type UserProfile = {
  id: string;
  display_name: string;
  email: string | null;
  role: UserRole;
  last_login_at?: string | null;
  is_active: boolean;
};

export async function listUserProfiles() {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, display_name, email, role, is_active, last_login_at")
    .order("role", { ascending: true })
    .order("display_name", { ascending: true });

  if (error) throw error;

  return data as UserProfile[];
}

export async function upsertUserProfile(input: {
  id?: string | null;
  displayName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  password?: string | null;
}) {
  const supabase = createSupabaseServiceClient();
  const payload: Record<string, unknown> = {
    display_name: input.displayName.trim(),
    email: input.email.trim().toLowerCase(),
    role: input.role,
    is_active: input.isActive,
    updated_at: new Date().toISOString()
  };

  if (input.password?.trim()) {
    payload.password_hash = hashPassword(input.password.trim());
  }

  const request = input.id
    ? supabase.from("user_profiles").update(payload).eq("id", input.id).select("id").single()
    : supabase.from("user_profiles").insert(payload).select("id").single();
  const { data, error } = await request;

  if (error) throw error;

  return data;
}

export async function setUserActive(id: string, isActive: boolean) {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("user_profiles")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw error;

  return { id, isActive };
}

export async function tryListUserProfiles() {
  try {
    return {
      data: await listUserProfiles(),
      error: null
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unable to load users"
    };
  }
}
