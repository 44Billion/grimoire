import { nip19 } from "nostr-tools";

export interface ParsedDecodeCommand {
  bech32: string;
}

export type DecodedData =
  | { type: "npub"; data: string }
  | { type: "note"; data: string }
  | { type: "nsec"; data: string }
  | { type: "nprofile"; data: nip19.ProfilePointer }
  | { type: "nevent"; data: nip19.EventPointer }
  | { type: "naddr"; data: nip19.AddressPointer };

/**
 * Parse DECODE command arguments
 *
 * Example:
 *   decode npub1...
 *   decode nevent1...
 */
export function parseDecodeCommand(args: string[]): ParsedDecodeCommand {
  if (args.length !== 1) {
    throw new Error("Usage: DECODE <bech32-identifier>");
  }

  const bech32 = args[0];

  // Validate it's a nostr bech32 (starts with n and is reasonably long)
  if (!bech32.startsWith("n") || bech32.length < 20) {
    throw new Error("Invalid nostr bech32 identifier");
  }

  return { bech32 };
}

/**
 * Decode a nostr bech32 identifier
 */
export function decodeNostr(bech32: string): DecodedData {
  try {
    const decoded = nip19.decode(bech32);
    return decoded as DecodedData;
  } catch (error) {
    throw new Error(
      `Failed to decode: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

/**
 * Re-encode with updated relays
 */
export function reencodeWithRelays(
  decoded: DecodedData,
  relays: string[],
  originalBech32?: string,
): string {
  switch (decoded.type) {
    case "npub":
      // Upgrade to nprofile with relays
      return nip19.nprofileEncode({
        pubkey: decoded.data,
        relays,
      });

    case "nprofile":
      // Update relays
      return nip19.nprofileEncode({
        ...decoded.data,
        relays,
      });

    case "note":
      // Upgrade to nevent with relays
      return nip19.neventEncode({
        id: decoded.data,
        relays,
      });

    case "nevent":
      // Update relays
      return nip19.neventEncode({
        ...decoded.data,
        relays,
      });

    case "naddr":
      // Update relays
      return nip19.naddrEncode({
        ...decoded.data,
        relays,
      });

    case "nsec":
      // nsec doesn't support relays, return original
      return originalBech32 || nip19.nsecEncode(decoded.data as any);

    default:
      throw new Error(
        `Unsupported type for re-encoding: ${(decoded as any).type}`,
      );
  }
}
