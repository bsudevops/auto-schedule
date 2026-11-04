import Link from "next/link";

export default function NotFound() {
  return (
    <main className="auth-form" style={{ minHeight: "100%" }}>
      <div className="stack" style={{ maxWidth: 380, textAlign: "center", alignItems: "center" }}>
        <h1>Page not found</h1>
        <p className="muted">The page doesn&apos;t exist, or you don&apos;t have access to it.</p>
        <Link className="btn primary" href="/">Go to your workspace</Link>
      </div>
    </main>
  );
}
