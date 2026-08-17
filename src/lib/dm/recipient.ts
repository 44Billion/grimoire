/**
 * npub / nprofile → hex, or null.
 *
 * Its own module so the dialog file exports components only — React Fast
 * Refresh cannot hot-reload a file that mixes the two.
 *
 * Deliberately narrow: bare hex is not accepted, because a 64-character hex
 * string is as plausibly an event id, and opening a private conversation with
 * a stranger because someone pasted the wrong thing is the wrong failure. Same
 * rule the `chat` command follows.
 */

import { nip19 } from "nostr-tools";

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
