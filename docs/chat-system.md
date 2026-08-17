# Chat System

**Status**: NIP-10, NIP-17, NIP-22, NIP-29, NIP-53 and Concord are all
registered. Only NIP-28 (public channels) remains commented out.

## Architecture

A protocol adapter pattern:

- `src/lib/chat/adapters/base-adapter.ts` — interface all adapters implement
- `nip-10-adapter.ts` — thread chat on a kind 1
- `nip-17-adapter.ts` — private direct messages (see below)
- `nip-22-adapter.ts` — comments; the catch-all
- `nip-29-adapter.ts` — relay groups
- `nip-53-adapter.ts` — live activity chat
- `concord-adapter.ts` — E2E-encrypted community channels

Registered in two places, both of which must agree: the `getAdapter` switch in
`src/components/ChatViewer.tsx` and the priority array in
`src/lib/chat-parser.ts`.

## NIP-17 direct messages

**applesauce does the crypto; Dexie does the storage and the reads.** Wraps are
opened once at ingest (`src/services/dm-inbox.ts`) and the rumor is mirrored to
`dmRumors`; the adapter reads that mirror and repaints on a `dm-bus` ring. The
applesauce `WrappedMessages*` models are deliberately unused — they read the
EventStore, and rumors never enter it.

Four things here are load-bearing, and each of them was a bug first:

1. **Reads authenticate; writes do not.** A gift wrap is signed by a throwaway
   key so the relay cannot attribute it, and a socket that has NIP-42 AUTHed as
   the sender gives that away for free. The peer's copy is published on
   `dm-publish-pool.ts`, which no auth manager watches, and a relay answering
   `auth-required` is reported undeliverable rather than satisfied. The inbox
   REQ and the self-copy stay on the singleton pool, where authenticating to
   your own mailbox costs nothing. `hub.ts` refuses to publish anyone else's
   wrap, because applesauce turns an `auth-required` refusal into a retry that
   WAITS for authentication — the leak succeeds rather than failing.
2. **Every `Message` carries `metadata.reactions`, always.** `MessageReactions`
   opens `{kinds:[7],"#e":[id]}` unless the field is present, and a DM's id is a
   rumor id that exists on no relay — the REQ alone announces the conversation.
   Reactions come from the mirror: they are kind-7 rumors in gift wraps.
   `metadata.relays` is empty for the same class of reason.
3. **Side rows are folded across the whole viewer, not the conversation.** A
   NIP-09 delete usually carries only an `e` tag, so it is filed under its
   author alone — and in a group DM under a two-person conversation that does
   not exist. Target ids are globally unique, so the wider read is safe and the
   narrow one loses tombstones. Kind 5 and kind 7 are both side rows, so the
   delete fold matches on kind 5 ALONE: treating them alike makes liking a
   message erase it.
4. **Decrypt once, ever.** Two `nip44.decrypt` calls per wrap, against what may
   be a browser prompt or a bunker. `dmSeenWraps` records every wrap, including
   the ones that would not open; the batch dedupes within itself (applesauce's
   cross-relay dedupe is off, so four inbox relays deliver four copies) and
   across concurrent callers. `DmConsentGate` asks once per account before any
   of it happens.

A conversation with yourself is "Saved messages": pinned above the list, never
unread, and named for what people use it as. It exists whether or not it holds
anything — a notepad you can only reach after writing in it is one nobody finds.

### Legacy NIP-04

`dm-legacy-inbox.ts` imports kind-4 history into the SAME `dmRumors` table and
the same conversations, because a kind-4 exchange with someone is the same
human conversation as the gift-wrapped one. NIP-17 is young; for anyone with
history, the legacy messages ARE the conversation list.

Four things differ from the gift-wrap path, each for its own reason:

1. **The signature is the vetting, not the id.** A kind-4 id was hashed over
   the ciphertext, so it cannot be recomputed from a row holding plaintext.
   `toLegacyDmRow` verifies the signature instead — strictly stronger, since a
   kind 4 is signed and a rumor is not. It rebuilds the event from its fields
   first: `verifyEvent` memoizes its verdict on a symbol, and a spread copy
   carries that symbol, so `{...event, content: forged}` verifies as true.
2. **Two filters.** `{authors:[self]}` for what you sent and `{"#p":[self]}`
   for what you received. A gift-wrap inbox needs only the second, because the
   self-copy is p-tagged to you.
