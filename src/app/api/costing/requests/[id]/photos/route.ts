import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { pgrestValue } from "@/lib/supabase/filters";
import { canSubmitFactoryCbd, canReviewCbd, getCurrentRole, getCurrentUserName } from "@/lib/auth/roles";
import { validateRequestId } from "@/lib/api/validate";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_PHOTOS = 10;
const BUCKET_NAME = "factory-photos";

export async function GET(_: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("cbd_photos")
    .select("id, file_name, file_path, file_size, content_type, uploaded_by, uploaded_at")
    .eq("costing_request_id", context.params.id)
    .order("uploaded_at", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Generate signed/public URLs for each photo
  const photos = await Promise.all(
    (data ?? []).map(async (photo: { id: string; file_name: string; file_path: string; file_size: number | null; content_type: string | null; uploaded_by: string | null; uploaded_at: string }) => {
      const { data: urlData } = await supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(photo.file_path);

      return {
        id: photo.id,
        file_name: photo.file_name,
        file_path: photo.file_path,
        file_size: photo.file_size,
        content_type: photo.content_type,
        uploaded_by: photo.uploaded_by,
        uploaded_at: photo.uploaded_at,
        url: urlData?.publicUrl ?? null
      };
    })
  );

  return NextResponse.json({ ok: true, data: photos });
}

export async function POST(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();
  if (!canSubmitFactoryCbd(role) && !canReviewCbd(role)) {
    return NextResponse.json({ ok: false, error: "Current role cannot upload photos" }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ ok: false, error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ ok: false, error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();

  // Check existing photo count
  const { count, error: countError } = await supabase
    .from("cbd_photos")
    .select("id", { count: "exact", head: true })
    .eq("costing_request_id", context.params.id);

  if (countError) {
    return NextResponse.json({ ok: false, error: countError.message }, { status: 500 });
  }

  if ((count ?? 0) >= MAX_PHOTOS) {
    return NextResponse.json({ ok: false, error: `Maximum ${MAX_PHOTOS} photos per request` }, { status: 400 });
  }

  // Build a unique file path: {requestId}/{timestamp}-{filename}
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = `${context.params.id}/${Date.now()}-${safeName}`;
  const arrayBuffer = await file.arrayBuffer();
  const fileBuffer = Buffer.from(arrayBuffer);

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filePath, fileBuffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false
    });

  if (uploadError) {
    return NextResponse.json({ ok: false, error: uploadError.message }, { status: 500 });
  }

  const { data: photoRow, error: insertError } = await supabase
    .from("cbd_photos")
    .insert({
      costing_request_id: context.params.id,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      content_type: file.type || null,
      uploaded_by: getCurrentUserName()
    })
    .select("id, file_name, file_path, file_size, content_type, uploaded_by, uploaded_at")
    .single();

  if (insertError || !photoRow) {
    // Clean up the uploaded file if DB insert fails
    await supabase.storage.from(BUCKET_NAME).remove([filePath]);
    return NextResponse.json({ ok: false, error: insertError?.message ?? "Failed to create photo record" }, { status: 500 });
  }

  const { data: urlData } = await supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(photoRow.file_path);

  return NextResponse.json({
    ok: true,
    data: {
      ...photoRow,
      url: urlData?.publicUrl ?? null
    }
  });
}

export async function DELETE(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();
  if (!canSubmitFactoryCbd(role) && !canReviewCbd(role)) {
    return NextResponse.json({ ok: false, error: "Current role cannot delete photos" }, { status: 403 });
  }

  const url = new URL(request.url);
  const photoId = url.searchParams.get("photoId");

  if (!photoId) {
    return NextResponse.json({ ok: false, error: "Missing photoId query parameter" }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();

  // Fetch the photo record to get the file path
  const { data: photo, error: fetchError } = await supabase
    .from("cbd_photos")
    .select("id, file_path")
    .eq("id", pgrestValue(photoId))
    .eq("costing_request_id", context.params.id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ ok: false, error: fetchError.message }, { status: 500 });
  }

  if (!photo) {
    return NextResponse.json({ ok: false, error: "Photo not found" }, { status: 404 });
  }

  // Delete from storage
  const { error: storageError } = await supabase.storage
    .from(BUCKET_NAME)
    .remove([photo.file_path]);

  if (storageError) {
    // Log but continue — the DB record is the source of truth
    console.error("Storage delete error:", storageError.message);
  }

  // Delete the DB record
  const { error: deleteError } = await supabase
    .from("cbd_photos")
    .delete()
    .eq("id", pgrestValue(photoId))
    .eq("costing_request_id", context.params.id);

  if (deleteError) {
    return NextResponse.json({ ok: false, error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
