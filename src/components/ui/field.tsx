import type { ReactNode } from "react";

type FieldProps = {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
};

export function Field({ label, children, hint, error, className = "" }: FieldProps) {
  return (
    <div className={`field ${className}`.trim()}>
      {label ? <label className="field-label">{label}</label> : null}
      <div className="field-control">{children}</div>
      {hint && !error ? <p className="field-hint">{hint}</p> : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  );
}
