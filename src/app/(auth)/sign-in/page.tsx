import { googleEnabled } from "@/lib/auth";
import { SignInForm } from "./SignInForm";

export const metadata = { title: "Sign in" };

export default function Page() {
  return <SignInForm google={googleEnabled} />;
}
