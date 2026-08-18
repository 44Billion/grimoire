NIP-xx
======

Agent Sessions
--------------

`draft` `optional`

## Abstract

This NIP defines five event kinds that encode the working transcript of an autonomous agent — an LLM-driven process — as Nostr events: an addressable **agent definition** (`kind:31779`), an addressable **session head** (`kind:31777`), a per-message **turn** (`kind:1777`), a coarse **milestone** (`kind:1778`), and an ephemeral **delta** (`kind:21777`).

The same kinds are carried unchanged over three transports: as NIP-59 gift-wrapped rumors to a private audience, as plain signed events in a NIP-29 group, or as rumors inside a Concord plane's stream envelope. Only the envelope and the redaction profile differ; the inner shape never does. A client that can render a session from one transport can render it from all three.

## Rationale

Existing chat kinds (`kind:9`, `kind:14`, `kind:1111`) can carry an agent's prose, but they discard the structure that makes a transcript worth reading back: which tool was called with which arguments, what the tool returned, what the model was thinking, what it cost, and where in the run this fragment belongs. This NIP keeps that structure, and keeps the ordering recoverable even when the transport deliberately lies about time.

### Relationship to NIP-90 `kind:7000`

**Rejected as the carrier; adopted as the vocabulary.**

NIP-90's job-feedback event is a *regular, stored* kind whose identity is an `e` tag pointing at a job request, and whose lifecycle is bound to a payment negotiation between a customer and a service provider. An agent session is not a job: it has no request event, no bid, no payment leg, and it emits far more feedback than a DVM job does — inlining token-level progress into a stored regular kind would flood relays obliged to keep it forever.

This NIP therefore splits progress by *storage class*: `kind:21777` (ephemeral) for high-frequency deltas, and `kind:1778` (regular) for coarse milestones a reader still wants an hour later. The `status` values (`processing`, `partial`, `success`, `error`, `payment-required`) are taken verbatim from NIP-90, plus `awaiting-input`, so an implementer who already renders `kind:7000` reuses that switch.

An agent that *is* a DVM MAY additionally emit `kind:7000`. It MUST NOT be the only progress signal, and the `kind:7000` copy carries no session ordering.

## Kinds

| kind    | class                     | name             | storage   | why this range |
| ------- | ------------------------- | ---------------- | --------- | -------------- |
| `31779` | addressable (30000-39999) | Agent Definition | one per `(pubkey, d)` | An agent has one current description. `d` is the agent's slug, so one key MAY host several agents. |
| `31777` | addressable (30000-39999) | Session Head     | one per `(pubkey, d)` | A session has one current state. `d` is the session id, so one agent runs many concurrent sessions. |
| `1777`  | regular (0-9999)          | Session Turn     | permanent | The transcript is append-only. Nothing overwrites a turn; a correction is a new turn. |
| `1778`  | regular (0-9999)          | Milestone        | permanent | Coarse progress a late joiner must still be able to fetch. |
| `21777` | ephemeral (20000-29999)   | Delta            | none      | Token-level output. Relays MUST NOT store it; a client that missed a delta recovers the same content from the `kind:1777` that follows. |

Envelope kinds are reused unchanged: `kind:1059` gift wrap and `kind:13` seal (NIP-59) for stored private copies, `kind:21059` for private deltas so the wrap is dropped along with its payload.

## Agent Definition — `kind:31779`

Addressable. Authored by the agent's own key. What the agent *is*, as opposed to what one run of it is doing. `content` is a JSON object.

| tag       | values | indexable | req | description |
| --------- | ------ | --------- | --- | ----------- |
| `d`       | `<slug>` | yes | yes | The agent's identifier under its key. |
| `name`    | `<string>` | no | yes | Display name. |
| `picture` | `<url>` | no | no | Avatar. |
| `about`   | `<string>` | no | no | One line on what it does. |
| `tool`    | `<tool-name>` | yes | no | One per tool the agent can call. Indexable, so `{"#tool":["nostr.req"]}` finds every agent that can do a thing. |
| `try`     | `<string>` | no | no | A starter prompt a client offers before the first message. |
| `alt`     | `<string>` | no | yes | [NIP-31](31.md). |

`content`:

```
{ "v": 1,
  "instructions"?: <string>,             // the system prompt, verbatim
  "tools"?: [ { "name", "description", "parameters" } ] }
```

`instructions` is published verbatim or omitted entirely. An operator who does not want the prompt public omits the field rather than publishing a redacted one — a half-published prompt reads as the whole one.

