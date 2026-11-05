import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { Composer } from "./Composer";
import { loadComposer } from "./load";

export const metadata = { title: "Create post" };

export default async function Page({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<{ media?: string; idea?: string; date?: string; time?: string }> }) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const { member, workspace } = await requireWorkspace(workspaceId, "create_posts");
  const props = await loadComposer({ member, workspace, mediaId: sp.media, ideaId: sp.idea, date: sp.date, time: sp.time });
  if (!props) notFound();
  return <Composer {...props} />;
}
