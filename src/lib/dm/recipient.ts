/**
 * Turning something a person typed into someone to write to.
 *
 * Three forms, and the reason for each: `npub`/`nprofile` because that is what
 * gets pasted, NIP-05 because that is what people say out loud, and a name
 * because the person you want is usually already someone you have seen.
 *
 * Bare hex is deliberately absent. A 64-character hex string is as plausibly
 * an event id, and opening a private conversation with a stranger because
 * someone pasted the wrong thing is the wrong failure — the same rule the
 * `chat` command follows.
 *
 * Its own module so component files export components only: React Fast Refresh
 * cannot hot-reload a file that mixes the two.
 */

import { nip19 } from "nostr-tools";
import { isNip05, resolveNip05 } from "@/lib/nip05";

/** npub / nprofile → hex, or null. Synchronous: nothing to look up. */
export function resolveRecipient(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  try {
    const decoded = nip19.decode(value);
    if (decoded.type === "npub") return decoded.data;
    if (decoded.type === "nprofile") return decoded.data.pubkey;
  } catch {
    return null;
  }
  return null;
}

/** Whether this looks like something {@link resolveRecipientAsync} can use. */
export function looksLikeRecipient(input: string): boolean {
  const value = input.trim();
  return (
    value.startsWith("npub1") || value.startsWith("nprofile1") || isNip05(value)
  );
}

/**
 * npub, nprofile, or NIP-05 → hex.
 *
 * NIP-05 costs a network round trip to the domain's `.well-known`, so this is
 * async and the synchronous form above stays for the paste-and-go path.
 */
export async function resolveRecipientAsync(
  input: string,
): Promise<string | null> {
  const direct = resolveRecipient(input);
  if (direct) return direct;

  const value = input.trim();
  if (isNip05(value)) return resolveNip05(value);

  return null;
}