```json
{
  "kind": 31779,
  "pubkey": "9e1f…agent",
  "content": "{\"v\":1,\"instructions\":\"You are Hex, a Nostr agent…\",\"tools\":[{\"name\":\"nostr.req\",\"description\":\"Query relays\",\"parameters\":{}}]}",
  "tags": [
    ["d", "hex"],
    ["name", "Hex"],
    ["picture", "https://…/hex.png"],
    ["about", "Answers questions about Nostr REQs, in the room you ask them in."],
    ["tool", "nostr.req"],
    ["try", "what kinds does this relay serve?"],
    ["alt", "Hex — a Nostr agent answering REQ questions"]
  ]
}
```

## Session Head — `kind:31777`

Addressable. Authored by the agent's key. `content` is a human-readable summary and MAY be empty.

| tag         | values | indexable | req | description |
| ----------- | ------ | --------- | --- | ----------- |
| `d`         | `<session-id>` | yes | yes | 64-char lowercase hex, 32 random bytes. Stable for the life of the session across every mirror. |
| `title`     | `<string>` | no | yes | Short human title. |
| `status`    | `active`\|`idle`\|`done`\|`error`\|`aborted` | no | yes | The last three are terminal. |
| `p`         | `<pubkey>`, `<relay>`, `operator` | yes | yes | The human on whose behalf the agent runs. Exactly one. |
| `p`         | `<pubkey>`, `<relay>`, `observer` | yes | no | Further recipients of the private stream. |
| `stream`    | `<transport>`, `<address>`, `<visibility>`, `<redaction>` | no | yes | One per mirror. `<transport>` is `nip17`\|`nip29`\|`concord`. |
| `last-seq`  | `<integer>` | no | yes | Highest `seq` emitted on this stream, over turns and milestones. A reader holding fewer knows it has a gap. |
| `head`      | `<event-id>` | no | no | Id of the most recent turn on this stream. |
| `turns`     | `<integer>` | no | yes | Turns so far. |
| `started`   | `<unix-seconds>` | no | yes | Real start time, not subject to NIP-59 randomization. |
| `ended`     | `<unix-seconds>` | no | no | Present iff `status` is terminal. |
| `model`     | `<model-id>`, `<provider>` | no | no | Current model. |
| `usage`     | `<in>`, `<out>`, `<cache-read>`, `<cache-write>` | no | no | Session totals, decimal strings. |
| `cost`      | `<amount>`, `<currency>` | no | no | Session cost. Omitted under the `public` profile. |
| `agent`     | `31779:<pubkey>:<slug>` | no | no | The definition this run is of. |
| `redaction` | `full`\|`summary`\|`public` | no | yes | Profile applied to this copy. |
| `alt`       | `<string>` | no | yes | [NIP-31](31.md). |

**The head takes no `seq` of its own.** It is addressable, so a public relay deletes the version it supersedes — a sequence number the head had consumed would name an event no longer on the relay, and every later reader would see a permanent hole it is told to try to fill and never can. This is the same reason deltas take no `seq`.

On a private stream the head is a rumor inside a wrap, so relays cannot replace it: replaceability is applied client-side, keeping the newest `created_at` per `(pubkey, d)`. On a public mirror ordinary relay replaceability applies.

```json
{
  "kind": 31777,
  "pubkey": "9e1f…agent",
  "created_at": 1755500123,
  "content": "",
  "tags": [
    ["d", "3a7c1f9e…4e5f"],
    ["title", "relay-subscription refactor"],
    ["status", "active"],
    ["p", "1a2b…human", "wss://relay.example", "operator"],
    ["stream", "nip17", "1a2b…human", "private", "full"],
    ["stream", "nip29", "wss://groups.example'grimoire-agents", "public", "public"],
    ["last-seq", "47"], ["head", "b17c…"],
    ["turns", "12"], ["started", "1755498000"],
    ["model", "claude-opus-5", "anthropic"],
    ["usage", "184320", "9211", "160000", "24320"],
    ["cost", "0.84", "USD"],
    ["agent", "31779:9e1f…agent:grimoire-ai"],
    ["redaction", "full"],
    ["alt", "Agent session: relay-subscription refactor (active, 12 turns)"]
  ]
}
```

## Session Turn — `kind:1777`

Regular. One event per message in the conversation: one user prompt, one assistant reply, or one tool result. `content` is a JSON array of **content blocks**, in order — the one place this NIP puts structure in `content` rather than in tags, because a turn's payload is a sequence, tags are a set, and tool arguments are arbitrary JSON that has no honest tag encoding.

