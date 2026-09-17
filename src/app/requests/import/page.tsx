import { AppShell } from "@/components/app-shell";
import { ImportCbdForm } from "@/components/import-cbd-form";

export default function ImportCbdPage() {
  return <AppShell><main className="page-shell import-page"><div className="hero"><div><p className="eyebrow">Template-driven intake</p><h1>Import Factory CBD</h1><p className="hero-copy">Upload a completed factory workbook and we’ll create a traceable draft request.</p></div></div><div className="import-layout"><ImportCbdForm /><aside className="panel import-guide"><h2>What happens next?</h2><ol className="list compact-list"><li>Workbook fields are validated and mapped.</li><li>A draft request is created with the imported BOM and costs.</li><li>The request follows the normal Factory → MD → Costing → PBD workflow.</li></ol><p className="muted">Need help with a template or encounter an error? Report it to ITSM.</p><a className="button secondary" href="https://m88itsm.netlify.app/login" target="_blank" rel="noreferrer">Report an issue</a></aside></div></main></AppShell>;
}
