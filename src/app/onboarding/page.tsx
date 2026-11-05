import { requireUser, listUserOrgs } from "@/lib/session";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { BRAND } from "@/lib/brand";
import { OnboardingForm } from "./OnboardingForm";

export const metadata = { title: "Set up your organization" };

export default async function Page() {
  const user = await requireUser();
  if ((await listUserOrgs(user.id)).length) redirect("/organization");
  return (
    <main className="portal-wrap" style={{ maxWidth: 560, paddingTop: 56 }}>
      <div className="row"><BrandLogo /><b style={{ fontFamily: "var(--f-display)", fontSize: 18 }}>{BRAND.name}</b></div>
      <div><h1>Welcome, {user.name.split(" ")[0]}</h1><p className="muted" style={{ marginTop: 4 }}>Start by naming your company or agency. Next you will add a workspace for each client.</p></div>
      <OnboardingForm />
    </main>
  );
}
