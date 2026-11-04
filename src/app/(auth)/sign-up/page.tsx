import Link from "next/link";
import { googleEnabled } from "@/lib/auth";
import { SIGNUP_CLOSED_MESSAGE, signupMode } from "@/lib/signup-policy";
import { SignUpForm } from "./SignUpForm";

export const metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  const token = invite && /^[A-Za-z0-9_-]{20,80}$/.test(invite) ? invite : undefined;
  // Without an invitation link there is nothing to do here when sign-up is closed.
  if (signupMode() === "invite-only" && !token) {
    return (
      <div className="stack" style={{ maxWidth: 360 }}>
        <h2 style={{ fontSize: 24 }}>Sign-up is by invitation</h2>
        <p>{SIGNUP_CLOSED_MESSAGE}</p>
        <Link href="/sign-in">Back to sign in</Link>
      </div>
    );
  }
  return <SignUpForm google={googleEnabled} invite={token} />;
}
