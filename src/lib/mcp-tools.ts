import "server-only";
import { and, asc, desc, eq, gte, lte, ne, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { channels, posts, postStatus } from "@/db/schema";
import { loadAnalytics, parseRange } from "./analytics";
import type { ApiContext, ApiScope } from "./api-auth";
import { postInWorkspace, serializePosts } from "./api-posts";
import type { Tool } from "./mcp-protocol";
import { deletePost, postInput, savePost } from "./posts";

const has = (scope: ApiScope) => (c: ApiContext) => c.scopes.includes(scope);
const json = (v: unknown) => ({ text: JSON.stringify(v, null, 2) });
const bad = (text: string) => ({ text, isError: true as const });
const uuid = z.string().uuid();

const POST_FIELDS = {
  channelIds: { type: "array", items: { type: "string" }, description: "Channel IDs from list_channels." },
  caption: { type: "string", description: "The post text." },
  mode: { type: "string", enum: ["draft", "schedule", "queue", "now"], description: "draft saves it, schedule needs date and time, queue uses the next free slot, now publishes immediately." },
  date: { type: "string", description: "YYYY-MM-DD in the workspace's time zone. Needed for mode schedule." },
  time: { type: "string", description: "HH:MM, 24-hour, in the workspace's time zone. Needed for mode schedule." },
  queueId: { type: "string", description: "Optional queue ID for mode queue." },
  overrides: { type: "object", additionalProperties: { type: "string" }, description: "Optional caption per channel ID, replacing the main caption for that channel." },
  mediaIds: { type: "array", items: { type: "string" }, description: "Media library asset IDs." },
  firstComment: { type: "string" },
  tags: { type: "array", items: { type: "string" } },
};

export const mcpTools: Tool<ApiContext>[] = [
  {
    name: "get_workspace",
    title: "Get workspace",
    description: "Shows which workspace this connection uses, its time zone, the role it acts with and what it is allowed to do.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    allowed: () => true,
    run: async (_a, c) => json({ workspace: { id: c.workspace.id, name: c.workspace.name, timezone: c.workspace.timezone }, role: c.member.role, scopes: c.scopes }),
  },
  {
    name: "list_channels",
    title: "List channels",
    description: "Lists the connected social channels (id, platform, handle, status, followers). Use the ids when creating posts.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    allowed: has("channels:read"),
    run: async (_a, c) =>
      json(
        await db
          .select({ id: channels.id, platform: channels.platform, handle: channels.handle, displayName: channels.displayName, status: channels.status, followers: channels.followers })
          .from(channels)
          .where(and(eq(channels.workspaceId, c.workspace.id), ne(channels.status, "disconnected")))
          .orderBy(asc(channels.platform)),
      ),
  },
  {
    name: "list_posts",
    title: "List posts",
    description: "Lists posts, newest first. Filter by status and by scheduled date range.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: [...postStatus.enumValues] },
        from: { type: "string", description: "ISO 8601 date-time." },
        to: { type: "string", description: "ISO 8601 date-time." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 25." },
      },
    },
    readOnly: true,
    allowed: has("posts:read"),
    run: async (args, c) => {
      const p = z.object({ status: z.enum(postStatus.enumValues).optional(), from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(), limit: z.number().int().min(1).max(100).default(25) }).safeParse(args);
      if (!p.success) return bad(p.error.issues[0]!.path.join(".") + ": " + p.error.issues[0]!.message);
      const conds: SQL[] = [eq(posts.workspaceId, c.workspace.id)];
      if (p.data.status) conds.push(eq(posts.status, p.data.status));
      if (p.data.from) conds.push(gte(posts.scheduledAt, new Date(p.data.from)));
      if (p.data.to) conds.push(lte(posts.scheduledAt, new Date(p.data.to)));
      const rows = await db.select({ id: posts.id }).from(posts).where(and(...conds)).orderBy(desc(posts.scheduledAt), desc(posts.createdAt)).limit(p.data.limit);
      return json(await serializePosts(rows.map((r) => r.id)));
    },
  },
  {
    name: "get_post",
    title: "Get post",
    description: "Shows one post with its status and the result for each channel.",
    inputSchema: { type: "object", properties: { postId: { type: "string" } }, required: ["postId"] },
    readOnly: true,
    allowed: has("posts:read"),
    run: async (args, c) => {
      const id = uuid.safeParse((args as { postId?: unknown })?.postId);
      if (!id.success || !(await postInWorkspace(id.data, c.workspace.id))) return bad("No post with that ID in this workspace.");
      return json((await serializePosts([id.data]))[0]);
    },
  },
  {
    name: "create_post",
    title: "Create post",
    description: "Creates a post. The same rules as the app apply: character limits, Instagram needs media, and contributors can only save drafts. Prefer mode draft or schedule. Mode now publishes straight away, so only use it when the person asked for that.",
    inputSchema: { type: "object", properties: POST_FIELDS, required: ["channelIds", "caption", "mode"] },
    readOnly: false,
    allowed: has("posts:write"),
    run: async (args, c) => {
      const p = postInput.omit({ postId: true }).safeParse(args);
      if (!p.success) return bad(p.error.issues[0]!.path.join(".") + ": " + p.error.issues[0]!.message);
      const r = await savePost({ member: c.member, workspace: c.workspace }, p.data);
      if (!r.ok) return bad(r.error);
      return json((await serializePosts([r.id]))[0]);
    },
  },
  {
    name: "update_post",
    title: "Update post",
    description: "Replaces a post's content and timing. Send every field again, as when creating. Published posts can't be changed.",
    inputSchema: { type: "object", properties: { postId: { type: "string" }, ...POST_FIELDS }, required: ["postId", "channelIds", "caption", "mode"] },
    readOnly: false,
    allowed: has("posts:write"),
    run: async (args, c) => {
      const p = postInput.required({ postId: true }).safeParse(args);
      if (!p.success) return bad(p.error.issues[0]!.path.join(".") + ": " + p.error.issues[0]!.message);
      if (!(await postInWorkspace(p.data.postId, c.workspace.id))) return bad("No post with that ID in this workspace.");
      const r = await savePost({ member: c.member, workspace: c.workspace }, p.data);
      if (!r.ok) return bad(r.error);
      return json((await serializePosts([r.id]))[0]);
    },
  },
  {
    name: "delete_post",
    title: "Delete post",
    description: "Deletes a post that hasn't been published. Only do this when the person asked for it.",
    inputSchema: { type: "object", properties: { postId: { type: "string" } }, required: ["postId"] },
    readOnly: false,
    allowed: has("posts:write"),
    run: async (args, c) => {
      const id = uuid.safeParse((args as { postId?: unknown })?.postId);
      if (!id.success || !(await postInWorkspace(id.data, c.workspace.id))) return bad("No post with that ID in this workspace.");
      const r = await deletePost({ member: c.member, workspace: c.workspace }, id.data);
      return r.ok ? { text: "Deleted." } : bad(r.error ?? "You can't delete this post.");
    },
  },
  {
    name: "get_analytics",
    title: "Get analytics",
    description: "Returns the figures from the Analytics page: totals with change against the previous period, daily impressions, per-channel results and top posts.",
    inputSchema: { type: "object", properties: { range: { type: "string", enum: ["7", "30", "90"], description: "Days. Default 30." }, channelId: { type: "string", description: "Limit to one channel." } } },
    readOnly: true,
    allowed: has("analytics:read"),
    run: async (args, c) => {
      const p = z.object({ range: z.enum(["7", "30", "90"]).optional(), channelId: uuid.optional() }).safeParse(args);
      if (!p.success) return bad(p.error.issues[0]!.path.join(".") + ": " + p.error.issues[0]!.message);
      const d = await loadAnalytics(c.workspace, parseRange(p.data.range), p.data.channelId ?? null);
      return json({ range: d.range, through: d.today, kpis: d.summary.kpis, daily: d.summary.series, channels: d.summary.byChannel, topPosts: d.top });
    },
  },
];
