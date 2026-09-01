"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";

export function LoginForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function login(formData: FormData) {
    setBusy(true);
    setMessage("Signing in...");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: String(formData.get("username") ?? ""),
          password: String(formData.get("password") ?? "")
        })
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        const errMsg = result.error ?? "Unable to sign in";
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
          type="password"
          required
          autoComplete="current-password"
        />
      </div>
      <button className="button login-submit" type="submit" disabled={busy}>
        {busy ? "Signing in..." : "Sign in"}
      </button>
      <p className="login-form-note">
        Use your authorized Madison88 account. Access is controlled by your active costing profile and assigned role.
      </p>
      {message ? <p className="form-message">{message}</p> : null}
    </form>
  );
}
