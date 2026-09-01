import Link from "next/link";
import { AppShell } from "@/components/app-shell";

const qaSteps = [
  {
    title: "1. Search NextGen Product",
    detail: "Search a real style such as M8819347 and confirm the product result looks correct.",
    pass: "Product is found and can be selected."
  },
  {
    title: "2. Load BOM",
    detail: "Click Load BOM after selecting the product.",
    pass: "BOM lines appear, or the empty-state message is clear."
  },
  {
    title: "3. Create Costing Request",
    detail: "Add factory/notes and create the draft.",
    pass: "Request saves and redirects to request detail."
  },
  {
    title: "4. Send to Factory",
    detail: "Click Send to Factory from request detail.",
    pass: "Status changes and Activity shows old status → new status."
  },
  {
    title: "5. Factory CBD",
    detail: "Open Factory CBD, fill costs, save draft, reload, then submit.",
    pass: "Saved values reload and submitted CBD goes to PBD review or clarification."
  },
  {
    title: "6. Smart Review",
    detail: "Review AI Assist panel after CBD submission.",
    pass: "Risk, highlights, and suggested action are understandable."
  },
  {
    title: "7. PBD Action",
    detail: "Try clarify/approve/reject based on validation result.",
    pass: "Blocking errors prevent approval; clean CBD can be approved."
  },
  {
    title: "8. History and Export",
    detail: "Check Historical Costing and export CSV.",
    pass: "Approved costing appears and CSV downloads."
  }
];

export default function QaPage() {
  return (
    <AppShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Phase 7</p>
          <h1>Pilot QA Checklist</h1>
        </div>
        <Link className="button" href="/requests/new">
          Start Test Request
        </Link>
      </div>

      <section className="panel">
        <h2>Recommended Pilot Scope</h2>
        <p>
          Test at least <strong>3 real styles</strong> end-to-end before production hardening. Start with{" "}
          <strong>M8819347</strong>, then add active styles from the current costing workload.
        </p>
      </section>

      <div style={{ height: 16 }} />

      <section className="grid qa-grid">
        {qaSteps.map((step) => (
          <div className="panel qa-card" key={step.title}>
            <h2>{step.title}</h2>
            <p>{step.detail}</p>
            <div className="qa-pass">
              <strong>Pass criteria</strong>
              <p>{step.pass}</p>
            </div>
          </div>
        ))}
      </section>

      <div style={{ height: 16 }} />

      <section className="panel">
        <h2>Sign-off Rule</h2>
        <p>
          Move to Phase 8 only when Product Search, BOM, Request Creation, Factory CBD, Validation,
          Smart Review, PBD Approval, History, and Export all pass for at least 3 real styles.
        </p>
      </section>
    </AppShell>
  );
}
