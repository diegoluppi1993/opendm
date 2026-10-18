/**
 * Facebook Pages: comment → private reply (Messenger), public comment reply and
 * the Page's posts. The Instagram counterparts live in ./client.
 *
 * Everything here goes through graph.facebook.com with a Page access token.
 * There is deliberately no follower/like check: Meta exposes no way to ask
 * whether a given person follows a Page, so a Facebook campaign never gates.
 */
import { getMetaGraphApiVersion, requireEnv } from "@/lib/env";
import {
  handleResponse,
  type InstagramMedia,
  type LinkButton,
} from "@/lib/meta/client";

const FACEBOOK_SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_manage_metadata",
  "pages_manage_engagement",
];

function graphBase() {
  return `https://graph.facebook.com/${getMetaGraphApiVersion()}`;
}

function authHeaders(accessToken: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
}

export function getFacebookAuthorizationUrl(
  redirectUri: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: requireEnv("FACEBOOK_APP_ID"),
    redirect_uri: redirectUri,
    scope: FACEBOOK_SCOPES.join(","),
    response_type: "code",
    state,
  });
  return `https://www.facebook.com/${getMetaGraphApiVersion()}/dialog/oauth?${params.toString()}`;
}

async function tokenRequest(params: Record<string, string>) {
  const url = new URL(`${graphBase()}/oauth/access_token`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return handleResponse<{ access_token: string; expires_in?: number }>(
    await fetch(url.toString())
  );
}

/** Exchanges the login `code` for a long-lived *user* token. */
export async function exchangeFacebookCode(
  code: string,
  redirectUri: string
): Promise<string> {
  const short = await tokenRequest({
    client_id: requireEnv("FACEBOOK_APP_ID"),
    client_secret: requireEnv("FACEBOOK_APP_SECRET"),
    redirect_uri: redirectUri,
    code,
  });
  // Page tokens obtained from a long-lived user token do not expire, which is
  // why a connected Page needs no refresh job.
  const long = await tokenRequest({
    grant_type: "fb_exchange_token",
    client_id: requireEnv("FACEBOOK_APP_ID"),
    client_secret: requireEnv("FACEBOOK_APP_SECRET"),
    fb_exchange_token: short.access_token,
  });
  return long.access_token;
}

export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
}

/** The Pages the person granted access to, each with its own Page token. */
export async function listFacebookPages(
  userAccessToken: string
): Promise<FacebookPage[]> {
  const pages: FacebookPage[] = [];
  let url: string | null =
    `${graphBase()}/me/accounts?fields=id,name,access_token&limit=100`;

  while (url) {
    const page: {
      data?: FacebookPage[];
      paging?: { next?: string };
    } = await handleResponse(
      await fetch(url, { headers: authHeaders(userAccessToken) })
    );
    pages.push(...(page.data ?? []).filter((p) => p.id && p.access_token));
    url = page.paging?.next ?? null;
  }
  return pages;
}

/** Subscribes the app to the Page's `feed` (comments) webhook. */
export async function subscribeFacebookPageToWebhooks(
  pageId: string,
  pageAccessToken: string
): Promise<{ success: boolean }> {
  return handleResponse(
    await fetch(`${graphBase()}/${pageId}/subscribed_apps`, {
      method: "POST",
      headers: authHeaders(pageAccessToken),
      body: JSON.stringify({ subscribed_fields: ["feed"] }),
    })
  );
}

type SendResult = { recipient_id: string; message_id: string };

async function postMessage(
  pageAccessToken: string,
  pageId: string,
  commentId: string,
  message: unknown
): Promise<SendResult> {
  return handleResponse(
    await fetch(`${graphBase()}/${pageId}/messages`, {
      method: "POST",
      headers: authHeaders(pageAccessToken),
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message,
      }),
    })
  );
}

/**
 * Private reply to a Page comment, sent as the Page. Meta allows one per
 * comment, within 7 days. Same signature as the Instagram sender so the worker
 * can pick either.
 */
export function sendFacebookPrivateReply(
  accessToken: string,
  pageId: string,
  commentId: string,
  text: string
): Promise<SendResult> {
  return postMessage(accessToken, pageId, commentId, { text });
}

/** Private reply with up to 3 tappable link buttons. */
export function sendFacebookPrivateReplyWithLinkButton(
  accessToken: string,
  pageId: string,
  commentId: string,
  text: string,
  buttons: LinkButton[]
): Promise<SendResult> {
  return postMessage(accessToken, pageId, commentId, {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: text.slice(0, 640),
        buttons: buttons.slice(0, 3).map((b) => ({
          type: "web_url",
          url: b.url,
          title: b.title.slice(0, 20),
        })),
      },
    },
  });
}

/** Public reply under a comment, posted as the Page. */
export async function sendFacebookCommentReply(
  accessToken: string,
  commentId: string,
  message: string
): Promise<{ id: string }> {
  return handleResponse(
    await fetch(`${graphBase()}/${commentId}/comments`, {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ message }),
    })
  );
}

interface FacebookPost {
  id: string;
  message?: string;
  full_picture?: string;
  permalink_url?: string;
  created_time: string;
  attachments?: { data?: { media_type?: string }[] };
}

function toMedia(post: FacebookPost): InstagramMedia {
  const mediaType = post.attachments?.data?.[0]?.media_type;
  return {
    id: post.id,
    caption: post.message,
    media_type: mediaType === "video" ? "VIDEO" : "IMAGE",
    media_url: post.full_picture,
    thumbnail_url: post.full_picture,
    timestamp: post.created_time,
    permalink: post.permalink_url,
  };
}

/**
 * The Page's published posts, in the shape the post picker already renders for
 * Instagram. Post ids are `<pageId>_<postId>`, the same form comment webhooks
 * report as `post_id`, so a campaign's postId matches incoming comments as is.
 */
export async function getFacebookPagePosts(
  accessToken: string,
  pageId: string,
  max = 25
): Promise<InstagramMedia[]> {
  const posts: InstagramMedia[] = [];
  const pageSize = Math.min(max, 50);
  let url: string | null =
    `${graphBase()}/${pageId}/published_posts?fields=id,message,full_picture,permalink_url,created_time,attachments{media_type}&limit=${pageSize}`;

  while (url && posts.length < max) {
    const page: {
      data?: FacebookPost[];
      paging?: { next?: string };
    } = await handleResponse(
      await fetch(url, { headers: authHeaders(accessToken) })
    );
    posts.push(...(page.data ?? []).map(toMedia));
    url = page.paging?.next ?? null;
  }
  return posts.slice(0, max);
}
