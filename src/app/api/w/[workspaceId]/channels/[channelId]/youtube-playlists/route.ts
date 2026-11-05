import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { can } from "@/lib/permissions";
import { youtubePlaylists } from "@/lib/publishing/google";
import { accessTokenFor } from "@/lib/publishing/tokens";
import { workspaceAccess } from "@/lib/session";

export const runtime = "nodejs";

/** The YouTube channel's playlists, for the playlist picker in Create post. An empty list when YouTube can't be reached. */
export async function GET(_req: Request, { params }: { params: Promise<{ workspaceId: string; channelId: string }> }) {
  const { workspaceId, channelId } = await params;
  const access = await workspaceAccess(workspaceId);
  if (!access || !can(access.member, "create_posts") || !/^[0-9a-f-]{36}$/i.test(channelId)) return Response.json({ error: "Not found" }, { status: 404 });
  const [c] = await db.select().from(channels).where(and(eq(channels.id, channelId), eq(channels.workspaceId, workspaceId), eq(channels.platform, "youtube")));
  if (!c) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    return Response.json({ playlists: await youtubePlaylists(await accessTokenFor(c)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ playlists: [], error: (e as Error).message }, { headers: { "Cache-Control": "no-store" } });
  }
}