3. **Received is scoped to follows.** The kind-4 era has no gift wrap deciding
   who may write to you, so unscoped this imports the entire spam era — and
   each one costs a signer round trip to discover. The cost is real and stated:
   a legacy message from someone you do not follow is not imported.
4. **The row is marked `legacy`.** A kind 4 hid its contents and nothing else;
   its author, recipient and timing were plain on a public event. The row says
   so rather than rendering under gift-wrap chrome. `messageIdsArePrivate`
   stays `true` for the whole adapter — on a mixed timeline the conservative
   value is the correct one, and the cost is only that Copy ID stays suppressed
   for ids that happen to be public.

Read-only, deliberately. Sending kind 4 means porting a downgrade-consent flow,
and it opens the one real leak: a public event quoting a private rumor id would
put that id on relays permanently.

### Coverage

Everything in this section exists because a message that was fetched and then
silently dropped is indistinguishable, to the reader, from one nobody sent.

- **A relay that did not answer is not a relay with no mail.** `readWrapsPerRelay`
  reports whether each relay ANSWERED. A page nobody answered pauses the walk;
  only an empty answer from a live relay ends it. Conflating the two let a cold
  start — every relay still waiting on the signer — latch `exhausted` forever.
- **The paging bound is the MAX of the per-relay tails**, not the min over the
  merged union. One relay holding a single ancient message would otherwise drag
  `until` past everything a busy relay had in between.
- **The relay-set signature is written when the walk starts**, so a walk
  interrupted before it finishes resumes instead of restarting from the newest
  page.
- **Write, then mark seen** — in that order, per wave. The reverse leaves wraps
  recorded as opened with no row behind them, and the seen memo never hands
  those back.
- **Reading is wider than sending.** A send goes to exactly what the recipient
  nominated; a read of your own inbox unions the 10050, BOTH sides of the
  NIP-65 list, and the configured read relays, because a wrap delivered to the
  wrong relay is still yours and asking costs one REQ.

## Key components

- `src/components/ChatViewer.tsx` — protocol-agnostic chat interface
- `src/components/chat/ReplyPreview.tsx` — reply context with scroll-to
- `src/lib/chat-parser.ts` — auto-detects protocol from identifier format
- `src/types/chat.ts` — protocol-agnostic types (`Conversation`, `Message`, …)

## NIP-29 identifier format

`relay'group-id` (the `wss://` prefix is optional):

```bash
chat relay.example.com'bitcoin-dev
chat wss://nos.lol'welcome
```

Groups live on a single relay that enforces membership and moderation.
Messages are kind 9, metadata kind 39000, admins kind 39001, members kind 39002.

## Read state (optional adapter surface)

Two optional methods on `ChatProtocolAdapter`, implemented only by Concord:

- `getLastRead(conversation): Promise<number>` — unix seconds, 0 for never read
- `markRead(conversation, timestampSecs): Promise<void>` — monotonic

`useReadMarker` (`src/hooks/useReadMarker.ts`) drives both and returns the id of
the message the "New" divider belongs above. Three rules matter to anyone
implementing this for another protocol:

1. **Read before write.** Opening a conversation is what moves the stamp, so the
   pre-visit value is captured first and the divider is measured against that
   frozen number for the whole visit. Reversing the order silently deletes the
   divider.
2. **The stamp must be able to cover everything the count counts.** If the
   protocol hides rows the store still holds — moderation, expiry, key rotation —
   then the newest message the viewer can show is older than the newest unread
   row, and stamping what the viewer showed leaves a badge nothing can clear.
   Concord resolves this in `markRead`: it stamps
   `max(clamped newest loaded, summary.latest)`, where `latest` is by
   construction the newest row the count counted
   (`channelUnreadSummary`, `src/services/concord-rumor-store.ts`).
3. **Bound both sides by the same clock allowance.** Message timestamps are
   author-chosen. Concord's scan and stamp both stop at
   `now + CONCORD_READ_MAX_FUTURE_SECS`; clamping one and not the other either
   pins the badge forever or marks the conversation read for years.

A conversation with `lastRead === 0` gets badges but no divider — flagging the
whole history of a channel someone just joined is noise.

Stamps live in the `chatReads` Dexie table, keyed
`[pubkey+protocol+containerId+channelId]`, and are wiped on logout for every
protocol the account holds. The table is shared by design — a NIP-29
`(relay, group)` pair is the same row shape as a Concord `(community, channel)`
one — but only Concord writes it today, because the COUNTING behind the badge
scans `concordRumors` through the fold pipeline. Nothing about read state is
ever published: no CORD document defines a read marker.

