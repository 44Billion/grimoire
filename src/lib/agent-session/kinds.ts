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
 * The envelope is never reinvented: a copy is a rumor inside the ordinary NIP-59
 * stack (`1059` wrap, `13` seal), and an ephemeral one swaps the wrap for
 * `21059` so the relay drops it with its payload. Only `1777`/`21777`/`31777`/
 * `31779` are this NIP's.
 */

/** Agent Definition — addressable, `d` = agent slug. What the agent *is*. */
export const KIND_AGENT_DEFINITION = 31779;

/** Session Head — addressable, `d` = session id. What one run currently is. */
export const KIND_SESSION_HEAD = 31777;

/** Session Turn — regular, append-only. A correction is a new turn. */
export const KIND_TURN = 1777;

/**
 * Session Control — regular, authored by the OPERATOR rather than the agent.
 *
 * The only kind here that makes an agent act rather than describing what it did,
 * which is why its authorisation is a decode-time rule: it is honoured only from
 * the pubkey the session's own head names as `operator`.
 *
 * One kind carrying a `command` tag rather than a kind per verb, for the same
 * reason a turn carries `role`. The usual argument for splitting — that a relay
 * can filter on kind — buys nothing: the channel is wrapped, so no relay sees
 * any of it.
 */
export const KIND_SESSION_CONTROL = 1779;

/**
 * Delta — ephemeral. Token-level output; relays MUST NOT store it. Everything a
 * delta carries is repeated in the `1777` that closes the turn, so a client that
 * missed one has lost nothing but liveness.
 */
export const KIND_DELTA = 21777;

/**
 * 1778 is deliberately unused. It held a "milestone" — a coarse stored progress
 * line — until it turned out to restate what the turn beside it already said.
 * What it alone could carry moved onto the head's `status`. Burned rather than
 * recycled, so a reader that once saw one never mistakes a later kind for it.
 */

/*
 * There were four lists here — every kind, the sequenced ones, the stored ones,
 * and a predicate over the first — and nothing imported any of them. The real
 * answers live where they are used and are not the same question: the DM
 * pipeline keeps `DM_AGENT_KINDS` (`src/services/dm-store.ts`), the store keeps
 * `STORED_KINDS` (`src/services/agent-store.ts`), and only turns carry `seq`,
 * which `order.ts` knows because it only ever reads turns.
 *
 * Two of the four also disagreed with hex's copies — they omitted `1779`, so
 * `isAgentSessionKind` denied that a control event was part of the protocol it
 * defines. An unused list that is wrong is worse than no list: the next caller
 * to reach for one inherits the mistake.
 */
