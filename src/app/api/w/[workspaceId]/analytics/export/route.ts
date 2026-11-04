import { csvCell } from "@/lib/analytics-math";
import { loadAnalytics, parseRange } from "@/lib/analytics";
import { PLATFORMS } from "@/lib/platforms";
import { workspaceAccess } from "@/lib/session";

export const runtime = "nodejs";

/** Daily figures for the chosen range and channel, as CSV. Any member can export what they can already see. */
export async function GET(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await workspaceAccess(workspaceId);
  if (!access) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const range = parseRange(url.searchParams.get("range") ?? undefined);
  const ch = url.searchParams.get("channel");
  const data = await loadAnalytics(access.workspace, range, ch && /^[0-9a-f-]{36}$/i.test(ch) ? ch : null);
  const name = new Map(data.channels.map((c) => [c.id, c]));
  const header = ["date", "channel", "platform", "followers", "impressions", "reach", "engagements", "video_views", "link_clicks"];
  const lines = [header.join(",")];
  for (const r of [...data.rows].sort((a, b) => a.day.localeCompare(b.day))) {
    const c = name.get(r.channelId);
    if (!c) continue;
    lines.push([r.day, c.displayName, PLATFORMS[c.platform].name, r.followers, r.impressions, r.reach, r.engagements, r.videoViews, r.linkClicks].map(csvCell).join(","));
  }
  const file = `analytics-${access.workspace.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${data.today}-${range}d.csv`;
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}"`, "Cache-Control": "no-store" },
  });
}
