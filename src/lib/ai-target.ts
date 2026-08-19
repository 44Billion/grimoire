/**
 * What an `ai` window is grounded in.
 *
 * A leaf module on purpose: the man pages import the `ai` parser, the parser
 * needs to classify a target, and `ai-context` needs the man pages to list the
 * commands a model may propose. Keeping this free of imports is what stops that
 * from becoming a cycle — a cycle would leave the prompt half-built at module
 * init, which no build step would catch.
 */

export type AiTargetKind = "event" | "kind" | "nip";

export interface AiTarget {
  type: AiTargetKind;
  /** Bech32 entity, kind number, or NIP id, as typed. */
  value: string;
}

/**
 * Classify a bare `ai` argument. `nip-01`/`nip01` and a plain number are
 * unambiguous; anything bech32 is an event or a profile.
 */
export function parseAiTarget(token: string): AiTarget | undefined {
  const value = token.trim();
  if (!value) return undefined;

  const nip = /^nip-?([0-9a-z]{1,3})$/i.exec(value);
  if (nip) return { type: "nip", value: nip[1].toUpperCase().padStart(2, "0") };

  if (/^(kind-?)?\d{1,5}$/i.test(value)) {
    return { type: "kind", value: value.replace(/^kind-?/i, "") };
  }

  if (/^(nostr:)?(npub|nprofile|note|nevent|naddr)1/.test(value)) {
    return { type: "event", value };
  }

  return undefined;
}
