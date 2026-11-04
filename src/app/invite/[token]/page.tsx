import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { AcceptButton } from "./AcceptButton";

export const metadata = { title: "Join workspace" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getSessionUser();
  const valid = /^[A-Za-z0-9_-]{20,80}$/.test(token);
  return (
    <main className="portal-wrap" style={{ maxWidth: 460, paddingTop: 72 }}>
      <h1>Join your team</h1>
      {!valid ? (
        <p className="err" role="alert">This invitation link is broken. Ask for a new one.</p>
      ) : user ? (
        <>
          <p>You&apos;re signed in as <b>{user.email}</b>. Accept the invitation to open the workspace.</p>
          <AcceptButton token={token} />
        </>
      ) : (
        <>
          <p>Sign in or create an account with the email address the invitation was sent to, then open this link again.</p>
          <div className="row"><Link className="btn primary" href={`/sign-up?invite=${token}`}>Create account</Link><Link className="btn" href="/sign-in">Sign in</Link></div>
        </>
      )}
    </main>
  );
}
