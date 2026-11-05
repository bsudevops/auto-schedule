"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { GoogleButton } from "../GoogleButton";

export function SignInForm({ google, signupOpen = true, next = "/" }: { google: boolean; signupOpen?: boolean; next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.email({
      email: String(f.get("email")),
      password: String(f.get("password")),
      rememberMe: f.get("remember") === "on",
    });
    setBusy(false);
    if (error) {
      setError(error.status === 403 ? "Confirm your email first. We sent you a link when you signed up." : "That email and password don't match. Try again or reset your password.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <h2 style={{ fontSize: 24 }}>Sign in</h2>
      <p className="muted">Welcome back. Sign in to your workspace.</p>
      {google && <GoogleButton callbackURL={next} />}
      {google && (
        <div className="row muted" style={{ fontSize: 12 }}>
          <span style={{ flex: 1, height: 1, background: "var(--line)" }} />or<span style={{ flex: 1, height: 1, background: "var(--line)" }} />
        </div>
      )}
      <label className="field"><span>Email</span><input className="input" type="email" name="email" id="email" autoComplete="email" required /></label>
      <label className="field"><span>Password</span><input className="input" type="password" name="password" id="password" autoComplete="current-password" required /></label>
      <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" name="remember" id="remember" defaultChecked style={{ accentColor: "var(--sky)" }} /> Remember me</label>
        <Link href="/forgot-password">Forgot password?</Link>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      <button className="btn primary" style={{ justifyContent: "center" }} type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      {signupOpen ? <p className="muted" style={{ fontSize: 13, textAlign: "center" }}>New here? <Link href="/sign-up">Create an account</Link></p> : <p className="muted" style={{ fontSize: 13, textAlign: "center" }}>Accounts are created by invitation.</p>}
    </form>
  );
}
