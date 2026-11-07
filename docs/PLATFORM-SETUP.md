# Connecting the social platforms

The product publishes through each platform's official API. Each platform needs a developer app that you create once. Its keys go in the server's environment (never in the code, never in a chat), and then anyone with the Owner or Manager role can connect accounts from the **Channels** page.

Until the keys are set, the Channels page shows "Not set up" next to that platform. Everything else works. To try publishing without any apps, set `PUBLISH_DRY_RUN=true` (ignored in production): the worker then marks posts as published without sending anything.

Every app needs the same redirect URL pattern:

```
{APP_URL}/api/channels/callback/meta
{APP_URL}/api/channels/callback/linkedin
{APP_URL}/api/channels/callback/linkedin_pages
{APP_URL}/api/channels/callback/tiktok
{APP_URL}/api/channels/callback/threads
{APP_URL}/api/channels/callback/youtube
{APP_URL}/api/channels/callback/google_business
{APP_URL}/api/channels/callback/pinterest
{APP_URL}/api/channels/callback/mastodon
```

Bluesky, Mastodon and DEV.to need no developer app at all. People connect them from the Channels page with an app password, their server's address, or an API key.

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
4. Company pages need the **Community Management API**, and LinkedIn only grants it to an app with no other products. So create a **second app** for pages:
   - Link it to (and verify) your company page, then request only **Community Management API** under *Products*.
   - Add the redirect URL `{APP_URL}/api/channels/callback/linkedin_pages` under *Auth*.
   - Once approved, set `LINKEDIN_PAGES_CLIENT_ID` and `LINKEDIN_PAGES_CLIENT_SECRET`. The Channels page then shows **LinkedIn company page**, which lists the pages the signed-in person administers.
   - If one app has both sign-in and Community Management (older apps), you can instead set
     `LINKEDIN_SCOPES="openid profile w_member_social w_organization_social r_organization_social rw_organization_admin"` on the first app.

LinkedIn tokens last 60 days. The Channels page warns a week ahead, and owners and managers get a notification, so someone can renew the connection.

## TikTok

1. At developers.tiktok.com, create an app and add **Login Kit** and **Content Posting API** (enable *Direct Post*).
2. Add the redirect URL above, and request the scopes `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.publish` and `video.list`.
3. Under *URL properties*, verify the domain of `MEDIA_PUBLIC_URL`. TikTok downloads each video from there.
4. Set `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`.

Until TikTok audits the app, videos can only be posted as private. The product tells you when that happens.

## Threads

Threads has its own app ID and secret, separate from Facebook's.

1. At developers.facebook.com, create an app and choose the **Access the Threads API** use case.
2. Under *Threads API → Settings*, add the redirect URL above to *Redirect Callback URLs*, and fill in the uninstall and delete callback URLs (any page on your site works while testing).
3. Request the permissions `threads_basic`, `threads_content_publish`, `threads_manage_replies`, `threads_read_replies` and `threads_manage_insights`.
4. Set `THREADS_APP_ID` and `THREADS_APP_SECRET` (shown under *Threads API → Settings*, not the main app settings).

While the app is in development, add each tester under *App roles → Threads testers*, and they must accept the invite in the Threads app. Tokens last 60 days and the worker renews them automatically.

## YouTube and Google Business Profile

One Google Cloud OAuth client covers both.

1. At console.cloud.google.com, create a project. Enable the **YouTube Data API v3** and, for Business Profile, the **My Business Account Management API**, **My Business Business Information API** and **Google My Business API**.
2. Under *APIs & Services → OAuth consent screen*, set up the app and add the scopes `youtube.upload`, `youtube.readonly`, `youtube.force-ssl` and `business.manage`.
3. Under *Credentials*, create an **OAuth client ID** of type *Web application* and add both Google redirect URLs above.
4. Set `GOOGLE_PUBLISH_CLIENT_ID` and `GOOGLE_PUBLISH_CLIENT_SECRET`. These are separate from any Google sign-in keys.
5. Optional: set `YOUTUBE_PRIVACY_STATUS` to `private` or `unlisted` to change the default for new uploads.

Videos uploaded by an unverified Google project are locked to private until Google audits it (*YouTube API Services audit*). Business Profile API access must be requested from Google before the APIs return data. The YouTube API allows about six uploads a day per project by default.

## Pinterest

1. At developers.pinterest.com, create an app and request **Standard access**.
2. Add the redirect URL above and the scopes `boards:read`, `pins:read`, `pins:write` and `user_accounts:read`.
3. Set `PINTEREST_APP_ID` and `PINTEREST_APP_SECRET`.
4. Before Standard access is approved, set `PINTEREST_SANDBOX=true` to post to Pinterest's sandbox instead.

Each public board shows up as its own channel. Secret boards are left out.

## Bluesky

Nothing to set up on the server. On the Channels page, enter the account's handle and an **app password** made in Bluesky under *Settings → Privacy and security → App passwords*. The app password is stored encrypted and can be revoked in Bluesky at any time. Bluesky video isn't supported yet.