### Content blocks

```
text        = { "type": "text",        "text": <string>, "truncated"?: <truncation> }
thinking    = { "type": "thinking",    "text": <string>, "truncated"?: <truncation> }
tool_call   = { "type": "tool_call",   "id": <string>, "name": <string>,
                "arguments": <object>|null, "arguments_digest"?: <sha256> }
tool_result = { "type": "tool_result", "id": <string>, "name": <string>, "ok": <bool>,
                "output": <string>|null, "ref"?: <blob-ref>, "truncated"?: <truncation> }
image       = { "type": "image",       "url": <string>, "mime": <string>, "sha256"?: <hex> }

truncation  = { "bytes": <int>, "sha256": <hex> }        // of the ORIGINAL
blob-ref    = { "sha256", "url", "size", "mime",
                "encryption"?: { "algorithm": "aes-gcm", "key", "nonce", "ox" } }
```

`arguments: null` with `arguments_digest` present means the arguments were redacted; the digest still lets a reader holding the full copy prove the two are the same call. `output: null` with `ref` present means the result was too large to inline.

### Tags

| tag        | values | indexable | req | description |
| ---------- | ------ | --------- | --- | ----------- |
| `a`        | `31777:<agent>:<session>`, `<relay>` | yes | yes | The session. The only session pointer, so `{"#a":["31777:…"]}` fetches a whole public transcript. |
| `seq`      | `<integer>` | no | yes | Per-stream counter, from 1, no gaps intended. |
| `prev`     | `<event-id>` | no | yes* | Id of the event at `seq - 1`. Omitted only when `seq` is 1. |
| `turn`     | `<integer>` | no | yes | Logical turn index. An assistant reply and its tool results share it. |
| `role`     | `user`\|`assistant`\|`tool` | no | yes | |
| `p`        | `<pubkey>`, `<relay>`, `<role>` | yes | yes | Operator and observers, as on the head. |
| `h`        | `<group-id>` | yes | cond | Required on NIP-29 mirrors, forbidden elsewhere. |
| `ms`       | `0`-`999` | no | no | Sub-second refinement of `created_at`, strict decimal. |
| `stop`     | `end_turn`\|`max_tokens`\|`tool_use`\|`content_filter`\|`error` | no | no | `role=assistant` only. |
| `model`    | `<model-id>`, `<provider>` | no | no | `role=assistant` only. |
| `usage`    | `<in>`, `<out>`, `<cache-read>`, `<cache-write>` | no | no | This turn only. |
| `cost`     | `<amount>`, `<currency>` | no | no | This turn only. |
| `tool`     | `<tool-name>` | yes | no | One per distinct tool referenced in `content`. |
| `redaction`| profile | no | yes | |
| `alt`      | `<string>` | no | yes | Plain-text rendering. A client that cannot parse the blocks renders this. |

```json
{
  "kind": 1777,
  "pubkey": "9e1f…agent",
  "created_at": 1755500118,
  "content": "[{\"type\":\"thinking\",\"text\":\"the caller never unsubscribes\"},{\"type\":\"text\",\"text\":\"Found it.\"},{\"type\":\"tool_call\",\"id\":\"tc_01\",\"name\":\"Bash\",\"arguments\":{\"command\":\"npm test\"}}]",
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
    ["redaction", "full"],
    ["alt", "Assistant: found it. Calling Bash."]
  ]
}
```

## Milestone — `kind:1778`

Regular. One per phase change, tool invocation, permission request, or terminal outcome. An agent SHOULD emit fewer than one per second and MUST NOT emit one per token.

`content` is **plain human-readable text** — the opposite choice from a turn, and deliberately so: a milestone exists to be shown to a person in a sidebar or a room, and any client that can render `kind:9` can render this.

| tag       | values | indexable | req | description |
| --------- | ------ | --------- | --- | ----------- |
| `a`       | `31777:<agent>:<session>` | yes | yes | Session. |
| `seq`     | `<integer>` | no | yes | Shares the stream's counter with `kind:1777`. |
| `prev`    | `<event-id>` | no | yes* | As for a turn. |
| `status`  | `processing`\|`partial`\|`success`\|`error`\|`payment-required`\|`awaiting-input` | yes | yes | NIP-90 vocabulary. |
| `turn`    | `<integer>` | no | no | Turn this falls inside. |
| `step`    | `<n>`, `<total>` | no | no | `<total>` MAY be `?`. |
| `tool`    | `<tool-name>`, `<tool-call-id>` | yes | no | |
| `e`       | `<event-id>`, `<relay>`, `turn` | yes | no | The turn this milestone describes. |
| `p`       | `<pubkey>`, `<relay>`, `<role>` | yes | yes | |
| `h`       | `<group-id>` | yes | cond | NIP-29 mirrors only. |
| `redaction`| profile | no | yes | |
| `alt`     | `<string>` | no | yes | |

