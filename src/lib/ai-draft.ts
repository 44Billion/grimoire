/**
 * An event a model drafted, checked before it is ever shown as signable.
 *
 * Nothing here signs or publishes — see `src/actions/publish-draft.ts`, which
 * only runs from a button. The checks matter anyway: the arguments were shaped
 * by whatever the model read, and note text is untrusted. A card offering to
 * replace the user's follow list is the failure this file exists to prevent.
 */

/** A draft, as the card renders it and the publish action signs it. */
export interface EventDraft {
  kind: number;
  content: string;
  tags: string[][];
  /** Why this event, in the model's words. Shown on the card. */
  reason?: string;
}

/** Longest draft body. A model asked for a note, not a book. */
const MAX_DRAFT_CHARS = 8_000;
/** Most tags one draft carries. */
const MAX_DRAFT_TAGS = 64;

/**
 * Kinds refused outright, by name rather than by range.
 *
 * `0` and `3` are the user's identity and their follows: one clicked card must
 * not be able to rewrite either. `5` deletes. `4`, `13`, `1059` and `1060` are
 * encrypted and cannot be drafted as plaintext at all. `9734`/`9735` are the
 * zap path, which spends.
 */
const DENIED_KINDS = new Set([0, 3, 4, 5, 13, 1059, 1060, 9734, 9735]);

/**
 * Why a kind is refused, or undefined when it may be drafted.
 *
 * Only regular events (NIP-01: `1000..9999`, plus the low kinds that predate
 * the ranges) are draftable. Replaceable and addressable kinds overwrite
 * something the user already has, and ephemeral ones are protocol traffic, not
 * content — neither belongs behind a one-click button in a chat reply.
 */
export function refuseKind(kind: number): string | undefined {
  if (!Number.isInteger(kind) || kind < 0 || kind > 65_535) {
    return "kind must be an integer between 0 and 65535.";
  }
  if (DENIED_KINDS.has(kind)) {
    return `Kind ${kind} cannot be drafted here: it either replaces something you already have, spends, or must be encrypted. Offer the user a command instead.`;
  }
  if (kind >= 10_000 && kind <= 19_999) {
    return `Kind ${kind} is replaceable — publishing it overwrites the one you have. Offer the user a command instead.`;
  }
  if (kind >= 20_000 && kind <= 29_999) {
    return `Kind ${kind} is ephemeral: relays do not store it, so drafting one achieves nothing.`;
  }
  if (kind >= 30_000) {
    return `Kind ${kind} is addressable — publishing it replaces any event of the same kind and \`d\` tag. Offer the user a command instead.`;
  }
  return undefined;
}

/** Validate a model's draft arguments. Returns the error as data, never throws. */
export function sanitizeDraft(args: unknown): { error: string } | EventDraft {
  const { kind, content, tags, reason } = (args ?? {}) as {
    kind?: unknown;
    content?: unknown;
    tags?: unknown;
    reason?: unknown;
  };

  if (typeof kind !== "number") return { error: "kind must be a number." };
  const refusal = refuseKind(kind);
  if (refusal) return { error: refusal };

  if (typeof content !== "string")
    return { error: "content must be a string." };
  if (content.length > MAX_DRAFT_CHARS) {
    return { error: `content must be under ${MAX_DRAFT_CHARS} characters.` };
  }

  const parsedTags: string[][] = [];
  if (tags !== undefined) {
    if (!Array.isArray(tags)) {
      return { error: "tags must be an array of arrays of strings." };
    }
    if (tags.length > MAX_DRAFT_TAGS) {
      return { error: `at most ${MAX_DRAFT_TAGS} tags.` };
    }
    for (const tag of tags) {
      if (
        !Array.isArray(tag) ||
        tag.length === 0 ||
        !tag.every((value) => typeof value === "string") ||
        tag[0].length === 0
      ) {
        return {
          error:
            "each tag must be a non-empty array of strings whose first value names it.",
        };
      }
      parsedTags.push(tag as string[]);
    }
  }

  return {
    kind,
    content,
    tags: parsedTags,
    ...(typeof reason === "string" && reason.trim() ? { reason } : {}),
  };
}
