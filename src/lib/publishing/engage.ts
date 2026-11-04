/**
 * Reading results and conversations back from the platforms: daily channel figures, per-post figures,
 * comments on our posts, and replying to those comments.
 */
import type { Platform } from "@/db/schema";
import { http } from "./http";
import { call as metaCall } from "./meta";
import { headers as liHeaders, linkedinError } from "./linkedin";
import { tiktokError } from "./tiktok";
import { PublishError } from "./types";

export type Ctx = { channel: { externalId: string; handle: string; meta: Record<string, unknown> }; accessToken: string };

export type DailyMetrics = {
  day: string; // YYYY-MM-DD
  impressions?: number | null;
  reach?: number | null;
  engagements?: number | null;
  videoViews?: number | null;
  linkClicks?: number | null;
};

export type PostFigures = {
  impressions?: number | null;
  reach?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  videoViews?: number | null;
  clicks?: number | null;
};

export type RemoteComment = { id: string; author: string; text: string; createdAt: Date; fromUs: boolean; replies: RemoteComment[] };

export interface EngageSource {
  followers(ctx: Ctx): Promise<number | null>;
  daily?(ctx: Ctx, since: Date, until: Date): Promise<DailyMetrics[]>;
  post(ctx: Ctx, externalPostId: string): Promise<PostFigures>;
  comments?(ctx: Ctx, externalPostId: string): Promise<RemoteComment[]>;
  /** Replies to a comment and returns the new comment's ID. */
  reply?(ctx: Ctx, thread: { externalId: string; meta: Record<string, unknown> }, text: string): Promise<string>;
}

const unix = (d: Date) => String(Math.floor(d.getTime() / 1000));
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown) => (typeof v === "number" ? v : null);

/* ---------------------------- Facebook ----------------------------- */

type InsightRow = { name: string; values?: { value: unknown; end_time?: string }[] };

const facebook: EngageSource = {
  async followers({ channel, accessToken }) {
    const r = await metaCall<{ followers_count?: number }>("GET", channel.externalId, accessToken, { fields: "followers_count" }, "Reading followers");
    return r.followers_count ?? null;
  },
  async daily({ channel, accessToken }, since, until) {
    const r = await metaCall<{ data: InsightRow[] }>(
      "GET",
      `${channel.externalId}/insights`,
      accessToken,
      { metric: "page_impressions,page_impressions_unique,page_post_engagements,page_video_views", period: "day", since: unix(since), until: unix(until) },
      "Reading Page insights",
    );
    const days = new Map<string, DailyMetrics>();
    const field: Record<string, keyof DailyMetrics> = { page_impressions: "impressions", page_impressions_unique: "reach", page_post_engagements: "engagements", page_video_views: "videoViews" };
    for (const m of r.data) {
      for (const v of m.values ?? []) {
        if (!v.end_time) continue;
        // end_time marks the end of the day the value covers.
        const day = dayOf(new Date(new Date(v.end_time).getTime() - 86_400_000));
        const row = days.get(day) ?? { day };
        (row as Record<string, unknown>)[field[m.name]!] = num(v.value);
        days.set(day, row);
      }
    }
    return [...days.values()];
  },
  async post({ accessToken }, id) {
    const base = await metaCall<{ shares?: { count?: number }; reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } }>(
      "GET", id, accessToken, { fields: "shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)" }, "Reading post figures",
    );
    const out: PostFigures = { likes: base.reactions?.summary?.total_count ?? null, comments: base.comments?.summary?.total_count ?? null, shares: base.shares?.count ?? 0 };
    try {
      const ins = await metaCall<{ data: InsightRow[] }>("GET", `${id}/insights`, accessToken, { metric: "post_impressions,post_impressions_unique,post_clicks" }, "Reading post insights");
      for (const m of ins.data) {
        const v = num(m.values?.[0]?.value);
        if (m.name === "post_impressions") out.impressions = v;
        if (m.name === "post_impressions_unique") out.reach = v;
        if (m.name === "post_clicks") out.clicks = v;
      }
    } catch (e) {
      if (e instanceof PublishError && e.kind === "auth") throw e; // otherwise insights just aren't available for this post type
    }
    return out;
  },
  async comments({ channel, accessToken }, postId) {
    type C = { id: string; from?: { id: string; name: string }; message?: string; created_time: string; comments?: { data: C[] } };
    const r = await metaCall<{ data: C[] }>(
      "GET", `${postId}/comments`, accessToken,
      { fields: "id,from{id,name},message,created_time,comments.limit(25){id,from{id,name},message,created_time}", filter: "toplevel", order: "reverse_chronological", limit: "50" },
      "Reading comments",
    );
    const map = (c: C): RemoteComment => ({
      id: c.id,
      author: c.from?.name ?? "Facebook user",
      text: c.message ?? "",
      createdAt: new Date(c.created_time),
      fromUs: c.from?.id === channel.externalId,
      replies: (c.comments?.data ?? []).map(map),
    });
    return r.data.map(map);
  },
  async reply({ accessToken }, thread, text) {
    return (await metaCall<{ id: string }>("POST", `${thread.externalId}/comments`, accessToken, { message: text }, "Sending the reply")).id;
  },
};

