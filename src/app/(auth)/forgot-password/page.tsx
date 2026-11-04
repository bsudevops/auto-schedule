"use client";
import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function Page() {
  const [sent, setSent] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email"));
    await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    // Same message whether or not the account exists, so this page can't be used to check emails.
    setSent(true);
  }
  return sent ? (
    <div className="stack" style={{ maxWidth: 360 }}>
      <h2 style={{ fontSize: 24 }}>Check your email</h2>
      <p>If an account uses that address, we sent a link to reset the password.</p>
      <Link href="/sign-in">Back to sign in</Link>
    </div>
  ) : (
    <form onSubmit={onSubmit}>
      <h2 style={{ fontSize: 24 }}>Reset your password</h2>
      <p className="muted">Enter your email and we&apos;ll send you a reset link.</p>
      <label className="field"><span>Email</span><input className="input" type="email" name="email" id="email" required /></label>
      <button className="btn primary" style={{ justifyContent: "center" }} type="submit">Send reset link</button>
      <Link href="/sign-in" style={{ fontSize: 13, textAlign: "center" }}>Back to sign in</Link>
    </form>
  );
}