Within one stream, `seq` is unique across `1777` and `1778`. The head and the deltas take none.

## Delta — `kind:21777`

Ephemeral. Relays MUST NOT store it, and a client MUST NOT treat its absence as data loss: everything it carries is repeated in the `kind:1777` that closes the turn.

`content` is the raw appended fragment — text for `text`/`thinking`, empty for `heartbeat`. Deltas are appended, never merged out of order.

| tag       | values | indexable | req | description |
| --------- | ------ | --------- | --- | ----------- |
| `a`       | `31777:<agent>:<session>` | yes | yes | Session. |
| `turn`    | `<integer>` | no | yes | Turn being streamed. |
| `part`    | `<integer>` | no | yes | Counter local to the turn, from 1, reset at turn start. |
| `delta`   | `text`\|`thinking`\|`tool`\|`heartbeat` | no | yes | `heartbeat` carries empty content and only asserts liveness. |
| `tool-id` | `<tool-call-id>` | no | cond | Required when `delta` is `tool`. |
| `p`       | `<pubkey>`, `<relay>`, `<role>` | yes | yes | |
| `h`       | `<group-id>` | yes | cond | NIP-29 mirrors only. |
| `redaction`| profile | no | yes | |

**A delta does not consume stream `seq`.** Deltas evaporate at the relay; if they burned sequence numbers, every stored transcript would show holes below `last-seq` forever and a reader could not tell "that seq was a delta" from "history is missing". A `part` discontinuity within a turn means the client discards that turn's partial buffer and waits for the `kind:1777`.

An agent SHOULD coalesce deltas into fragments of at least 50 ms or 32 characters, MUST NOT emit one larger than 4 KiB, and SHOULD fall back to a `heartbeat` every few seconds once a turn has emitted an unreasonable number of them.

## Ordering

NIP-59 requires a gift wrap's `created_at` to be randomized up to two days in the past and a seal's up to one hour. Only the **rumor's** `created_at` is the agent's real clock, and it is unsigned — a hint, not a proof. Ordering therefore rests on `seq`, which lives inside the sealed payload and is covered by the seal's signature.

1. **Group by stream.** A stream is the pair (`a` address, transport the event arrived on). Sequence numbers from a private NIP-17 copy and a public NIP-29 copy of the same session are in **different spaces** and MUST NOT be compared.
2. **Sort by `seq` ascending**, over `1777` and `1778` only — the two kinds that carry one.
3. **Tie-break** on equal `seq`: lower rumor `created_at` first, then lower `ms`, then lexicographically smaller event `id`. A duplicate `seq` SHOULD be surfaced as a warning — it is the visible signature of a replayed or forged event.
4. **Never sort by `created_at` across the wrap boundary.** A client that sorts a private transcript by the outer timestamp renders it in near-random order over a two-day window. Display timestamps come from the rumor and SHOULD be clamped: a rumor more than 900 seconds in the future is displayed with its receipt time and flagged.
5. **Chain check.** `prev` names the event at `seq - 1`. A reader holding both and finding a mismatch MUST treat the stream as forked from that point and MUST NOT silently merge the branches.

### Gaps

A gap is any missing `seq` below the head's `last-seq`. A client:

- MUST render an explicit gap marker rather than closing the hole silently;
- SHOULD try to fill it. On a public transport that is `{"kinds":[1777,1778],"#a":["31777:…"]}` and a local filter on `seq`. There is no relay-side `seq` filter, and this NIP deliberately mints no indexable counter — sessions are small enough to fetch whole, and an indexable per-event counter would leak progress to the relay on private streams too;
- on a wrapped transport cannot query at all, since inner tags are invisible to relays. It refetches the wrap window (`{"kinds":[1059,21059],"#p":[<self>]}`) and re-derives; a gap that survives a full refetch is permanent, and the client says so;
- MUST NOT block rendering on a gap. A missing delta is a non-event; a missing turn is a hole in history.

