import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type FactoryPhoto = {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  content_type: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  url: string | null;
};

const BUCKET_NAME = "factory-photos";

export async function tryGetFactoryPhotos(requestId: string): Promise<{ data: FactoryPhoto[] | null; error: string | null }> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("cbd_photos")
      .select("id, file_name, file_path, file_size, content_type, uploaded_by, uploaded_at")
      .eq("costing_request_id", requestId)
      .order("uploaded_at", { ascending: true });

    if (error) {
      return { data: null, error: error.message };
    }

    const photos: FactoryPhoto[] = await Promise.all(
      (data ?? []).map(async (photo) => {
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

    return { data: photos, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Failed to load photos" };
  }
}
