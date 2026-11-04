"use client";
import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { GoogleButton } from "../GoogleButton";

export function SignUpForm({ google, invite }: { google: boolean; invite?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = invite ? `/invite/${invite}` : "/";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    setBusy(true);
    setError(null);
    const { error } = await authClient.signUp.email({ name: String(f.get("name")), email, password: String(f.get("password")), callbackURL: next });
    setBusy(false);
    if (error) {
      setError(error.code === "PASSWORD_TOO_SHORT" ? "Use at least 10 characters for your password." : error.message ?? "We couldn't create the account. Try again.");
      return;
    }
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <div className="stack" style={{ maxWidth: 360 }}>
        <h2 style={{ fontSize: 24 }}>Check your email</h2>
        <p>We sent a confirmation link to <b>{sentTo}</b>. Open it to finish creating your account.</p>
        <Link href="/sign-in">Back to sign in</Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <h2 style={{ fontSize: 24 }}>Create your account</h2>
      <p className="muted">{invite ? "Create an account to join your team's workspace." : "Start planning posts for your brands."}</p>
      {google && <GoogleButton />}
      <label className="field"><span>Your name</span><input className="input" name="name" id="name" autoComplete="name" required maxLength={80} /></label>
      <label className="field"><span>Work email</span><input className="input" type="email" name="email" id="email" autoComplete="email" required /></label>
      <label className="field"><span>Password</span><input className="input" type="password" name="password" id="password" autoComplete="new-password" minLength={10} required /><small className="muted">At least 10 characters.</small></label>
      {error && <p className="err" role="alert">{error}</p>}
      <button className="btn primary" style={{ justifyContent: "center" }} type="submit" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
      <p className="muted" style={{ fontSize: 13, textAlign: "center" }}>Already have an account? <Link href="/sign-in">Sign in</Link></p>
    </form>
  );
}
