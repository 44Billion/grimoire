/**
 * NIP-17 private direct messages.
 *
 * Like the Concord adapter and unlike every other one here, this does not
 * subscribe to relays for its messages. `dm-inbox.ts` opens each gift wrap once
 * and mirrors the rumor to Dexie; `loadMessages` reads that mirror and repaints
 * when `dm-bus` rings. So a conversation paints from disk with no crypto and no
 * signer prompt, and reopening it costs nothing.
 *
 * Two rules here are privacy rules rather than design preferences:
 *
 * - **Every message carries `metadata.reactions`, always present.**
 *   `MessageReactions` opens a relay REQ `{kinds:[7], "#e":[messageId]}` unless
 *   the field is present. A DM's message id is a private rumor id that exists
 *   nowhere public; asking a relay about it announces that the conversation
 *   happened. Reactions come from the local mirror instead — they are kind-7
 *   rumors in gift wraps, as private as the messages they are about.
 * - **A private id is never handed outward.** `messageIdsArePrivate` turns off
 *   every affordance that would put a rumor id into a query or a clipboard —
 *   see `ChatMessageContextMenu`.
 *
 * `metadata.relays` DOES carry both parties' inboxes: that is the reader's own
 * view of their own conversation, and it is what answers "will this arrive".
 * The rule is about never naming those relays in a REQ, not about hiding them
 * from the person whose mail it is.
 */

import { Observable, ReplaySubject } from "rxjs";
import { nip19 } from "nostr-tools";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { ChatProtocolAdapter } from "./base-adapter";
import type { SendMessageOptions } from "./base-adapter";
import type {
  ChatCapabilities,
  Conversation,
  ConversationType,
  DMIdentifier,
  LoadMessagesOptions,
  Message,
  ProtocolIdentifier,
} from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";
import type { EmojiTag } from "@/lib/emoji-helpers";
import accountManager from "@/services/accounts";
import eventStore from "@/services/event-store";
import { getDisplayName } from "@/lib/nostr-utils";
import { getProfileContent } from "applesauce-core/helpers";
import {
  DM_MAX_FUTURE_SECS,
  dmReactionsByTarget,
  dmUnreadSummary,
  foldDmMessages,
  queryConversation,
} from "@/services/dm-store";
import type { DmRumorRow } from "@/services/db";
import { conversationScope, onDmScope } from "@/services/dm-bus";
import { syncDmInbox } from "@/services/dm-inbox";
import { resolveDmRelays, warmDmRelays } from "@/lib/dm/relays";
import { sendDirectMessage, sendDirectReaction } from "@/lib/dm/send";
import { timelineSignature } from "@/lib/chat/timeline-signature";
import { markDmRead, readDmLastRead } from "@/services/dm-reads";

/** What a conversation with yourself is called. */
export const SAVED_MESSAGES_TITLE = "Saved messages";

/** Rows per page, matching the Concord adapter's window. */
const PAGE_ROWS = 200;

/** Whatever kind 0 the store already holds. Never fetched — this is a title. */
function cachedProfile(pubkey: string) {
  const event = eventStore.getReplaceable(0, pubkey, "");
  if (!event) return undefined;
  try {
    return getProfileContent(event);
  } catch {
    return undefined;
  }
}

/**
 * A conversation id: the participants, sorted and colon-joined.
 *
 * Takes either one pubkey or an already-joined id, because both arrive — a 1:1
 * is opened by naming someone, a group by its id from the sidebar — and both
 * have to normalise to the same string or the two would be different
 * conversations.
 */
function conversationIdFor(self: string, peerOrId: string): string {
  return Array.from(new Set([self, ...peerOrId.split(":").filter(Boolean)]))
    .sort()
    .join(":");
}

/**
 * Everyone in a conversation except the viewer.
 *
 * Empty for a note to yourself, one for a 1:1, more for a group — and the
 * whole list matters: the `p` tags ARE the conversation's identity, so sending
 * to a subset files the message under a different conversation than the one on
 * screen.
 */
function othersIn(conversationId: string, self: string): string[] {
  return conversationId.split(":").filter((p) => p && p !== self);
}

/**
 * A stored rumor as the renderers expect an event.
 *
 * `sig` is empty and stays empty: a rumor has none by construction — NIP-59
 * proves authorship with the seal's signature at ingest — and inventing one
 * would claim a proof that does not exist. The Concord adapter does the same.
 */
function toEvent(row: DmRumorRow): NostrEvent {
  return {
    id: row.id,
    pubkey: row.pubkey,
    kind: row.kind,
    content: row.content,
    tags: row.tags,
    created_at: row.created_at,
    sig: "",
  } as NostrEvent;
}

