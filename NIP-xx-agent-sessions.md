NIP-xx
======

Agent Sessions
--------------

`draft` `optional`

## Abstract

Four kinds encode what an autonomous agent did: an **agent definition**, a **session head**, one **turn** per message, and an ephemeral **delta** while a turn is still being written.

The kinds are identical over every transport. A private copy is a NIP-59 rumor inside a gift wrap; a public copy is a plain signed event in a NIP-29 group. Only the envelope differs.

## Kinds

| kind    | class       | name             | notes |
| ------- | ----------- | ---------------- | ----- |
| `31779` | addressable | Agent Definition | One per `(pubkey, d)`; `d` is the agent's slug. |
| `31777` | addressable | Session Head     | One per `(pubkey, d)`; `d` is the session id. |
| `1777`  | regular     | Turn             | Append-only. A correction is a new turn, never an overwrite. |
| `21777` | ephemeral   | Delta            | Relays MUST NOT store it. Everything it carries is repeated in the turn that closes it. |

Envelopes are reused unchanged: `kind:1059` wrap with a `kind:13` seal (NIP-59), and `kind:21059` for a delta so the wrap is dropped with its payload.

### Kind allocation

The numbers are a family with `kind:777` (spells) and `kind:30777` (spellbooks). Checks performed before freezing them:

| Registry | Result |
| --- | --- |
| Upstream event-kind table (`nostr-protocol/nips` `README.md`, commit `656cecc7c0a815b6a2b218d3b5d6f078b3f4dbab`) | `1777`, `21777`, `31777` and `31779` all unassigned; nothing assigned in `1770`-`1789`, `21770`-`21779` or `31770`-`31789`. |
| nostrbook.dev (`https://nostrbook.dev/kinds/<n>`) | All four HTTP 404 — no entry. |

Both registries are advisory and neither reserves numbers, so an unregistered kind may still be in use by an unpublished client. An upstream assignment later would be a collision this NIP absorbs: the numbers are its own, and a reader that does not know them sees nothing it could misread.

## Agent Definition — `kind:31779`

Authored by the agent's own key. What the agent *is*, as opposed to what one run of it is doing.

| tag       | value | indexable | req |
| --------- | ----- | --------- | --- |
| `d`       | `<slug>` | yes | yes |
| `name`    | `<string>` | no | yes |
| `picture` | `<url>` | no | no |
| `about`   | `<string>` | no | no |
| `tool`    | `<tool-name>` | yes | no |
| `try`     | `<starter prompt>` | no | no |
| `alt`     | `<string>` ([NIP-31](31.md)) | no | yes |

`content` is `{"v":1, "instructions"?: <system prompt>, "tools"?: [{"name","description","parameters"}]}`.

`tool` is indexable, so `{"#tool":["nostr.req"]}` finds every agent that can do a thing. `instructions` is published verbatim or omitted entirely — a half-published prompt reads as the whole one.

```json
{
  "kind": 31779,
  "pubkey": "9e1f…agent",
  "content": "{\"v\":1,\"instructions\":\"You are Hex…\",\"tools\":[{\"name\":\"nostr.req\",\"description\":\"Query relays\",\"parameters\":{}}]}",
  "tags": [
    ["d", "hex"],
    ["name", "Hex"],
    ["about", "Answers questions about Nostr REQs."],
    ["tool", "nostr.req"],
    ["try", "what kinds does this relay serve?"],
    ["alt", "Hex — a Nostr agent answering REQ questions"]
  ]
}
```

## Session Head — `kind:31777`

One run's current state. `content` is a human-readable summary and MAY be empty.

| tag         | value | indexable | req |
| ----------- | ----- | --------- | --- |
| `d`         | `<session-id>` — 32 random bytes, hex; stable across every mirror | yes | yes |
| `title`     | `<string>` | no | yes |
| `status`    | `active`\|`idle`\|`awaiting-input`\|`payment-required`\|`done`\|`error`\|`aborted` | no | yes |
| `p`         | `<pubkey>`, `<relay>`, `operator` — exactly one | yes | yes |
| `p`         | `<pubkey>`, `<relay>`, `observer` | yes | no |
| `stream`    | `<transport>`, `<address>`, `<visibility>`; one per mirror | no | yes |
| `last-seq`  | highest turn `seq` on this stream | no | yes |
| `head`      | id of the newest turn | no | no |
| `turns`     | `<integer>` | no | yes |
| `started`   | `<unix-seconds>` — the real start, unaffected by NIP-59 | no | yes |
| `ended`     | `<unix-seconds>`; present iff `status` is terminal | no | no |
| `model`     | `<model-id>`, `<provider>` | no | no |
| `usage`     | `<in>`, `<out>`, `<cache-read>`, `<cache-write>` | no | no |
| `cost`      | `<amount>`, `<currency>` | no | no |
| `agent`     | `31779:<pubkey>:<slug>` | no | no |
| `alt`       | `<string>` | no | yes |

