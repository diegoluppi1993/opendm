# Delivery retries and the follow gate

Ported from [diwenne/openreply](https://github.com/diwenne/openreply)
(#55, #68, #70, #73, #74). OpenDM keeps the same behaviour without the upstream
Zernio/provider layer and **without a database migration**.

## Unconfirmed deliveries

Only an explicit refusal proves a DM was *not* delivered: Meta codes 10, 100,
200 and 551, rate limits and expired tokens. Anything else — notably Meta's
generic code 1, which Meta has returned *after* delivering — is "unconfirmed":

- the worker does **not** throw, so BullMQ does not retry;
- the monthly-plan and hourly-slot reservations are **kept**;
- `DmLog.errorMessage` (or `publicReplyError` for the comment reply) is set to
  `Delivery unconfirmed: …`, and the reconciler never re-enqueues that comment.

Every send is claimed first with an atomic `updateMany`, which also counts
`attempts` across jobs (max 3). If the process dies mid-send, the claim stays
and the send is not repeated. If a person genuinely did not receive the DM, they
can simply comment again.

Upstream stores the flags in two boolean columns (`dmDeliveryUnconfirmed`,
`publicReplyDeliveryUnconfirmed`). OpenDM uses the existing text columns; to move
to the columns later, add the upstream migration `20260908165200_unconfirmed_delivery`
and replace `hasUnconfirmedDelivery()` / the `UNCONFIRMED_PREFIX` writes.

Not ported: the durable postback claims (`PostbackDelivery`), which belong to
the Zernio provider work.

## Follow gate

Instagram can take up to ~a minute to report a brand-new follow, so a tap on
"I'm following" is re-checked instead of rejected on the first `false`:
after 20 s, then 40 s (`FOLLOW_RECHECK_DELAYS_MS`). Only a last `false` sends the
prompt again, and it is recorded as an `OperationalEvent`
("Follow gate rejected a button tap"). Set `FOLLOW_RECHECK_ACK_MESSAGE` to send
a short "checking…" DM on the first `false`.

The opening DM's button carries a `:open` marker (`followcheck:<id>:open`): a tap
there is not a claim to follow, so non-followers get the prompt immediately.
Buttons already sent before this change keep working (no marker = old behaviour
of re-checking).

A read fallback now requires a *confirmed* follow (`true`); an unreadable status
(`null`) no longer lets the link through.
