import {
  MetaApiError,
  RateLimitError,
  TokenExpiredError,
} from "@/lib/meta/client";

/**
 * How many times one comment's DM may be attempted in total, counted across
 * jobs: BullMQ retries and the reconciler's re-enqueues all draw on it.
 */
export const MAX_COMMENT_SEND_ATTEMPTS = 3;

/**
 * Written to DmLog.errorMessage / publicReplyError for a send whose outcome is
 * unknown. A row carrying it is never sent again.
 *
 * Ported from diwenne/openreply (#68, #70), which stores this in two dedicated
 * boolean columns. OpenDM keeps it in the existing text columns instead so the
 * port needs no database migration; migrating to the columns later is a
 * mechanical change (see docs/delivery-retries.md).
 */
export const UNCONFIRMED_PREFIX = "Delivery unconfirmed:";

/**
 * The claim written *before* the send. If the process dies between the send and
 * the log write, the row is left holding this and the send is not repeated.
 */
export const SEND_CLAIM_MESSAGE = `${UNCONFIRMED_PREFIX} send started, outcome not recorded`;

// Only explicit rejections prove that no message was delivered. Meta code 1
// (a generic OAuthException returned *after* delivery in production), network
// failures, invalid responses and local persistence failures do not.
export function isConfirmedSendRejection(error: unknown): boolean {
  if (error instanceof RateLimitError || error instanceof TokenExpiredError) {
    return true;
  }
  return (
    error instanceof MetaApiError && [10, 100, 200, 551].includes(error.code)
  );
}

export function unconfirmedMessage(detail: string): string {
  return `${UNCONFIRMED_PREFIX} ${detail}`;
}

// Workers older than this change logged the same uncertain Meta responses as
// plain FAILED rows with a "Meta API Error <code>:" message.
const LEGACY_UNCONFIRMED = /Meta API Error (?:1|2|5\d\d):/;

/**
 * True when a log's error text says its send may have been delivered.
 * `legacyFailed` also recognises rows written by the previous worker.
 */
export function hasUnconfirmedDelivery(
  message: string | null | undefined,
  legacyFailed = false
): boolean {
  if (!message) return false;
  if (message.startsWith(UNCONFIRMED_PREFIX)) return true;
  return legacyFailed && LEGACY_UNCONFIRMED.test(message);
}