The last three statuses are terminal; `awaiting-input` and `payment-required` are [NIP-90](90.md)'s values verbatim. `<transport>` is `nip17`\|`nip29`\|`concord`.

**The head takes no `seq`.** It is addressable, so a relay deletes the version it supersedes — a sequence number it had consumed would name an event that is gone, and every later reader would see a hole it can never fill.

Wrapped, no relay can replace it, so a reader keeps the newest `created_at` per `(pubkey, d)`.

Because the head carries running `usage` and `cost`, an agent MAY publish heads and no turns at all: what a session spent then survives without any of what it said.

## Turn — `kind:1777`

One event per message: a user prompt, an assistant reply, or a tool result. `content` is a JSON array of **content blocks**, in order — the one place structure lives in `content` rather than in tags, because a turn's payload is a sequence, tags are a set, and tool arguments are arbitrary JSON with no honest tag encoding.

```
text        = { "type":"text",        "text": <string>, "truncated"?: <truncation> }
thinking    = { "type":"thinking",    "text": <string>, "truncated"?: <truncation> }
tool_call   = { "type":"tool_call",   "id","name", "arguments": <object>|null,
                                      "arguments_digest"?: <sha256> }
tool_result = { "type":"tool_result", "id","name", "ok": <bool>,
                                      "output": <string>|null,
                                      "ref"?: <blob-ref>, "truncated"?: <truncation> }
image       = { "type":"image",       "url","mime", "sha256"? }

truncation  = { "bytes", "sha256" }   // of the ORIGINAL
blob-ref    = { "sha256","url","size","mime",
                "encryption"?: { "algorithm":"aes-gcm","key","nonce","ox" } }
```

`arguments: null` with a digest means the call was too large to carry; the digest still names which call it was. `output: null` with a `ref` means the result was too large to inline.

| tag         | value | indexable | req |
| ----------- | ----- | --------- | --- |
| `a`         | `31777:<agent>:<session>`, `<relay>` — the only session pointer | yes | yes |
| `seq`       | per-stream counter, from 1 | no | yes |
| `prev`      | id of the event at `seq - 1`; omitted only at `seq` 1 | no | yes |
| `turn`      | logical turn index; an assistant reply and its tool results share it | no | yes |
| `role`      | `user`\|`assistant`\|`tool` | no | yes |
| `p`         | `<pubkey>`, `<relay>`, `<role>` — as on the head | yes | yes |
| `h`         | `<group-id>` — required on a NIP-29 mirror, forbidden elsewhere | yes | cond |
| `ms`        | `0`-`999`, strict decimal — sub-second refinement | no | no |
| `stop`      | `end_turn`\|`max_tokens`\|`tool_use`\|`content_filter`\|`error`; assistant only | no | no |
| `model`     | `<model-id>`, `<provider>`; assistant only | no | no |
| `usage`     | `<in>`, `<out>`, `<cache-read>`, `<cache-write>` | no | no |
| `cost`      | `<amount>`, `<currency>` | no | no |
| `tool`      | one per distinct tool in `content` | yes | no |
| `alt`       | plain-text rendering — what a client that cannot parse the blocks shows | no | yes |

```json
{
  "kind": 1777,
  "pubkey": "9e1f…agent",
  "created_at": 1755500118,
  "content": "[{\"type\":\"text\",\"text\":\"Found it. Running the tests.\"},{\"type\":\"tool_call\",\"id\":\"tc_01\",\"name\":\"Bash\",\"arguments\":{\"command\":\"npm test\"}}]",
  "tags": [
    ["a", "31777:9e1f…agent:3a7c…4e5f", "wss://relay.example"],
    ["seq", "46"], ["prev", "0c93…"], ["turn", "12"],
    ["role", "assistant"],
    ["p", "1a2b…human", "wss://relay.example", "operator"],
    ["stop", "tool_use"],
    ["model", "claude-opus-5", "anthropic"],
    ["usage", "18432", "921", "16000", "2432"],
    ["cost", "0.084", "USD"],
    ["tool", "Bash"],
    ["alt", "Assistant: found it. Calling Bash."]
  ]
}
```

## Delta — `kind:21777`

