NIP-xx
======

Agent Sessions
--------------

`draft` `optional`

## Abstract

Four kinds encode what an autonomous agent did: an **agent definition**, a **session head**, one **turn** per message, and an ephemeral **delta** while a turn is still being written.

They are rumors, carried as NIP-59 gift wraps to whoever is meant to read them. A turn's shape — a `role` and an ordered list of `parts`, each `text`, `reasoning`, a tool call or its result — is the shape an agent runtime already has, so publishing is a mapping rather than a translation. Nothing here depends on that envelope — a transport that carries the same rumors carries the same session — but this document specifies only the wrapped case, because that is the only one with an implementation behind it.

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

Both registries are advisory and neither reserves numbers, so an unregistered kind may still be in use by an unpublished client.

## Agent Definition — `kind:31779`

Authored by the agent's own key. What the agent *is*, as opposed to what one run of it is doing.

**`content` is the system prompt itself** — plain text, nothing wrapping it, so anyone reading the raw event reads what the agent was told. It is published whole or left empty; a half-published prompt reads as the whole one. Everything else is a tag, `v` included, so a later revision of this shape is a version bump rather than a parse fork.

| tag       | value | indexable | req |
| --------- | ----- | --------- | --- |
| `d`       | `<slug>` | yes | yes |
| `v`       | `1` — the revision of this shape | no | yes |
| `name`    | `<string>` | no | yes |
| `picture` | `<url>` | no | no |
| `about`   | `<string>` | no | no |
| `tool`    | `<tool-name>`, `<description>`, `<parameters>` | yes | no |
| `try`     | `<starter prompt>` | no | no |
| `alt`     | `<string>` ([NIP-31](31.md)) | no | yes |

`tool` is indexable, so `{"#tool":["nostr.req"]}` finds every agent that can do a thing. Trailing elements are dropped when absent: a bare tool is a two-element tag, a fully described one is four. `<parameters>` is the tool's schema — usually JSON Schema — as a JSON string, which is the price of the content being prose rather than a document. A reader that cannot parse it treats the tool as having no schema rather than discarding the tool.

```json
{
  "kind": 31779,
  "pubkey": "9e1f…agent",
  "content": "You are Hex. Answer with a REQ filter when one will do.",
  "tags": [
    ["d", "hex"],
    ["v", "1"],
    ["name", "Hex"],
    ["about", "Answers questions about Nostr REQs."],
    ["tool", "nostr.req", "Query relays", "{\"type\":\"object\",\"properties\":{\"kinds\":{\"type\":\"array\"}}}"],
    ["try", "what kinds does this relay serve?"],
    ["alt", "Hex — a Nostr agent answering REQ questions"]
  ]
}
```

## Session Head — `kind:31777`

One run's current state. `content` is a human-readable summary and MAY be empty.

| tag        | value | indexable | req |
| ---------- | ----- | --------- | --- |
| `d`        | `<session-id>` — 32 random bytes, hex | yes | yes |
| `title`    | `<string>` | no | yes |
| `status`   | `active`\|`idle`\|`awaiting-input`\|`payment-required`\|`done`\|`error`\|`aborted` | no | yes |
| `p`        | `<pubkey>`, `<relay>`, `operator` — exactly one | yes | yes |
| `p`        | `<pubkey>`, `<relay>`, `observer` | yes | no |
| `e`        | `<event-id>`, `<relay>`, `trigger` — the message that started this run | yes | no |
| `last-seq` | the highest turn `seq` so far, which is also the turn count | no | yes |
| `started`  | `<unix-seconds>` — the real start, unaffected by NIP-59 | no | yes |
| `ended`    | `<unix-seconds>`; present iff `status` is terminal | no | no |
| `model`    | `<model-id>`, `<provider>` | no | no |
| `usage`    | `<in>`, `<out>`, `<cache-read>`, `<cache-write>` | no | no |
| `cost`     | `<amount>`, `<currency>` | no | no |
| `agent`    | `31779:<pubkey>:<slug>` | no | no |
| `alt`      | `<string>` | no | yes |

The last three statuses are terminal; `awaiting-input` and `payment-required` are [NIP-90](90.md)'s values verbatim.

**The head takes no `seq`.** It is addressable, so a relay deletes the version it supersedes — a sequence number it had consumed would name an event that is gone, and every later reader would see a hole it can never fill. Wrapped, no relay can replace it either, so a reader keeps the newest `created_at` per `(pubkey, d)`.

Because the head carries running `usage` and `cost`, an agent MAY publish heads and no turns at all: what a session spent then survives without any of what it said.

## Turn — `kind:1777`

