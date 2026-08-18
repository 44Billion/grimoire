/**
 * Who is in a call — the shape every protocol folds down to.
 *
 * Two protocols answer "who is here" in completely different ways. Concord asks
 * its members, who announce themselves over the channel in sealed ephemeral
 * rumors (CORD-07 §4); NIP-29 asks the relay, which publishes a `kind:39004`
 * naming the participants of its own LiveKit room. What the stage renders is the
 * same in both cases: one tile per member, matched to an SFU identity.
 *
 * So the fold is here and the folding is not. Each protocol builds a `CallRoster`
 * from whatever it can prove, and everything downstream — tiles, speaking rings,
 * volumes, the screenshare spotlight — reads only this.
 *
 * `claims` is the part that looks like overkill until you know why it exists. An
 * SFU identity is visible to everyone in the room, so under Concord a member can
 * copy someone else's into their own presence; a contested identity therefore
 * vouches for nobody and its frames are keyed with random bytes. Under NIP-29
 * the relay mints every identity and binds the pubkey into it, so a claim is
 * single by construction and nothing ever renders unverified. One shape, two
 * trust models, and the renderer does not have to know which it is looking at.
 */

/** One member the roster proves is present. */
export interface RosterEntry {
  /** The member's pubkey (lowercase hex). */
  author: string;
  /** The SFU identity this member is connected as. */
  identity: string;
  /**
   * Where the call is being hosted, as this member announced it. Concord's §5
   * rendezvous hint; a NIP-29 space has exactly one host and never sets it.
   */
  broker?: string;
  /** Whether this member's hand is up. Concord only; no NIP-29 carrier exists. */
  hand: boolean;
  /** Millisecond ordering basis. */
  ms: number;
}

/** The folded view of one call's participants. */
export interface CallRoster {
  /** Present members, in a stable order every client computes identically. */
  present: RosterEntry[];
  /**
   * SFU identity → the members claiming it. A participant renders as a member
   * only when exactly ONE claimant holds its identity; contested or unclaimed
   * identities render as unverified.
   */
  claims: Map<string, string[]>;
}

/** The stable empty roster, so idle callers keep constant props. */
export const EMPTY_ROSTER: CallRoster = { present: [], claims: new Map() };

/** A transient in-call emoji, floated over whoever sent it. */
export interface CallReaction {
  /** The verified sender. */
  author: string;
  /** The emoji, or a `:shortcode:` resolved by {@link CallReaction.custom}. */
  emoji: string;
  /** The sender-chosen nonce — the fire-once key. */
  nonce: string;
  /** Millisecond stamp — the decay basis. */
  ms: number;
  /** The NIP-30 image behind a `:shortcode:`, when the sender named one. */
  custom?: { shortcode: string; url: string };
}

/**
 * The member verifiably behind an SFU identity, or undefined when the identity
 * is unclaimed or CONTESTED. A contested claim proves nothing about either
 * claimant, so all of them render as unverified until the stale claims age out.
 */
export function verifiedAuthorOf(
  roster: CallRoster,
  identity: string,
): string | undefined {
  const claimants = roster.claims.get(identity);
  return claimants && claimants.length === 1 ? claimants[0] : undefined;
}
