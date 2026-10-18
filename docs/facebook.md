# Facebook Pages

OpenDM can run the same comment-to-DM campaign on a **Facebook Page**:

> someone comments a keyword on a Page post → the Page replies publicly (optional)
> and sends them a private Messenger message with your guide and a link button.

A Facebook campaign is deliberately simpler than an Instagram one:

| | Instagram | Facebook Page |
|---|---|---|
| Comment → private reply | yes | yes |
| Public reply under the comment | yes | yes |
| Link buttons + click tracking | yes | yes |
| Follow gate | yes | **no** — Meta exposes no "does this person follow the Page" check |
| Opening DM + button | yes | no |
| DM keyword trigger | yes | no |
| "Next post" mode, polling safety net | yes | no (webhook only) |

## Limits that come from Meta

- One private reply per comment, and only within **7 days** of the comment.
- A private message from a Page to someone who never messaged it often lands in
  **Message requests** or **Spam** on their side. Say so in your public reply
  ("I've sent it in a private message — check your Message requests too").
- If the person replies, a 24-hour window opens for further messages.
- A Page cannot send a private reply to another Page, and comments made *as* the
  Page are ignored.

## Setup

Use the **same Meta app** as Instagram.

1. In the Meta app dashboard add the **Facebook Login** product and, under its
   settings, add this valid OAuth redirect URI:
   `https://<your-domain>/api/facebook/callback`
2. Set the app's **Facebook App ID** in the environment (different from
   `INSTAGRAM_APP_ID`, which belongs to the Instagram product):

   ```
   FACEBOOK_APP_ID=...
   FACEBOOK_APP_SECRET=...   # already used to verify webhooks
   ```
3. Webhooks → add the **Page** object, callback URL `https://<your-domain>/api/webhook`
   (same as Instagram, same verify token), and subscribe to the **`feed`** field.
   The connect flow then subscribes each connected Page automatically.
4. Permissions the app requests: `pages_show_list`, `pages_messaging`,
   `pages_read_engagement`, `pages_read_user_content`, `pages_manage_metadata`,
   `pages_manage_engagement`. In development mode they work for people with a
   role on the app; for anyone else the app needs **App Review** (and usually
   business verification).
5. Run the database migration (`npx prisma migrate deploy`): it adds the
   `AccountPlatform` enum and a `platform` column to `InstagramAccount`
   (default `INSTAGRAM`, so existing accounts are unchanged).
6. Settings → **Connect Facebook Page**, and tick the Page(s) in Facebook's dialog.

## How it is wired

A Page is stored as an account with `platform = FACEBOOK`: `instagramId` holds the
Page ID, `username` the Page name, `accessToken` the (non-expiring, encrypted) Page
token. Campaigns, logs, queues, billing and click tracking are shared with
Instagram. `lib/meta/facebook.ts` holds the Graph calls, `parseFacebookCommentEvents`
in `lib/meta/webhook.ts` reads the `feed` webhook, and the DM worker picks the
Facebook senders when the campaign's account is a Page. Instagram-only endpoints
(inbox, analytics, follower history, token refresh) skip Pages.
