"use client";

import { useState, useCallback, type ReactNode } from "react";
import { IconAlert, IconCheck, IconX } from "./icons";

type ConfirmConfig = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "success";
};

type ConfirmState = ConfirmConfig & {
  open: boolean;
  resolve: ((confirmed: boolean) => void) | null;
};

const variantConfig = {
  danger: {
    icon: IconX,
    iconClass: "confirm-icon-danger",
    buttonClass: "btn-danger"
  },
  warning: {
    icon: IconAlert,
    iconClass: "confirm-icon-warning",
    buttonClass: ""
  },
  success: {
    icon: IconCheck,
    iconClass: "confirm-icon-success",
    buttonClass: "btn-success"
  }
};

export function useConfirm() {
  const [state, setState] = useState<ConfirmState>({
    open: false,
    title: "",
    message: "",
    resolve: null
  });

  const confirm = useCallback((config: ConfirmConfig): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        ...config,
        open: true,
        resolve
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    state.resolve?.(true);
    setState((prev) => ({ ...prev, open: false, resolve: null }));
  }, [state]);

  const handleCancel = useCallback(() => {
    state.resolve?.(false);
    setState((prev) => ({ ...prev, open: false, resolve: null }));
  }, [state]);

  const dialog = (
    <ConfirmDialog
      open={state.open}
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      variant={state.variant}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );

  return { confirm, dialog };
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "warning",
  onConfirm,
  onCancel
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "success";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  const cfg = variantConfig[variant];
  const Icon = cfg.icon;

  return (
    <div
      className="modal-overlay"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
    >
      <div className="modal-content confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-header">
          <span className={`confirm-icon ${cfg.iconClass}`}>
            <Icon size={24} />
          </span>
          <h3 id="confirm-title">{title}</h3>
        </div>
        <p id="confirm-message" className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button
            className="button secondary"
            onClick={onCancel}
            autoFocus
          >
            {cancelLabel}
          </button>
          <button
            className={`button ${cfg.buttonClass}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
