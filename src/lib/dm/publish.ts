/**
 * Publishing a NIP-17 gift wrap, anonymously.
 *
 * Every wrap addressed to someone else goes through here, on
 * `dm-publish-pool.ts`, which no auth manager watches. See that file for why
 * an authenticated socket defeats the ephemeral key the wrap is signed with.
 *
 * Two applesauce behaviours shape this:
 *
 * - `Relay.event()` wraps the EVENT in `waitForAuth(authRequiredForPublish$)`,
 *   and `receivedAuthRequiredForEvent` LATCHES for the whole `Relay` instance
 *   once a relay answers `auth-required` to any publish. Nothing authenticates
 *   on this pool, so after that latch every publish to that relay waits out its
 *   full timeout before failing. Hence `refusedRelays`: a relay that demanded
 *   auth once is skipped for the rest of the session rather than paid for
 *   again. (`resetState()` clears the latch on reconnect, so this memo is the
 *   only thing keeping the cost down.)
 * - `Relay.publish()` turns an `auth-required` OK into an `AuthRequiredError`
 *   and hands it to a retry operator. Retries are disabled here: retrying is
 *   what an app does when it intends to authenticate, and this one never will.
 */

import { AuthRequiredError } from "applesauce-relay";
import type { NostrEvent } from "nostr-tools";
import dmPublishPool from "@/services/dm-publish-pool";
import { normalizeRelayURL } from "@/lib/relay-url";

/** A relay that demands auth is answered fast, not waited out. */
const PUBLISH_TIMEOUT_MS = 10_000;

/** What one relay did with a wrap. */
export interface GiftWrapDelivery {
  relay: string;
  ok: boolean;
  /**
   * The relay would only take this wrap from an identified sender. Reported,
   * never satisfied — authenticating is the disclosure the wrap exists to
   * avoid.
   */
  authRequired: boolean;
  error?: string;
}

/** Relays that demanded auth for an EVENT this session. */
const refusedRelays = new Set<string>();

/** Forget the refusals — for tests, and for a relay-settings change. */
export function resetGiftWrapRefusals(): void {
  refusedRelays.clear();
}

function isAuthRequired(error: unknown): boolean {
  if (error instanceof AuthRequiredError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("auth-required");
}

/**
 * Publish one gift wrap to each relay, in parallel, on the unauthenticated
 * pool.
 *
 * Never throws for a relay-level failure — the caller needs to see WHICH
 * relays took it, because "the peer copy reached nothing" and "one of four
 * relays was down" are different messages to show a sender.
 */
export async function publishGiftWrap(
  wrap: NostrEvent,
  relays: string[],
): Promise<GiftWrapDelivery[]> {
  const targets = Array.from(new Set(relays.map(normalizeRelayURL)));

  return Promise.all(
    targets.map(async (relay): Promise<GiftWrapDelivery> => {
      if (refusedRelays.has(relay)) {
        return {
          relay,
          ok: false,
          authRequired: true,
          error: "Relay requires authentication to accept an event",
        };
      }

      try {
        const response = await dmPublishPool
          .relay(relay)
          .publish(wrap, { retries: 0, timeout: PUBLISH_TIMEOUT_MS });

        if (response.ok) return { relay, ok: true, authRequired: false };

        const authRequired =
          response.message?.startsWith("auth-required") ?? false;
        if (authRequired) refusedRelays.add(relay);
        return {
          relay,
          ok: false,
          authRequired,
          ...(response.message ? { error: response.message } : {}),
        };
      } catch (error) {
        const authRequired = isAuthRequired(error);
        if (authRequired) refusedRelays.add(relay);
        return {
          relay,
          ok: false,
          authRequired,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}
