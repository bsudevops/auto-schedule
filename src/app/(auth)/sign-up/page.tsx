import { googleEnabled } from "@/lib/auth";
import { SignUpForm } from "./SignUpForm";

export const metadata = { title: "Create account" };

export default async function Page({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  return <SignUpForm google={googleEnabled} invite={invite && /^[A-Za-z0-9_-]{20,80}$/.test(invite) ? invite : undefined} />;
}
