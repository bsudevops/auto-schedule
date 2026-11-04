import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { Composer } from "../../compose/Composer";
import { loadComposer } from "../../compose/load";

export const metadata = { title: "Edit post" };

export default async function Page({ params }: { params: Promise<{ workspaceId: string; postId: string }> }) {
  const { workspaceId, postId } = await params;
  const { member, workspace } = await requireWorkspace(workspaceId);
  if (!/^[0-9a-f-]{36}$/i.test(postId)) notFound();
  const props = await loadComposer({ member, workspace, postId });
  if (!props) notFound();
  return <Composer {...props} />;
}
