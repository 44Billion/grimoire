/**
 * Wallet Utilities
 *
 * Helper functions for working with wallet transactions and zap payments
 */

import { NostrEvent } from "@/types/nostr";
import { getOrComputeCachedValue } from "applesauce-core/helpers";
import { decode as decodeBolt11 } from "light-bolt11-decoder";

export interface ZapRequestInfo {
  sender: string; // pubkey of the zapper
  recipient?: string; // pubkey of the zapped user (from p tag)
  message: string; // zap message content
  zappedEventId?: string; // ID of the zapped event (from e tag)
  zappedEventAddress?: string; // Address of the zapped event (from a tag)
  amount?: number; // amount in sats (if available)
  zapRequestEvent: NostrEvent; // The full kind 9734 zap request event
}

// Symbol for caching parsed zap requests on transaction objects
const ZapRequestSymbol = Symbol("zapRequest");

/**
 * Try to parse a zap request JSON string into a ZapRequestInfo object
 * @param jsonString - The JSON string to parse
 * @returns ZapRequestInfo if valid zap request, null otherwise
 */
function tryParseZapRequestJson(jsonString: string): ZapRequestInfo | null {
  try {
    // Try to parse as JSON
    const parsed = JSON.parse(jsonString);

    // Check if it's a valid zap request (kind 9734)
    if (!parsed || typeof parsed !== "object" || parsed.kind !== 9734) {
      return null;
    }

    return zapRequestInfoFromObject(parsed);
  } catch {
    // Not JSON or parsing failed - not a zap request
    return null;
  }
}

/**
 * Build a ZapRequestInfo from a (possibly partial) zap request object
 * @param parsed - Object carrying at least a string pubkey
 * @param fallbackMessage - Message to use when the object has no content
 * @returns ZapRequestInfo, or null when there is no sender pubkey
 */
function zapRequestInfoFromObject(
  parsed: Record<string, unknown>,
  fallbackMessage?: string,
): ZapRequestInfo | null {
  if (typeof parsed.pubkey !== "string" || !parsed.pubkey) return null;

  const tags = Array.isArray(parsed.tags) ? (parsed.tags as string[][]) : [];
  const message =
    (typeof parsed.content === "string" && parsed.content) ||
    fallbackMessage ||
    "";

  // Normalize partial objects so renderers can rely on tags and content
  const event = {
    ...parsed,
    kind: 9734,
    tags,
    content: message,
  } as unknown as NostrEvent;

  // Extract zapped event from tags
  let zappedEventId: string | undefined;
  let zappedEventAddress: string | undefined;

  // Look for e tag (event ID)
  const eTag = tags.find(
    (tag) => Array.isArray(tag) && tag.length >= 2 && tag[0] === "e",
  );
  if (eTag && typeof eTag[1] === "string") {
    zappedEventId = eTag[1];
  }

  // Look for a tag (address/coordinate)
  const aTag = tags.find(
    (tag) => Array.isArray(tag) && tag.length >= 2 && tag[0] === "a",
  );
  if (aTag && typeof aTag[1] === "string") {
    zappedEventAddress = aTag[1];
  }

  // Look for p tag (recipient)
  const pTag = tags.find(
    (tag) => Array.isArray(tag) && tag.length >= 2 && tag[0] === "p",
  );
  const recipient =
    pTag && typeof pTag[1] === "string" && pTag[1] ? pTag[1] : undefined;

  return {
    sender: parsed.pubkey,
    recipient,
    message,
    zappedEventId,
    zappedEventAddress,
    zapRequestEvent: event,
  };
}

/**
 * Try to parse a zap request from NWC transaction metadata
 * Zap invoices commit to a description_hash, so the bolt11 carries no
 * description. Wallets like Alby Hub report the zap request in
 * `metadata.nostr` instead — sometimes only `{ pubkey, tags }`, with the
 * zap message in `metadata.comment`.
 *
 * @param metadata - The transaction's NWC metadata
 * @returns ZapRequestInfo if the metadata names a zapper, null otherwise
 */
function tryParseZapRequestMetadata(
  metadata: Record<string, unknown>,
): ZapRequestInfo | null {
  const comment =
    typeof metadata.comment === "string" ? metadata.comment : undefined;

  for (const key of ["nostr", "zap_request"]) {
    const value = metadata[key];

    if (typeof value === "string") {
      const result = tryParseZapRequestJson(value);
      if (result) return result;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      // Partial objects may omit kind; a present one must be a zap request
      if (obj.kind !== undefined && obj.kind !== 9734) continue;
      const result = zapRequestInfoFromObject(obj, comment);
      if (result) return result;
    }
  }

  return null;
}

/**
 * Try to parse a zap request from a transaction
 * Checks the transaction description, the NWC metadata, and the invoice description
 * Transaction descriptions for zaps contain a JSON-stringified kind 9734 event
 * Results are cached on the transaction object using applesauce pattern
 *
 * @param transaction - The transaction object with description, metadata and/or invoice field
 * @returns ZapRequestInfo if this is a zap payment, null otherwise
 */
export function parseZapRequest(transaction: {
  description?: string;
  invoice?: string;
  metadata?: Record<string, unknown>;
}): ZapRequestInfo | null {
  // Use applesauce caching pattern - cache result on transaction object
  return getOrComputeCachedValue(transaction, ZapRequestSymbol, () => {
    // Try parsing the transaction description first
    if (transaction.description) {
      const result = tryParseZapRequestJson(transaction.description);
      if (result) return result;
    }

    // Wallets that know the zap request report it in metadata
    if (transaction.metadata) {
      const result = tryParseZapRequestMetadata(transaction.metadata);
      if (result) return result;
    }

    // If that didn't work, try decoding the invoice and checking its description
    if (transaction.invoice) {
      try {
        const decoded = decodeBolt11(transaction.invoice);
        const descSection = decoded.sections.find(
          (s) => s.name === "description",
        );

        if (descSection && descSection.value) {
          const result = tryParseZapRequestJson(descSection.value as string);
          if (result) return result;
        }
      } catch {
        // Invoice decoding failed, ignore
      }
    }

    return null;
  });
}

// Symbol for caching invoice description on transaction objects
const InvoiceDescriptionSymbol = Symbol("invoiceDescription");

/**
 * Extract the description from a BOLT11 invoice
 * Results are cached on the transaction object using applesauce pattern
 *
 * @param transaction - The transaction object with invoice field
 * @returns The invoice description string, or undefined if not available
 */
export function getInvoiceDescription(transaction: {
  invoice?: string;
}): string | undefined {
  // Use applesauce caching pattern - cache result on transaction object
  return getOrComputeCachedValue(transaction, InvoiceDescriptionSymbol, () => {
    if (!transaction.invoice) return undefined;

    try {
      const decoded = decodeBolt11(transaction.invoice);
      const descSection = decoded.sections.find(
        (s) => s.name === "description",
      );

      if (descSection && "value" in descSection) {
        return String(descSection.value);
      }
    } catch {
      // Invoice decoding failed, ignore
    }

    return undefined;
  });
}