## Mastodon

Nothing to set up on the server. On the Channels page, enter the server the account lives on (for example `mastodon.social`). The product registers itself with that server the first time and then sends the person to its sign-in page. Only public internet addresses are accepted.

## DEV.to

Nothing to set up on the server. On the Channels page, paste an API key from dev.to under *Settings → Extensions → DEV Community API Keys*. The first line of a post becomes the article title, and up to four hashtags become its tags.

## Google Drive (choosing post media)

Not a channel: this lets people pick photos and videos for a post straight from their Google Drive (and shared drives) in the composer, instead of uploading them first. **Add media** then opens on a *Google Drive* tab; uploading and the media library stay on the next tab.

The app asks only for the `drive.file` permission, which lets it open the files the person picks and nothing else in their Drive. Google treats this as a non-sensitive scope, so the consent screen doesn't need Google's verification. Each picked file is copied into the workspace's media storage (the platforms fetch media by public URL, so they can't post a file straight from Drive) and counts towards the workspace's 5 GB. The Google access token stays in the browser tab for about an hour and is only passed to the server to download those files; it's never saved.

1. At console.cloud.google.com, open the project that holds your Google sign-in client (or create one). Under *APIs & Services → Library*, enable the **Google Drive API** and the **Google Picker API**.
2. Under *APIs & Services → OAuth consent screen* (*Google Auth Platform → Data access*), add the scope `https://www.googleapis.com/auth/drive.file`. While the app's publishing status is *Testing*, add each person under *Test users*; choose *In production* to let anyone use it.
3. Under *Credentials*, open your **OAuth client ID** of type *Web application* (the Google sign-in one works) or create a new one, and add your `APP_URL` (for example `https://app.example.com`, and `http://localhost:3000` for development) under **Authorized JavaScript origins**. No redirect URL is needed.
4. Under *Credentials*, choose *Create credentials → API key*. Edit it: under *Application restrictions* pick *Websites* and add `{APP_URL}/*`; under *API restrictions* allow only the **Google Picker API** and **Google Drive API**. This key is visible in the browser by design, so the restrictions are what protect it.
5. Set in `.env`:
   - `GOOGLE_DRIVE_API_KEY`: the API key from step 4.
   - `GOOGLE_DRIVE_CLIENT_ID`: the client ID from step 3. Leave it empty to reuse `GOOGLE_CLIENT_ID`, or `GOOGLE_PUBLISH_CLIENT_ID` (the YouTube client) when there's no sign-in client. Whichever client is used needs step 3's JavaScript origin.
   - `GOOGLE_DRIVE_APP_ID`: optional. It's the project number (*IAM & Admin → Settings*), which is also the digits at the start of the client ID, so it's filled in from that when empty.
6. Restart the app (`npm run dev`, or redeploy on Vercel). The page's security policy only allows Google's Picker once `GOOGLE_DRIVE_API_KEY` is set, and it's read when the app starts or builds.

Images up to 20 MB and videos up to 300 MB can be picked, up to 10 files at a time. Google Docs, Sheets and other non-media files are hidden in the picker. If the Google sign-in window doesn't open, allow pop-ups for the app's address.

## How publishing works

- The worker (`npm run worker`) checks for due posts every 15 seconds and claims each one atomically, so running several workers is safe.
- Each channel of a post publishes as its own job. Network errors, platform outages and rate limits are retried up to 4 times with growing delays (1, 2, 4 minutes). Rejected content fails straight away with the platform's reason.
- An expired or revoked token marks the channel **Reconnect** and notifies owners and managers.
- Per-channel limits stay under each platform's own: Instagram 25 a day, Facebook 50 an hour, LinkedIn 50 a day, TikTok 15 a day. Posts over the limit wait for the next window.
- Tokens that can be refreshed (TikTok, and LinkedIn when allowed) are refreshed hourly before they expire.
- Every attempt is recorded in the publish log, which keeps 90 days.

## Inbox and analytics

- Every 10 minutes the worker reads comments on posts published in the last 14 days. Each top-level comment becomes a conversation; a new comment reopens it and marks it unread. Replies go back through the platform's API.
- Every 6 hours it reads follower counts, daily figures and per-post figures for the last 30 days.
- What each platform shares:

| | Followers | Daily figures | Post figures | Comments and replies |
|---|---|---|---|---|
| Facebook Page | Yes | Impressions, reach, engagements, video views | Yes | Yes |
| Instagram | Yes | Reach | Yes | Yes |
| LinkedIn company page | Yes | Impressions, reach, engagements, clicks | Likes, comments | Yes |
| LinkedIn profile | No | No | Likes, comments | Yes |
| TikTok | Yes | No | Views, likes, comments, shares | Not offered by TikTok |

Direct messages need extra Meta permissions and a webhook endpoint, and aren't included yet.
