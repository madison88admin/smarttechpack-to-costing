"use client";

import Image from "next/image";
import { useState } from "react";

type ProductImageProps = {
  entityId: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
};

export function ProductImage({ entityId, alt, width = 80, height = 80, className, style }: ProductImageProps) {
  const [error, setError] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  if (error) {
    return (
      <div
        role="img"
        aria-label={`${alt || "Product"} image unavailable`}
        title="Product image unavailable"
        className={className}
        style={{
          width,
          height,
          borderRadius: 8,
          flexShrink: 0,
          background: "#f3f4f6",
          border: "1px solid #e5e7eb",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#9ca3af",
          fontSize: 11,
          textAlign: "center",
          ...style
        }}
      >
        No image
      </div>
    );
  }

  const imgUrl = `/api/product/${encodeURIComponent(entityId)}/image`;

  return (
    <>
      {/* The image is always rendered (the gray background is the loading
          placeholder). Do NOT gate visibility on onLoad: when the image is
          served from cache or loads faster than hydration, the load event can
          fire before React attaches the handler and the photo would stay
          hidden forever. onError still swaps to the "No image" state. */}
      <Image
        src={imgUrl}
        alt={alt}
        width={width}
        height={height}
        unoptimized
        className={className}
        style={{
          objectFit: "cover",
          borderRadius: 8,
          flexShrink: 0,
          background: "#f3f4f6",
          border: "1px solid #e5e7eb",
          cursor: "pointer",
          ...style
        }}
        onError={() => setError(true)}
        onClick={() => setLightbox(true)}
        title="Click to enlarge"
      />

      {lightbox ? (
        <div
          onClick={() => setLightbox(false)}
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
            src={imgUrl}
            alt={alt}
            width={1200}
            height={1200}
            unoptimized
            style={{ maxWidth: "90%", maxHeight: "90%", objectFit: "contain", borderRadius: 8 }}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setLightbox(false)}
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
