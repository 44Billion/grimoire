/**
 * NIP-98 — HTTP auth, signed by the user.
 *
 * A kind-27235 event whose `u` tag names the exact URL being requested, base64'd
 * into an `Authorization: Nostr …` header. The server verifies the signature and
 * learns which pubkey is knocking; nothing here is ever published to a relay.
 *
 * Concord signs a NIP-98-SHAPED grant of its own (`signAvGrant`,
 * `src/lib/concord/voice.ts`), and the differences are worth stating because
 * they are the reason this is a separate function rather than a shared one:
 * that grant is signed by a channel-derived key so the broker learns nothing
 * about who is joining, it uses a `Concord` scheme, and it carries a `nonce`
 * because every member of a channel signs with the SAME key and would otherwise
 * produce byte-identical events. Real NIP-98 needs none of that — each request
 * is signed by its own user's key, which is what the server wants to know.
 */

import type { EventTemplate } from "nostr-tools";

import type { NostrEvent } from "@/types/nostr";

/** The HTTP-auth event kind. */
export const KIND_HTTP_AUTH = 27235;

/** The narrowest thing that can sign one of these. */
export interface HttpAuthSigner {
  signEvent(template: EventTemplate): Promise<NostrEvent>;
}

/**
 * Base64 without the UTF-8 footgun.
 *
 * `btoa` throws on any code point above U+00FF, and an event's JSON can carry
 * one through a URL with non-ASCII characters in it — a group id, say, before it
 * is percent-encoded. Encoding to UTF-8 bytes first is what NIP-98 means by
 * base64 of the event.
 */
function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Sign a NIP-98 authorization for one request.
 *
 * `url` must be the EXACT string that will be fetched. The server compares its
 * own request URL against the `u` tag, so a caller that canonicalizes one and
 * not the other gets a 401 with nothing in it to explain why — build the URL
 * once and pass the same value to both.
 */
export async function signHttpAuth(
  signer: HttpAuthSigner,
  url: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
): Promise<string> {
  const event = await signer.signEvent({
    kind: KIND_HTTP_AUTH,
    content: "",
    tags: [
      ["u", url],
      ["method", method],
    ],
    created_at: Math.floor(Date.now() / 1000),
  });
  return base64Utf8(JSON.stringify(event));
}

/** The header value a signed authorization goes out as. */
export function httpAuthHeader(base64Event: string): string {
  return `Nostr ${base64Event}`;
}
