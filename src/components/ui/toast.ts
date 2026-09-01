"use client";

import { useEffect, useState, useCallback } from "react";

export type ToastType = "default" | "success" | "info" | "warning" | "error";
export type ToastPriority = "normal" | "high";

export type ToastItem = {
  id: string;
  type: ToastType;
  description: string;
  title?: string;
  priority: ToastPriority;
  duration: number;
  createdAt: number;
};

type ToastInput = {
  type?: ToastType;
  description: string;
  title?: string;
  priority?: ToastPriority;
  duration?: number;
};

type PromiseToastOptions<T> = {
  loading: string;
  success: (data: T) => string;
  error: string;
};

// Simple event-based store (no external deps)
const TOAST_EVENT = "toast-change";
let toasts: ToastItem[] = [];
const listeners = new Set<() => void>();

function emit() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: toasts }));
  }
  listeners.forEach((fn) => fn());
}

function removeToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function addToast(input: ToastInput): string {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const item: ToastItem = {
    id,
    type: input.type ?? "default",
    description: input.description,
    title: input.title,
    priority: input.priority ?? "normal",
    duration: input.duration ?? (input.priority === "high" ? 0 : 4500),
    createdAt: Date.now()
  };
  toasts = [...toasts, item];
  emit();

  if (item.duration > 0) {
    setTimeout(() => removeToast(id), item.duration);
  }
  return id;
}

export const toast = {
  add: addToast,
  remove: removeToast,
  clear: () => {
    toasts = [];
    emit();
  },
  promise: <T,>(promise: Promise<T>, options: PromiseToastOptions<T>) => {
    const loadingId = addToast({
      description: options.loading,
      type: "info",
      duration: 0
    });

    promise
      .then((data) => {
        removeToast(loadingId);
        addToast({
          description: options.success(data),
          type: "success"
        });
      })
      .catch(() => {
        removeToast(loadingId);
        addToast({
          description: options.error,
          type: "error",
          priority: "high"
        });
      });

    return promise;
  }
};

export function useToasts() {
  const [items, setItems] = useState<ToastItem[]>(toasts);

  useEffect(() => {
    const handler = () => setItems([...toasts]);
    listeners.add(handler);
    const eventHandler = () => setItems([...toasts]);
    window.addEventListener(TOAST_EVENT, eventHandler as EventListener);
    return () => {
      listeners.delete(handler);
      window.removeEventListener(TOAST_EVENT, eventHandler as EventListener);
    };
  }, []);

  const remove = useCallback((id: string) => removeToast(id), []);
  const clear = useCallback(() => {
    toasts = [];
    emit();
  }, []);

  return { toasts: items, remove, clear };
}
