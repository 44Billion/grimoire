# Agent sessions

An autonomous agent's work, as Nostr events. Five kinds, specified in
[`spec/nip-agent-sessions.md`](https://github.com/purrgrammer/hex/blob/main/spec/nip-agent-sessions.md)
in the **hex** repository — the spec lives beside the daemon that has to satisfy
it, and grimoire is a client of it. This file is the map of where the client
code lives and which decisions are load-bearing.

Hex: `github.com/purrgrammer/hex`, or over Nostr at
`nostr://npub107jk7htfv243u0x5ynn43scq9wrxtaasmrwwa8lfu2ydwag6cx2quqncxg/nos.lol/hex`.

| Kind    | What        | Written by |
| ------- | ----------- | ---------- |
| `31779` | Agent Definition — a standing description, or a snapshot of one run | agent |
| `31777` | Session Head — where a run currently stands | agent |
| `1777`  | Turn — one message, append-only | agent |
| `1779`  | Session Control — answer, steer, stop, compact, clear | **operator** |
| `21777` | Delta — a fragment of a turn still being written | agent |

Everything arrives gift-wrapped, so nothing here is a public event and no relay
filter can see any of it.

## Where it lives

| Concern | File |
| --- | --- |
| Kind numbers, and the note not to renumber | `src/lib/agent-session/kinds.ts` |
| Wire types and part types | `src/lib/agent-session/types.ts` |
| **Decoding, which is the security boundary** | `src/lib/agent-session/decode.ts` |
| `seq` ordering, gaps, forks | `src/lib/agent-session/order.ts` |
| Reading sessions out of Dexie | `src/services/agent-store.ts` |
| Live deltas (ephemeral, never stored) | `src/services/agent-delta-store.ts` |
| Sending a control event | `src/services/agent-control.ts` |
| Optimistic previews of a control event, until a fact confirms it | `src/services/agent-intents.ts` |
| The window | `src/components/agent/AgentSessionViewer.tsx` |
| Sessions nested under a chat message | `src/components/agent/MessageSessions.tsx` |

The publisher is a different repository entirely — hex, linked above. The
encoder is duplicated there deliberately, because a client and a daemon that
share a module share a release, and kept honest by golden vectors that are
byte-identical in both trees (`__fixtures__/agent-vectors.json` here,
`src/nostr/__fixtures__/agent-vectors.json` there). Nothing under
`src/lib/agent-session/` may import from the rest of `src/`: the other copy runs
under Node with no browser globals and no repo around it.

## The four things worth knowing before changing any of it

**Everything rides the DM pipeline.** Agent kinds are in `DM_AGENT_KINDS`
(`src/services/dm-store.ts`) but deliberately not in `DM_ROW_KINDS`, so they
inherit wrap dedupe, waved decryption, backfill and the doorbell — and cannot
appear in, bump, or badge a conversation. There is one ingest, started once at
`AppShell`, not per window.

**Order comes from `seq`, never from a clock.** A wrap's `created_at` is
randomised up to two days back, so it is meaningless for ordering. Only turns
carry `seq`; a head is replaceable and a delta evaporates, so neither may consume
one — a number whose event the protocol itself removes is a hole no reader can
ever fill.

**Authorship is checked at decode, not at render.** An event's author must match
the pubkey inside its own `a` address, and for a wrapped copy the *seal* is the
proof — the wrap is signed by a throwaway key by design. A control event has a
second check on top: it is honoured only from the pubkey the head names as
`operator`. It must be impossible to render, or act on, anything that did not
pass through `decode.ts`.

**A session waiting on a person looks exactly like a finished one** to the
runtime that reports it. The only thing separating them is the head's `input`
tags. Anything that infers "done" from an end-of-turn signal is wrong, and was
wrong in this codebase for a while: `awaiting-input` was set and then overwritten
milliseconds later by the epilogue.

## Deltas

Ephemeral `21059` wraps, subscribed separately and never written to Dexie. A DM
inbox relay is entitled to refuse kind 21059 — real ones do — so the head names
where they actually go in `delta-relay` tags, and the reader listens there as
well as on its own inbox. A missed delta costs nothing: everything it carried is
repeated in the turn that closes it.

## Intents

A control event never becomes a turn — `agent-store.ts`'s `STORED_KINDS`
deliberately excludes `1779` — so a steer, a stop or an answer produces nothing
the transcript can show until the agent reacts to it: a `user` turn echoing a
steer, a request leaving the head's `pending` list, a status moving off
`active`. `agent-intents.ts` is the operator-side mirror of a delta: this tab's
own memory of what it just sent, held only in memory, shown at reduced opacity
by `PendingIntentBody` and inline in `InputRequestRow`, and dropped the moment
`AgentSessionViewer` reads a fact that confirms it. Nothing here rides the wire
and nothing survives a reload — a fresh read of the session is always the
truth.
