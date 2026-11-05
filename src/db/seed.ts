/**
 * Demo data for local development and design review. Never run against production.
 * Creates demo@example.com / demo-password-123 with two workspaces of sample content.
 */
import { eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "./index";
import { activityLog, channelMetricsDaily, channels, ideas, inboxMessages, postMetrics, queueChannels, queueSlots, queues, inboxThreads, organizations, orgMembers, posts, postTargets, user, workspaceMembers, workspaces } from "./schema";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed a production database.");

const EMAIL = "demo@example.com";
const PASSWORD = "demo-password-123";

const existing = await db.select().from(user).where(eq(user.email, EMAIL));
if (existing.length) {
  console.log("Demo data already exists. Sign in as", EMAIL);
  process.exit(0);
}

await auth.api.signUpEmail({ body: { name: "Priya Raman", email: EMAIL, password: PASSWORD } });
const [demo] = await db.update(user).set({ emailVerified: true }).where(eq(user.email, EMAIL)).returning();

const [org] = await db.insert(organizations).values({ name: "Northwind Agency" }).returning();
await db.insert(orgMembers).values({ orgId: org!.id, userId: demo!.id, role: "owner" });
const [harbor, lumen] = await db.insert(workspaces).values([
  { orgId: org!.id, name: "Harbor Coffee Co.", color: "#2B86F5", timezone: "America/New_York", defaultHashtags: "#HarborCoffee" },
  { orgId: org!.id, name: "Lumen Fitness", color: "#0F9D6B", timezone: "America/New_York" },
]).returning();
await db.insert(workspaceMembers).values([
  { workspaceId: harbor!.id, userId: demo!.id, role: "owner" },
  { workspaceId: lumen!.id, userId: demo!.id, role: "owner" },
]);

const ch = await db.insert(channels).values([
  { workspaceId: harbor!.id, platform: "instagram", externalId: "ig-1", handle: "harborcoffee", displayName: "Harbor Coffee", status: "expiring", followers: 18420 },
  { workspaceId: harbor!.id, platform: "facebook", externalId: "fb-1", handle: "harborcoffee", displayName: "Harbor Coffee", status: "connected", followers: 9310 },
  { workspaceId: harbor!.id, platform: "linkedin", externalId: "li-1", handle: "harbor-coffee-co", displayName: "Harbor Coffee Co.", status: "connected", followers: 2280 },
  { workspaceId: harbor!.id, platform: "tiktok", externalId: "tt-1", handle: "harborcoffee", displayName: "Harbor Coffee", status: "reconnect", followers: 12650, lastError: "The TikTok access token expired." },
  { workspaceId: harbor!.id, platform: "youtube", externalId: "yt-1", handle: "harborcoffee", displayName: "Harbor Coffee", status: "connected", followers: 1540 },
]).returning();
const [ig, fb, li, tt] = ch;

const day = 86_400_000;
const at = (d: number, h: number) => { const x = new Date(Date.now() + d * day); x.setUTCHours(h, 0, 0, 0); return x; };
const P = [
  { caption: "Pumpkin spice cold brew is back for three weeks only 🎃", status: "scheduled", scheduledAt: at(0, 23), t: [ig, fb] },
  { caption: "Meet Jonah, our head barista at the Pier Street shop.", status: "scheduled", scheduledAt: at(1, 16), t: [ig, fb, tt] },
  { caption: "Holiday gift cards are here. Buy $50, get a free bag of Winter Blend.", status: "scheduled", scheduledAt: at(2, 14), t: [fb, li] },
  { caption: "Latte art reel: tulip in 15 seconds", status: "scheduled", scheduledAt: at(3, 22), t: [tt, ig] },
  { caption: "New Pier Street opening hours: 6:30am from Monday.", status: "published", scheduledAt: at(-2, 13), publishedAt: at(-2, 13), t: [fb, li] },
  { caption: "From Huila to your cup: this month's washed Caturra.", status: "published", scheduledAt: at(-1, 16), publishedAt: at(-1, 16), t: [ig, fb] },
  { caption: "Rainy day 2-for-1 pastries until 2pm.", status: "partially_failed", scheduledAt: at(-3, 14), t: [ig, tt], failOn: tt },
  { caption: "Customer of the week", status: "draft", scheduledAt: null, t: [ig] },
] as const;

for (const p of P) {
  const [row] = await db.insert(posts).values({
    workspaceId: harbor!.id, authorId: demo!.id, caption: p.caption, status: p.status,
    scheduledAt: p.scheduledAt, publishedAt: "publishedAt" in p ? p.publishedAt : null,
  }).returning();
  await db.insert(postTargets).values(p.t.map((c) => {
    const failed = "failOn" in p && p.failOn === c;
    return {
      postId: row!.id, channelId: c!.id,
      status: failed ? ("failed" as const) : p.status === "published" || p.status === "partially_failed" ? ("published" as const) : ("pending" as const),
      publishedAt: !failed && (p.status === "published" || p.status === "partially_failed") ? p.scheduledAt : null,
      error: failed ? "TikTok rejected the request because the access token expired. Reconnect TikTok, then retry." : null,
    };
  }));
}

// A teammate, so conversations can be assigned.
await auth.api.signUpEmail({ body: { name: "Marcus Lee", email: "marcus@example.com", password: PASSWORD } });
const [marcus] = await db.update(user).set({ emailVerified: true }).where(eq(user.email, "marcus@example.com")).returning();
await db.insert(workspaceMembers).values({ workspaceId: harbor!.id, userId: marcus!.id, role: "editor" });
await db.update(workspaces).set({ savedReplies: ["Thanks so much! ☕", "Sorry about that. Can you send us a message with the details?", "Yes, in 250g and 1kg bags at every shop."] }).where(eq(workspaces.id, harbor!.id));

const ago = (mins: number) => new Date(Date.now() - mins * 60_000);
const convo: { channel: typeof ig; kind: "comment" | "message" | "mention"; author: string; subject: string; sentiment: "positive" | "neutral" | "negative"; unread: boolean; assigned?: string; msgs: [boolean, string, number][] }[] = [
  { channel: ig, kind: "comment", author: "jess.makes.things", subject: "From Huila to your cup", sentiment: "positive", unread: true, msgs: [[false, "Is the Huila available in bags to take home? Loved it this morning ❤️", 18]] },
  { channel: fb, kind: "message", author: "Amira Yusuf", subject: "Direct message", sentiment: "neutral", unread: true, assigned: marcus!.id, msgs: [[false, "Do you cater office events of around 40 people?", 95]] },
  { channel: li, kind: "comment", author: "Tom Becker", subject: "Holiday gift cards are here", sentiment: "negative", unread: true, msgs: [[false, "Waited 20 minutes on Saturday morning and the latte was cold. Disappointed.", 240]] },
  { channel: ig, kind: "comment", author: "brewlab.sam", subject: "From Huila to your cup", sentiment: "positive", unread: false, msgs: [[false, "Best washed Caturra I've had this year 🔥", 1500], [true, "Thank you Sam! It's on the shelf until the end of the month.", 1440]] },
  { channel: fb, kind: "comment", author: "Linda Ortiz", subject: "New Pier Street opening hours", sentiment: "neutral", unread: false, msgs: [[false, "Does this include Sundays?", 2900]] },
];
for (const c of convo) {
  const [t] = await db.insert(inboxThreads).values({
    workspaceId: harbor!.id, channelId: c.channel!.id, kind: c.kind, externalId: `seed-${c.author}`, subject: c.subject, authorName: c.author,
    sentiment: c.sentiment, unread: c.unread, assignedTo: c.assigned ?? null, lastMessageAt: ago(Math.min(...c.msgs.map((m) => m[2]))),
  }).returning();
  await db.insert(inboxMessages).values(c.msgs.map(([fromUs, body, mins]) => ({ threadId: t!.id, fromUs, sentBy: fromUs ? demo!.id : null, authorName: fromUs ? null : c.author, body, createdAt: ago(mins) })));
}

// Ninety days of daily figures for each Harbor channel, and figures for every published post.
const rand = (seed: number) => { const x = Math.sin(seed) * 10_000; return x - Math.floor(x); };
const PROFILE: Record<string, { base: number; eng: number; video: number; clicks: number }> = {
  instagram: { base: 2600, eng: 0.052, video: 0.35, clicks: 0 },
  facebook: { base: 1500, eng: 0.031, video: 0.2, clicks: 0.01 },
  linkedin: { base: 650, eng: 0.029, video: 0, clicks: 0.04 },
  tiktok: { base: 1900, eng: 0.078, video: 0.9, clicks: 0 },
};
const metricRows = [];
for (const [ci, c] of [ig, fb, li, tt].entries()) {
  const prof = PROFILE[c!.platform]!;
  for (let d = 179; d >= 0; d--) {
    const day = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
    const trend = 1 + (179 - d) / 300;
    const impressions = Math.round(prof.base * trend * (0.75 + 0.5 * rand(d * 7 + ci * 131)) * (1 + 0.25 * Math.sin((d + ci * 3) / 4.3)));
    metricRows.push({
      channelId: c!.id, day,
      followers: Math.round(c!.followers! * (1 - d * 0.0006)),
      impressions, reach: Math.round(impressions * 0.68),
      engagements: Math.round(impressions * prof.eng * (0.8 + 0.4 * rand(d + ci))),
      videoViews: prof.video ? Math.round(impressions * prof.video) : null,
      linkClicks: prof.clicks ? Math.round(impressions * prof.clicks) : null,
    });
  }
}
await db.insert(channelMetricsDaily).values(metricRows);

const pastCaptions = [
  "Cold brew Fridays: half price after 3pm", "Behind the bar: dialing in the espresso at dawn", "Our oat milk cortado, now with a new local oat",
  "Three ways to brew our Winter Blend at home", "Meet the farmers behind our Ethiopia Guji", "Latte art throwdown recap 🏆",
  "Pastry case restock: cardamom buns are back", "Why we roast light: a two-minute explainer", "Rainy morning, warm mug. Open till 7pm",
  "Sneak peek at the new Pier Street mural", "Ten years of Harbor Coffee: thank you", "How we pick a single origin for the menu",
];
for (const [i, caption] of pastCaptions.entries()) {
  const when = at(-(4 + i * 6), [13, 16, 22, 13, 17, 23, 14][i % 7]!); // posts 7 apart share a weekday and hour
  const targets = [[ig, fb], [fb, li], [ig, tt], [ig, fb, li]][i % 4]!;
  const [post] = await db.insert(posts).values({ workspaceId: harbor!.id, authorId: i % 3 ? demo!.id : marcus!.id, caption, status: "published", scheduledAt: when, publishedAt: when }).returning();
  const rows = await db.insert(postTargets).values(targets.map((c) => ({ postId: post!.id, channelId: c!.id, status: "published" as const, publishedAt: when }))).returning();
  await db.insert(postMetrics).values(rows.map((r, j) => {
    const reach = Math.round(1800 + rand(i * 17 + j) * 9000);
    return { targetId: r.id, reach, impressions: Math.round(reach * 1.4), likes: Math.round(reach * 0.04), comments: Math.round(reach * 0.006), shares: Math.round(reach * 0.004), saves: Math.round(reach * 0.003) };
  }));
}

const [q] = await db.insert(queues).values({ workspaceId: harbor!.id, name: "Weekday mornings" }).returning();
await db.insert(queueSlots).values([1, 2, 3, 4, 5].map((weekday) => ({ queueId: q!.id, weekday, minuteOfDay: 8 * 60 })));
await db.insert(queueChannels).values([{ queueId: q!.id, channelId: ig!.id }, { queueId: q!.id, channelId: fb!.id }]);
// Three posts waiting in the queue, so shuffling has something to work on.
for (const [i, caption] of ["Monday espresso tip: weigh your dose", "Tuesday: meet Dana from the roastery", "Wednesday flight of three single origins"].entries()) {
  const [post] = await db.insert(posts).values({ workspaceId: harbor!.id, authorId: demo!.id, caption, status: "scheduled", scheduledAt: at(8 + i, 13), queueId: q!.id }).returning();
  await db.insert(postTargets).values([{ postId: post!.id, channelId: fb!.id }]);
}

await db.insert(activityLog).values([
  { workspaceId: harbor!.id, actorId: marcus!.id, verb: "queue.created", summary: "created the queue “Weekday mornings”", href: `/w/${harbor!.id}/calendar?view=queues`, createdAt: at(-3, 14) },
  { workspaceId: harbor!.id, actorId: null, verb: "post.published", summary: "“From Huila to your cup: this month's washed Caturra.” was published on Instagram, Facebook", createdAt: at(-1, 16) },
  { workspaceId: harbor!.id, actorId: demo!.id, verb: "post.scheduled", summary: "queued “Monday espresso tip: weigh your dose”", createdAt: at(-1, 17) },
]);

await db.insert(ideas).values([
  { workspaceId: harbor!.id, title: "Coffee tasting live stream with the roaster", column: "idea", tags: ["Video"], createdBy: demo!.id, position: 1 },
  { workspaceId: harbor!.id, title: "Map of every shop and its signature drink", column: "idea", tags: ["Carousel"], createdBy: demo!.id, position: 2 },
  { workspaceId: harbor!.id, title: "Cup sleeve art contest with local artists", column: "research", tags: ["Community"], createdBy: demo!.id, position: 3 },
  { workspaceId: harbor!.id, title: "Winter Blend tasting notes carousel", column: "writing", tags: ["Seasonal"], createdBy: demo!.id, position: 4 },
  { workspaceId: harbor!.id, title: "Holiday gift guide with partner bakeries", column: "ready", tags: ["Promo"], createdBy: demo!.id, position: 5 },
]);

await db.execute(sql`update channels c set last_published_at = (select max(published_at) from post_targets t where t.channel_id = c.id and t.status = 'published')`);

console.log(`Seeded. Sign in as ${EMAIL} / ${PASSWORD}`);
process.exit(0);
