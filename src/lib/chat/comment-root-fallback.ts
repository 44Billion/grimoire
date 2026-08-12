import { getAddressPointerFromATag } from "applesauce-core/helpers/pointers";
import { getCommentRootPointer } from "applesauce-common/helpers/comment";
import type { AddressPointer } from "nostr-tools/nip19";
import type { NostrEvent } from "@/types/nostr";

/**
 * Root scope of a kind 1111 comment recovered without the uppercase K tag.
 * NIP-22 requires K, but clients omit it and the kind is derivable elsewhere:
 * from the A tag itself, or from the root event once fetched.
 */
export type LooseCommentRoot =
  | { type: "address"; address: AddressPointer }
  | { type: "event"; id: string; relay?: string; pubkey?: string }
  | { type: "external"; identifier: string };

/** Reads the A/E/I root tags of a comment, ignoring the missing K tag */
export function getLooseCommentRoot(
  comment: NostrEvent,
): LooseCommentRoot | null {
  const aTag = comment.tags.find((t) => t[0] === "A");
  if (aTag) {
    const address = getAddressPointerFromATag(aTag);
    if (address) return { type: "address", address };
  }

  const eTag = comment.tags.find((t) => t[0] === "E");
  if (eTag?.[1]) {
    const rootPubkey = comment.tags.find((t) => t[0] === "P")?.[1];
    return {
      type: "event",
      id: eTag[1],
      relay: eTag[2] || undefined,
      pubkey: eTag[3] || rootPubkey || undefined,
    };
  }

  const iTag = comment.tags.find((t) => t[0] === "I")?.[1];
  if (iTag) return { type: "external", identifier: iTag };

  return null;
}

/**
 * Returns a copy of the comment with the omitted uppercase K/P root tags filled
 * in, so applesauce's factories can read its root scope. Tag source only — the
 * copy's signature no longer matches, so never store or publish it.
 */
export function withRootScopeTags(
  comment: NostrEvent,
  rootKind?: string,
): NostrEvent {
  if (comment.kind !== 1111) return comment;
  if (getCommentRootPointer(comment)) return comment;

  const root = getLooseCommentRoot(comment);
  if (!root) return comment;

  const kind = root.type === "address" ? String(root.address.kind) : rootKind;
  if (!kind) return comment;

  const tags = [...comment.tags, ["K", kind]];
  if (
    root.type === "event" &&
    root.pubkey &&
    !comment.tags.some((t) => t[0] === "P")
  )
    tags.push(["P", root.pubkey]);

  // Rebuilt field by field: spreading would carry over applesauce's cached
  // "no root pointer" symbol and the patched tags would be ignored.
  return {
    id: comment.id,
    kind: comment.kind,
    pubkey: comment.pubkey,
    created_at: comment.created_at,
    content: comment.content,
    sig: comment.sig,
    tags,
  };
}