Notification levels are keyed the same way:
`chatnotif:<protocol>|<container>[|<channel>]` in `concordKv`, which a Concord
logout empties whole.

## Local search (Concord only)

`searchConcordMessages` (`src/services/concord-search.ts`) does **not** query
rows. It runs each in-scope channel through the same pipeline the timeline reads
with — `queryChannelRumors` → stamp the channel's `current.epoch` →
`filterEpochCutoff` → `foldTimeline(…, chatModerationOf(folded, community.id))`
— and matches a case-insensitive substring over the FOLDED messages.

That is the invariant: **a hit is a strict subset of what the channel would
render.** Banned authors, expired rumors, retired-epoch rows and deleted
messages are absent by construction rather than by a second set of rules, and an
edited message matches its edited text because the fold applied the edit first.
`chatModerationOf` (`src/lib/concord/chat.ts`) exists so the timeline and the
search cannot wire moderation differently.

`SEARCH_SCAN_LIMIT` bounds the store read as well as the fold: since the paging
fix, `queryChannelRumors` walks the `[communityId+channel+created_at]` index
backwards and stops once the limit's worth of row-kind rows is collected, and
search passes no `until`, so the side-event top-up query never runs. A match
older than a channel's newest 5000 rows is invisible.

Search is Concord's alone because its corpus is the local plaintext rumor store.
NIP-29 messages live in the EventStore with no local mirror, so there is nothing
to generalize over yet.

### Jumping to a hit

`ChatViewer`'s `jumpTo={{ messageId, nonce }}` is a REQUEST, and two rules keep
it one:

- **Wait for the resolved conversation's own messages.** `use$` publishes from
  an effect, so on the render where `conversation` first exists, `messages` is
  still `undefined` — and `useJumpToMessage` gives up silently on an empty
  timeline, because there is no oldest row to page below and nothing was paged
  to warrant a toast. Starting there spends the request on a look that never
  happened. This is not a cross-channel concern: the results pane replaces
  ChatViewer, so every click lands on a cold mount.
- **The caller forgets the request, not the viewer.** For the same reason —
  ChatViewer unmounts whenever search is open — consumption tracked only in a
  ref inside it would let a fresh instance honour a request the reader already
  saw answered. `onJumpHandled(nonce)` fires when the walk ends, and
  `ConcordViewer` clears `jumpTo` if the nonce still matches.

`src/hooks/useJumpToMessage.request.test.tsx` drives both against the real
hooks, because everything wrong here was timing.

## Moderation rendering (Concord only)

Nothing is ever removed from `concordRumors` — `writeChatRumors` only puts — so
a kind-5 and its target both persist and `foldTimeline` re-applies the removal
on every read. (Armada physically deletes; CORD authorizes a moderator delete
without mandating removal, so the two clients differ and both are honest.)

`FoldedTimeline.removed` carries the moderator removals only. The adapter maps
each to a `Message` with `metadata.deleted` and `metadata.deletedBy`, and
ChatViewer renders it as a muted row naming author and remover. Three details
are load-bearing:

- **Self-deletes leave nothing.** They are not in `removed`; a tombstone would
  advertise the erasure the spec's carve-out protects.
- **The `event` is scrubbed** — empty content, empty tags — while `id` stays the
  real rumor id for keying and dedupe. `Message.event` is documented as "the
  original event for verification", a contract Concord already voids (`sig` is
  empty; rumors have none and nothing re-verifies). The row exposes no
  raw-event affordance, but a future generic "view raw event" over
  `Message.event` must special-case a deleted row.
- **Tombstones are `type: "user"`, not `"system"`.** `groupSystemMessages`
  collapses only system rows, and a collapsed tombstone would take a jump target
  with it. The adapter's emitter dedupe signature also counts
  `metadata.deleted`, because a delete landing mid-session changes no id, no
  timestamp and no delivery state.

## Adding a protocol

1. Extend `ChatProtocolAdapter` in `src/lib/chat/adapters/`
2. Implement `parseIdentifier`, `resolveConversation`, `loadMessages`, `sendMessage`
3. Register the adapter in `src/lib/chat-parser.ts` and `src/components/ChatViewer.tsx`
4. Update the command docs in `src/types/man.ts`
