import Link from "next/link";
import { ActivityList } from "@/components/ActivityList";
import { EmptyState } from "@/components/ui";
import { recentActivity } from "@/lib/activity";
import { requireWorkspace } from "@/lib/session";

export const metadata = { title: "Team activity" };

const PAGE = 50;

export default async function Page({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const { workspace } = await requireWorkspace(workspaceId);
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before) : undefined;
  const rows = await recentActivity(workspaceId, { limit: PAGE + 1, before });
  const more = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Team activity</h1>
          <p>What everyone in {workspace.name} did, newest first. Kept for 180 days.</p>
        </div>
      </div>
      <div className="card">
        <div className="card-b">
          {shown.length ? <ActivityList entries={shown} timeZone={workspace.timezone} /> : <EmptyState title="Nothing yet" body="Posts, channels, queues and team changes show up here as they happen." />}
        </div>
      </div>
      <div className="row" style={{ marginTop: 12, gap: 8 }}>
        {before && <Link className="btn sm" href={`/w/${workspaceId}/activity`}>Newest</Link>}
        {more && <Link className="btn sm" href={`/w/${workspaceId}/activity?before=${encodeURIComponent(shown[shown.length - 1]!.at.toISOString())}`}>Older</Link>}
      </div>
    </>
  );
}
