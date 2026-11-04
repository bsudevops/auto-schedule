import { NextResponse } from "next/server";
import { authenticate } from "@/lib/api-auth";
import { loadAnalytics, parseRange } from "@/lib/analytics";

export const runtime = "nodejs";

/** GET /api/v1/analytics?range=7|30|90&channel=<id> */
export async function GET(req: Request) {
  const ctx = await authenticate(req, "analytics:read");
  if (ctx instanceof NextResponse) return ctx;
  const q = new URL(req.url).searchParams;
  const ch = q.get("channel");
  const data = await loadAnalytics(ctx.workspace, parseRange(q.get("range") ?? undefined), ch && /^[0-9a-f-]{36}$/i.test(ch) ? ch : null);
  return NextResponse.json({
    data: {
      range: data.range,
      through: data.today,
      channel: data.selected?.id ?? null,
      kpis: data.summary.kpis,
      daily: data.summary.series,
      channels: data.summary.byChannel.map(({ channelId, name, platform, followers, growth, impressions, reach, engagements, engagementRate, posts }) => ({ channelId, name, platform, followers, growth, impressions, reach, engagements, engagementRate, posts })),
      topPosts: data.top,
    },
  });
}
