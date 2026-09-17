import Image from "next/image";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-shell" aria-label="Smart TP Costing sign in">
        <aside className="login-visual" aria-label="Smart TP Costing overview">
          <div className="login-visual-top">
            <span className="login-brand-mark" aria-hidden="true">TP</span>
            <span className="login-brand-name">Smart TP <small>Costing Approval</small></span>
          </div>
          <div className="login-visual-copy">
            <p className="eyebrow">Madison88 Business Solutions</p>
            <h2>From tech pack<br /><em>to confident costing.</em></h2>
            <p>Bring factory inputs, validation, approvals, and customer review into one clear workspace.</p>
          </div>
          <div className="login-visual-meta" aria-label="Platform capabilities">
            <span className="login-visual-chip"><span aria-hidden="true">+</span> Guided costing</span>
            <span className="login-visual-chip"><span aria-hidden="true">&gt;</span> Audit-ready workflow</span>
          </div>
        </aside>

        <section className="login-card">
          <div className="login-card-header">
            <Image
              className="login-m88-logo"
              src="/m88logo.png"
              alt="Madison88"
              width={960}
              height={212}
              style={{ height: "auto" }}
              priority
            />
            <span className="login-secure-pill"><span aria-hidden="true">*</span> Secure access</span>
          </div>
          <h1>Welcome back</h1>
          <p className="login-subtitle">Sign in to continue to your costing workspace.</p>
          <LoginForm />
          <div className="login-help">
            <strong>Need access?</strong>
            <span>Contact the Smart TP Costing system administrator to activate your account and assign a role.</span>
          </div>
          <p className="login-footer">Last security update: September 2026 · Issues? <a href="https://m88itsm.netlify.app/login" target="_blank" rel="noreferrer">Report to ITSM</a></p>
        </section>
      </section>
    </main>
  );
}
