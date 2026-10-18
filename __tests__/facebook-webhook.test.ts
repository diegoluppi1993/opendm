import { describe, it, expect } from "vitest";
import {
  parseCommentEvents,
  parseFacebookCommentEvents,
} from "@/lib/meta/webhook";

type Payload = Parameters<typeof parseFacebookCommentEvents>[0];

const feedChange = (value: Record<string, unknown>) => ({
  field: "feed",
  value: {
    item: "comment",
    verb: "add",
    comment_id: "100_200",
    post_id: "page_1_100",
    parent_id: "page_1_100",
    message: "I want the GUIDE",
    from: { id: "user_9", name: "Maria Rossi" },
    ...value,
  },
});

const payload = (...changes: ReturnType<typeof feedChange>[]): Payload => ({
  object: "page",
  entry: [{ id: "page_1", time: 1, changes }],
});

describe("parseFacebookCommentEvents", () => {
  it("turns a new top-level comment into a comment event", () => {
    expect(parseFacebookCommentEvents(payload(feedChange({})))).toEqual([
      {
        instagramAccountId: "page_1",
        commentId: "100_200",
        commentText: "I want the GUIDE",
        commenterId: "user_9",
        commenterName: "Maria Rossi",
        mediaId: "page_1_100",
      },
    ]);
  });

  it("ignores replies to another comment", () => {
    expect(
      parseFacebookCommentEvents(
        payload(feedChange({ parent_id: "page_1_100_555" }))
      )
    ).toEqual([]);
  });

  it("ignores the Page's own comments", () => {
    expect(
      parseFacebookCommentEvents(
        payload(feedChange({ from: { id: "page_1", name: "The Page" } }))
      )
    ).toEqual([]);
  });

  it.each([
    ["an edit", { verb: "edited" }],
    ["a deletion", { verb: "remove" }],
    ["a reaction", { item: "reaction" }],
    ["a post", { item: "status" }],
  ])("ignores %s", (_name, override) => {
    expect(parseFacebookCommentEvents(payload(feedChange(override)))).toEqual(
      []
    );
  });

  it("ignores events missing the ids it needs", () => {
    expect(
      parseFacebookCommentEvents(payload(feedChange({ comment_id: undefined })))
    ).toEqual([]);
    expect(
      parseFacebookCommentEvents(payload(feedChange({ from: undefined })))
    ).toEqual([]);
  });

  it("does not touch Instagram payloads, and vice versa", () => {
    const instagram = {
      object: "instagram",
      entry: [
        {
          id: "ig_1",
          time: 1,
          changes: [
            {
              field: "comments",
              value: {
                id: "c1",
                text: "LINK",
                from: { id: "u1", username: "someone" },
                media: { id: "m1" },
              },
            },
          ],
        },
      ],
    } as Payload;

    expect(parseFacebookCommentEvents(instagram)).toEqual([]);
    expect(parseCommentEvents(payload(feedChange({})))).toEqual([]);
    expect(parseCommentEvents(instagram)).toHaveLength(1);
  });
});
