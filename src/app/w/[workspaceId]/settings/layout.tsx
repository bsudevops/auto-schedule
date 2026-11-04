import { SettingsTabs } from "./SettingsTabs";
import { requireWorkspace } from "@/lib/session";

export default async function SettingsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { workspace, orgName } = await requireWorkspace(workspaceId);
  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><p>{workspace.name} · {orgName}</p></div></div>
      <SettingsTabs base={`/w/${workspaceId}/settings`} />
      {children}
    </>
  );
}