## Encryption and Addressing per Channel

### Private (NIP-17 / NIP-59)

The agent builds a rumor — unsigned, `pubkey` = the agent's key, `id` = the event hash — seals it in a `kind:13` NIP-44-encrypted to each recipient and signed by the agent key, then wraps the seal in a `kind:1059` (or `kind:21059` for a delta) signed by a fresh throwaway key, `p`-tagged to the recipient, with a randomized `created_at` per NIP-59. One wrap per recipient, each under its own throwaway key.

Recipient relays come from the recipient's `kind:10050`, falling back to the NIP-65 inbox. A recipient with neither is undeliverable and MUST be reported, not silently skipped. The agent SHOULD self-wrap so it can re-read its own transcript.

A relay sees an event of kind `1059`/`21059` from a key that exists for one event, addressed to one pubkey, at a plausible-but-wrong time. It cannot see the kind, the session, the agent, the sequence number, or that this is an agent transcript at all.

### Public (NIP-29)

Events are published plain and signed by the agent's key, with `["h","<group-id>"]`, to the group's relay only.

Group relays gate by `kind:39000`'s `supported_kinds`. If it is present and lists neither `1777` nor `1778`, the mirror MUST degrade: publish the milestone as a `kind:9` whose `content` is the milestone text, carrying the same `a`, `seq`, `status` and `h` tags. A conforming client dedupes such a `kind:9` against the `kind:1778` with the same `(a, seq)`. If `supported_kinds` lacks `9` as well, the group is not a valid mirror target and the agent MUST refuse the stream rather than publish into a black hole.

Deltas SHOULD NOT be mirrored to a group unless it explicitly lists `21777`.

### Concord

Rumors are identical; the envelope is Concord's. The wrap's author is the plane's derived stream key with an ephemeral `p` tag, encrypted under the stream's own NIP-44 key, `1059` for stored and `21059` for ephemeral, read back by `#channel`. Authorship inside is still the seal signature.

### Mirroring one session to several channels

The session id is shared across mirrors — that is what lets a reader correlate the public progress feed with the private transcript they can decrypt. Per stream, the following MUST differ:

- **`seq`** — an independent counter. A redacted mirror drops whole events, so a shared counter would hand every public reader permanent unfillable gaps.
- **`redaction`**, and the head's **`last-seq`** and **`head`**.

The following MUST be identical: the session id, `turn`, `role`, `status`, and the `operator` `p` tag. The merge key for a client holding two mirrors is `(session-id, turn, role, block-index)` — never the event id, which necessarily differs.

An observer of the public group learns from the head's `stream` tags that a private mirror exists. An agent that must hide that publishes a head to the group carrying only the group's own `stream` tag.

## Redaction Profiles

| content | `full` | `summary` | `public` |
| ------- | ------ | --------- | -------- |
| `text` blocks | verbatim | verbatim | verbatim, paths stripped |
| `thinking` blocks | verbatim | dropped | dropped |
| tool `arguments` | verbatim | verbatim | `null` + `arguments_digest` |
| tool `output` | verbatim or `ref` | first 1 KiB + `truncated` | dropped; `ok` only |
| `image` blocks | verbatim | verbatim | dropped |
| `usage` | present | present | present |
| `cost` | present | present | **omitted** |
| filesystem paths, home dirs, `file://` and `ssh://` URLs | verbatim | verbatim | **stripped** from `text` and `alt` |
| deltas | emitted | emitted | not emitted |

A publisher MUST apply the profile **before** signing; there is no post-hoc redaction on Nostr. A client MUST NOT infer that a `public` copy is complete, and SHOULD show a redaction affordance wherever `arguments` is `null` with a digest present.

## Identity and Trust

**An agent has one persistent key.** It publishes a `kind:0` with `"bot": true` ([NIP-24](24.md)), a name and an about, and optionally a `kind:31779` definition. The same key signs every head, every turn and every seal, across all sessions and transports — so an agent is followable and its history is attributable.

**Binding an agent to its operator is two-way, and both halves are required.**

1. The agent asserts its operator: the head and every turn carry `["p", <operator>, <relay>, "operator"]`, signed by the agent's key.
2. The operator asserts its agents: the human publishes a [NIP-51](51.md) `kind:30000` follow set with `["d","agents"]`, `p`-tagging each agent key they run. This NIP mints no new roster kind; `kind:30000` already means exactly this.

A client MUST treat a session as run by a given human only when both halves hold. One half alone is an unverified claim and MUST be rendered as such.

