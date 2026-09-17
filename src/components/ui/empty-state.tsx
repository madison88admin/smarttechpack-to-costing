import type { ReactNode } from "react";
import { IconBox } from "./icons";

type EmptyStateProps = {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, action, className = "" }: EmptyStateProps) {
  return (
    <div className={`empty-state ${className}`.trim()}>
      <span className="empty-state-icon" aria-hidden>
        <IconBox size={32} />
      </span>
      <p className="empty-state-title">{title}</p>
      {description ? <p className="empty-state-description">{description}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
