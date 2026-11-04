import { WorkspaceForm } from "./WorkspaceForm";
import { can } from "@/lib/permissions";
import { requireWorkspace } from "@/lib/session";

export const metadata = { title: "Workspace settings" };

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { member, workspace } = await requireWorkspace(workspaceId);
  return <WorkspaceForm workspace={workspace} canEdit={can(member, "manage_workspace")} />;
}
