import { internalReviewStatuses } from "@/lib/workflow/status";
import { formatCustomerStatusLabel } from "@/lib/costing/customer-status";
import { IconCheck } from "@/components/ui/icons";

type Step = { id: string; label: string; detail: string; state: "done" | "current" | "pending" };

/**
 * Workflow order (per business requirement): NextGen -> Factory CBD ->
 * MD technical review -> Costing validation -> PBD approval ->
 * Customer lifecycle. Factory users see the internal MD/Costing/PBD
 * stages collapsed into a single "Under Review" step.
 */
export function RequestProgressStepper({
  status,
  customerStatus,
  hasProduct,
  hasCbd,
  hasMdReview = false,
  hasCostingReview = false,
  role
}: {
  status: string;
  customerStatus: string;
  hasProduct: boolean;
  hasCbd: boolean;
  hasMdReview?: boolean;
  hasCostingReview?: boolean;
  role?: string;
}) {
  const internalApproved = status === "approved";
  const approvalActive = status === "for_pbd_review";
  const customerClosed = customerStatus === "closed";
  const customerActive = !customerClosed && (internalApproved || customerStatus === "customer_rejected_revised");

  if (role === "factory") {
    // Factory must not see internal review stages — collapse them to "Under Review".
    const underReview = internalReviewStatuses.includes(status as (typeof internalReviewStatuses)[number]);
    const steps: Step[] = [
      { id: "nextgen", label: "NextGen", detail: "Product + BOM", state: hasProduct ? "done" : "current" },
      { id: "factory", label: "Factory CBD", detail: "Cost submission", state: hasCbd || underReview || internalApproved || status === "rejected" ? "done" : ["sent_to_factory", "needs_clarification"].includes(status) ? "current" : "pending" },
      { id: "review", label: "Under Review", detail: "Internal review", state: internalApproved || status === "rejected" ? "done" : underReview ? "current" : "pending" },
      { id: "customer", label: "Customer", detail: customerClosed ? "Approved + closed" : formatCustomerStatusLabel(customerStatus), state: customerClosed ? "done" : customerActive ? "current" : "pending" },
      { id: "closed", label: "Closed", detail: customerClosed ? "Complete" : "Waiting for customer", state: customerClosed ? "done" : "pending" }
    ];

    return (
      <section className="request-stepper" aria-label="Request workflow progress">
        {steps.map((step, index) => (
          <div key={step.id} className={`request-step request-step-${step.state}`}>
            <div className="request-step-marker">{step.state === "done" ? <IconCheck size={14} /> : index + 1}</div>
            <div className="request-step-copy"><strong>{step.label}</strong><span>{step.detail}</span></div>
            {index < steps.length - 1 ? <div className="request-step-connector" aria-hidden="true" /> : null}
          </div>
        ))}
      </section>
    );
  }

  const steps: Step[] = [
    { id: "nextgen", label: "NextGen", detail: "Product + BOM", state: hasProduct ? "done" : "current" },
    { id: "factory", label: "Factory CBD", detail: "Cost submission", state: hasCbd || ["for_md_review", "for_costing_review", "for_pbd_review", "approved", "rejected"].includes(status) ? "done" : ["sent_to_factory", "needs_clarification"].includes(status) ? "current" : "pending" },
    // Review steps are completed only by their immutable audit actions. Do not
    // infer completion from a later status because legacy/imported records can
    // contain an inconsistent status and must remain visibly blocked.
    { id: "md", label: "MD Review", detail: "Technical check", state: hasMdReview ? "done" : status === "for_md_review" ? "current" : "pending" },
    { id: "costing", label: "Costing", detail: "Validation checklist", state: hasCostingReview ? "done" : status === "for_costing_review" ? "current" : "pending" },
    { id: "approval", label: "PBD Approval", detail: "Approve, reject, or clarify", state: internalApproved || status === "rejected" ? "done" : approvalActive ? "current" : "pending" },
    { id: "customer", label: "Customer", detail: customerClosed ? "Approved + closed" : formatCustomerStatusLabel(customerStatus), state: customerClosed ? "done" : customerActive ? "current" : "pending" },
    { id: "closed", label: "Closed", detail: customerClosed ? "Complete" : "Waiting for customer", state: customerClosed ? "done" : "pending" }
  ];

  return (
    <section className="request-stepper" aria-label="Request workflow progress">
      {steps.map((step, index) => (
        <div key={step.id} className={`request-step request-step-${step.state}`}>
          <div className="request-step-marker">{step.state === "done" ? <IconCheck size={14} /> : index + 1}</div>
          <div className="request-step-copy"><strong>{step.label}</strong><span>{step.detail}</span></div>
          {index < steps.length - 1 ? <div className="request-step-connector" aria-hidden="true" /> : null}
        </div>
      ))}
    </section>
  );
}