One event per message: a user prompt, an assistant reply, or a tool result. `content` is a JSON array of **parts**, in order — the one place structure lives in `content` rather than in tags, because a turn's payload is a sequence, tags are a set, and tool arguments are arbitrary JSON with no honest tag encoding.

```
text        = { "type":"text",        "text": <string>, "truncated"?: <truncation> }
reasoning   = { "type":"reasoning",   "text": <string>, "truncated"?: <truncation> }
tool_call   = { "type":"tool_call",   "id","name", "arguments": <object>|null,
                                      "arguments_digest"?: <sha256> }
tool_result = { "type":"tool_result", "id","name", "ok": <bool>,
                                      "output": <string>|null,
                                      "ref"?: <blob-ref>, "truncated"?: <truncation> }
image       = { "type":"image",       "url","mime", "sha256"? }

truncation  = { "bytes", "sha256" }          // of the ORIGINAL
blob-ref    = { "sha256","url","size","mime" }
```

`arguments: null` with a digest means the call was too large to carry; the digest still names which call it was. `output: null` with a `ref` means the result was too large to inline.

**The list of part types is open.** Those five are the ones this revision defines and the ones a client should implement; an agent MAY emit others. A client MUST keep a part whose `type` it does not recognise, render what it can around it, and MUST NOT discard the turn — a turn from a later revision is still most of a turn.

| tag     | value | indexable | req |
| ------- | ----- | --------- | --- |
| `a`     | `31777:<agent>:<session>`, `<relay>` — the only session pointer | yes | yes |
| `seq`   | counter, from 1 | no | yes |
| `prev`  | id of the event at `seq - 1`; omitted only at `seq` 1 | no | yes |
| `turn`  | logical turn index; an assistant reply and its tool results share it | no | yes |
| `role`  | `user`\|`assistant`\|`tool` | no | yes |
| `p`     | `<pubkey>`, `<relay>`, `<role>` — as on the head | yes | yes |
| `stop`  | `end_turn`\|`max_tokens`\|`tool_use`\|`content_filter`\|`error`; assistant only | no | no |
| `model` | `<model-id>`, `<provider>`; assistant only | no | no |
| `usage` | `<in>`, `<out>`, `<cache-read>`, `<cache-write>` | no | no |
| `cost`  | `<amount>`, `<currency>` | no | no |
| `tool`  | one per distinct tool in `content` | yes | no |
| `alt`   | plain-text rendering — what a client that cannot parse the parts shows | no | yes |

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

What tells a reader the agent is working before the turn lands. `content` is the raw appended fragment: prose for `text`, the model's own words for `reasoning`, the tool call's arguments as they stream for `tool` (with `tool-id` naming the call), and empty for `heartbeat`, which asserts only that the agent is alive.

| tag       | value | indexable | req |
| --------- | ----- | --------- | --- |
| `a`       | `31777:<agent>:<session>` | yes | yes |
| `turn`    | the turn being streamed | no | yes |
| `part`    | counter local to the turn, from 1, reset at turn start | no | yes |
| `delta`   | `text`\|`reasoning`\|`tool`\|`heartbeat` | no | yes |
| `tool-id` | required when `delta` is `tool` | no | cond |
| `p`       | `<pubkey>`, `<relay>`, `<role>` | yes | yes |

**A delta takes no `seq`.** Deltas evaporate at the relay; a number one had consumed would be a permanent hole. A `part` discontinuity means the reader discards that turn's partial buffer and waits for the turn.

An agent SHOULD coalesce deltas into fragments of at least 50 ms or 32 characters, MUST NOT emit one over 4 KiB, and MUST NOT emit one per token.

## Linking an Answer to Its Transcript

An agent that answers in a chat — a `kind:14` private message, a `kind:9` group message — SHOULD carry `["a", "31777:<agent>:<session>"]` on that message. A client that knows this NIP can then offer the transcript from the answer; one that does not ignores an unknown `a` tag, and the message renders as it always did.

This is the whole integration surface for an agent that already publishes plain chat messages: one tag, nothing else changed.

## Ordering

NIP-59 randomises a wrap's `created_at` up to two days back and a seal's up to an hour. Only the rumor's `created_at` is the agent's clock, and it is unsigned — a hint, not a proof. Order rests on `seq`, which is inside the sealed payload and covered by the seal's signature.

1. **Sort by `seq`.** Only `kind:1777` carries one.
2. **Tie-break** on equal `seq`: lower `created_at`, then smaller event `id`. A duplicate `seq` SHOULD be surfaced — it is the visible signature of a replayed or forged event.
3. **Never sort by `created_at` across the wrap boundary.** A rumor more than 900 seconds in the future is displayed with its receipt time and flagged.
4. **Chain check.** `prev` names the event at `seq - 1`. A mismatch means the stream **forked**; a client MUST NOT silently merge the branches.