`content` is the raw appended fragment, empty for a `heartbeat`.

| tag         | value | indexable | req |
| ----------- | ----- | --------- | --- |
| `a`         | `31777:<agent>:<session>` | yes | yes |
| `h`         | `<group-id>` — the room this progress is for | yes | no |
| `turn`      | the turn being streamed | no | yes |
| `part`      | counter local to the turn, from 1, reset at turn start | no | yes |
| `delta`     | `text`\|`thinking`\|`tool`\|`heartbeat` | no | yes |
| `tool-id`   | required when `delta` is `tool` | no | cond |
| `p`         | `<pubkey>`, `<relay>`, `<role>` | yes | yes |

**A delta takes no `seq`.** Deltas evaporate at the relay; a number one had consumed would be a permanent hole. A `part` discontinuity means the reader discards that turn's partial buffer and waits for the turn.

An agent SHOULD coalesce deltas into fragments of at least 50 ms or 32 characters, MUST NOT emit one over 4 KiB, and MUST NOT emit one per token.

### Progress in the room that asked

An agent invoked from a message is being watched by people who are not reading its transcript. A `heartbeat` delta carrying that room's `h` tag says "this agent is working, and its transcript is at this `a`" — no content, no new kind, ordered by `part` like any other delta. An agent MAY send `thinking` deltas there instead when the room is meant to see them.

A group relay that does not accept `21777` leaves no live signal available. An agent SHOULD then acknowledge the request itself — a `kind:7` reaction on the message it is answering — because a room cannot otherwise tell being worked on from being ignored.

## Linking an Answer to Its Transcript

An agent that answers in a room publishes an ordinary message there — `kind:9` in a group, `kind:14` in a DM — and SHOULD carry `["a", "31777:<agent>:<session>"]` on it. A client that knows this NIP can then offer the transcript from the answer; one that does not ignores an unknown `a` tag, and the message renders as it always did.

This is the whole integration surface for an agent that already publishes plain chat messages: one tag, nothing else changed.

## Ordering

NIP-59 randomises a wrap's `created_at` up to two days back and a seal's up to an hour. Only the rumor's `created_at` is the agent's clock, and it is unsigned — a hint, not a proof. Order rests on `seq`, which is inside the sealed payload and covered by the seal's signature.

1. **Group by stream** = (`a` address, transport it arrived on). A private and a public copy of one session have **independent `seq` spaces** and MUST NOT be compared: a mirror need not carry every event, so a shared counter would hand its reader unfillable gaps.
2. **Sort by `seq`.** Only `kind:1777` carries one.
3. **Tie-break** on equal `seq`: lower `created_at`, then lower `ms`, then smaller event `id`. A duplicate `seq` SHOULD be surfaced — it is the visible signature of a replayed or forged event.
4. **Never sort by `created_at` across the wrap boundary.** A rumor more than 900 seconds in the future is displayed with its receipt time and flagged.
5. **Chain check.** `prev` names the event at `seq - 1`. A mismatch means the stream **forked**; a client MUST NOT silently merge the branches.

A gap is any missing `seq` below the head's `last-seq`. A client MUST render it explicitly rather than closing the hole, and MUST NOT block rendering on it. On a public transport it can be filled with `{"kinds":[1777],"#a":["31777:…"]}` and a local filter; on a wrapped transport inner tags are invisible to relays, so a gap surviving a full refetch of the wrap window is permanent and the client says so. This NIP deliberately mints no indexable counter: it would leak progress to a relay that can read nothing else.

## Transports

**Private (NIP-17/59).** The agent builds the rumor, seals it in a `kind:13` NIP-44-encrypted to each recipient and signed by its own key, and wraps the seal in a `kind:1059` — or `21059` for a delta — signed by a fresh throwaway key, `p`-tagged to the recipient, `created_at` randomised. One wrap per recipient, each under its own key. Recipient relays come from their `kind:10050`, else the NIP-65 inbox; a recipient with neither is undeliverable and MUST be reported, not skipped. The agent SHOULD self-wrap so it can re-read its own transcript. A relay sees a `1059` from a key that exists for one event: not the kind, the session, the agent, the sequence, or that this is an agent at all.

**Public (NIP-29).** Plain signed events with `["h","<group-id>"]`, published to the group's relay only. Group relays gate by `kind:39000`'s `supported_kinds`: if it does not list `1777`, publish each turn as a `kind:9` carrying the turn's `alt` and the same `a`, `seq` and `h` tags, which a client dedupes against the `1777` with the same `(a, seq)`. If `9` is absent too, the group is not a valid target and the agent MUST refuse the stream rather than publish into a black hole. Deltas SHOULD NOT be mirrored to a group unless it lists `21777` — the same constraint that decides whether progress in the room is possible at all.

