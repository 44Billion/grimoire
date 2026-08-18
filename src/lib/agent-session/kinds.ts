/**
 * Agent-session event kinds (NIP-xx: Agent Sessions).
 *
 * The transcript of an autonomous agent, as events. Numbered as a family with
 * grimoire's kind-777 "Spells" draft.
 *
 * DO NOT RENUMBER. Once a session has been published, its `a` tags name
 * `31777:<pubkey>:<session>` forever; changing a number orphans every
 * transcript already on a relay.
 *
 * The envelope is never reinvented: a private copy is a rumor inside the
 * ordinary NIP-59 stack (`1059` wrap, `13` seal), an ephemeral one swaps the
 * wrap for `21059` so the relay drops it with its payload, and a Concord plane
 * uses Concord's own stream envelope. Only `1777`/`1778`/`21777`/`31777`/`31779`
 * are this NIP's.
 */

/** Agent Definition — addressable, `d` = agent slug. What the agent *is*. */
export const KIND_AGENT_DEFINITION = 31779;

/** Session Head — addressable, `d` = session id. What one run currently is. */
export const KIND_SESSION_HEAD = 31777;

/** Session Turn — regular, append-only. A correction is a new turn. */
export const KIND_TURN = 1777;

/** Milestone — regular. Coarse progress a late joiner can still fetch. */
export const KIND_MILESTONE = 1778;

/**
 * Delta — ephemeral. Token-level output; relays MUST NOT store it. Everything a
 * delta carries is repeated in the `1777` that closes the turn, so a client that
 * missed one has lost nothing but liveness.
 */
export const KIND_DELTA = 21777;

/** Every kind this NIP defines. */
export const AGENT_SESSION_KINDS = [
  KIND_AGENT_DEFINITION,
  KIND_SESSION_HEAD,
  KIND_TURN,
  KIND_MILESTONE,
  KIND_DELTA,
] as const;

/**
 * The kinds that carry stream sequence. `seq`, `prev`, `last-seq` and gap
 * detection apply to these and never to a delta: deltas evaporate at the relay,
 * so if they burned sequence numbers every stored transcript would show holes
 * below `last-seq` forever, and a reader could not tell "that seq was a delta"
 * from "history is missing".
 */
export const SEQUENCED_KINDS = [
  KIND_SESSION_HEAD,
  KIND_TURN,
  KIND_MILESTONE,
] as const;

/** Kinds a private stream stores (and therefore hands to the DM pipeline). */
export const STORED_AGENT_KINDS = [
  KIND_AGENT_DEFINITION,
  KIND_SESSION_HEAD,
  KIND_TURN,
  KIND_MILESTONE,
] as const;

export function isAgentSessionKind(kind: number): boolean {
  return (AGENT_SESSION_KINDS as readonly number[]).includes(kind);
}
