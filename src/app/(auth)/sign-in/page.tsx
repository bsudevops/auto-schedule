import { googleEnabled } from "@/lib/auth";
import { signupMode } from "@/lib/signup-policy";
import { SignInForm } from "./SignInForm";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

/** Only same-site paths are followed after sign-in, so the link can't send people elsewhere. */
const safeNext = (v: unknown) => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/");

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <SignInForm google={googleEnabled} signupOpen={signupMode() === "open"} next={safeNext(next)} />;
}
