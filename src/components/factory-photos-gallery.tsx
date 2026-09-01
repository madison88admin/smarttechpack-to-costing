"use client";

import Image from "next/image";
import { useState } from "react";

export type Photo = {
  id: string;
  file_name: string;
  url: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
};

export function FactoryPhotosGallery({ photos }: { photos: Photo[] }) {
  const [lightbox, setLightbox] = useState<Photo | null>(null);

  if (photos.length === 0) {
    return <p className="text-muted">No factory photos uploaded.</p>;
  }

  return (
    <>
      <div className="photo-grid" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {photos.map((photo) => (
          <div
            key={photo.id}
            className="photo-thumb"
            style={{
              position: "relative",
              width: 140,
              height: 140,
              border: "1px solid var(--border, #e5e7eb)",
              borderRadius: 8,
              overflow: "hidden",
              cursor: "pointer"
            }}
            onClick={() => setLightbox(photo)}
          >
            {photo.url ? (
              <Image
                src={photo.url}
                alt={photo.file_name}
                fill
                unoptimized
                sizes="140px"
                style={{ objectFit: "cover" }}
              />
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#9ca3af", fontSize: 11 }}>
                No preview
              </div>
            )}
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
    </>
  );
}
