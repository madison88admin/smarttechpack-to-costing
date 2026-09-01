"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "@/components/ui/toast";
import { IconTrash } from "@/components/ui/icons";

type Photo = {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  content_type: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  url: string | null;
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_PHOTOS = 10;

export function FactoryPhotoUpload({
  requestId,
  readOnly = false
}: {
  requestId: string;
  readOnly?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<Photo | null>(null);

  const loadPhotos = useCallback(async () => {
    if (!requestId) return;
    setLoading(true);
    try {
      const resp = await fetch(`/api/costing/requests/${requestId}/photos`);
      const result = await resp.json();
      if (resp.ok && result.ok) {
        setPhotos(result.data ?? []);
      }
    } catch {
      // ignore load errors
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  async function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    if (photos.length + files.length > MAX_PHOTOS) {
      toast.add({ type: "warning", description: `Maximum ${MAX_PHOTOS} photos per request` });
      return;
    }

    setUploading(true);
    let successCount = 0;
    let lastError = "";

    for (const file of Array.from(files)) {
      if (photos.length + successCount >= MAX_PHOTOS) break;

      if (file.size > MAX_FILE_SIZE) {
        lastError = `${file.name} exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`;
        continue;
      }

      if (!file.type.startsWith("image/")) {
        lastError = `${file.name} is not an image`;
        continue;
      }

      const formData = new FormData();
      formData.append("file", file);

      try {
        const resp = await fetch(`/api/costing/requests/${requestId}/photos`, {
          method: "POST",
          body: formData
        });
        const result = await resp.json();
        if (resp.ok && result.ok) {
          successCount++;
        } else {
          lastError = result.error ?? "Upload failed";
        }
      } catch {
        lastError = "Network error during upload";
      }
    }

    if (successCount > 0) {
      toast.add({ type: "success", description: `${successCount} photo(s) uploaded` });
    }
    if (lastError) {
      toast.add({ type: "error", description: lastError });
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";

    setUploading(false);
    loadPhotos();
  }

  async function handleDelete(photoId: string) {
    const resp = await fetch(`/api/costing/requests/${requestId}/photos?photoId=${photoId}`, {
      method: "DELETE"
    });
    const result = await resp.json();
    if (resp.ok && result.ok) {
      toast.add({ type: "success", description: "Photo deleted" });
      setPhotos(photos.filter((p) => p.id !== photoId));
    } else {
      toast.add({ type: "error", description: result.error ?? "Delete failed" });
    }
  }

  return (
    <div className="factory-photo-section">
      <h3>Factory Photos</h3>
      <p className="eyebrow" style={{ marginBottom: 12 }}>
        Upload up to {MAX_PHOTOS} photos (max {MAX_FILE_SIZE / 1024 / 1024}MB each). JPG, PNG, etc.
      </p>

      {!readOnly && photos.length < MAX_PHOTOS ? (
        <div className="field full" style={{ marginBottom: 16 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            disabled={uploading}
            style={{ marginBottom: 8 }}
          />
          {uploading ? <span className="eyebrow"><span className="spinner" /> Uploading...</span> : null}
        </div>
      ) : null}

      {readOnly && photos.length === 0 && !loading ? (
        <p className="text-muted">No photos uploaded.</p>
      ) : null}

      {loading ? (
        <p className="eyebrow">Loading photos...</p>
      ) : (
        <div className="photo-grid" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="photo-thumb"
              style={{
                position: "relative",
                width: 120,
                height: 120,
                border: "1px solid var(--border, #e5e7eb)",
                borderRadius: 8,
                overflow: "hidden",
                cursor: "pointer"
              }}
            >
              {photo.url ? (
                <Image
                  src={photo.url}
                  alt={photo.file_name}
                  fill
                  unoptimized
                  sizes="120px"
                  style={{ objectFit: "cover" }}
                  onClick={() => setLightbox(photo)}
                />
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#9ca3af", fontSize: 11 }}>
                  No preview
                </div>
              )}
              {!readOnly ? (
                <button
                  type="button"
                  className="icon-button"
                  onClick={(e) => { e.stopPropagation(); handleDelete(photo.id); }}
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    background: "rgba(0,0,0,0.5)",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    padding: 4,
                    cursor: "pointer"
                  }}
                  title="Delete photo"
                >
                  <IconTrash size={12} />
                </button>
              ) : null}
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  background: "rgba(0,0,0,0.5)",
                  color: "white",
                  fontSize: 10,
                  padding: "2px 4px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
                title={photo.file_name}
              >
                {photo.file_name}
              </div>
            </div>
          ))}
        </div>
      )}

      {lightbox && lightbox.url ? (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            cursor: "pointer",
            padding: 24
          }}
        >
          <Image
            src={lightbox.url}
            alt={lightbox.file_name}
            width={1200}
            height={1200}
            unoptimized
            style={{ maxWidth: "90%", maxHeight: "90%", objectFit: "contain", borderRadius: 8 }}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setLightbox(null)}
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              background: "rgba(255,255,255,0.2)",
              color: "white",
              border: "none",
              borderRadius: 6,
              padding: "8px 16px",
              cursor: "pointer",
              fontSize: 16
            }}
          >
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}
