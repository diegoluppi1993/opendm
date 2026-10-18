import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/env", () => ({
  getMetaGraphApiVersion: () => "v25.0",
  requireEnv: (name: string) => `${name}_value`,
}));

// handleResponse is the shared Meta response parser; here it just unwraps JSON
// so the tests can focus on the requests this module builds.
vi.mock("@/lib/meta/client", () => ({
  handleResponse: async (response: Response) => response.json(),
}));

import {
  exchangeFacebookCode,
  getFacebookAuthorizationUrl,
  getFacebookPagePosts,
  listFacebookPages,
  sendFacebookCommentReply,
  sendFacebookPrivateReply,
  sendFacebookPrivateReplyWithLinkButton,
  subscribeFacebookPageToWebhooks,
} from "@/lib/meta/facebook";

const fetchMock = vi.fn();

function ok(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getFacebookAuthorizationUrl", () => {
  it("asks for the Page messaging and engagement permissions", () => {
    const url = new URL(
      getFacebookAuthorizationUrl("https://app.test/api/facebook/callback", "st")
    );

    expect(url.origin + url.pathname).toBe(
      "https://www.facebook.com/v25.0/dialog/oauth"
    );
    expect(url.searchParams.get("client_id")).toBe("FACEBOOK_APP_ID_value");
    expect(url.searchParams.get("state")).toBe("st");
    const scopes = url.searchParams.get("scope")!.split(",");
    expect(scopes).toEqual(
      expect.arrayContaining([
        "pages_show_list",
        "pages_messaging",
        "pages_read_engagement",
        "pages_manage_metadata",
        "pages_manage_engagement",
      ])
    );
  });
});

describe("exchangeFacebookCode", () => {
  it("exchanges the code, then upgrades it to a long-lived user token", async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ access_token: "short" }))
      .mockResolvedValueOnce(ok({ access_token: "long" }));

    await expect(
      exchangeFacebookCode("the-code", "https://app.test/cb")
    ).resolves.toBe("long");

    const first = new URL(fetchMock.mock.calls[0][0]);
    expect(first.pathname).toBe("/v25.0/oauth/access_token");
    expect(first.searchParams.get("code")).toBe("the-code");
    const second = new URL(fetchMock.mock.calls[1][0]);
    expect(second.searchParams.get("grant_type")).toBe("fb_exchange_token");
    expect(second.searchParams.get("fb_exchange_token")).toBe("short");
  });
});

describe("listFacebookPages", () => {
  it("follows pagination and drops pages without a token", async () => {
    fetchMock
      .mockResolvedValueOnce(
        ok({
          data: [
            { id: "1", name: "One", access_token: "t1" },
            { id: "2", name: "No token" },
          ],
          paging: { next: "https://graph.facebook.com/next-page" },
        })
      )
      .mockResolvedValueOnce(
        ok({ data: [{ id: "3", name: "Three", access_token: "t3" }] })
      );

    const pages = await listFacebookPages("user-token");

    expect(pages.map((p) => p.id)).toEqual(["1", "3"]);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer user-token"
    );
  });
});

describe("subscribeFacebookPageToWebhooks", () => {
  it("subscribes the Page to the feed field", async () => {
    fetchMock.mockResolvedValue(ok({ success: true }));

    await subscribeFacebookPageToWebhooks("page_1", "page-token");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v25.0/page_1/subscribed_apps");
    expect(JSON.parse(init.body)).toEqual({ subscribed_fields: ["feed"] });
  });
});

describe("sending", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(ok({ recipient_id: "u", message_id: "m" }));
  });

  it("sends a private reply to the comment as the Page", async () => {
    await sendFacebookPrivateReply("page-token", "page_1", "c_1", "Hi!");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v25.0/page_1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer page-token");
    expect(JSON.parse(init.body)).toEqual({
      recipient: { comment_id: "c_1" },
      message: { text: "Hi!" },
    });
  });

  it("sends link buttons as a template, capped at 3 and 20-char titles", async () => {
    await sendFacebookPrivateReplyWithLinkButton(
      "page-token",
      "page_1",
      "c_1",
      "Your guide",
      Array.from({ length: 4 }, (_, i) => ({
        title: `A very long button title ${i}`,
        url: `https://example.com/${i}`,
      }))
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.recipient).toEqual({ comment_id: "c_1" });
    const payload = body.message.attachment.payload;
    expect(payload.template_type).toBe("button");
    expect(payload.text).toBe("Your guide");
    expect(payload.buttons).toHaveLength(3);
    expect(payload.buttons[0]).toEqual({
      type: "web_url",
      url: "https://example.com/0",
      title: "A very long button t",
    });
  });

  it("replies publicly under the comment", async () => {
    fetchMock.mockResolvedValue(ok({ id: "r_1" }));

    await sendFacebookCommentReply("page-token", "c_1", "Check Messenger!");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v25.0/c_1/comments");
    expect(JSON.parse(init.body)).toEqual({ message: "Check Messenger!" });
  });
});

describe("getFacebookPagePosts", () => {
  it("maps Page posts to the shape the post picker renders", async () => {
    fetchMock.mockResolvedValue(
      ok({
        data: [
          {
            id: "page_1_100",
            message: "Guide",
            full_picture: "https://img/1.jpg",
            permalink_url: "https://facebook.com/1",
            created_time: "2026-10-01T10:00:00+0000",
            attachments: { data: [{ media_type: "photo" }] },
          },
          {
            id: "page_1_101",
            created_time: "2026-10-02T10:00:00+0000",
            attachments: { data: [{ media_type: "video" }] },
          },
        ],
      })
    );

    const posts = await getFacebookPagePosts("page-token", "page_1", 25);

    expect(posts[0]).toMatchObject({
      id: "page_1_100",
      caption: "Guide",
      media_type: "IMAGE",
      thumbnail_url: "https://img/1.jpg",
      permalink: "https://facebook.com/1",
    });
    expect(posts[1].media_type).toBe("VIDEO");
    expect(fetchMock.mock.calls[0][0]).toContain("/page_1/published_posts");
  });

  it("stops at the requested maximum", async () => {
    fetchMock.mockResolvedValue(
      ok({
        data: Array.from({ length: 5 }, (_, i) => ({
          id: `p${i}`,
          created_time: "2026-10-01T10:00:00+0000",
        })),
        paging: { next: "https://graph.facebook.com/more" },
      })
    );

    const posts = await getFacebookPagePosts("t", "page_1", 3);

    expect(posts).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
