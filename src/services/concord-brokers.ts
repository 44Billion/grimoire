/**
 * Which blind brokers this client will start a call through (CORD-07 §2/§5).
 *
 * Consulted only when a room is EMPTY. Once anyone is present their announced
 * broker wins the rendezvous, so this is a bootstrap list rather than a
 * preference that overrides the call.
 *
 * The default is a hardcoded origin, which the no-hardcoded-relays rule
 * otherwise forbids — the same documented exception as CORD-05's stock relay
 * set, and for the same reason: a broker is protocol infrastructure a client
 * must be able to reach before it knows anything, and there is no directory to
 * discover one from. It is blind by construction (it cannot tell which community
 * a room belongs to, or who is joining), it never sees plaintext media, and a
 * member who would rather not use it can name their own.
 */

const DEFAULT_BROKER = "https://armada.buzz";

/** Where the member's own preference lives, until Settings owns it. */
const PREF_KEY = "concord.voiceBroker";

/** The member's preferred broker origin, if they have named one. */
export function preferredBroker(): string | undefined {
  try {
    return localStorage.getItem(PREF_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Name a broker, or clear the preference by passing nothing. */
export function setPreferredBroker(origin?: string): void {
  try {
    if (origin) localStorage.setItem(PREF_KEY, origin);
    else localStorage.removeItem(PREF_KEY);
  } catch {
    // A blocked localStorage costs the preference, never the call.
  }
}

/** Our own candidates, in preference order: the member's first, then the default. */
export function preferredBrokers(): string[] {
  const own = preferredBroker();
  return own ? [own, DEFAULT_BROKER] : [DEFAULT_BROKER];
}

export { DEFAULT_BROKER };