/* ---------------------------- Instagram ---------------------------- */

const instagram: EngageSource = {
  async followers({ channel, accessToken }) {
    const r = await metaCall<{ followers_count?: number }>("GET", channel.externalId, accessToken, { fields: "followers_count" }, "Reading followers");
    return r.followers_count ?? null;
  },
  async daily({ channel, accessToken }, since, until) {
    const r = await metaCall<{ data: InsightRow[] }>("GET", `${channel.externalId}/insights`, accessToken, { metric: "reach", period: "day", since: unix(since), until: unix(until) }, "Reading Instagram insights");
    return (r.data.find((m) => m.name === "reach")?.values ?? [])
      .filter((v) => v.end_time)
      .map((v) => ({ day: dayOf(new Date(new Date(v.end_time!).getTime() - 86_400_000)), reach: num(v.value) }));
  },
  async post({ accessToken }, id) {
    const read = (metric: string) => metaCall<{ data: InsightRow[] }>("GET", `${id}/insights`, accessToken, { metric }, "Reading post insights");
    let r;
    try {
      r = await read("reach,likes,comments,shares,saved,views");
    } catch (e) {
      if (e instanceof PublishError && e.kind === "permanent") r = await read("reach,likes,comments,saved");
      else throw e;
    }
    const get = (n: string) => num(r.data.find((m) => m.name === n)?.values?.[0]?.value);
    return { reach: get("reach"), likes: get("likes"), comments: get("comments"), shares: get("shares"), saves: get("saved"), videoViews: get("views") };
  },
  async comments({ channel, accessToken }, mediaId) {
    type C = { id: string; username?: string; text?: string; timestamp: string; replies?: { data: C[] } };
    const r = await metaCall<{ data: C[] }>("GET", `${mediaId}/comments`, accessToken, { fields: "id,username,text,timestamp,replies{id,username,text,timestamp}", limit: "50" }, "Reading comments");
    const map = (c: C): RemoteComment => ({
      id: c.id,
      author: c.username ?? "instagram user",
      text: c.text ?? "",
      createdAt: new Date(c.timestamp),
      fromUs: c.username === channel.handle,
      replies: (c.replies?.data ?? []).map(map),
    });
    return r.data.map(map);
  },
  async reply({ accessToken }, thread, text) {
    return (await metaCall<{ id: string }>("POST", `${thread.externalId}/replies`, accessToken, { message: text }, "Sending the reply")).id;
  },
};

/* ----------------------------- LinkedIn ---------------------------- */

const LI = "https://api.linkedin.com/rest";
const author = (ctx: Ctx) => {
  const a = ctx.channel.meta.author;
  if (typeof a !== "string") throw new PublishError("This LinkedIn channel is missing its account details. Reconnect it.", "auth");
  return a;
};
async function liGet<T>(ctx: Ctx, path: string, action: string): Promise<T> {
  const r = await http(`${LI}${path}`, { headers: liHeaders(ctx.accessToken, false) });
  if (r.status >= 400) throw linkedinError(r, action);
  return r.body as T;
}

