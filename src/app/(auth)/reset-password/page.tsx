"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { authClient } from "@/lib/auth-client";

function ResetForm() {
  const token = useSearchParams().get("token");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (!token) return <p>This reset link is missing its code. <Link href="/forgot-password">Request a new link</Link>.</p>;
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const { error } = await authClient.resetPassword({ newPassword: String(new FormData(e.currentTarget).get("password")), token: token! });
    if (error) return setError("This link has expired. Request a new one.");
    router.replace("/sign-in");
  }
  return (
    <form onSubmit={onSubmit}>
      <h2 style={{ fontSize: 24 }}>Choose a new password</h2>
      <label className="field"><span>New password</span><input className="input" type="password" name="password" id="password" minLength={10} required autoComplete="new-password" /></label>
      {error && <p className="err" role="alert">{error}</p>}
      <button className="btn primary" style={{ justifyContent: "center" }} type="submit">Save password</button>
    </form>
  );
}

export default function Page() {
  return <Suspense><ResetForm /></Suspense>;
}