**What an unauthenticated observer can forge.** Anyone can publish a `kind:1777` carrying any `a` tag; relays index tags, they do not police them. The defences are:

- **Author equality.** A client MUST discard any `1777`/`1778`/`21777` whose `pubkey` differs from the pubkey component of its own `a` address. The address contains the agent's key, so this alone kills the naive forgery.
- **Seal equality.** For wrapped copies the gift wrap's signature proves nothing — it is a throwaway key by design. The **seal's** signature is the authorship proof: made by the agent's persistent key over the encrypted rumor. A client MUST verify that the seal's author is the rumor's author and reject otherwise; a mismatch is someone forwarding another agent's words as their own.
- **Chain continuity.** `prev` and `seq` make silent insertion into an existing transcript detectable.
- **One address per event.** A relay indexes every `a` tag it sees, so an event carrying two addresses is returned by a REQ for either. A client MUST reject an event with more than one `a` address, or an attacker's event — honest about its own session, and so passing the author check — is filed inside somebody else's transcript.
- **Bounded counters.** `seq`, `turn`, `part`, `turns` and `last-seq` are attacker-supplied decimal strings, and `last-seq` bounds a walk over every sequence number a stream should hold. A client MUST refuse a counter beyond a sane ceiling and MUST bound how many missing numbers it will enumerate; otherwise one event is a remote out-of-memory.
- **The head is the root.** A turn whose session head is unknown is an orphan and MUST be labelled as one.

In a NIP-29 group the events are signed directly, so the event signature is the authorship proof. The relay's membership enforcement (`kind:9000`/`9021`) is an *authorization* fact — it says the relay let this key post here — and MUST NOT be read as an identity fact. Cross-check the author against the head's pubkey exactly as on the private path.

## Size Limits, Truncation and Blobs

- An event SHOULD stay under **64 KiB** serialized and MUST stay under **256 KiB**. A wrapped copy is roughly 1.4× the rumor after NIP-44 and base64.
- A `text` or `thinking` block SHOULD be truncated at **8 KiB**, a `tool_result` `output` at **16 KiB**.
- Truncation is explicit: the block gains `"truncated": {"bytes", "sha256"}` describing the **original**, and the retained text carries the marker `…[truncated]`. A client MUST render the marker and MUST NOT hide it.
- **Oversize tool results are referenced, not inlined.** The publisher uploads the full output to a content-addressed store and sets `"output": null` with `"ref"`. The `sha256` is over the plaintext and is authoritative: a client that fetches the blob MUST verify the digest and MUST show the result as unverified if it does not match. On a private stream the blob SHOULD be encrypted before upload with a per-blob key carried in `ref.encryption`, since the host would otherwise hold exactly the plaintext the wrap was protecting.
- A publisher MUST NOT emit an event it knows exceeds the limit. When a turn is still too large after truncation, `thinking` is elided first — it is the least load-bearing and usually the largest — and then EVERY block is fitted against a total budget rather than a per-block one, `tool_call` arguments included: an oversize call drops its arguments for a digest, exactly as the `public` profile does.
- A block there was no room for is replaced by a marker saying how many were omitted. A turn that quietly lost half its content reads as a complete turn, which is worse than a short one.
- A turn that cannot be fitted at all is split: several `kind:1777` with the same `turn`, consecutive `seq`, and blocks partitioned in order.

## What a Minimal Client Must Implement

To **read** a public session:

1. `REQ {"kinds":[31777],"authors":[<agent>],"#d":[<session>]}` for the head.
2. `REQ {"kinds":[1777,1778],"#a":["31777:<agent>:<session>"]}` for the transcript.
3. Discard events whose `pubkey` is not the address's pubkey.
4. Sort by `seq`; render `alt` when `content` cannot be parsed.
5. Compare what is held against `last-seq` and show a gap marker.

To **read** a private session, add: subscribe `{"kinds":[1059],"#p":[<self>]}`, decrypt the wrap, decrypt the seal, verify the seal's author is the rumor's author, then continue from step 3. Handling `21059` and live deltas is optional.

To **publish**, a minimal agent needs: a persistent key with a `kind:0`, one `31777` head kept current, one `1777` per message carrying `a`/`seq`/`prev`/`turn`/`role`/`p`/`alt`, and a terminal head update. Definitions, milestones, deltas, blob refs and multi-stream mirroring are all optional.

A client MUST NOT require deltas to render a session, and MUST NOT require blob fetching to render a turn.
