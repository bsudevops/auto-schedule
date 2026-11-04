import { requireUser, listUserWorkspaces } from "@/lib/session";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { BRAND } from "@/lib/brand";
import { OnboardingForm } from "./OnboardingForm";

export const metadata = { title: "Set up your workspace" };

export default async function Page() {
  const user = await requireUser();
  if ((await listUserWorkspaces(user.id)).length) redirect("/");
  return (
    <main className="portal-wrap" style={{ maxWidth: 560, paddingTop: 56 }}>
      <div className="row"><BrandLogo /><b style={{ fontFamily: "var(--f-display)", fontSize: 18 }}>{BRAND.name}</b></div>
      <div><h1>Welcome, {user.name.split(" ")[0]}</h1><p className="muted" style={{ marginTop: 4 }}>Set up your company and your first brand. You can add more brands later.</p></div>
      <OnboardingForm />
    </main>
  );
}
