# Connecting the social platforms

The product publishes through each platform's official API. Each platform needs a developer app that you create once. Its keys go in the server's environment (never in the code, never in a chat), and then anyone with the Owner or Manager role can connect accounts from the **Channels** page.

Until the keys are set, the Channels page shows "Not set up" next to that platform. Everything else works. To try publishing without any apps, set `PUBLISH_DRY_RUN=true` (ignored in production): the worker then marks posts as published without sending anything.

Every app needs the same redirect URL pattern:

```
{APP_URL}/api/channels/callback/meta
{APP_URL}/api/channels/callback/linkedin
{APP_URL}/api/channels/callback/tiktok
```

Media is sent to platforms by URL, so `MEDIA_PUBLIC_URL` must be a public HTTPS address (S3, R2 or a CDN) in production. `localhost` won't work for real publishing.

## Facebook Pages and Instagram

One Meta app covers both. Instagram accounts must be business or creator accounts linked to a Facebook Page.

1. At developers.facebook.com, create an app of type **Business**.
2. Add the **Facebook Login for Business** product. Under its settings, add the redirect URL above to *Valid OAuth Redirect URIs*.
3. Request these permissions (App Review is needed before people outside your business can use them): `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_engagement`, `pages_read_user_content`, `read_insights`, `business_management`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`.
4. Under *App settings → Advanced*, turn on **Require app secret**. Every call the server makes carries an `appsecret_proof`.
5. Set `META_APP_ID` and `META_APP_SECRET`.

While the app is in development mode, only people with a role on the app can connect.

## LinkedIn

1. At linkedin.com/developers, create an app linked to your company page.
2. Add the products **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn**. Add the redirect URL above under *Auth*.
3. Set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.
4. To post to company pages, apply for the **Community Management API**. Once approved, set
   `LINKEDIN_SCOPES="openid profile w_member_social w_organization_social r_organization_social rw_organization_admin"`.

LinkedIn tokens last 60 days. The Channels page warns a week ahead, and owners and managers get a notification, so someone can renew the connection.

## TikTok

1. At developers.tiktok.com, create an app and add **Login Kit** and **Content Posting API** (enable *Direct Post*).
2. Add the redirect URL above, and request the scopes `user.info.basic`, `user.info.profile`, `user.info.stats` and `video.publish`.
3. Under *URL properties*, verify the domain of `MEDIA_PUBLIC_URL`. TikTok downloads each video from there.
4. Set `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`.

Until TikTok audits the app, videos can only be posted as private. The product tells you when that happens.

## How publishing works

- The worker (`npm run worker`) checks for due posts every 15 seconds and claims each one atomically, so running several workers is safe.
- Each channel of a post publishes as its own job. Network errors, platform outages and rate limits are retried up to 4 times with growing delays (1, 2, 4 minutes). Rejected content fails straight away with the platform's reason.
- An expired or revoked token marks the channel **Reconnect** and notifies owners and managers.
- Per-channel limits stay under each platform's own: Instagram 25 a day, Facebook 50 an hour, LinkedIn 50 a day, TikTok 15 a day. Posts over the limit wait for the next window.
- Tokens that can be refreshed (TikTok, and LinkedIn when allowed) are refreshed hourly before they expire.
- Every attempt is recorded in the publish log, which keeps 90 days.