**Concord.** The rumors are identical; the envelope is Concord's — a wrap authored by the plane's derived stream key, read back by `#channel`. Authorship inside is still the seal's signature.

Across mirrors the session id, `turn`, `role` and the `operator` `p` tag MUST be identical; `seq`, `last-seq` and `head` are per stream. A client merging two mirrors keys on `(session-id, turn, role, block-index)` — never the event id, which necessarily differs.

An agent decides what it puts in each stream. A public mirror is published as written, so an agent that must not leak a filesystem path, a tool argument or its own reasoning to a group MUST NOT put them in the events it sends there. A reader of one stream cannot tell whether another carries more.

## Identity and Trust

An agent has **one persistent key**, with a `kind:0` carrying `"bot": true` ([NIP-24](24.md)). The same key signs every head, turn and seal across every session and transport, so an agent is followable and its history is attributable.

Binding an agent to its operator is two-way, and both halves are required: the agent names its operator on the head and every turn, and the human `p`-tags each agent key in a [NIP-51](51.md) `kind:30000` set with `["d","agents"]`. One half alone is an unverified claim and MUST be rendered as such.

Anyone can publish a `1777` carrying any `a` tag; relays index tags, they do not police them. A client MUST therefore:

- **Check the author.** Discard any `1777`/`21777` whose `pubkey` is not the pubkey inside its own `a` address.
- **Check the seal.** For a wrapped copy the wrap's signature proves nothing — it is a throwaway key by design. The seal's signature is the authorship proof; reject a seal whose author is not the rumor's author.
- **Reject a second address.** Relays index every `a` tag, so an event carrying two is returned by a REQ for either. Accept exactly one.
- **Bound the counters.** `seq`, `turn`, `part`, `turns` and `last-seq` are attacker-supplied decimal strings, and `last-seq` bounds a walk over a stream's sequence numbers. Refuse a counter beyond a sane ceiling and cap how many missing numbers you will enumerate; otherwise one event is a remote out-of-memory.
- **Treat an orphan as an orphan.** A turn whose head is unknown is labelled as one.

In a NIP-29 group the events are signed directly, so the event signature is the proof. Relay membership (`kind:9000`/`9021`) is an authorization fact, never an identity one — cross-check the author against the head's pubkey as on the private path.

## Size

An event SHOULD stay under 64 KiB and MUST stay under 256 KiB; a wrapped copy is ~1.4× the rumor. `text` and `thinking` truncate at 8 KiB, a tool `output` at 16 KiB.

Truncation is explicit: the block gains `truncated` describing the **original**, and the retained text carries the marker `…[truncated]`, which a client MUST render. An oversize tool result is referenced instead — uploaded to a content-addressed store, `output: null` plus a `ref` whose `sha256` is over the plaintext and is authoritative; a client that fetches the blob MUST verify it. On a private stream the blob SHOULD be encrypted first, since the host would otherwise hold exactly the plaintext the wrap was protecting.

A publisher MUST NOT emit an event it knows exceeds the limit. When a turn is still too large, `thinking` is elided first, then every block is fitted against a total budget — an oversize `tool_call` drops its arguments for a digest that still names the call. A block there was no room for is replaced by a marker naming how many were omitted: a turn that quietly lost half its content reads as a whole one. A turn that cannot be fitted at all is split across several `1777` sharing a `turn` with consecutive `seq`.

## What a Minimal Client Must Implement

Read a public session:

1. `REQ {"kinds":[31777],"authors":[<agent>],"#d":[<session>]}` for the head.
2. `REQ {"kinds":[1777],"#a":["31777:<agent>:<session>"]}` for the transcript.
3. Discard events failing the author check.
4. Sort by `seq`; render `alt` when `content` will not parse.
5. Compare what is held against `last-seq` and show a gap marker.

Read a private session: subscribe `{"kinds":[1059],"#p":[<self>]}`, decrypt the wrap, decrypt the seal, check the seal's author, then continue from step 3. Deltas and `21059` are optional.

Publish: a persistent key with a `kind:0`, one head kept current, one `1777` per message carrying `a`/`seq`/`prev`/`turn`/`role`/`p`/`alt`, and a terminal head update. Definitions, deltas, blob refs and mirroring are all optional.

A client MUST NOT require deltas to render a session, nor blob fetching to render a turn.
