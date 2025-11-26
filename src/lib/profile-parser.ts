import { nip19 } from "nostr-tools";

export interface ParsedProfileCommand {
  pubkey: string;
}

/**
 * Parse PROFILE command arguments into a pubkey
 * Supports:
 * - npub1... (bech32 npub)
 * - nprofile1... (bech32 nprofile with relay hints)
 * - abc123... (64-char hex pubkey)
 * - nip05@domain.com (NIP-05 identifier - not implemented yet)
 */
export function parseProfileCommand(args: string[]): ParsedProfileCommand {
  const identifier = args[0];

  if (!identifier) {
    throw new Error("User identifier required");
  }

  // Try bech32 decode first (npub, nprofile)
  if (identifier.startsWith("npub") || identifier.startsWith("nprofile")) {
    try {
      const decoded = nip19.decode(identifier);

      if (decoded.type === "npub") {
        // npub1... -> pubkey
        return {
          pubkey: decoded.data,
        };
      }

      if (decoded.type === "nprofile") {
        // nprofile1... -> pubkey (ignore relays for now)
        return {
          pubkey: decoded.data.pubkey,
        };
      }
    } catch (error) {
      throw new Error(`Invalid bech32 identifier: ${error}`);
    }
  }

  // Check if it's a hex pubkey (64 chars, hex only)
  if (/^[0-9a-f]{64}$/i.test(identifier)) {
    return {
      pubkey: identifier.toLowerCase(),
    };
  }

  // Check if it's a NIP-05 identifier (user@domain.com)
  if (identifier.includes("@")) {
    throw new Error(
      "NIP-05 identifier lookup not yet implemented. Please use npub or hex pubkey.",
    );
  }

  throw new Error(
    "Invalid user identifier. Supported formats: npub1..., nprofile1..., or hex pubkey",
  );
}
