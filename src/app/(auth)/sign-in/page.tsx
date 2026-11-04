import { googleEnabled } from "@/lib/auth";
import { signupMode } from "@/lib/signup-policy";
import { SignInForm } from "./SignInForm";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default function Page() {
  return <SignInForm google={googleEnabled} signupOpen={signupMode() === "open"} />;
}
