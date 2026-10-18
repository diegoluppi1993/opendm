import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/meta/client", () => ({
  MetaApiError: class MetaApiError extends Error {
    code: number;
    constructor(code: number, _s: unknown, _t: unknown, message: string) {
      super(message);
      this.code = code;
    }
  },
  RateLimitError: class RateLimitError extends Error {},
  TokenExpiredError: class TokenExpiredError extends Error {},
}));

import {
  MetaApiError,
  RateLimitError,
  TokenExpiredError,
} from "@/lib/meta/client";
import {
  hasUnconfirmedDelivery,
  isConfirmedSendRejection,
  unconfirmedMessage,
} from "@/lib/instagram/delivery-errors";

const meta = (code: number) =>
  new MetaApiError(code, undefined, undefined, "x");

describe("isConfirmedSendRejection", () => {
  it.each([10, 100, 200, 551])("treats Meta code %i as a refusal", (code) => {
    expect(isConfirmedSendRejection(meta(code))).toBe(true);
  });

  it("treats rate limits and expired tokens as refusals", () => {
    expect(isConfirmedSendRejection(new RateLimitError("x"))).toBe(true);
    expect(isConfirmedSendRejection(new TokenExpiredError("x"))).toBe(true);
  });

  it.each([1, 2, 500, 503])(
    "does not treat Meta code %i as proof of non-delivery",
    (code) => {
      expect(isConfirmedSendRejection(meta(code))).toBe(false);
    }
  );

  it("does not treat network failures as proof of non-delivery", () => {
    expect(isConfirmedSendRejection(new Error("socket hang up"))).toBe(false);
  });
});

describe("hasUnconfirmedDelivery", () => {
  it("recognises the marker", () => {
    expect(hasUnconfirmedDelivery(unconfirmedMessage("boom"))).toBe(true);
  });

  it("ignores empty and ordinary errors", () => {
    expect(hasUnconfirmedDelivery(null)).toBe(false);
    expect(hasUnconfirmedDelivery("Meta API Error 100: nope")).toBe(false);
  });

  it("recognises rows written by the previous worker only when asked", () => {
    const legacy = "Meta API Error 1: An unknown error occurred";
    expect(hasUnconfirmedDelivery(legacy)).toBe(false);
    expect(hasUnconfirmedDelivery(legacy, true)).toBe(true);
    expect(hasUnconfirmedDelivery("Meta API Error 100: nope", true)).toBe(false);
  });
});