const linkedin: EngageSource = {
  async followers(ctx) {
    const a = author(ctx);
    if (!a.startsWith("urn:li:organization:")) return null; // LinkedIn doesn't share follower counts for personal profiles
    const r = await liGet<{ firstDegreeSize?: number }>(ctx, `/networkSizes/${encodeURIComponent(a)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, "Reading followers");
    return r.firstDegreeSize ?? null;
  },
  async daily(ctx, since, until) {
    const a = author(ctx);
    if (!a.startsWith("urn:li:organization:")) return [];
    const range = `(timeRange:(start:${since.getTime()},end:${until.getTime()}),timeGranularityType:DAY)`;
    const r = await liGet<{ elements?: { timeRange: { start: number }; totalShareStatistics: Record<string, number> }[] }>(
      ctx, `/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(a)}&timeIntervals=${range}`, "Reading page statistics",
    );
    return (r.elements ?? []).map((e) => {
      const s = e.totalShareStatistics;
      return {
        day: dayOf(new Date(e.timeRange.start)),
        impressions: s.impressionCount ?? null,
        reach: s.uniqueImpressionsCount ?? null,
        engagements: (s.likeCount ?? 0) + (s.commentCount ?? 0) + (s.shareCount ?? 0) + (s.clickCount ?? 0),
        linkClicks: s.clickCount ?? null,
      };
    });
  },
  async post(ctx, urn) {
    const r = await liGet<{ likesSummary?: { totalLikes?: number }; commentsSummary?: { aggregatedTotalComments?: number } }>(ctx, `/socialActions/${encodeURIComponent(urn)}`, "Reading post figures");
    return { likes: r.likesSummary?.totalLikes ?? null, comments: r.commentsSummary?.aggregatedTotalComments ?? null };
  },
  async comments(ctx, urn) {
    const me = author(ctx);
    type C = { id?: string; commentUrn?: string; $URN?: string; actor: string; message?: { text?: string }; created?: { time: number } };
    const r = await liGet<{ elements?: C[] }>(ctx, `/socialActions/${encodeURIComponent(urn)}/comments?count=50`, "Reading comments");
    return (r.elements ?? []).map((c) => ({
      id: c.commentUrn ?? c.$URN ?? c.id ?? "",
      author: c.actor === me ? "You" : "LinkedIn member",
      text: c.message?.text ?? "",
      createdAt: new Date(c.created?.time ?? Date.now()),
      fromUs: c.actor === me,
      replies: [],
    })).filter((c) => c.id);
  },
  async reply(ctx, thread, text) {
    const post = thread.meta.postId;
    if (typeof post !== "string") throw new PublishError("This conversation is missing its LinkedIn post. It can't be replied to here.", "permanent");
    const r = await http(`${LI}/socialActions/${encodeURIComponent(thread.externalId)}/comments`, {
      method: "POST",
      headers: liHeaders(ctx.accessToken),
      body: JSON.stringify({ actor: author(ctx), object: post, parentComment: thread.externalId, message: { text } }),
    });
    if (r.status >= 400) throw linkedinError(r, "Sending the reply");
    return r.headers.get("x-restli-id") ?? `reply-${Date.now()}`;
  },
};

/* ------------------------------ TikTok ----------------------------- */

const TT = "https://open.tiktokapis.com/v2";

const tiktok: EngageSource = {
  async followers({ accessToken }) {
    const r = await http(`${TT}/user/info/?fields=follower_count`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (r.status >= 400) throw tiktokError(r, "Reading followers");
    return (r.body as { data?: { user?: { follower_count?: number } } }).data?.user?.follower_count ?? null;
  },
  async post({ accessToken }, id) {
    const r = await http(`${TT}/video/query/?fields=id,view_count,like_count,comment_count,share_count`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ filters: { video_ids: [id] } }),
    });
    if (r.status >= 400) throw tiktokError(r, "Reading video figures");
    const v = (r.body as { data?: { videos?: Record<string, number>[] } }).data?.videos?.[0];
    return { videoViews: v?.view_count ?? null, likes: v?.like_count ?? null, comments: v?.comment_count ?? null, shares: v?.share_count ?? null };
  },
  // TikTok's public API doesn't offer reading or replying to comments.
};

export const ENGAGE: Partial<Record<Platform, EngageSource>> = { facebook, instagram, linkedin, tiktok };