function toMessage(
  row: DmRumorRow,
  conversationId: string,
  reactions: DmRumorRow[] = [],
): Message {
  const parent = row.tags.find((t: string[]) => t[0] === "e" && t[1])?.[1];
  return {
    id: row.id,
    conversationId,
    author: row.pubkey,
    content: row.content,
    timestamp: row.created_at,
    type: "user",
    protocol: "nip-17",
    event: toEvent(row),
    ...(parent ? { replyTo: { id: parent } as EventPointer } : {}),
    metadata: {
      encrypted: true,
      // ALWAYS present, even when empty — see the module docstring. Absent is
      // what makes MessageReactions REQ a private rumor id. True for a legacy
      // row too: its id IS public, but announcing to a relay that you are
      // reading that particular DM is still a disclosure nobody asked for.
      reactions: reactions.map(toEvent),
      ...(row.legacy ? { legacy: true } : {}),
    },
  };
}

export class Nip17Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-17" as const;
  readonly type: ConversationType = "dm";

  private timelines = new Map<string, ReplaySubject<Message[]>>();
  private started = new Set<string>();
  private windows = new Map<string, number>();
  private doorbells = new Map<string, () => void>();
  private lastEmitted = new Map<string, string>();
  private warmed = new Map<string, { unsubscribe(): void }>();

  private self(): string {
    const pubkey = accountManager.active?.pubkey;
    if (!pubkey) throw new Error("Sign in to read direct messages.");
    return pubkey;
  }

  private signer() {
    const signer = accountManager.active?.signer;
    if (!signer?.nip44)
      throw new Error(
        "This account's signer cannot encrypt — NIP-44 is required for private messages.",
      );
    return signer;
  }

  /**
   * `npub` and `nprofile` only.
   *
   * Bare 64-hex is NOT claimed. `chat-parser` is the only caller, and it hands
   * over whatever the reader typed — so claiming hex would mean `chat
   * 3bf0c63f…` opens a private conversation with a stranger when what was
   * pasted was an event id. Internal callers build a `DMIdentifier` directly
   * and never come through here.
   */
  parseIdentifier(input: string): DMIdentifier | null {
    const value = input.trim();

    if (value.startsWith("npub1")) {
      try {
        const decoded = nip19.decode(value);
        if (decoded.type !== "npub") return null;
        return { type: "chat-partner", value: decoded.data };
      } catch {
        return null;
      }
    }

    if (value.startsWith("nprofile1")) {
      try {
        const decoded = nip19.decode(value);
        if (decoded.type !== "nprofile") return null;
        return {
          type: "chat-partner",
          value: decoded.data.pubkey,
          ...(decoded.data.relays?.length
            ? { relays: decoded.data.relays }
            : {}),
        };
      } catch {
        return null;
      }
    }

    return null;
  }

  async resolveConversation(
    identifier: ProtocolIdentifier,
  ): Promise<Conversation> {
    if (
      identifier.type !== "chat-partner" &&
      identifier.type !== "dm-recipient"
    )
      throw new Error(
        `NIP-17 adapter cannot handle identifier type: ${identifier.type}`,
      );

    const self = this.self();
    // A group arrives as its conversation id — the participants, sorted and
    // colon-joined — because that is what the sidebar holds and what a window
    // reloads with. A 1:1 arrives as a single pubkey.
    const participants = conversationIdFor(self, identifier.value)
      .split(":")
      .filter(Boolean);
    const id = participants.join(":");
    const others = participants.filter((p) => p !== self);

    // Warm every participant's relay list now, not at send time. Resolution is
    // on a deadline and a cold read has to reach a relay first, so doing it
    // when the conversation opens is what makes the first send land.
    this.warmed.get(id)?.unsubscribe();
    this.warmed.set(id, warmDmRelays(participants));

    // Every inbox, for the header's relay dropdown: theirs is where your
    // message goes, yours is where their replies land, and a reader wondering
    // whether a message will arrive needs to see both. Resolved with a short
    // deadline — a conversation must open whether or not a relay list does.
    const resolved = await Promise.all(
      participants.map(async (pubkey) => ({
        pubkey,
        ...(await resolveDmRelays(pubkey, 1500)),
      })),
    );
    const relays = Array.from(new Set(resolved.flatMap((r) => r.relays)));
    // In a group this is a LIST: one member with no published inbox does not
    // stop the message reaching the rest, so it is a caveat, not a refusal.
    const unreachable = resolved
      .filter((r) => r.source === "none" && r.pubkey !== self)
      .map((r) => r.pubkey);

    return {
      id,
      type: "dm",
      protocol: "nip-17",
      // A conversation with yourself is a notepad, not correspondence, and
      // titling it with your own display name reads as talking to a stranger
      // who happens to share your face. Otherwise: resolved once from whatever
      // profile is cached, since a DM has no name of its own.
      title:
        others.length === 0
          ? SAVED_MESSAGES_TITLE
          : others.length === 1
            ? getDisplayName(others[0], cachedProfile(others[0]))
            : // A group has no name of its own — NIP-17 defines no metadata
              // for one — so naming it after its members is the honest answer.
              others.map((p) => getDisplayName(p, cachedProfile(p))).join(", "),
      participants: participants.map((pubkey) => ({ pubkey })),
      metadata: {
        encrypted: true,
        giftWrapped: true,
        relays,
        // Named so the header can say WHY a message might not arrive: someone
        // with no DM inbox and no NIP-65 inbox cannot be written to at all.
        ...(unreachable.length > 0
          ? {
              description:
                unreachable.length === 1
                  ? "This person has published no inbox for direct messages."
                  : `${unreachable.length} people here have published no inbox for direct messages.`,
            }
          : {}),
      },
      unreadCount: 0,
    };
  }

  /** Read the current window and fold it. */
  private async read(
    conversationId: string,
    options?: LoadMessagesOptions,
  ): Promise<Message[]> {
    const self = this.self();
    const limit =
      this.windows.get(conversationId) ?? options?.limit ?? PAGE_ROWS;
    const rows = await queryConversation(self, conversationId, { limit });
    const visible = foldDmMessages(rows);
    const reactions = dmReactionsByTarget(
      rows,
      new Set(visible.map((r) => r.id)),
    );
    return visible.map((row) =>
      toMessage(row, conversationId, reactions.get(row.id) ?? []),
    );
  }

  /**
   * Emit only when the timeline actually changed.
   *
   * A repaint with identical content still hands the virtualizer a fresh array,
   * which re-anchors the scroll.
   */
  private publish(
    conversationId: string,
    emitter: ReplaySubject<Message[]>,
    next: Message[],
  ): void {
    const signature = timelineSignature(next);
    if (this.lastEmitted.get(conversationId) === signature) return;
    this.lastEmitted.set(conversationId, signature);
    emitter.next(next);
  }

  loadMessages(
    conversation: Conversation,
    options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const id = conversation.id;

    let subject = this.timelines.get(id);
    if (!subject) {
      subject = new ReplaySubject<Message[]>(1);
      this.timelines.set(id, subject);
    }
    const emitter = subject;

    // Once per conversation: `loadMessages` runs again whenever the caller's
    // `conversation` identity changes, and a second read+sync pair pushing into
    // the same emitter makes the timeline flash.
    if (this.started.has(id)) return emitter.asObservable();
    this.started.add(id);
    this.windows.set(id, options?.limit ?? PAGE_ROWS);

    this.doorbells.get(id)?.();
    this.doorbells.set(
      id,
      onDmScope(conversationScope(id), () => {
        void this.read(id, options)
          .then((next) => this.publish(id, emitter, next))
          .catch(() => undefined);
      }),
    );

    void (async () => {
      try {
        // Paint from the store first — but only if it has something. An empty
        // first read is indistinguishable from an empty conversation, so
        // emitting it puts "no messages" over a history still on the wire.
        const stored = await this.read(id, options);
        if (stored.length > 0) this.publish(id, emitter, stored);

        // Then pull the inbox. The doorbell repaints as rumors land, so this
        // needs no callback of its own.
        await syncDmInbox(this.self(), this.signer());

        // After the sync an empty answer IS the answer.
        this.publish(id, emitter, await this.read(id, options));
      } catch (error) {
        console.warn("[dm] could not load the conversation:", error);
      }
    })();

    return emitter.asObservable();
  }

  /**
   * Page backwards.
   *
   * DM history pages by WRAP, not by conversation: the inbox is one
   * undifferentiated gift-wrap stream and no relay can be asked for "older
   * messages with this person". So widening the local window comes first, and
   * only when that runs dry is another page of the global stream fetched —
   * which may return mostly other people's conversations.
   */
  async loadMoreMessages(
    conversation: Conversation,
    before: number,
  ): Promise<Message[]> {
    const id = conversation.id;
    const self = this.self();
    const previous = this.windows.get(id) ?? PAGE_ROWS;
    this.windows.set(id, previous + PAGE_ROWS);

    const emitter = this.timelines.get(id);
    const repaint = async () => {
      const next = await this.read(id);
      if (emitter) this.publish(id, emitter, next);
      return next;
    };

    const local = await queryConversation(self, id, {
      limit: PAGE_ROWS,
      until: before - 1,
    });
    const older = foldDmMessages(local).filter((r) => r.created_at < before);
    if (older.length > 0) {
      await repaint();
      return older.map((row) => toMessage(row, id));
    }

    // Local history is exhausted for this conversation; walk the wrap stream.
    await syncDmInbox(self, this.signer(), { until: before }).catch(
      () => undefined,
    );
    const after = await repaint();
    return after.filter((m) => m.timestamp < before);
  }

  async sendMessage(
    conversation: Conversation,
    content: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    const self = this.self();
    const peers = othersIn(conversation.id, self);

    let replyTo;
    if (options?.replyTo) {
      const rows = await queryConversation(self, conversation.id, {
        limit: PAGE_ROWS * 5,
      });
      const parent = rows.find((r) => r.id === options.replyTo);
      if (parent)
        replyTo = {
          id: parent.id,
          kind: parent.kind,
          pubkey: parent.pubkey,
          created_at: parent.created_at,
          content: parent.content,
          tags: parent.tags,
        };
    }

    await sendDirectMessage({
      viewer: self,
      signer: this.signer(),
      peers,
      content,
      ...(replyTo ? { replyTo } : {}),
    });
  }

  /**
   * React to a private message.
   *
   * A kind-7 RUMOR in a gift wrap, not a public kind 7 — a public reaction
   * naming a rumor id would announce both that the conversation happened and
   * how someone felt about it.
   */
  async sendReaction(
    conversation: Conversation,
    messageId: string,
    emoji: string,
    customEmoji?: EmojiTag,
  ): Promise<void> {
    const self = this.self();
    await sendDirectReaction({
      viewer: self,
      signer: this.signer(),
      peers: othersIn(conversation.id, self),
      targetId: messageId,
      emoji,
      ...(customEmoji ? { customEmoji } : {}),
    });
  }

  /**
   * Resolve a replied-to message from the local mirror.
   *
   * Never the EventStore and never a relay: rumors exist nowhere but here, and
   * asking a relay for one by id would leak it.
   */
  async loadReplyMessage(
    conversation: Conversation,
    pointer: EventPointer | AddressPointer,
  ): Promise<NostrEvent | null> {
    if (!("id" in pointer)) return null;
    const rows = await queryConversation(this.self(), conversation.id, {
      limit: PAGE_ROWS * 5,
    });
    const row = rows.find((r) => r.id === pointer.id);
    return row ? toEvent(row) : null;
  }

  async getLastRead(conversation: Conversation): Promise<number> {
    return readDmLastRead(this.self(), conversation.id);
  }

  /**
   * Stamp the conversation read, high enough that the badge can clear.
   *
   * `timestampSecs` is the newest message the TIMELINE showed. That is not
   * always the newest row the COUNT counted: the count is a raw scan and the
   * timeline is a fold, so a message its author deleted can be newer than
   * anything on screen. Stamping what was shown would leave a badge no visit
   * can clear. Concord solves it the same way and for the same reason — see
   * `docs/chat-system.md`.
   */
  async markRead(
    conversation: Conversation,
    timestampSecs: number,
  ): Promise<void> {
    const self = this.self();
    // Nothing loaded is not "everything read": without this, `latest` below
    // would stamp a conversation the reader has not seen a message of.
    if (!Number.isFinite(timestampSecs) || timestampSecs <= 0) return;

    const at = Math.floor(Date.now() / 1000);
    const requested = Math.min(timestampSecs, at + DM_MAX_FUTURE_SECS);
    const summary = await dmUnreadSummary(self, conversation.id, {
      after: requested,
      nowSecs: at,
    });

    await markDmRead(
      self,
      conversation.id,
      Math.max(requested, summary.latest),
    );
  }

  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: true,
      supportsThreading: true,
      supportsModeration: false,
      supportsRoles: false,
      supportsGroupManagement: false,
      // A conversation starts by naming someone — there is nothing to create
      // and nothing to join, so the composer offers no such affordance.
      canCreateConversations: false,
      requiresRelay: false,
      // A rumor id exists on no relay: opening it, or copying an `nevent` for
      // it, is a query that announces the conversation happened.
      messageIdsArePrivate: true,
      supportsDeletion: false,
    };
  }

  cleanup(conversationId: string): void {
    super.cleanup(conversationId);
    this.doorbells.get(conversationId)?.();
    this.doorbells.delete(conversationId);
    this.warmed.get(conversationId)?.unsubscribe();
    this.warmed.delete(conversationId);
    this.timelines.delete(conversationId);
    this.started.delete(conversationId);
    this.windows.delete(conversationId);
    this.lastEmitted.delete(conversationId);
  }
}
