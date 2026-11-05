"use client";
import { authClient } from "@/lib/auth-client";

export function GoogleButton({ callbackURL = "/" }: { callbackURL?: string }) {
  return (
    <button type="button" className="btn" style={{ justifyContent: "center" }} onClick={() => authClient.signIn.social({ provider: "google", callbackURL })}>
      <span className="pf" style={{ background: "#fff", color: "#4285F4", border: "1px solid var(--line)" }}>G</span> Continue with Google
    </button>
  );
}
