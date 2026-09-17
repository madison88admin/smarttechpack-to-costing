import Link from "next/link";

type Issue = { id: string; severity: string; rule_code: string; message: string; field_path: string | null };
const location = (field?: string | null) => {
  const value = field ?? "";
  if (value.startsWith("lines.")) return { step: 2, label: "Factory CBD · Fabric & Trim", hint: "Review the named material line, its consumption, and its unit cost." };
  if (value === "lines") return { step: 2, label: "Factory CBD · Fabric & Trim", hint: "Add at least one material line, then enter its consumption and unit cost." };
  if (value === "laborCost") return { step: 3, label: "Factory CBD · Knitting & Operations", hint: "Enter the labor cost or check the knitting-operation cost calculation." };
  if (value.includes("packaging") || value.includes("overhead") || value.includes("testing")) return { step: 4, label: "Factory CBD · Packaging & Overhead", hint: "Review the packaging, overhead, or testing cost shown in this section." };
  if (value === "yarnType") return { step: 0, label: "Factory CBD · Header Info · Yarn Type", hint: "Select the yarn type used for benchmark matching." };
  if (value === "knitType") return { step: 0, label: "Factory CBD · Header Info · Knit Type", hint: "Select the knit type used for benchmark matching." };
  if (value === "machineType") return { step: 0, label: "Factory CBD · Header Info · Machine Type", hint: "Select the machine or gauge used for benchmark matching." };
  if (value === "moq") return { step: 0, label: "Factory CBD · Header Info · MOQ", hint: "Enter the minimum order quantity supplied by the factory." };
  if (value === "leadTimeDays") return { step: 0, label: "Factory CBD · Header Info · Lead Time", hint: "Enter the production lead time in days." };
  if (value === "materialBufferPercent") return { step: 0, label: "Factory CBD · Header Info · Material Buffer", hint: "Enter the material buffer percentage used for this costing." };
  if (value === "brandNominatedItems") return { step: 0, label: "Factory CBD · Header Info · Brand-Nominated Items", hint: "Confirm whether brand-nominated items apply." };
  if (value === "m88Packaging") return { step: 0, label: "Factory CBD · Header Info · M88 Packaging", hint: "Add the required M88 packaging details." };
  if (value.startsWith("benchmark")) return { step: 6, label: "Costing Review · Benchmark", hint: "Compare the total against historical approved costings." };
  return { step: 0, label: "Factory CBD · Header Info", hint: "Review the required header fields such as currency, customer, MOQ, lead time, and construction attributes." };
};

export function ValidationFindingsPanel({ requestId, issues, canOpenCbd }: { requestId: string; issues: Issue[]; canOpenCbd: boolean }) {
  const actionable = issues.filter(issue => issue.severity !== "info");
  return <section className="panel validation-findings-panel"><div className="section-heading"><div><p className="eyebrow">CBD review guide</p><h2>Warnings & highlights</h2></div><span className={`status ${actionable.length ? "amber" : "green"}`}>{actionable.length ? `${actionable.length} need review` : "No open warnings"}</span></div>
    <p className="eyebrow">Each finding names where it came from and what to check. Once the CBD is corrected and resubmitted, resolved findings should disappear.</p>
    {issues.length ? <ul className="list compact-list">{issues.map(issue => { const target = location(issue.field_path); return <li key={issue.id} className={`validation-finding ${issue.severity}`}><span className={`status ${issue.severity === "error" ? "red" : issue.severity === "warning" ? "amber" : "blue"}`}>{issue.severity}</span><div><strong>{issue.message}</strong><br /><span className="eyebrow">Location: {target.label} · {target.hint}</span>{canOpenCbd ? <><br /><Link className="table-action" href={`/factory/${requestId}?step=${target.step}`}>Open this CBD section</Link></> : null}</div></li>; })}</ul> : <div className="empty-state compact-empty"><strong>No active validation warnings</strong><p>The current CBD passed the available validation rules. Review checklist and approval gates before final approval.</p></div>}
  </section>;
}