A gap is any missing `seq` below the head's `last-seq`. A client MUST render it explicitly rather than closing the hole, and MUST NOT block rendering on it. Inner tags are invisible to relays, so a gap that survives a refetch of the wrap window is permanent and the client says so. This NIP deliberately mints no indexable counter: it would leak progress to a relay that can read nothing else.

## Carriage

The agent builds the rumor, seals it in a `kind:13` NIP-44-encrypted to each recipient and signed by its own key, and wraps the seal in a `kind:1059` — or `21059` for a delta — signed by a fresh throwaway key, `p`-tagged to the recipient, `created_at` randomised. One wrap per recipient, each under its own key.

Recipient relays come from their `kind:10050`, else the NIP-65 inbox; a recipient with neither is undeliverable and MUST be reported, not skipped. The agent SHOULD self-wrap so it can re-read its own transcript.

A relay sees a `1059` from a key that exists for one event: not the kind, the session, the agent, the sequence, or that this is an agent at all.

## Publishing in the Clear

An agent MAY publish a session unencrypted — the same events, signed by the same key, to its own NIP-65 write relays. The session id, the `seq` chain and the head are unchanged, so a reader holding both copies sees one session rather than two, and an `naddr` for the head is a shareable address anyone can resolve.

There is one chain and one `last-seq`, so a public copy MUST carry the whole of it. Publishing some turns and not others leaves gaps a reader is required to render as gaps, which is worse than a transcript that was never public.

Two properties to state plainly, because a publisher cannot undo either: the events are permanent — [NIP-09](09.md) is a request, not a delete — and the transcript contains whatever the agent was told, including the operator's own words.

**Only the author can do this.** The seal rule below makes forwarding impossible on purpose: a sharer who re-seals someone else's rumors signs the new seal, and a conforming reader rejects every one. Sharing a transcript you did not author means asking whoever did to publish it.

## Identity and Trust

An agent has **one persistent key**, with a `kind:0` carrying `"bot": true` ([NIP-24](24.md)). The same key signs every head, turn and seal across every session, so an agent is followable and its history is attributable.

Binding an agent to its operator is two-way, and both halves are required: the agent names its operator on the head and every turn, and the human `p`-tags each agent key in a [NIP-51](51.md) `kind:30000` set with `["d","agents"]`. One half alone is an unverified claim and MUST be rendered as such.

Anyone can publish a `1777` carrying any `a` tag; relays index tags, they do not police them. A client MUST therefore:

- **Check the author.** Discard any `1777`/`21777` whose `pubkey` is not the pubkey inside its own `a` address.
- **Check the seal.** The wrap's signature proves nothing — it is a throwaway key by design. The seal's signature is the authorship proof; reject a seal whose author is not the rumor's author.
- **Reject a second address.** Relays index every `a` tag, so an event carrying two is returned by a REQ for either. Accept exactly one.
- **Bound the counters.** `seq`, `turn`, `part` and `last-seq` are attacker-supplied decimal strings, and `last-seq` bounds a walk over a stream's sequence numbers. Refuse a counter beyond a sane ceiling and cap how many missing numbers you will enumerate; otherwise one event is a remote out-of-memory.
- **Treat an orphan as an orphan.** A turn whose head is unknown is labelled as one.

## Size

An event SHOULD stay under 64 KiB and MUST stay under 256 KiB; a wrapped copy is ~1.4× the rumor. A publisher MUST NOT emit an event it knows exceeds the limit; how it gets under is its own business.

Whatever it does MUST be visible. A shortened part carries `truncated` describing the **original** and ends with the marker `…[truncated]`, which a client MUST render. An oversize tool result MAY be referenced instead: `output: null` plus a `ref` whose `sha256` is over the plaintext and is authoritative, and which a client that fetches the blob MUST verify. On a private stream the blob SHOULD be encrypted before upload, since the host would otherwise hold exactly the plaintext the wrap was protecting.

A turn that quietly lost half its content reads as a whole one, which is worse than a short one.

## What a Minimal Client Must Implement

Read: subscribe `{"kinds":[1059],"#p":[<self>]}`, decrypt the wrap, decrypt the seal, check the seal's author against the rumor's, then check the rumor's author against its `a` address. Sort turns by `seq`, render `alt` when `content` will not parse, and compare what you hold against the head's `last-seq`. Deltas and `21059` are optional.

Publish: a persistent key with a `kind:0`, one `31777` head kept current, and one `1777` per message carrying `a`/`seq`/`prev`/`turn`/`role`/`p`/`alt`. Definitions, deltas and blob refs are all optional.

A client MUST NOT require deltas to render a session, nor blob fetching to render a turn.
