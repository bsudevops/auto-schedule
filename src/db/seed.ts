/**
 * Demo data for local development and design review. Never run against production.
 * Creates demo@example.com / demo-password-123 with two workspaces of sample content.
 */
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "./index";
import { channels, inboxMessages, inboxThreads, organizations, orgMembers, posts, postTargets, user, workspaceMembers, workspaces } from "./schema";

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
      error: failed ? "TikTok rejected the request because the access token expired. Reconnect TikTok, then retry." : null,
    };
  }));
}

const threads = await db.insert(inboxThreads).values([
  { workspaceId: harbor!.id, channelId: ig!.id, kind: "comment", externalId: "c1", subject: "Origin story: Huila roast", authorName: "jess.makes.things", sentiment: "positive" },
  { workspaceId: harbor!.id, channelId: fb!.id, kind: "message", externalId: "m1", subject: "Direct message", authorName: "Amira Yusuf", sentiment: "neutral" },
  { workspaceId: harbor!.id, channelId: li!.id, kind: "comment", externalId: "c2", subject: "Gift cards", authorName: "Tom Becker", sentiment: "negative" },
]).returning();
await db.insert(inboxMessages).values(threads.map((t, i) => ({
  threadId: t.id, fromUs: false,
  body: ["Is the Huila available in bags to take home?", "Do you cater office events of around 40 people?", "Waited 20 minutes on Saturday morning."][i]!,
})));

console.log(`Seeded. Sign in as ${EMAIL} / ${PASSWORD}`);
process.exit(0);
