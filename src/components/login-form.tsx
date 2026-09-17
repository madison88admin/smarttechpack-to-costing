"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";

export function LoginForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [fieldError, setFieldError] = useState("");

  async function login(formData: FormData) {
    const username = String(formData.get("username") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    if (!username || !/^\S+@\S+\.\S+$/.test(username)) { setFieldError("Enter a valid email address."); return; }
    if (!password) { setFieldError("Enter your password."); return; }
    setFieldError("");
    setBusy(true);
    setMessage("Signing in...");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password
        })
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        const errMsg = response.status === 401 ? "We couldn’t sign you in. Check your email and password or contact ITSM." : result.error ?? "Unable to sign in right now. Please try again.";
        setMessage(errMsg);
        toast.add({ type: "error", description: errMsg, priority: "high" });
        return;
      }

      toast.add({ type: "success", description: `Welcome back, ${result.role}` });
      router.push("/");
      router.refresh();
    } catch {
      setMessage("Network error - please try again");
      toast.add({ type: "error", description: "Network error during login", priority: "high" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={login} className="login-form">
      <div className="login-field">
        <label htmlFor="login-username">Email address</label>
        <input
          id="login-username"
          className="input"
          name="username"
          placeholder="you@madison88.com"
          type="email"
          required
          autoComplete="username"
          autoFocus
        />
      </div>
      <div className="login-field">
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          className="input"
          name="password"
          placeholder="Enter your password"
          type={showPassword ? "text" : "password"}
          required
          autoComplete="current-password"
        />
        <button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button>
        {fieldError ? <p className="field-error" role="alert">{fieldError}</p> : null}
      </div>
      <button className="button login-submit" type="submit" disabled={busy}>
        {busy ? "Signing in..." : "Sign in"}
      </button>
      <p className="login-form-note">
        Use your authorized Madison88 account. Access is controlled by your active costing profile and assigned role.
      </p>
      <a className="login-recovery" href="https://m88itsm.netlify.app/login" target="_blank" rel="noreferrer">Forgot password or having an issue? Report it to ITSM →</a>
      {message ? <p className="form-message">{message}</p> : null}
    </form>
  );
}
