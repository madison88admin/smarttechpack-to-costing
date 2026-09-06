import { statusLabels, statusTone, type CostingStatus } from "@/lib/workflow/status";
import {
  IconFileText,
  IconSend,
  IconAlertCircle,
  IconSearch,
  IconClock,
  IconCheckCircle,
  IconXCircle,
  IconDollar
} from "@/components/ui/icons";

const statusIcons: Record<CostingStatus, React.ComponentType<{ size?: number }>> = {
  draft: IconFileText,
  sent_to_factory: IconSend,
  needs_clarification: IconAlertCircle,
  for_md_review: IconSearch,
  for_costing_review: IconSearch,
  for_pbd_review: IconClock,
  approved: IconCheckCircle,
  rejected: IconXCircle,
  under_review: IconClock
};

export function StatusPill({ status }: { status: CostingStatus }) {
  const tone = statusTone[status];
  const Icon = statusIcons[status] ?? IconFileText;

  return (
    <span className={`status ${tone}`}>
      <span className="status-dot" />
      <Icon size={13} />
      <span className="status-label">{statusLabels[status]}</span>
    </span>
  );
}
