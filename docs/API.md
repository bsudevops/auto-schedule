# REST API

Owners and managers create keys in **Settings → API & webhooks**. A key belongs to one workspace and acts with the current role of the person who created it, so it can never do more than they can. If that person leaves the workspace, the key stops working. Only a SHA-256 fingerprint of each key is stored.

```
Authorization: Bearer yb_live_…
```

Responses are JSON. Errors look like `{ "error": "What went wrong, in plain words." }` with a 4xx status. Each key can make 120 requests a minute (`API_RATE_LIMIT_PER_MINUTE`); over that you get `429` with `Retry-After`.

| Scope | Allows |
|---|---|
| `posts:read` | `GET /api/v1/posts`, `GET /api/v1/posts/{id}` |
| `posts:write` | `POST /api/v1/posts`, `PATCH /api/v1/posts/{id}`, `DELETE /api/v1/posts/{id}` |
| `channels:read` | `GET /api/v1/channels` |
| `analytics:read` | `GET /api/v1/analytics` |

`GET /api/v1/me` works with any scope and returns the workspace, role and scopes.

## Channels

`GET /api/v1/channels` returns connected channels: `id`, `platform`, `handle`, `displayName`, `status`, `followers`.

## Posts

`GET /api/v1/posts?status=scheduled&from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z&limit=50`

`POST /api/v1/posts` takes the same fields as the composer, and the same rules apply (caption limits, Instagram needs media, TikTok needs one video, contributors can only save drafts):

```json
{
  "channelIds": ["…", "…"],
  "caption": "Pumpkin spice cold brew is back",
  "overrides": { "<channelId>": "A different caption for this channel" },
  "mediaIds": [],
  "firstComment": "",
  "tags": ["fall"],
  "mode": "schedule",
  "date": "2026-11-20",
  "time": "09:30"
}
```

`mode` is `draft`, `now`, `schedule` (with `date` and `time` in the workspace's time zone) or `queue` (with `queueId`). Returns `201` with the post.

`PATCH /api/v1/posts/{id}` replaces a post's content and timing with the same fields. Published posts can't be changed.

`DELETE /api/v1/posts/{id}` returns `204`.

A post looks like:

```json
{
  "id": "…", "status": "scheduled", "caption": "…", "firstComment": "", "tags": [],
  "scheduledAt": "2026-11-20T14:30:00.000Z", "publishedAt": null, "mediaIds": [],
  "channels": [{ "channelId": "…", "platform": "instagram", "status": "pending", "url": null, "error": null, "captionOverride": null, "publishedAt": null }]
}
```

## Analytics

`GET /api/v1/analytics?range=30&channel=<id>` returns the same figures as the Analytics page: `kpis` (with change against the previous period), `daily` impressions, per-channel `channels` and `topPosts`.

# Webhooks

Add an endpoint in **Settings → API & webhooks** and pick its events:

| Event | When |
|---|---|
| `post.published` | A post went out on every channel |
| `post.failed` | A post failed on one or more channels (`status` is `failed` or `partially_failed`) |
| `inbox.message_received` | A new comment arrived in the inbox |
| `channel.needs_attention` | A channel needs reconnecting or expires soon |
| `ping` | You pressed **Send test** |

Each delivery is a `POST` with a JSON body:

```json
{ "id": "<delivery id>", "event": "post.published", "workspaceId": "…", "createdAt": "…", "data": { … } }
```

and these headers:

```
X-Webhook-Id: <delivery id, the same on every retry>
X-Webhook-Event: post.published
X-Webhook-Signature: t=1762250000,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with your signing secret>
```

Check the signature before trusting a delivery, and reject timestamps more than five minutes old:

```js
import { createHmac, timingSafeEqual } from "node:crypto";
function verify(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return v1.length === expected.length && timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}
```

Answer with any 2xx within 10 seconds. Anything else is retried 5 more times over about half an hour. After 20 failed deliveries in a row the webhook is turned off; turn it back on from the same page. Endpoints must be public `https://` URLs: private, loopback and cloud-metadata addresses are refused, including names that resolve to them, and redirects aren't followed.
