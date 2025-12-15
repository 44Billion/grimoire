import type { ProfileContent } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { NostrFilter } from "@/types/nostr";

export function derivePlaceholderName(pubkey: string): string {
  return `${pubkey.slice(0, 4)}:${pubkey.slice(-4)}`;
}

export function getTagValues(event: NostrEvent, tagName: string): string[] {
  return event.tags
    .filter((tag) => tag[0] === tagName && tag[1])
    .map((tag) => tag[1]);
}

export function getDisplayName(
  pubkey: string,
  metadata?: ProfileContent,
): string {
  if (metadata?.display_name) {
    return metadata.display_name;
  }
  if (metadata?.name) {
    return metadata.name;
  }
  return derivePlaceholderName(pubkey);
}

/**
 * Resolve $me and $contacts aliases in a Nostr filter (case-insensitive)
 * @param filter - Filter that may contain $me or $contacts aliases
 * @param accountPubkey - Current user's pubkey (for $me resolution)
 * @param contacts - Array of contact pubkeys (for $contacts resolution)
 * @returns Resolved filter with aliases replaced by actual pubkeys
 */
export function resolveFilterAliases(
  filter: NostrFilter,
  accountPubkey: string | undefined,
  contacts: string[],
): NostrFilter {
  const resolved = { ...filter };

  // Resolve aliases in authors array
  if (resolved.authors && resolved.authors.length > 0) {
    const resolvedAuthors: string[] = [];

    for (const author of resolved.authors) {
      const normalized = author.toLowerCase();
      if (normalized === "$me") {
        if (accountPubkey) {
          resolvedAuthors.push(accountPubkey);
        }
      } else if (normalized === "$contacts") {
        resolvedAuthors.push(...contacts);
      } else {
        resolvedAuthors.push(author);
      }
    }

    // Deduplicate
    resolved.authors = Array.from(new Set(resolvedAuthors));
  }

  // Resolve aliases in #p tags array
  if (resolved["#p"] && resolved["#p"].length > 0) {
    const resolvedPTags: string[] = [];

    for (const pTag of resolved["#p"]) {
      const normalized = pTag.toLowerCase();
      if (normalized === "$me") {
        if (accountPubkey) {
          resolvedPTags.push(accountPubkey);
        }
      } else if (normalized === "$contacts") {
        resolvedPTags.push(...contacts);
      } else {
        resolvedPTags.push(pTag);
      }
    }

    // Deduplicate
    resolved["#p"] = Array.from(new Set(resolvedPTags));
  }

  // Resolve aliases in #P tags array (uppercase P, e.g., zap senders)
  if (resolved["#P"] && resolved["#P"].length > 0) {
    const resolvedPTagsUppercase: string[] = [];

    for (const pTag of resolved["#P"]) {
      const normalized = pTag.toLowerCase();
      if (normalized === "$me") {
        if (accountPubkey) {
          resolvedPTagsUppercase.push(accountPubkey);
        }
      } else if (normalized === "$contacts") {
        resolvedPTagsUppercase.push(...contacts);
      } else {
        resolvedPTagsUppercase.push(pTag);
      }
    }

    // Deduplicate
    resolved["#P"] = Array.from(new Set(resolvedPTagsUppercase));
  }

  return resolved;
}
