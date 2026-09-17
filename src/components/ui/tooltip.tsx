"use client";

import type { ReactNode } from "react";

type TooltipProps = {
  text: string;
  children: ReactNode;
};

export function Tooltip({ text, children }: TooltipProps) {
  return (
    <span className="tooltip-wrap">
      {children}
      <span className="tooltip-bubble" role="tooltip">{text}</span>
    </span>
  );
}
