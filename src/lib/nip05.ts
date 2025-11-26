import { queryProfile } from "nostr-tools/nip05";

/**
 * NIP-05 Identifier Resolution
 * Resolves user@domain identifiers to Nostr pubkeys using nostr-tools
 */

/**
 * Check if a string looks like a NIP-05 identifier (user@domain)
 */
export function isNip05(value: string): boolean {
  if (!value) return false;
  // Must match user@domain format
  return /^[a-zA-Z0-9._-]+@[a-zA-Z0-9][\w.-]+\.[a-zA-Z]{2,}$/.test(value);
}

/**
 * Resolve a NIP-05 identifier to a pubkey using nostr-tools
 * @param nip05 - The NIP-05 identifier (user@domain or _@domain)
 * @returns The hex pubkey or null if resolution fails
 */
export async function resolveNip05(nip05: string): Promise<string | null> {
  if (!isNip05(nip05)) return null;

  try {
    const profile = await queryProfile(nip05);

    if (!profile?.pubkey) {
      console.warn(`NIP-05: No pubkey found for ${nip05}`);
      return null;
    }

    console.log(`NIP-05: Resolved ${nip05} → ${profile.pubkey}`);
    return profile.pubkey.toLowerCase();
  } catch (error) {
    console.warn(`NIP-05: Resolution failed for ${nip05}:`, error);
    return null;
  }
}

/**
 * Resolve multiple NIP-05 identifiers in parallel
 */
export async function resolveNip05Batch(
  identifiers: string[],
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  await Promise.all(
    identifiers.map(async (nip05) => {
      const pubkey = await resolveNip05(nip05);
      if (pubkey) {
        results.set(nip05, pubkey);
      }
    }),
  );

  return results;
}
