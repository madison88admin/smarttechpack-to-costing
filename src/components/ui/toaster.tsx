"use client";

import { useToasts, type ToastItem } from "./toast";
import { IconCheck, IconAlert, IconX, IconSearch, IconDollar } from "./icons";

const typeConfig: Record<
  ToastItem["type"],
  { Icon: React.ComponentType<{ size?: number }>; color: string; bg: string; border: string }
> = {
  default: {
    Icon: IconDollar,
    color: "var(--text)",
    bg: "var(--panel, #fff)",
    border: "var(--line, #dce2df)"
  },
  success: {
    Icon: IconCheck,
    color: "var(--green, #1f7a4d)",
    bg: "#f0fdf4",
    border: "#bbf7d0"
  },
  info: {
    Icon: IconSearch,
    color: "var(--blue, #2f617f)",
    bg: "#f0f9ff",
    border: "#bae6fd"
  },
  warning: {
    Icon: IconAlert,
    color: "var(--amber, #a76112)",
    bg: "#fffbeb",
    border: "#fde68a"
  },
  error: {
    Icon: IconX,
    color: "var(--red, #a83d37)",
    bg: "#fef2f2",
    border: "#fecaca"
  }
};

function ToastCard({ toast, onRemove }: { toast: ToastItem; onRemove: (id: string) => void }) {
  const config = typeConfig[toast.type];
  const Icon = config.Icon;

  return (
    <div
      role="alert"
      onClick={() => onRemove(toast.id)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 8,
        background: config.bg,
        border: `1px solid ${config.border}`,
        borderLeft: `4px solid ${config.color}`,
        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        cursor: "pointer",
        minWidth: 280,
        maxWidth: 400,
        animation: "toast-slide-in 0.2s ease-out"
      }}
    >
      <span
        style={{
          color: config.color,
          lineHeight: 1.2,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          marginTop: 2
        }}
      >
        <Icon size={16} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {toast.title ? (
          <div style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: 2 }}>{toast.title}</div>
        ) : null}
        <div style={{ fontSize: "0.85rem", color: "var(--text, #1e2528)", lineHeight: 1.4 }}>
          {toast.description}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(toast.id);
        }}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--muted, #657174)",
          padding: 0,
          lineHeight: 1,
          flexShrink: 0,
          display: "flex",
          alignItems: "center"
        }}
        aria-label="Dismiss"
      >
        <IconX size={16} />
      </button>
    </div>
  );
}

export function Toaster() {
  const { toasts, remove } = useToasts();

  if (toasts.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes toast-slide-in {
          from { opacity: 0; transform: translateX(100%); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes toast-slide-out {
          from { opacity: 1; transform: translateX(0); }
          to { opacity: 0; transform: translateX(100%); }
        }
      `}</style>
      <div
        aria-live="polite"
        aria-atomic="true"
        role="status"
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 9999,
          pointerEvents: "none"
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8, pointerEvents: "auto" }}>
          {toasts.map((t) => (
            <ToastCard key={t.id} toast={t} onRemove={remove} />
          ))}
        </div>
      </div>
    </>
  );
}
