import { redirect } from "next/navigation";
import { getSessionUser, listUserOrgs } from "@/lib/session";

/** After sign-in everyone lands on the organization page, which lists their workspaces. */
export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  redirect((await listUserOrgs(user.id)).length ? "/organization" : "/onboarding");
}
