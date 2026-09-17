import type { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  className?: string;
  variant?: "default" | "metric" | "form" | "chart" | "insight" | "dimension";
  onClick?: () => void;
};

const variantClass = {
  default: "",
  metric: "metric",
  form: "form-section-card",
  chart: "report-chart-card",
  insight: "report-insight-card",
  dimension: "report-dimension-card"
};

export function Card({ children, className = "", variant = "default", onClick }: CardProps) {
  const classes = ["panel", variantClass[variant], className].filter(Boolean).join(" ");
  return (
    <div className={classes} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}>
      {children}
    </div>
  );
}
