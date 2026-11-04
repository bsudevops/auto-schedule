import { redirect } from "next/navigation";
import { getSessionUser, listUserWorkspaces } from "@/lib/session";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  const [first] = await listUserWorkspaces(user.id);
  redirect(first ? `/w/${first.id}` : "/onboarding");
}
